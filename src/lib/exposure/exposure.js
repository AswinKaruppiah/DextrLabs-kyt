import { getTransferHistory } from "./transferHistory.js";
import { lookupAddresses } from "../collector/store.js";
import { normalizeAddress } from "../collector/util/address.js";
import { RISK_CATEGORIES } from "../intelligence/entityAttribution";
import { EXPOSURE_RULES } from "./rules.js";

export { EXPOSURE_RULES };

const LEVEL_SCORES = { HIGH: 75, MEDIUM: 50, LOW: 20 };

// Intel categories that make a counterparty risky, most severe first. `severe` = government or
// issuer action; the others are OSINT labels and rank one level lower.
const LISTED = {
  SANCTIONS: { severe: true, risk: RISK_CATEGORIES.SANCTIONS_OFAC },
  ISSUER_FREEZE: { severe: true, risk: RISK_CATEGORIES.TETHER_FROZEN },
  HACK_EXPLOIT: { severe: false, risk: RISK_CATEGORIES.EXCHANGE_EXPLOIT },
  SCAM_PHISHING: { severe: false, risk: RISK_CATEGORIES.PHISHING_SCAM },
};
const LISTED_ORDER = Object.keys(LISTED);

const usd = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const day = (ts) => new Date(ts).toISOString().slice(0, 10);

/** Per-counterparty totals of one wallet's transfers. `counted` drops incoming dust. */
function aggregate(transfers, skip) {
  const byCp = new Map();
  let totalUsd = 0;
  let dustIgnored = 0;
  for (const t of transfers) {
    totalUsd += t.usd;
    const cp = normalizeAddress(t.cp || "");
    if (!cp || skip.has(cp)) continue;
    let a = byCp.get(cp);
    if (!a) byCp.set(cp, (a = { cp, inUsd: 0, outUsd: 0, counted: 0, txCount: 0, largest: null, lastTs: 0 }));
    a.txCount++;
    a[t.dir === "in" ? "inUsd" : "outUsd"] += t.usd;
    // Sending to a bad wallet is the wallet's own act at any amount; receiving dust is not.
    if (t.dir === "out" || t.usd >= EXPOSURE_RULES.dustUsd) {
      a.counted += t.usd;
      if (!a.largest || t.usd > a.largest.usd) a.largest = t;
    } else {
      dustIgnored++;
    }
    a.lastTs = Math.max(a.lastTs, t.ts);
  }
  return { byCp, totalUsd, dustIgnored };
}

/** The most severe risky listing of an intel entry, or null if it carries none. */
function riskOf(entry) {
  const category = LISTED_ORDER.find((c) => entry.sources.some((s) => s.category === c));
  if (!category) return null;
  const sources = entry.sources.filter((s) => s.category === category);
  return {
    category,
    ...LISTED[category],
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

function indicator({ hop, level, risk, agg, pct, via, reason }) {
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
    return { indicators: [], coverage, graph: null };
  }

  // ---- Hop 1: the wallet's own counterparties
  const hop1 = aggregate(history.transfers, new Set([self]));
  const listed1 = await lookupAddresses(chain, [...hop1.byCp.keys()]);
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
    const level = risk.severe ? (large ? "HIGH" : "MEDIUM") : large ? "MEDIUM" : "LOW";
    hop1Node(agg, { role: "listed", risk: riskData(risk, level) });
    indicators.push(
      indicator({
        hop: 1,
        level,
        risk,
        agg,
        pct,
        reason:
          `Directly ${flowVerb(agg)} ${risk.entity} (${risk.providers.join(", ")}) — ` +
          `${pct.toFixed(1)}% of this wallet's volume, last on ${day(agg.lastTs)}.`,
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
      return { via, agg: aggregate(h.transfers, new Set([self, via.cp])), truncated: h.truncated.in || h.truncated.out };
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
  const seen2 = new Set(risky1);

  for (const { via, agg: viaAgg } of followed) {
    for (const agg of viaAgg.byCp.values()) {
      if (agg.counted <= 0) continue;
      const entry = listed2.get(agg.cp);
      const risk = entry && riskOf(entry);
      if (!risk) continue;
      // Hop 2 is capped at MEDIUM: the intermediary may be an unrelated party.
      const level = risk.severe && agg.counted >= EXPOSURE_RULES.highUsd ? "MEDIUM" : "LOW";
      // Every route to a listed wallet is drawn, even when it was already found another way.
      graph.node(agg.cp, { hop: 2, role: "listed", volumeUsd: Math.round(agg.inUsd + agg.outUsd), risk: riskData(risk, level) });
      graph.link(via.cp, agg, 2);
      if (seen2.has(agg.cp)) continue;
      seen2.add(agg.cp);
      const pct = viaAgg.totalUsd ? (agg.counted / viaAgg.totalUsd) * 100 : 0;
      indicators.push(
        indicator({
          hop: 2,
          level,
          risk,
          agg,
          pct,
          via: { address: via.cp, volumeUsd: Math.round(via.inUsd + via.outUsd), direction: flowDirection(via) },
          reason:
            `2 hops: this wallet ${flowVerb(via)} ${via.cp}, which ${flowVerb(agg)} ` +
            `${risk.entity} (${risk.providers.join(", ")}), last on ${day(agg.lastTs)}.`,
        })
      );
    }
  }

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
  return { indicators, coverage, graph: pruneGraph(graph.toJSON(), self) };
}
