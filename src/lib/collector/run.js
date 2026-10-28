import fs from "node:fs";
import path from "node:path";
import { SOURCES } from "./sources/index.js";
import { addressFamily, addressKey, normalizeAddress, resolveTargets } from "./util/address.js";
import { runWithSignal } from "./util/http.js";

export const INTEL_DIR = path.join(process.cwd(), "data", "intel");
const SOURCES_DIR = path.join(INTEL_DIR, "sources");
const ADDRESSES_FILE = path.join(INTEL_DIR, "addresses.json");
const MANIFEST_FILE = path.join(INTEL_DIR, "manifest.json");
const CHANGELOG_FILE = path.join(INTEL_DIR, "changelog.jsonl");
const LOCK_FILE = path.join(INTEL_DIR, ".collect.lock");

// Confidence penalty when an EVM address is applied to a chain the publisher did not name.
const MIRROR_PENALTY = 10;
const CATEGORY_PRIORITY = ["SANCTIONS", "ISSUER_FREEZE", "HACK_EXPLOIT", "SCAM_PHISHING"];

// A source that doesn't finish in time keeps its last good snapshot (sources can override).
const DEFAULT_SOURCE_TIMEOUT_MS = 4 * 60 * 1000;
// A lock older than this belongs to a crashed run.
const LOCK_STALE_MS = 30 * 60 * 1000;

/**
 * Largest drop in record count (vs the last good snapshot) accepted without review, by tier.
 * Sanctions are almost never delisted in bulk, so a big drop usually means the publisher
 * changed its format and our parser missed entries. Sources can override with `maxShrink`.
 */
const MAX_SHRINK_BY_TIER = { 1: 0.1, 2: 0.05, 4: 0.3 };

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

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
        entityType: item.entityType || null,
        programs: item.programs || [],
        asset: item.asset || null,
        reference: item.reference || null,
        listedAt: item.listedAt || null,
        details: item.details || null,
      });
    }
  }
  return { records: [...records.values()], rejected };
}

/**
 * Compares a fresh record count with the last good snapshot. Returns a reason string when the
 * drop is larger than the source's limit, otherwise null.
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

async function runSource(source, { acceptShrink = false, onProgress = () => {} } = {}) {
  const file = path.join(SOURCES_DIR, `${source.id}.json`);
  const started = Date.now();
  // Last snapshot (if any) lets incremental sources resume where they stopped.
  const previous = readJson(file);
  onProgress({ sourceId: source.id, status: "running" });
  try {
    const { items, sourceDate = null, notes = null } = await collectWithTimeout(source, {
      previous,
      progress: (detail) => onProgress({ sourceId: source.id, status: "running", detail }),
    });
    const { records, rejected } = toRecords(source, items);
    if (!records.length && items.length) throw new Error(`all ${items.length} items failed validation`);
    const result = {
      source: sourceMeta(source),
      status: "ok",
      fetchedAt: new Date().toISOString(),
      sourceDate,
      durationMs: Date.now() - started,
      stats: {
        items: items.length,
        records: records.length,
        rejected: rejected.length,
        rejectedSample: rejected.slice(0, 10),
        byChain: countBy(records, (r) => r.chain),
        byBasis: countBy(records, (r) => r.basis),
      },
      notes,
      records,
    };
    const shrink = acceptShrink ? null : checkShrink(source, previous?.records?.length || 0, records.length);
    if (shrink) {
      // Park the suspicious result next to the snapshot so it can be inspected or accepted.
      writeJson(path.join(SOURCES_DIR, `${source.id}.rejected.json`), result);
      const err = new Error(shrink);
      err.shrink = { previous: previous.records.length, fresh: records.length };
      throw err;
    }
    writeJson(file, result);
    fs.rmSync(path.join(SOURCES_DIR, `${source.id}.rejected.json`), { force: true });
    return result;
  } catch (err) {
    // Keep the last good snapshot so one broken feed never empties the database.
    const result = previous
      ? {
          ...previous,
          status: "stale",
          lastError: err.message,
          lastAttemptAt: new Date().toISOString(),
          shrinkBlocked: err.shrink || null,
        }
      : {
          source: sourceMeta(source),
          status: "failed",
          lastError: err.message,
          lastAttemptAt: new Date().toISOString(),
          records: [],
          stats: { records: 0 },
        };
    if (previous) writeJson(file, result);
    return result;
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
 * source left stays in the file with status "delisted" + delistedAt. Screening only uses
 * active sources. If a publisher lists the address again, it becomes active again.
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
          lastSeen: now,
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

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
};

/**
 * Cross-process lock (the web app and `npm run collect:intel` share data/intel), so two runs
 * never write the same snapshot files at once. A lock left by a crashed run is taken over.
 */
