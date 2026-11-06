import { getTransferHistory } from "./transferHistory.js";
import { lookupAddresses } from "../collector/store.js";
import { normalizeAddress } from "../collector/util/address.js";
import { RISK_CATEGORIES } from "../intelligence/entityAttribution";
import { sanctionsCategoryId } from "../intelligence/sanctionsRegistry";
import { EXPOSURE_RULES } from "./rules.js";
import { SUPPORTED_CHAINS } from "../chains/chainConfig";
import { freezeTime } from "./freezeTime.js";

export { EXPOSURE_RULES };

const LEVEL_SCORES = { HIGH: 75, MEDIUM: 50, LOW: 20 };

// Intel categories that make a counterparty risky, most severe first. `severe` = government or
// issuer action, or a known mixer (funds through it have no traceable source); the others are
// OSINT labels and rank one level lower. MIXER sits above ISSUER_FREEZE: issuers froze the
// Tornado Cash pools only because they were sanctioned, so "mixer" is what explains the address.
const LISTED = {
  SANCTIONS: { severe: true, risk: RISK_CATEGORIES.SANCTIONS_OFAC },
  MIXER: { severe: true, risk: RISK_CATEGORIES.MIXER },
  ISSUER_FREEZE: { severe: true, risk: RISK_CATEGORIES.TETHER_FROZEN },
  HACK_EXPLOIT: { severe: false, risk: RISK_CATEGORIES.EXCHANGE_EXPLOIT },
  SCAM_PHISHING: { severe: false, risk: RISK_CATEGORIES.PHISHING_SCAM },
};
const LISTED_ORDER = Object.keys(LISTED);

const usd = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
// A freeze is often the end of a scam: money moved with the wallet before it was frozen can still
// be dirty, so it counts, one level lower than money moved after the freeze.
const LOWER = { HIGH: "MEDIUM", MEDIUM: "LOW", LOW: "LOW" };
const day = (ts) => new Date(ts).toISOString().slice(0, 10);

/**
 * Per-counterparty totals of one wallet's transfers. `counted` drops incoming dust, unless the
 * small transfers from one counterparty add up to `dustSumUsd` (many small payments, not poisoning).
 */
function aggregate(transfers, skip) {
  const byCp = new Map();
  let totalUsd = 0;
  for (const t of transfers) {
    totalUsd += t.usd;
    const cp = normalizeAddress(t.cp || "");
    if (!cp || skip.has(cp)) continue;
    let a = byCp.get(cp);
    if (!a) {
      byCp.set(cp, (a = { cp, inUsd: 0, outUsd: 0, counted: 0, txCount: 0, largest: null, lastTs: 0, dust: { usd: 0, count: 0, largest: null } }));
    }
    a.txCount++;
    a[t.dir === "in" ? "inUsd" : "outUsd"] += t.usd;
    // Sending to a bad wallet is the wallet's own act at any amount; receiving dust is not.
    if (t.dir === "out" || t.usd >= EXPOSURE_RULES.dustUsd) {
      a.counted += t.usd;
      if (!a.largest || t.usd > a.largest.usd) a.largest = t;
    } else {
      a.dust.usd += t.usd;
      a.dust.count++;
      if (!a.dust.largest || t.usd > a.dust.largest.usd) a.dust.largest = t;
    }
    a.lastTs = Math.max(a.lastTs, t.ts);
  }
  let dustIgnored = 0;
  for (const a of byCp.values()) {
    if (a.dust.usd >= EXPOSURE_RULES.dustSumUsd) {
      a.counted += a.dust.usd;
      a.dustCounted = a.dust.count;
      if (!a.largest) a.largest = a.dust.largest;
    } else {
      dustIgnored += a.dust.count;
    }
  }
  return { byCp, totalUsd, dustIgnored };
}

/** " (incl. 500 transfers under $10 ...)" when split-up small payments were counted. */
const dustNote = (a) =>
  a.dustCounted
    ? ` (incl. ${a.dustCounted} transfers under ${usd(EXPOSURE_RULES.dustUsd)} that add up to ${usd(a.dust.usd)})`
    : "";

