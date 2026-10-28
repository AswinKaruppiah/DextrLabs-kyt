import fs from "node:fs";
import path from "node:path";
import { INTEL_DIR } from "./run.js";
import { addressKey } from "./util/address.js";

const ADDRESSES_FILE = path.join(INTEL_DIR, "addresses.json");
const MANIFEST_FILE = path.join(INTEL_DIR, "manifest.json");

// addresses.json is ~25 MB; parse once and re-parse only when the collector rewrites it.
let cache = { mtimeMs: 0, data: null, manifest: null, byKey: new Map() };

function load() {
  let stat;
  try {
    stat = fs.statSync(ADDRESSES_FILE);
  } catch {
    if (!cache.warnedMissing) {
      console.warn(`[intel] ${ADDRESSES_FILE} not found — run \`npm run collect:intel\`. Screening has no intel data.`);
      cache.warnedMissing = true;
    }
    return {
      data: { generatedAt: null, totals: { entries: 0 }, entries: [] },
      manifest: null,
      byKey: new Map(),
    };
  }
  if (stat.mtimeMs !== cache.mtimeMs) {
    const data = JSON.parse(fs.readFileSync(ADDRESSES_FILE, "utf8"));
    for (const e of data.entries) {
      e._search = [
        e.address,
        ...e.entities,
        ...e.sources.flatMap((s) => [...(s.programs || []), s.reference?.id || ""]),
      ]
        .join(" ")
        .toLowerCase();
    }
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
    } catch {}
    const byKey = new Map(data.entries.map((e) => [e.key, e]));
    cache = { mtimeMs: stat.mtimeMs, data, manifest, byKey };
  }
  return cache;
}

export function invalidateIntelCache() {
  cache = { mtimeMs: 0, data: null, manifest: null, byKey: new Map() };
}

/** Exact lookup of one address on one chain ("TRON" | "ETHEREUM" | "BSC"). null if not listed. */
export function lookupAddress(chain, address) {
  if (!chain || !address) return null;
  const entry = load().byKey.get(addressKey(chain, address.trim()));
  if (!entry) return null;
  const { _search, ...rest } = entry;
  return rest;
}

const count = (list, keyFn) => {
  const out = {};
  for (const x of list) for (const k of [].concat(keyFn(x))) out[k] = (out[k] || 0) + 1;
  return out;
};

/**
 * Filtered, paginated view of the collected address database.
 * Facet counts are computed on the set filtered by every *other* facet, so each
 * filter row shows how many results picking that option would give.
 */
export function queryIntel({
  search = "",
  chain = "ALL",
  category = "ALL",
  source = "ALL",
  page = 1,
  limit = 50,
} = {}) {
  const { data, manifest } = load();
  const q = search.trim().toLowerCase();

  const matches = {
    search: (e) => !q || e._search.includes(q),
    chain: (e) => chain === "ALL" || e.chain === chain,
    category: (e) => category === "ALL" || e.categories.includes(category),
    source: (e) => source === "ALL" || e.sources.some((s) => s.sourceId === source),
  };
  const filterExcept = (skip) =>
    data.entries.filter((e) => Object.entries(matches).every(([k, fn]) => k === skip || fn(e)));

  const filtered = filterExcept(null);
  // Highest-severity first: tier, then confidence, then number of corroborating sources.
  filtered.sort(
    (a, b) => a.tier - b.tier || b.confidence - a.confidence || b.sources.length - a.sources.length,
  );

  const offset = (Math.max(1, page) - 1) * limit;
  const items = filtered.slice(offset, offset + limit).map(({ _search, ...e }) => e);

  return {
    generatedAt: data.generatedAt,
    totalCount: data.entries.length,
    filteredCount: filtered.length,
    page,
    totalPages: Math.ceil(filtered.length / limit) || 1,
    facets: {
      chain: count(filterExcept("chain"), (e) => e.chain),
      category: count(filterExcept("category"), (e) => e.categories),
      source: count(filterExcept("source"), (e) => [...new Set(e.sources.map((s) => s.sourceId))]),
    },
    sources: (manifest?.sources || []).map((s) => ({
      id: s.id,
      name: s.name,
      authority: s.authority,
      jurisdiction: s.jurisdiction,
      tier: s.tier,
      category: s.category,
      status: s.status,
      records: s.records,
      fetchedAt: s.fetchedAt,
      sourceDate: s.sourceDate,
      lastError: s.lastError,
      license: s.license,
    })),
    items,
  };
}
