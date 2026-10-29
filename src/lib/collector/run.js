import { ObjectId } from "mongodb";
import { SOURCES } from "./sources/index.js";
import { addressFamily, addressKey, normalizeAddress, resolveTargets } from "./util/address.js";
import { runWithSignal } from "./util/http.js";
import { runWalletsCollection, syncErrorsCollection, syncRunsCollection, walletsCollection } from "./db.js";

const WRITE_BATCH = 1000;

// Confidence penalty when an EVM address is applied to a chain the publisher did not name.
const MIRROR_PENALTY = 10;
const CATEGORY_PRIORITY = ["SANCTIONS", "ISSUER_FREEZE", "HACK_EXPLOIT", "SCAM_PHISHING"];

// A source that doesn't finish in time keeps its current listings (sources can override).
const DEFAULT_SOURCE_TIMEOUT_MS = 4 * 60 * 1000;
// A run still "running" after this belongs to a crashed process (the slowest source is capped at 8 min).
const RUN_STALE_MS = 20 * 60 * 1000;

/**
 * Largest drop in record count (vs the source's current listings) accepted without review, by tier.
 * Sanctions are almost never delisted in bulk, so a big drop usually means the publisher
 * changed its format and our parser missed entries. Sources can override with `maxShrink`.
 */
const MAX_SHRINK_BY_TIER = { 1: 0.1, 2: 0.05, 4: 0.3 };

const sourceMeta = (s) => ({
  id: s.id,
  name: s.name,
  authority: s.authority,
  jurisdiction: s.jurisdiction,
  tier: s.tier,
  confidence: s.confidence,
  category: s.category,
  license: s.license,
  homepage: s.homepage,
});