/** The most severe risky listing of an intel entry, or null if it carries none. */
export function riskOf(entry) {
  const category = LISTED_ORDER.find((c) => entry.sources.some((s) => s.category === c));
  if (!category) return null;
  const sources = entry.sources.filter((s) => s.category === category);
  return {
    category,
    ...LISTED[category],
    ...(category === "SANCTIONS" && { risk: RISK_CATEGORIES[sanctionsCategoryId(sources)] }),
    entity: sources.find((s) => s.entity)?.entity || entry.entities?.[0] || LISTED[category].risk.label,
    providers: [...new Set(sources.map((s) => s.authority))],
    reference: sources.find((s) => s.reference?.url)?.reference?.url || null,
  };
}

const flowDirection = (a) => (a.inUsd && a.outUsd ? "BOTH" : a.inUsd ? "INBOUND" : "OUTBOUND");
const flowVerb = (a) =>
  a.inUsd && a.outUsd
    ? `exchanged ${usd(a.counted)} with`
    : a.inUsd
      ? `received ${usd(a.counted)} from`
      : `sent ${usd(a.counted)} to`;

/** Freeze times (ms) of the issuer-frozen entries among `entries`, by entry key. */
async function freezeTimes(entries) {
  const frozen = entries.filter((e) => riskOf(e)?.category === "ISSUER_FREEZE");
  const times = await Promise.all(frozen.map((e) => freezeTime(e)));
  return new Map(frozen.map((e, i) => [e.key, times[i]]));
}

/** The freeze time when every transfer with the frozen wallet came before it, else null. */
const frozenAfter = (frozenAt, agg) => (frozenAt && agg.lastTs < frozenAt ? frozenAt : null);
const freezeNote = (ts) => ` All of it before the wallet was frozen on ${day(ts)}, so ranked one level lower.`;

