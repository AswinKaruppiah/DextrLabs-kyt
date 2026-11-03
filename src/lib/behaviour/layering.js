import { BEHAVIOUR_RULES as R, EXPOSURE_RULES } from "../exposure/rules.js";
import { holdStats, walletAgeDays } from "./detectors.js";

/**
 * Layering: money passed through a row of freshly made wallets, each forwarding it within hours,
 * to get past the 2-hop exposure trace. Only the main money path is followed (the counterparty
 * carrying most of the wallet's in- or outflow), so the cost stays at a few wallets per direction.
 *
 * deps = { getHistory(addr) -> {transfers, truncated}, getAge(addr) -> createdAt|null,
 *          getRisk(addr) -> riskOf result|null, deadline: ms timestamp, now?: ms }
 */

/** The counterparty carrying the largest share of the wallet's inflow (back) or outflow (forward). */
function mainCounterparty(transfers, direction) {
  const dir = direction === "back" ? "in" : "out";
  const byCp = new Map();
  let total = 0;
  for (const t of transfers) {
    if (t.dir !== dir || t.usd < EXPOSURE_RULES.dustUsd) continue;
    byCp.set(t.cp, (byCp.get(t.cp) || 0) + t.usd);
    total += t.usd;
  }
  let best = null;
  for (const [cp, usd] of byCp) if (!best || usd > best.usd) best = { cp, usd };
  return best && best.usd / total >= R.layeringDominantShare ? best : null;
}

/** Exchange-like wallet: too many counterparties (or too much history) to be one person's. */
export const isHub = ({ transfers, truncated }) =>
  (truncated?.in && truncated?.out) || new Set(transfers.map((t) => t.cp)).size >= R.hubCounterparties;

/** A fresh wallet that passes its money on quickly; returns its layer record or null. */
export function asLayer(address, history, createdAt, now) {
  const ageDays = walletAgeDays(createdAt, now);
  if (ageDays === null || ageDays > R.layeringFreshDays) return null;
  const h = holdStats(history.transfers);
  const [lo, hi] = R.passThroughRatio;
  if (h.ratio === null || h.ratio < lo || h.ratio > hi) return null;
  if (h.medianHoldMinutes === null || h.medianHoldMinutes > R.layeringMaxHoldH * 60) return null;
  return { address, ageDays, holdHours: Math.round((h.medianHoldMinutes / 60) * 10) / 10, usd: Math.round(h.inUsd) };
}

/**
 * Follows the main money path from `start`, back (where money came from) or forward (where it went),
 * while each wallet on it is a fresh pass-through wallet.
 * @returns {Promise<{layers: object[], end: {address, reason, risk?}, partial: boolean}>}
 *   end.reason: "listed" | "hub" | "not-a-layer" | "split" | "cycle" | "max-hops" | "error" | "deadline"
 */
export async function traceLayering(start, direction, deps) {
  const now = deps.now ?? Date.now();
  const layers = [];
  const visited = new Set([start]);
  const stop = (address, reason, extra = {}) => ({ layers, end: { address, reason, ...extra }, partial: reason === "error" || reason === "deadline" });

  let current = start;
  let history;
  try {
    history = await deps.getHistory(start);
  } catch {
    return stop(start, "error");
  }

  for (let hop = 0; hop < R.layeringMaxHops; hop++) {
    if (Date.now() > deps.deadline) return stop(current, "deadline");
    const main = mainCounterparty(history.transfers, direction);
    if (!main) return stop(current, "split");
    const next = main.cp;
    if (visited.has(next)) return stop(next, "cycle");
    visited.add(next);

    let risk, nextHistory, createdAt;
    try {
      risk = await deps.getRisk(next);
      if (risk) return stop(next, "listed", { risk });
      nextHistory = await deps.getHistory(next);
      if (isHub(nextHistory)) return stop(next, "hub");
      createdAt = await deps.getAge(next);
    } catch {
      return stop(next, "error");
    }
    const record = asLayer(next, nextHistory, createdAt, now);
    if (!record) return stop(next, "not-a-layer");
    layers.push(record);
    current = next;
    history = nextHistory;
  }
  return stop(current, "max-hops");
}

const plural = (n) => `${n} new wallet${n === 1 ? "" : "s"}`;

/**
 * Turns the back and forward traces into one signal (or null).
 * A listed wallet at the end of ≥ 1 fresh layer beats a long unlisted row.
 */
export function layeringSignal(back, forward, startIsLayer) {
  const hold = `${R.layeringMaxHoldH} hours`;
  for (const [trace, type, verb] of [
    [back, "LAYERED_FROM_LISTED", "came from"],
    [forward, "LAYERED_TO_LISTED", "went on to"],
  ]) {
    if (trace.end?.reason !== "listed" || !trace.layers.length) continue;
    const { risk } = trace.end;
    return {
      type,
      level: risk.severe ? "HIGH" : "MEDIUM",
      reason:
        `Money ${verb} ${risk.entity} (${risk.providers.join(", ")}) through ${plural(trace.layers.length)} ` +
        `that each passed it on within ${hold}.`,
      evidence: { direction: trace === back ? "back" : "forward", layers: trace.layers, end: { address: trace.end.address, entity: risk.entity, category: risk.risk.id } },
    };
  }
  const row = startIsLayer ? back.layers.length + 1 + forward.layers.length : Math.max(back.layers.length, forward.layers.length);
  if (row < R.layeringMinLayers) return null;
  return {
    type: "LAYERING_CHAIN",
    level: "MEDIUM",
    reason: `Money moved through ${plural(row)} in a row, each made within ${R.layeringFreshDays} days and passing it on within ${hold}: a common way to hide where funds came from.`,
    evidence: { back: back.layers, forward: forward.layers, startIsLayer, row },
  };
}