function acquireLock() {
  fs.mkdirSync(INTEL_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), {
        flag: "wx",
      });
      return () => fs.rmSync(LOCK_FILE, { force: true });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const held = readJson(LOCK_FILE);
      const abandoned =
        !held || !pidAlive(held.pid) || Date.now() - Date.parse(held.startedAt) > LOCK_STALE_MS;
      if (!abandoned) {
        throw new CollectionBusyError(
          `another collection is already running (pid ${held.pid}, started ${held.startedAt})`,
        );
      }
      fs.rmSync(LOCK_FILE, { force: true });
    }
  }
  throw new CollectionBusyError("could not acquire the collection lock");
}

/**
 * Runs every source (or `only` ids), writes per-source snapshots, the merged address
 * database, a manifest, and appends a changelog line.
 * @param {string[]} [acceptShrink]  source ids whose record-count drop is accepted (see checkShrink)
 * @param {(event: object) => void} [onProgress]  per-source status events
 */
export async function runCollection({ only = null, acceptShrink = [], log = console.log, onProgress = () => {} } = {}) {
  const release = acquireLock();
  try {
    return await collectLocked({ only, acceptShrink, log, onProgress });
  } finally {
    release();
  }
}

async function collectLocked({ only, acceptShrink, log, onProgress }) {
  const started = Date.now();
  const selected = only ? SOURCES.filter((s) => only.includes(s.id)) : SOURCES;
  if (only && selected.length !== only.length) {
    const known = new Set(SOURCES.map((s) => s.id));
    throw new Error(`unknown source id(s): ${only.filter((id) => !known.has(id)).join(", ")}`);
  }

  const fresh = await Promise.all(
    selected.map(async (source) => {
      const result = await runSource(source, { acceptShrink: acceptShrink.includes(source.id), onProgress });
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

  // Partial runs still merge the full set: unselected sources come from their last snapshot.
  const results = SOURCES.map(
    (s) => fresh.find((r) => r.source.id === s.id) || readJson(path.join(SOURCES_DIR, `${s.id}.json`)),
  ).filter(Boolean);

  const previous = readJson(ADDRESSES_FILE);
  const previousEntries = new Map((previous?.entries || []).map((e) => [e.key, e]));
  const entries = mergeRecords(results, previousEntries);

  const generatedAt = new Date().toISOString();
  const active = entries.filter((e) => e.status === "active");
  writeJson(ADDRESSES_FILE, {
    generatedAt,
    totals: {
      entries: entries.length,
      active: active.length,
      delisted: entries.length - active.length,
      byChain: countBy(active, (e) => e.chain),
      byCategory: countBy(active, (e) => e.category),
      byTier: countBy(active, (e) => `tier${e.tier}`),
    },
    entries,
  });

  const wasActive = (key) => {
    const prev = previousEntries.get(key);
    return prev && prev.status !== "delisted";
  };
  const added = entries.filter((e) => !previousEntries.has(e.key)).map((e) => e.key);
  const delisted = entries.filter((e) => e.status === "delisted" && wasActive(e.key)).map((e) => e.key);
  const relisted = active.filter((e) => previousEntries.get(e.key)?.status === "delisted").map((e) => e.key);
  fs.appendFileSync(
    CHANGELOG_FILE,
    JSON.stringify(
      previous
        ? {
            runAt: generatedAt,
            added: added.length,
            delisted: delisted.length,
            relisted: relisted.length,
            addedKeys: added,
            delistedKeys: delisted,
            relistedKeys: relisted,
          }
        : { runAt: generatedAt, initial: true, added: added.length },
    ) + "\n",
  );

  const crossCheck = { ofac: ofacCrossCheck(results) };
  const manifest = {
    runAt: generatedAt,
    durationMs: Date.now() - started,
    totals: {
      entries: entries.length,
      active: active.length,
      delisted: entries.length - active.length,
      added: added.length,
      newlyDelisted: delisted.length,
      relisted: relisted.length,
    },
    sources: results.map((r) => ({
      ...r.source,
      status: r.status,
      fetchedAt: r.fetchedAt || null,
      sourceDate: r.sourceDate || null,
      durationMs: r.durationMs ?? null,
      records: r.stats?.records ?? 0,
      rejected: r.stats?.rejected ?? 0,
      byChain: r.stats?.byChain || {},
      notes: r.notes || null,
      lastError: r.lastError || null,
      lastAttemptAt: r.lastAttemptAt || null,
      shrinkBlocked: r.shrinkBlocked || null,
    })),
    crossCheck,
    warnings: buildWarnings(results, crossCheck),
  };
  writeJson(MANIFEST_FILE, manifest);
  return manifest;
}