function indicator({ hop, level, risk, agg, pct, via, reason, frozenAt }) {
  return {
    id: `IND-EXP-H${hop}-${agg.cp}`,
    kind: "EXPOSURE",
    direction: flowDirection(agg),
    counterparty: agg.cp,
    via: via || null,
    entity: risk.entity,
    category: risk.risk.id,
    categoryLabel: `Exposure: ${risk.risk.label}`,
    severity: level,
    score: LEVEL_SCORES[level],
    hopDistance: hop,
    exposurePercentage: Math.round(pct * 100) / 100,
    amountUsdt: Math.round(agg.counted * 100) / 100,
    confidence: risk.severe ? "LISTED_COUNTERPARTY" : "OSINT_COUNTERPARTY",
    providers: risk.providers,
    reason,
    beforeFreeze: frozenAt ? day(frozenAt) : null,
    sampleTx: agg.largest ? { hash: agg.largest.tx, usd: agg.largest.usd, timestamp: agg.largest.ts } : null,
    evidence: [
      {
        source: risk.providers.join(", "),
        confidence: `Counterparty listed as ${risk.category}`,
        details: reason,
        legalCitation: risk.reference,
      },
    ],
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Fund-flow graph for the UI. Edges point from the nearer wallet to the farther one; `outUsd`
 * is what the nearer wallet sent, `inUsd` what it received.
 */
function graphBuilder() {
  const nodes = new Map();
  const edges = new Map();
  return {
    has: (id) => nodes.has(id),
    node(id, data) {
      if (!nodes.has(id)) nodes.set(id, { id, ...data });
      return nodes.get(id);
    },
    link(from, agg, hop) {
      const id = `${from}->${agg.cp}`;
      if (!edges.has(id)) {
        edges.set(id, {
          id,
          source: from,
          target: agg.cp,
          hop,
          inUsd: round2(agg.inUsd),
          outUsd: round2(agg.outUsd),
          txCount: agg.txCount,
        });
      }
    },
    toJSON: () => ({ nodes: [...nodes.values()], edges: [...edges.values()] }),
  };
}

const riskData = (risk, level) => ({
  category: risk.risk.id,
  label: risk.risk.label,
  entity: risk.entity,
  providers: risk.providers,
  severe: risk.severe,
  level,
});

const LEVEL_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2, IGNORED: 3 };
const CLEAN_ROLE_RANK = { intermediary: 0, unreached: 1, counterparty: 2 };

/**
 * Keeps the graph within EXPOSURE_RULES.graphMaxNodes without hiding what matters: listed
 * wallets go in first (most severe, nearest, largest), each with the intermediary that leads to
 * it; clean wallets fill the room left. Whatever doesn't fit is folded into "+N more" nodes.
 * Only the drawing is limited: every finding is still scored and listed.
 */
function pruneGraph({ nodes, edges }, self) {
  if (nodes.length <= EXPOSURE_RULES.graphMaxNodes) return { nodes, edges };

  const room = EXPOSURE_RULES.graphMaxNodes - 2; // two slots kept for the "+N more" nodes
  const kept = new Set([self]);
  const incoming = (id) => edges.filter((e) => e.target === id);
  const volume = (n) => n.volumeUsd || 0;

  const listed = nodes
    .filter((n) => n.role === "listed")
    .sort((a, b) => LEVEL_RANK[a.risk.level] - LEVEL_RANK[b.risk.level] || a.hop - b.hop || volume(b) - volume(a));
  const hiddenListed = [];
  for (const n of listed) {
    const need = [n.id];
    // A hop-2 wallet needs a visible route: keep its largest intermediary if none is kept yet.
    const routes = incoming(n.id);
    if (n.hop === 2 && !routes.some((e) => kept.has(e.source))) {
      need.push(routes.sort((a, b) => b.inUsd + b.outUsd - (a.inUsd + a.outUsd))[0].source);
    }
    const added = need.filter((id) => !kept.has(id));
    if (kept.size + added.length <= room) added.forEach((id) => kept.add(id));
    else hiddenListed.push(n);
  }

  const clean = nodes
    .filter((n) => n.role in CLEAN_ROLE_RANK && !kept.has(n.id))
    .sort((a, b) => CLEAN_ROLE_RANK[a.role] - CLEAN_ROLE_RANK[b.role] || volume(b) - volume(a));
  const hiddenClean = [];
  for (const n of clean) {
    if (kept.size < room) kept.add(n.id);
    else hiddenClean.push(n);
  }

  // Fold hidden hop-1 wallets into "+N more" nodes, carrying their edge amounts along.
  const outNodes = nodes.filter((n) => kept.has(n.id));
  const outEdges = edges.filter((e) => kept.has(e.source) && kept.has(e.target));
  const fold = (id, data, hidden, existing) => {
    const node = existing ? { ...existing } : { id, hop: 1, volumeUsd: 0, count: 0, ...data };
    const edge = edges.find((e) => e.target === id) || { id: `${self}->${id}`, source: self, target: id, hop: 1, inUsd: 0, outUsd: 0, txCount: 0 };
    const sum = { ...edge };
    for (const n of hidden) {
      node.count += n.count || 1;
      node.volumeUsd += volume(n);
      const e = edges.find((x) => x.source === self && x.target === n.id);
      if (e) {
        sum.inUsd = round2(sum.inUsd + e.inUsd);
        sum.outUsd = round2(sum.outUsd + e.outUsd);
        sum.txCount += e.txCount || 0;
      }
    }
    outNodes.push(node);
    outEdges.push(sum);
  };
  const more = nodes.find((n) => n.role === "more");
  const moreId = more?.id || `more:${self}`;
  if (more || hiddenClean.length) fold(moreId, { role: "more" }, hiddenClean.filter((n) => n.hop === 1), more);
  if (hiddenListed.length) {
    const worst = hiddenListed[0].risk.level; // already sorted most severe first
    fold(`more-listed:${self}`, { role: "more-listed", risk: { level: worst, entity: "More listed wallets" } }, hiddenListed);
  }
  return { nodes: outNodes, edges: outEdges };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const withDeadline = (promise, deadline) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), Math.max(0, deadline - Date.now())).unref?.()
    ),
  ]);

/**
 * Counterparty exposure of one wallet: who it moved USDT with (hop 1), and who its largest
 * clean counterparties moved USDT with (hop 2), checked against the intel database.
 * Exposure alone never makes a wallet CRITICAL; only the wallet's own listing does.
 *
 * @param {string} chain  "TRON" | "ETHEREUM" | "BSC"
 * @param {string} address
 * @param {object} [opts]
 * @param {boolean} [opts.followOutflows] hop 2 follows the clean wallets this one sent the most to
 *   (where its money went) instead of the largest by total volume. Used for already-listed wallets.
 * @returns {Promise<{indicators: object[], coverage: object, graph: object|null}>}
 */
