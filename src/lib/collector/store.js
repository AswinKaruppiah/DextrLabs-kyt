import { syncRunsCollection, walletsCollection } from "./db.js";
import { getSource } from "./sources/index.js";
import { addressKey } from "./util/address.js";

// Newest first; wallets found in the same run are ordered most severe first.
const DIRECTORY_SORT = { firstSeen: -1, tier: 1, confidence: -1, _id: 1 };
const HIDDEN_FIELDS = { _id: 0, search: 0 };

// One screening asks for the same address several times (Tether, sanctions, OSINT), so lookups
// are cached briefly. A sync in this process clears the cache; one from the CLI ages out.
const LOOKUP_TTL_MS = 60_000;
const lookups = (globalThis.__kytIntelLookups ??= new Map());

export function invalidateIntelCache() {
  lookups.clear();
}

/**
 * Exact lookup of one address on one chain ("TRON" | "ETHEREUM" | "BSC") for screening.
 * Only sources that still list the address are returned; null if none do (never listed, or
 * delisted by every publisher). Use lookupAddressHistory for removed listings too.
 */
export async function lookupAddress(chain, address) {
  const entry = await lookupAddressHistory(chain, address);
  if (!entry) return null;
  const sources = entry.sources.filter((s) => s.status !== "removed");
  return sources.length ? { ...entry, sources } : null;
}

/** The full stored entry, including delisted addresses and removed source listings. */
export async function lookupAddressHistory(chain, address) {
  if (!chain || !address) return null;
  const key = addressKey(chain, address.trim());
  const hit = lookups.get(key);
  if (hit && hit.expires > Date.now()) return hit.entry;

  const entry = walletsCollection().then((wallets) => wallets.findOne({ _id: key }, { projection: HIDDEN_FIELDS }));
  lookups.set(key, { entry, expires: Date.now() + LOOKUP_TTL_MS });
  entry.catch(() => lookups.delete(key));
  return entry;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const facet = (wallets, match, field, { array = false } = {}) =>
  wallets
    .aggregate([
      { $match: match },
      // Count each wallet once per value, even if several of its sources share it.
      ...(array ? [{ $project: { v: { $setUnion: [`$${field}`, []] } } }, { $unwind: "$v" }] : [{ $project: { v: `$${field}` } }]),
      { $group: { _id: "$v", n: { $sum: 1 } } },
    ])
    .toArray()
    .then((rows) => Object.fromEntries(rows.map((r) => [r._id, r.n])));

/**
 * Filtered, paginated view of the wallet database, newest first.
 * Facet counts are computed on the set filtered by every *other* facet, so each
 * filter row shows how many results picking that option would give.
 */
export async function queryIntel({
  search = "",
  chain = "ALL",
  category = "ALL",
  source = "ALL",
  status = "ALL",
  page = 1,
  limit = 50,
} = {}) {
  const [wallets, runs] = await Promise.all([walletsCollection(), syncRunsCollection()]);
  const q = search.trim().toLowerCase();

  const conditions = {
    search: q && { search: { $regex: escapeRegex(q) } },
    chain: chain !== "ALL" && { chain },
    category: category !== "ALL" && { categories: category },
    source: source !== "ALL" && { "sources.sourceId": source },
    status: status !== "ALL" && { status },
  };
  const filterExcept = (skip) => {
    const parts = Object.entries(conditions)
      .filter(([k, c]) => k !== skip && c)
      .map(([, c]) => c);
    return parts.length ? { $and: parts } : {};
  };
  const filter = filterExcept(null);
  const offset = (Math.max(1, page) - 1) * limit;

  const [items, filteredCount, totalCount, lastRun, chainFacet, categoryFacet, sourceFacet, statusFacet] =
    await Promise.all([
      wallets.find(filter, { projection: HIDDEN_FIELDS }).sort(DIRECTORY_SORT).skip(offset).limit(limit).toArray(),
      wallets.countDocuments(filter),
      wallets.estimatedDocumentCount(),
      runs.findOne({ status: "done" }, { sort: { finishedAt: -1 } }),
      facet(wallets, filterExcept("chain"), "chain"),
      facet(wallets, filterExcept("category"), "categories", { array: true }),
      facet(wallets, filterExcept("source"), "sources.sourceId", { array: true }),
      facet(wallets, filterExcept("status"), "status"),
    ]);

  return {
    generatedAt: lastRun?.finishedAt || null,
    totalCount,
    filteredCount,
    page,
    totalPages: Math.ceil(filteredCount / limit) || 1,
    facets: { chain: chainFacet, category: categoryFacet, source: sourceFacet, status: statusFacet },
    // Runs store only per-source status; name, authority etc. come from the source registry.
    sources: (lastRun?.sources || []).map((s) => {
      const meta = getSource(s.id) || {};
      return {
        id: s.id,
        name: meta.name,
        authority: meta.authority,
        jurisdiction: meta.jurisdiction,
        tier: meta.tier,
        category: meta.category,
        status: s.status,
        records: s.records,
        fetchedAt: s.fetchedAt,
        sourceDate: s.sourceDate,
        lastError: s.lastError,
        license: meta.license,
      };
    }),
    warnings: lastRun?.warnings || [],
    items,
  };
}