const countBy = (list, fn) =>
  list.reduce((acc, x) => {
    const k = fn(x);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

const recordStats = (records) => ({ records: records.length, byChain: countBy(records, (r) => r.chain) });

/** Raw source items -> validated, per-chain, de-duplicated records. */
function toRecords(source, items) {
  const records = new Map();
  const rejected = [];
  for (const item of items) {
    const raw = (item.address || "").trim();
    if (!addressFamily(raw)) {
      rejected.push(raw);
      continue;
    }
    for (const { chain, basis } of resolveTargets(raw, item.statedChain, { mirror: source.mirror })) {
      const key = addressKey(chain, raw);
      const existing = records.get(key);
      if (existing) {
        // Same address listed twice by one source (e.g. under two assets): merge, prefer "listed".
        existing.programs = [...new Set([...existing.programs, ...(item.programs || [])])];
        if (basis === "listed") existing.basis = "listed";
        continue;
      }
      records.set(key, {
        key,
        chain,
        address: normalizeAddress(raw),
        basis,
        category: item.category || source.category,
        entity: item.entity || null,
        programs: item.programs || [],
        reference: item.reference || null,
        listedAt: item.listedAt || null,
        details: item.details || null,
      });
    }
  }
  return { records: [...records.values()], rejected };
}

/**
 * Each source's last known result, rebuilt from the database: its active listings in
 * intel_wallets plus the status and notes the last finished run recorded for it.
 * Incremental sources resume from these notes (e.g. the Ethereum block reached).
 */
function previousResults(stored, lastRun) {
  const records = new Map();
  for (const entry of stored.values()) {
    for (const s of entry.sources) {
      if (s.status === "removed") continue;
      if (!records.has(s.sourceId)) records.set(s.sourceId, []);
      records.get(s.sourceId).push({
        key: entry.key,
        chain: entry.chain,
        address: entry.address,
        basis: s.basis,
        category: s.category,
        entity: s.entity,
        programs: s.programs,
        reference: s.reference,
        listedAt: s.listedAt,
        details: s.details,
      });
    }
  }
  const results = new Map();
  for (const source of SOURCES) {
    const run = lastRun?.sources?.find((s) => s.id === source.id);
    const list = records.get(source.id) || [];
    if (!run && !list.length) continue;
    results.set(source.id, {
      source: sourceMeta(source),
      status: run?.status || "ok",
      fetchedAt: run?.fetchedAt || null,
      sourceDate: run?.sourceDate || null,
      notes: run?.notes || null,
      lastError: run?.lastError || null,
      records: list,
      stats: recordStats(list),
    });
  }
  return results;
}

/**
 * Compares a fresh record count with the source's current listings. Returns a reason string when
 * the drop is larger than the source's limit, otherwise null.
 */
function checkShrink(source, previousCount, freshCount) {
  if (!previousCount) return null;
  const limit = source.maxShrink ?? MAX_SHRINK_BY_TIER[source.tier] ?? 0.1;
  const drop = (previousCount - freshCount) / previousCount;
  if (drop <= limit) return null;
  return (
    `record count fell from ${previousCount} to ${freshCount} (-${Math.round(drop * 100)}%, limit ` +
    `${Math.round(limit * 100)}%) — kept previous data; accept the new data if the publisher really delisted them`
  );
}

/** Runs source.collect() with a hard time limit that also cancels its in-flight requests. */
async function collectWithTimeout(source, args) {
  const timeoutMs = source.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`)),
    timeoutMs,
  );
  const aborted = new Promise((_, reject) =>
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true }),
  );
  try {
    return await Promise.race([runWithSignal(controller.signal, () => source.collect(args)), aborted]);
  } finally {
    clearTimeout(timer);
  }
}

async function runSource(source, previous, { acceptShrink = false, onProgress = () => {} } = {}) {
  const started = Date.now();
  onProgress({ sourceId: source.id, status: "running" });
  try {
    const { items, sourceDate = null, notes = null } = await collectWithTimeout(source, {
      previous,
      progress: (detail) => onProgress({ sourceId: source.id, status: "running", detail }),
    });
    const { records, rejected } = toRecords(source, items);
    if (!records.length && items.length) throw new Error(`all ${items.length} items failed validation`);
    const shrink = acceptShrink ? null : checkShrink(source, previous?.records.length || 0, records.length);
    if (shrink) {
      const err = new Error(shrink);
      err.shrink = { previous: previous.records.length, fresh: records.length };
      throw err;
    }
    return {
      source: sourceMeta(source),
      status: "ok",
      fetchedAt: new Date().toISOString(),
      sourceDate,
      durationMs: Date.now() - started,
      stats: { items: items.length, ...recordStats(records), rejected: rejected.length, rejectedSample: rejected.slice(0, 10) },
      notes,
      records,
    };
  } catch (err) {
    // Keep the current listings so one broken feed never empties the database.
    const error = describeError(err);
    return {
      ...(previous || { source: sourceMeta(source), records: [], stats: recordStats([]) }),
      status: previous ? "stale" : "failed",
      lastError: error.cause ? `${error.message} (${error.cause})` : error.message,
      lastAttemptAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      shrinkBlocked: err.shrink || null,
      error,
    };
  }
}

/** Error details worth keeping. A failed fetch only says "fetch failed"; the reason is in `cause`. */
function describeError(err) {
  const message = String(err?.message || err);
  const cause = err?.cause ? (err.cause.code ? `${err.cause.code}: ${err.cause.message}` : String(err.cause.message || err.cause)) : null;
  let kind = "other";
  if (err?.shrink) kind = "shrink-blocked";
  else if (/^timed out after/.test(message) || err?.name === "TimeoutError") kind = "timeout";
  else if (/^HTTP \d{3}/.test(message)) kind = "http";
  else if (/^RPC |Ethereum RPCs failed/.test(message)) kind = "rpc";
  else if (/format changed|layout changed|failed validation|incomplete after|expected CSV/.test(message)) kind = "format";
  else if (cause || /fetch failed/i.test(message)) kind = "network";
  return {
    kind,
    name: err?.name || "Error",
    message,
    cause,
    httpStatus: Number(message.match(/HTTP (\d{3})/)?.[1]) || null,
    stack: err?.stack?.split("\n").slice(0, 8).join("\n") || null,
  };
}

/**
 * Logs a failure to intel_sync_errors. `result` is a failed source result, or null when the
 * whole run failed. Never throws: losing the log must not also lose the run.
 */
async function recordError(run, source, result, err = null) {
  const error = result?.error || describeError(err);
  try {
    await (await syncErrorsCollection()).insertOne({
      runId: run._id,
      runStartedAt: run.startedAt,
      failedAt: result?.lastAttemptAt || new Date().toISOString(),
      sourceId: source?.id || null,
      sourceName: source?.name || null,
      authority: source?.authority || null,
      scope: source ? "source" : "run",
      ...error,
      durationMs: result?.durationMs ?? null,
      // What happened to the data: a stale source keeps the listings it had before.
      outcome: !source ? "run failed, nothing written" : result.status === "stale" ? "kept previous data" : "no data (never collected)",
      recordsKept: result?.stats?.records ?? null,
      shrink: result?.shrinkBlocked || null,
    });
  } catch (logErr) {
    console.error("[intel] could not record sync error:", logErr.message);
  }
}

const sourceRank = (src) => CATEGORY_PRIORITY.indexOf(src.category);

/** Recomputes category / tier / confidence / entities from the given sources. */
function summarise(entry, sources) {
  entry.categories = [...new Set(sources.map((src) => src.category))].sort(
    (a, b) => CATEGORY_PRIORITY.indexOf(a) - CATEGORY_PRIORITY.indexOf(b),
  );
  entry.category = entry.categories[0];
  entry.tier = Math.min(...sources.map((src) => src.tier));
  entry.confidence = Math.max(...sources.map((src) => src.confidence));
  entry.entities = [...new Set(sources.map((src) => src.entity).filter(Boolean))];
}

/**
 * Builds the address database. Nothing is ever deleted: when a publisher drops an address,
 * its source record stays with status "removed" + removedAt, and an address with no active
 * source left stays with status "delisted" + delistedAt. Screening only uses active sources.
 * If a publisher lists the address again, it becomes active again.
 */
function mergeRecords(results, previousEntries) {
  const now = new Date().toISOString();
  const entries = new Map();
  for (const result of results) {
    const meta = result.source;
    for (const r of result.records) {
      const confidence = Math.max(0, meta.confidence - (r.basis === "evm-mirror" ? MIRROR_PENALTY : 0));
      let entry = entries.get(r.key);
      if (!entry) {
        const prev = previousEntries.get(r.key);
        entry = {
          key: r.key,
          chain: r.chain,
          address: r.address,
          status: "active",
          firstSeen: prev?.firstSeen || now,
          delistedAt: null,
          // Set when an address that had been delisted is listed again.
          relistedAt: prev?.status === "delisted" ? now : prev?.relistedAt || null,
          sources: [],
        };
        entries.set(r.key, entry);
      }
      entry.sources.push({
        sourceId: meta.id,
        authority: meta.authority,
        jurisdiction: meta.jurisdiction,
        tier: meta.tier,
        category: r.category,
        basis: r.basis,
        confidence,
        entity: r.entity,
        programs: r.programs,
        reference: r.reference,
        listedAt: r.listedAt,
        details: r.details,
        status: "active",
        removedAt: null,
      });
    }
  }

  // Carry forward every source record (and address) the publishers no longer list.
  for (const [key, prev] of previousEntries) {
    const removedSources = (prev.sources || [])
      .filter((src) => !entries.get(key)?.sources.some((cur) => cur.sourceId === src.sourceId))
      .map((src) => ({
        ...src,
        tier: src.tier ?? prev.tier,
        status: "removed",
        removedAt: src.removedAt || now,
      }));
    const entry = entries.get(key);
    if (entry) {
      entry.sources.push(...removedSources);
      continue;
    }
    entries.set(key, {
      ...prev,
      status: "delisted",
      delistedAt: prev.status === "delisted" ? prev.delistedAt : now,
      sources: removedSources,
    });
  }

  for (const entry of entries.values()) {
    const active = entry.sources.filter((src) => src.status === "active");
    // A delisted address keeps showing what it was listed for.
    summarise(entry, active.length ? active : entry.sources);
    entry.sources.sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || sourceRank(a) - sourceRank(b));
  }
  return [...entries.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const activeSourceIds = (entry) =>
  new Set((entry?.sources || []).filter((s) => s.status !== "removed").map((s) => s.sourceId));

/**
 * What this run changed, one item per wallet and kind of change:
 *  added          — wallet seen for the first time
 *  delisted       — its last active source dropped it
 *  relisted       — listed again after being delisted
 *  source-added   — an existing wallet is now also listed by another source
 *  source-removed — one source dropped it, others still list it
 * `sources` holds the source listings involved.
 */
function walletChanges(entries, previousEntries) {
  const changes = [];
  for (const entry of entries) {
    const prev = previousEntries.get(entry.key);
    const before = activeSourceIds(prev);
    const after = activeSourceIds(entry);
    const gained = entry.sources.filter((s) => s.status === "active" && !before.has(s.sourceId));
    const lost = (prev?.sources || []).filter((s) => s.status !== "removed" && !after.has(s.sourceId));
    if (!prev) changes.push({ change: "added", entry, sources: gained });
    else if (entry.status === "delisted" && prev.status !== "delisted") changes.push({ change: "delisted", entry, sources: lost });
    else if (entry.status === "active" && prev.status === "delisted") changes.push({ change: "relisted", entry, sources: gained });
    else {
      if (gained.length) changes.push({ change: "source-added", entry, sources: gained });
      if (lost.length) changes.push({ change: "source-removed", entry, sources: lost });
    }
  }
  return changes;
}

/** OFAC direct parse vs the 0xB10C extract: both should agree on the address set. */
function ofacCrossCheck(results) {
  const listed = (id) =>
    new Set(
      (results.find((r) => r.source.id === id)?.records || [])
        .filter((r) => r.basis === "listed")
        .map((r) => r.address),
    );
  const direct = listed("ofac-sdn");
  const mirror = listed("ofac-0xb10c");
  if (!direct.size || !mirror.size) return null;
  return {
    onlyInOfacDirect: [...direct].filter((a) => !mirror.has(a)),
    onlyIn0xB10C: [...mirror].filter((a) => !direct.has(a)),
  };
}

/** Human-readable problems with this run, shown next to the Sync button. */
function buildWarnings(results, crossCheck) {
  const warnings = [];
  for (const r of results) {
    if (r.status === "ok") continue;
    warnings.push({
      sourceId: r.source.id,
      kind: r.shrinkBlocked ? "shrink-blocked" : r.status,
      message: r.lastError || r.status,
      ...(r.shrinkBlocked && { shrink: r.shrinkBlocked }),
    });
  }
  const ofac = crossCheck.ofac;
  if (ofac && (ofac.onlyInOfacDirect.length || ofac.onlyIn0xB10C.length)) {
    warnings.push({
      sourceId: "ofac-sdn",
      kind: "cross-check",
      message:
        `OFAC SDN.XML and the 0xB10C extract disagree: ${ofac.onlyInOfacDirect.length} address(es) only in ` +
        `SDN.XML, ${ofac.onlyIn0xB10C.length} only in 0xB10C (0xB10C updates nightly, so a fresh designation can lag a day)`,
    });
  }
  return warnings;
}

export class CollectionBusyError extends Error {}

/**
 * Records the run in intel_sync_runs with status "running". The unique index on running runs
 * makes this the lock shared by the web app and `npm run collect:intel`, so two runs never
 * write at once. A run left "running" by a crashed process is closed and taken over.
 */
async function startRun(runs, only) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const run = { _id: new ObjectId(), status: "running", startedAt: new Date().toISOString(), only };
    try {
      await runs.insertOne(run);
      return run;
    } catch (err) {
      if (err.code !== 11000) throw err;
      const held = await runs.findOne({ status: "running" });
      if (held && Date.now() - Date.parse(held.startedAt) < RUN_STALE_MS) {
        throw new CollectionBusyError(`another collection is already running (started ${held.startedAt})`);
      }
      if (held) {
        await runs.updateOne(
          { _id: held._id, status: "running" },
          { $set: { status: "failed", finishedAt: new Date().toISOString(), error: "abandoned: the process stopped mid-run" } },
        );
      }
    }
  }
  throw new CollectionBusyError("could not start a run");
}

/**
 * Runs every source (or `only` ids), upserts the wallets that changed into intel_wallets,
 * records each wallet change in intel_run_wallets and the run itself in intel_sync_runs.
 * @param {string[]} [acceptShrink]  source ids whose record-count drop is accepted (see checkShrink)
 * @param {(event: object) => void} [onProgress]  per-source status events
 */
export async function runCollection({ only = null, acceptShrink = [], log = console.log, onProgress = () => {} } = {}) {
  if (only) {
    const known = new Set(SOURCES.map((s) => s.id));
    const unknown = only.filter((id) => !known.has(id));
    if (unknown.length) throw new Error(`unknown source id(s): ${unknown.join(", ")}`);
  }
  const runs = await syncRunsCollection();
  const run = await startRun(runs, only);
  try {
    const summary = await collect(run, { only, acceptShrink, log, onProgress });
    await runs.updateOne({ _id: run._id }, { $set: { status: "done", ...summary } });
    return { runId: String(run._id), runAt: summary.finishedAt, ...summary };
  } catch (err) {
    await recordError(run, null, null, err);
    await runs
      .updateOne({ _id: run._id }, { $set: { status: "failed", finishedAt: new Date().toISOString(), error: err.message } })
      .catch(() => {});
    throw err;
  }
}

async function collect(run, { only, acceptShrink, log, onProgress }) {
  const started = Date.parse(run.startedAt);
  const [wallets, runs] = await Promise.all([walletsCollection(), syncRunsCollection()]);
  const stored = new Map((await wallets.find({}).toArray()).map((doc) => [doc._id, fromStored(doc)]));
  const lastRun = await runs.findOne({ status: "done" }, { sort: { finishedAt: -1 } });
  const previous = previousResults(stored, lastRun);

  const selected = only ? SOURCES.filter((s) => only.includes(s.id)) : SOURCES;
  const fresh = await Promise.all(
    selected.map(async (source) => {
      const result = await runSource(source, previous.get(source.id) || null, {
        acceptShrink: acceptShrink.includes(source.id),
        onProgress,
      });
      // Logged as soon as the source fails, so it is kept even if the run dies later.
      if (result.error) await recordError(run, source, result);
      onProgress({
        sourceId: source.id,
        status: result.status,
        records: result.stats?.records ?? 0,
        error: result.lastError || null,
      });
      log(
        `  ${result.status.padEnd(6)} ${source.id.padEnd(24)} ${String(result.stats?.records ?? 0).padStart(6)} records` +
          (result.lastError ? `  ! ${result.lastError}` : ""),
      );
      return result;
    }),
  );

  // Partial runs still merge the full set: unselected sources keep their current listings.
  const results = SOURCES.map((s) => fresh.find((r) => r.source.id === s.id) || previous.get(s.id)).filter(Boolean);
  const entries = mergeRecords(results, stored);

  // Only wallets that differ from the stored copy are written.
  const finishedAt = new Date().toISOString();
  const changed = entries.filter((e) => !stored.has(e.key) || canonical(e) !== canonical(stored.get(e.key)));
  await writeWallets(wallets, changed, finishedAt);
  const changes = walletChanges(entries, stored);
  await writeRunWallets(run._id, finishedAt, changes);
  log(`  wrote ${changed.length} of ${entries.length} wallets, ${changes.length} change(s) logged`);

  const count = (kind) => changes.filter((c) => c.change === kind).length;
  const active = entries.filter((e) => e.status === "active").length;
  const crossCheck = { ofac: ofacCrossCheck(results) };
  return {
    finishedAt,
    durationMs: Date.now() - started,
    totals: {
      entries: entries.length,
      active,
      delisted: entries.length - active,
      added: count("added"),
      newlyDelisted: count("delisted"),
      relisted: count("relisted"),
      written: changed.length,
    },
    sources: results.map((r) => ({
      id: r.source.id,
      status: r.status,
      records: r.stats?.records ?? 0,
      fetchedAt: r.fetchedAt || null,
      sourceDate: r.sourceDate || null,
      durationMs: r.durationMs ?? null,
      notes: r.notes || null,
      lastError: r.lastError || null,
      lastAttemptAt: r.lastAttemptAt || null,
      shrinkBlocked: r.shrinkBlocked || null,
    })),
    crossCheck,
    warnings: buildWarnings(results, crossCheck),
  };
}

/** A stored wallet without the fields that are derived when it is written. */
function fromStored({ _id, search, updatedAt, ...entry }) {
  return entry;
}

/** JSON with object keys sorted, so two wallets compare equal whatever their field order. */
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

/** Lowercased text the directory search matches against. */
const searchText = (e) =>
  [e.address, ...e.entities, ...e.sources.flatMap((s) => [...(s.programs || []), s.reference?.id || ""])]
    .join(" ")
    .toLowerCase();

async function writeWallets(wallets, changed, now) {
  for (let i = 0; i < changed.length; i += WRITE_BATCH) {
    await wallets.bulkWrite(
      changed.slice(i, i + WRITE_BATCH).map((e) => ({
        replaceOne: {
          filter: { _id: e.key },
          replacement: { _id: e.key, ...e, updatedAt: now, search: searchText(e) },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
}

async function writeRunWallets(runId, runAt, changes) {
  const docs = changes.map(({ change, entry, sources }) => ({
    runId,
    runAt,
    change,
    key: entry.key,
    chain: entry.chain,
    address: entry.address,
    status: entry.status,
    category: entry.category,
    tier: entry.tier,
    confidence: entry.confidence,
    entities: entry.entities,
    firstSeen: entry.firstSeen,
    sources: sources.map((s) => ({
      sourceId: s.sourceId,
      authority: s.authority,
      jurisdiction: s.jurisdiction,
      category: s.category,
      basis: s.basis,
      entity: s.entity,
      programs: s.programs,
      reference: s.reference,
      listedAt: s.listedAt,
    })),
  }));
  if (!docs.length) return;
  const collection = await runWalletsCollection();
  for (let i = 0; i < docs.length; i += WRITE_BATCH) {
    await collection.insertMany(docs.slice(i, i + WRITE_BATCH), { ordered: false });
  }
}
