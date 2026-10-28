import fs from "node:fs";
import path from "node:path";
import { SOURCES } from "./sources/index.js";
import { addressFamily, addressKey, normalizeAddress, resolveTargets } from "./util/address.js";

export const INTEL_DIR = path.join(process.cwd(), "data", "intel");
const SOURCES_DIR = path.join(INTEL_DIR, "sources");
const ADDRESSES_FILE = path.join(INTEL_DIR, "addresses.json");
const MANIFEST_FILE = path.join(INTEL_DIR, "manifest.json");
const CHANGELOG_FILE = path.join(INTEL_DIR, "changelog.jsonl");

// Confidence penalty when an EVM address is applied to a chain the publisher did not name.
const MIRROR_PENALTY = 10;
const CATEGORY_PRIORITY = ["SANCTIONS", "ISSUER_FREEZE", "HACK_EXPLOIT", "SCAM_PHISHING"];

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

async function runSource(source) {
  const file = path.join(SOURCES_DIR, `${source.id}.json`);
  const started = Date.now();
  try {
    const { items, sourceDate = null, notes = null } = await source.collect();
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
    writeJson(file, result);
    return result;
  } catch (err) {
    // Keep the last good snapshot so one broken feed never empties the database.
    const previous = readJson(file);
    const result = previous
      ? { ...previous, status: "stale", lastError: err.message, lastAttemptAt: new Date().toISOString() }
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

function mergeRecords(results, previousEntries) {
  const now = new Date().toISOString();
  const entries = new Map();
  for (const result of results) {
    const meta = result.source;
    for (const r of result.records) {
      const confidence = Math.max(0, meta.confidence - (r.basis === "evm-mirror" ? MIRROR_PENALTY : 0));
      let entry = entries.get(r.key);
      if (!entry) {
        entry = {
          key: r.key,
          chain: r.chain,
          address: r.address,
          category: r.category,
          categories: [],
          tier: meta.tier,
          confidence: 0,
          entities: [],
          sources: [],
          firstSeen: previousEntries.get(r.key)?.firstSeen || now,
          lastSeen: now,
        };
        entries.set(r.key, entry);
      }
      if (!entry.categories.includes(r.category)) entry.categories.push(r.category);
      if (r.entity && !entry.entities.includes(r.entity)) entry.entities.push(r.entity);
      entry.tier = Math.min(entry.tier, meta.tier);
      entry.confidence = Math.max(entry.confidence, confidence);
      entry.sources.push({
        sourceId: meta.id,
        authority: meta.authority,
        jurisdiction: meta.jurisdiction,
        category: r.category,
        basis: r.basis,
        confidence,
        entity: r.entity,
        programs: r.programs,
        reference: r.reference,
        listedAt: r.listedAt,
        details: r.details,
      });
    }
  }
  for (const entry of entries.values()) {
    entry.categories.sort((a, b) => CATEGORY_PRIORITY.indexOf(a) - CATEGORY_PRIORITY.indexOf(b));
    entry.category = entry.categories[0];
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

/**
 * Runs every source (or `only` ids), writes per-source snapshots, the merged address
 * database, a manifest, and appends a changelog line.
 */
export async function runCollection({ only = null, log = console.log } = {}) {
  const started = Date.now();
  const selected = only ? SOURCES.filter((s) => only.includes(s.id)) : SOURCES;

  const fresh = await Promise.all(
    selected.map(async (source) => {
      const result = await runSource(source);
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
  writeJson(ADDRESSES_FILE, {
    generatedAt,
    totals: {
      entries: entries.length,
      byChain: countBy(entries, (e) => e.chain),
      byCategory: countBy(entries, (e) => e.category),
      byTier: countBy(entries, (e) => `tier${e.tier}`),
    },
    entries,
  });

  const keys = new Set(entries.map((e) => e.key));
  const added = entries.filter((e) => !previousEntries.has(e.key)).map((e) => e.key);
  const removed = [...previousEntries.keys()].filter((k) => !keys.has(k));
  fs.appendFileSync(
    CHANGELOG_FILE,
    JSON.stringify(
      previous
        ? { runAt: generatedAt, added: added.length, removed: removed.length, addedKeys: added, removedKeys: removed }
        : { runAt: generatedAt, initial: true, added: added.length },
    ) + "\n",
  );

  const manifest = {
    runAt: generatedAt,
    durationMs: Date.now() - started,
    totals: { entries: entries.length, added: added.length, removed: removed.length },
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
    })),
    crossCheck: { ofac: ofacCrossCheck(results) },
  };
  writeJson(MANIFEST_FILE, manifest);
  return manifest;
}