export async function analyzeExposure(chain, address, { followOutflows = false } = {}) {
  const self = normalizeAddress(address.trim());
  const coverage = { status: "complete", hop1: null, hop2: null, errors: [] };

  let history;
  try {
    history = await getTransferHistory(chain, self);
  } catch (err) {
    coverage.status = "unavailable";
    coverage.errors.push(`Transfer history unavailable: ${err.message}`);
    return { indicators: [], coverage, graph: null, history: null };
  }

  // USDT sent to the token contract itself is lost by mistake, not paid to anyone. Tether
  // blacklisted its own contracts, so it would otherwise read as dealing with a frozen wallet.
  const token = normalizeAddress(SUPPORTED_CHAINS[chain].contract);

  // ---- Hop 1: the wallet's own counterparties
  const hop1 = aggregate(history.transfers, new Set([self, token]));
  const listed1 = await lookupAddresses(chain, [...hop1.byCp.keys()]);
  const frozen1 = await freezeTimes([...listed1.values()]);
  const indicators = [];
  const risky1 = new Set();
  const graph = graphBuilder();
  graph.node(self, { hop: 0, role: "screened", volumeUsd: Math.round(hop1.totalUsd), counterparties: hop1.byCp.size });
  const hop1Node = (agg, data) => {
    graph.node(agg.cp, { hop: 1, volumeUsd: Math.round(agg.inUsd + agg.outUsd), txCount: agg.txCount, ...data });
    graph.link(self, agg, 1);
  };

  for (const agg of hop1.byCp.values()) {
    const entry = listed1.get(agg.cp);
    const risk = entry && riskOf(entry);
    if (!risk) continue;
    risky1.add(agg.cp);
    if (agg.counted <= 0) {
      // Only incoming dust: the wallet is a target, not a participant.
      hop1Node(agg, { role: "listed", risk: riskData(risk, "IGNORED") });
      continue;
    }
    const pct = hop1.totalUsd ? (agg.counted / hop1.totalUsd) * 100 : 0;
    const large = agg.counted >= EXPOSURE_RULES.highUsd || pct >= EXPOSURE_RULES.highPct;
    const frozenAt = frozenAfter(frozen1.get(entry.key), agg);
    const full = risk.severe ? (large ? "HIGH" : "MEDIUM") : large ? "MEDIUM" : "LOW";
    const level = frozenAt ? LOWER[full] : full;
    hop1Node(agg, { role: "listed", risk: riskData(risk, level) });
    indicators.push(
      indicator({
        hop: 1,
        level,
        risk,
        agg,
        pct,
        frozenAt,
        reason:
          `Directly ${flowVerb(agg)} ${risk.entity} (${risk.providers.join(", ")})${dustNote(agg)} — ` +
          `${pct.toFixed(1)}% of this wallet's volume, last on ${day(agg.lastTs)}.` +
          (frozenAt ? freezeNote(frozenAt) : ""),
      })
    );
  }

  coverage.hop1 = {
    transfers: history.transfers.length,
    counterparties: hop1.byCp.size,
    volumeUsd: Math.round(hop1.totalUsd),
    truncated: history.truncated.in || history.truncated.out,
    dustIgnored: hop1.dustIgnored,
    cached: history.cached,
    fetchedAt: history.fetchedAt,
  };

  // ---- Hop 2: counterparties of the largest clean counterparties
  const pick = (weight, taken = []) =>
    [...hop1.byCp.values()]
      .filter((a) => !risky1.has(a.cp) && !taken.includes(a) && weight(a) >= EXPOSURE_RULES.hop2MinUsd)
      .sort((a, b) => weight(b) - weight(a))
      .slice(0, EXPOSURE_RULES.hop2FanOut - taken.length);
  const byVolume = (a) => a.inUsd + a.outUsd;
  // A frozen wallet often only receives, so remaining slots go to the largest by volume.
  const outflows = followOutflows ? pick((a) => a.outUsd) : [];
  const candidates = [...outflows, ...pick(byVolume, outflows)];

  const deadline = Date.now() + EXPOSURE_RULES.hop2DeadlineMs;
  // TronGrid's free key allows ~15 req/s and pages 200 at a time, so fewer TRON wallets at once.
  const traced = await pool(candidates, chain === "TRON" ? 3 : 5, async (via) => {
    try {
      const h = await withDeadline(getTransferHistory(chain, via.cp), deadline);
      // Busy wallets are traced too, on their newest transfers only (`truncated`). Transfer
      // count alone can't tell an exchange from an active person, so nothing is skipped.
      return { via, agg: aggregate(h.transfers, new Set([self, via.cp, token])), truncated: h.truncated.in || h.truncated.out };
    } catch (err) {
      return { via, error: err.message };
    }
  });

  for (const t of traced) {
    hop1Node(t.via, {
      role: t.error ? "unreached" : "intermediary",
      counterparties: t.agg?.byCp.size,
      truncated: !!t.truncated,
    });
  }

  const followed = traced.filter((t) => t.agg);
  const listed2 = await lookupAddresses(chain, [...new Set(followed.flatMap((t) => [...t.agg.byCp.keys()]))]);
  const frozen2 = await freezeTimes([...listed2.values()]);
  // One finding per listed wallet: the strongest route to it (a later route may be large where the first was small).
  const best2 = new Map();

  for (const { via, agg: viaAgg } of followed) {
    for (const agg of viaAgg.byCp.values()) {
      if (agg.counted <= 0) continue;
      const entry = listed2.get(agg.cp);
      const risk = entry && riskOf(entry);
      if (!risk) continue;
      // Hop 2 is capped at MEDIUM: the intermediary may be an unrelated party. MEDIUM needs both
      // links to be large: a small payment from someone who once dealt with a listed wallet is context.
      const frozenAt = frozenAfter(frozen2.get(entry.key), agg);
      const bothLarge = Math.min(agg.counted, via.counted) >= EXPOSURE_RULES.highUsd;
      const full = risk.severe && bothLarge ? "MEDIUM" : "LOW";
      const level = frozenAt ? LOWER[full] : full;
      // Every route to a listed wallet is drawn, even when it was already found another way.
      graph.node(agg.cp, { hop: 2, role: "listed", volumeUsd: Math.round(agg.inUsd + agg.outUsd), risk: riskData(risk, level) });
      graph.link(via.cp, agg, 2);
      if (risky1.has(agg.cp)) continue; // already a direct (hop-1) finding
      const pct = viaAgg.totalUsd ? (agg.counted / viaAgg.totalUsd) * 100 : 0;
      const prev = best2.get(agg.cp);
      if (prev && (LEVEL_SCORES[level] < prev.score || (LEVEL_SCORES[level] === prev.score && Math.min(agg.counted, via.counted) <= prev.strength))) continue;
      best2.set(agg.cp, {
        score: LEVEL_SCORES[level],
        strength: Math.min(agg.counted, via.counted),
        ind: indicator({
          hop: 2,
          level,
          risk,
          agg,
          pct,
          frozenAt,
          via: { address: via.cp, volumeUsd: Math.round(via.inUsd + via.outUsd), direction: flowDirection(via) },
          reason:
            `2 hops: this wallet ${flowVerb(via)} ${via.cp}, which ${flowVerb(agg)} ` +
            `${risk.entity} (${risk.providers.join(", ")})${dustNote(agg)}, last on ${day(agg.lastTs)}.` +
            (frozenAt ? freezeNote(frozenAt) : ""),
        }),
      });
    }
  }
  indicators.push(...[...best2.values()].map((b) => b.ind));

  const failed = traced.filter((t) => t.error);
  coverage.hop2 = {
    followed: followed.length,
    truncated: followed.filter((t) => t.truncated).length, // traced on their newest transfers only
    failed: failed.length,
    counterparties: followed.reduce((n, t) => n + t.agg.byCp.size, 0),
  };
  if (failed.length) {
    coverage.status = "partial";
    coverage.errors.push(...failed.map((t) => `Hop 2 via ${t.via.cp}: ${t.error}`));
  }

  // Other large hop-1 counterparties, then everything else folded into one node.
  const rest = [...hop1.byCp.values()]
    .filter((a) => !graph.has(a.cp))
    .sort((a, b) => b.inUsd + b.outUsd - (a.inUsd + a.outUsd));
  for (const agg of rest.slice(0, EXPOSURE_RULES.graphExtraHop1)) hop1Node(agg, { role: "counterparty" });
  const others = rest.slice(EXPOSURE_RULES.graphExtraHop1);
  if (others.length) {
    const sum = { cp: `more:${self}`, inUsd: 0, outUsd: 0, txCount: 0 };
    for (const a of others) {
      sum.inUsd += a.inUsd;
      sum.outUsd += a.outUsd;
      sum.txCount += a.txCount;
    }
    hop1Node(sum, { role: "more", count: others.length });
  }

  indicators.sort((a, b) => b.score - a.score || a.hopDistance - b.hopDistance || b.amountUsdt - a.amountUsdt);
  // `history` is for the behaviour detectors (server side only; the scorer doesn't return it).
  return { indicators, coverage, graph: pruneGraph(graph.toJSON(), self), history };
}
