import { BEHAVIOUR_RULES as R, EXPOSURE_RULES } from "../exposure/rules.js";

/**
 * Behaviour detectors: pure functions over one wallet's USDT transfers ({cp, dir, usd, ts, tx}).
 * Each returns { type, level, reason, evidence } or null. They catch wallets no list names yet,
 * so their levels are review-grade (MEDIUM, INFO); combineSignals decides when they add up to HIGH.
 */

const DAY_MS = 86_400_000;
const isDust = (t) => t.usd < EXPOSURE_RULES.dustUsd;
const usd = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
const byTime = (a, b) => a.ts - b.ts;
const volume = (transfers) => transfers.reduce((n, t) => n + t.usd, 0);

const signal = (type, level, reason, evidence) => ({ type, level, reason, evidence });

/** Largest recipients of the wallet's (non-dust) outgoing transfers. */
function topTargets(transfers, n = 3) {
  const out = new Map();
  for (const t of transfers) if (t.dir === "out" && !isDust(t)) out.set(t.cp, (out.get(t.cp) || 0) + t.usd);
  return [...out]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([address, usdOut]) => ({ address, usd: Math.round(usdOut * 100) / 100 }));
}

/**
 * How long money stays in the wallet: incoming lots are matched to later outgoing transfers
 * first-in first-out. `medianHoldMinutes` is the value-weighted median; `cycles` counts outgoing
 * transfers that were matched to at least one earlier incoming lot. Dust is ignored.
 */
export function holdStats(transfers) {
  const sorted = transfers.filter((t) => !isDust(t)).sort(byTime);
  const lots = [];
  const holds = [];
  let inUsd = 0;
  let outUsd = 0;
  let cycles = 0;
  for (const t of sorted) {
    if (t.dir === "in") {
      inUsd += t.usd;
      lots.push({ ts: t.ts, left: t.usd });
      continue;
    }
    outUsd += t.usd;
    let need = t.usd;
    let matched = false;
    while (need > 0 && lots.length) {
      const lot = lots[0];
      const take = Math.min(need, lot.left);
      holds.push({ minutes: (t.ts - lot.ts) / 60_000, usd: take });
      matched = true;
      lot.left -= take;
      need -= take;
      if (lot.left <= 1e-9) lots.shift();
    }
    if (matched) cycles++;
  }
  holds.sort((a, b) => a.minutes - b.minutes);
  const half = holds.reduce((n, h) => n + h.usd, 0) / 2;
  let acc = 0;
  let medianHoldMinutes = null;
  for (const h of holds) {
    acc += h.usd;
    if (acc >= half) {
      medianHoldMinutes = Math.round(h.minutes);
      break;
    }
  }
  return { inUsd, outUsd, ratio: inUsd ? outUsd / inUsd : null, medianHoldMinutes, cycles };
}

/** Money comes in and leaves again within the hour, over and over. */
export function detectPassThrough(transfers) {
  if (volume(transfers) < R.minVolumeUsd) return null;
  const h = holdStats(transfers);
  const [lo, hi] = R.passThroughRatio;
  if (h.ratio === null || h.ratio < lo || h.ratio > hi) return null;
  if (h.cycles < R.passThroughMinCycles || h.medianHoldMinutes > R.passThroughMaxHoldMin) return null;
  return signal(
    "PASS_THROUGH",
    "MEDIUM",
    `Money passes straight through: ${usd(h.inUsd)} in and ${usd(h.outUsd)} out, ` +
      `typically leaving after ${h.medianHoldMinutes} min (${h.cycles} times).`,
    { medianHoldMinutes: h.medianHoldMinutes, cycles: h.cycles, inUsd: h.inUsd, outUsd: h.outUsd, targets: topTargets(transfers) }
  );
}

/** Many wallets pay in and it forwards to a few (collector), or the reverse (distributor). */
export function detectFanPattern(transfers) {
  if (volume(transfers) < R.minVolumeUsd) return null;
  const senders = new Set();
  const recipients = new Set();
  let inUsd = 0;
  let outUsd = 0;
  for (const t of transfers) {
    if (isDust(t)) continue;
    if (t.dir === "in") {
      senders.add(t.cp);
      inUsd += t.usd;
    } else {
      recipients.add(t.cp);
      outUsd += t.usd;
    }
  }
  const evidence = { senders: senders.size, recipients: recipients.size, inUsd, outUsd, targets: topTargets(transfers) };
  if (senders.size >= R.fanMinWallets && recipients.size >= 1 && recipients.size <= R.fanMaxOther && outUsd >= R.fanForwardShare * inUsd) {
    return signal(
      "COLLECTOR",
      "MEDIUM",
      `Collects from many wallets: ${senders.size} wallets sent ${usd(inUsd)}, and ${usd(outUsd)} went on to only ${recipients.size}.`,
      evidence
    );
  }
  if (recipients.size >= R.fanMinWallets && senders.size >= 1 && senders.size <= R.fanMaxOther) {
    return signal(
      "DISTRIBUTOR",
      "MEDIUM",
      `Pays out to many wallets: ${usd(outUsd)} sent to ${recipients.size} wallets, funded by only ${senders.size}.`,
      evidence
    );
  }
  return null;
}

/** Whole days since `createdAt` (ms), or null when the age is unknown. */
export const walletAgeDays = (createdAt, now = Date.now()) =>
  createdAt == null ? null : Math.floor((now - createdAt) / DAY_MS);

const ageText = (days) => (days === 0 ? "less than a day old" : `${days} day${days === 1 ? "" : "s"} old`);

/**
 * A brand-new wallet that already moved a lot. Age comes from `createdAt` (account record or first
 * gas received); without it, the oldest transfer is used, but only when the history is complete.
 */
export function detectNewWallet(transfers, { createdAt, truncated }, now = Date.now()) {
  let firstTs = createdAt ?? null;
  if (firstTs == null && transfers.length && !truncated?.in && !truncated?.out) {
    firstTs = Math.min(...transfers.map((t) => t.ts));
  }
  const ageDays = walletAgeDays(firstTs, now);
  if (ageDays === null || now - firstTs > R.newWalletDays * DAY_MS) return null;
  const volumeUsd = volume(transfers);
  if (volumeUsd < R.newWalletMinUsd) return null;
  return signal(
    "NEW_WALLET_HIGH_VOLUME",
    "MEDIUM",
    `Wallet is ${ageText(ageDays)} but has already moved ${usd(volumeUsd)}.`,
    { ageDays, createdAt: firstTs, volumeUsd }
  );
}

/** Sends tiny transfers to many wallets: the address-poisoning pattern (sender side). */
export function detectPoisoner(transfers) {
  const outs = transfers.filter((t) => t.dir === "out");
  const dust = outs.filter((t) => t.usd < R.poisonerMaxUsd);
  const targets = new Set(dust.map((t) => t.cp)).size;
  if (targets < R.poisonerMinTargets || dust.length / outs.length < R.poisonerShare) return null;
  return signal(
    "POISONER",
    "MEDIUM",
    `Sent ${dust.length} tiny transfers (under ${usd(R.poisonerMaxUsd)}) to ${targets} different wallets, ` +
      `the pattern of an address-poisoning scam.`,
    { targets, dustTransfers: dust.length, outgoingTransfers: outs.length }
  );
}

/** Lookalike key: first 5 / last 4 chars on TRON (case-sensitive), first 4 hex after 0x / last 4 on EVM. */
const lookalikeKey = (a) => (/^0x/i.test(a) ? `${a.slice(2, 6)}|${a.slice(-4)}`.toLowerCase() : `${a.slice(0, 5)}|${a.slice(-4)}`);
const sameAddress = (a, b) => (/^0x/i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Received dust from an address that imitates one of the wallet's real counterparties (victim side). */
export function detectPoisoningTarget(transfers, selfAddress) {
  const real = new Map();
  for (const t of transfers) {
    if (!isDust(t) && !sameAddress(t.cp, selfAddress)) real.set(lookalikeKey(t.cp), t.cp);
  }
  const matches = [];
  for (const t of transfers) {
    if (t.dir !== "in" || !isDust(t)) continue;
    const twin = real.get(lookalikeKey(t.cp));
    if (twin && !sameAddress(twin, t.cp) && !matches.some((m) => m.lookalike === t.cp)) {
      matches.push({ lookalike: t.cp, real: twin });
    }
  }
  if (!matches.length) return null;
  const [first] = matches;
  return signal(
    "POISONING_TARGET",
    "INFO",
    `Targeted by address poisoning: tiny transfers came from ${first.lookalike}, which imitates ${first.real}, ` +
      `a wallet this one really uses. Check every address before sending.`,
    { lookalike: first.lookalike, real: first.real, matches }
  );
}

/** Repeated amounts just under a reporting-style limit ($900-$999, $2,700-$2,999, ...) in a short time. */
export function detectStructuring(transfers) {
  const justBelow = transfers
    .filter((t) => R.structuringBands.some((b) => t.usd >= 0.9 * b && t.usd < b))
    .sort(byTime);
  const windowMs = R.structuringWindowH * 3_600_000;
  let best = 0;
  for (let i = 0, j = 0; j < justBelow.length; j++) {
    while (justBelow[j].ts - justBelow[i].ts > windowMs) i++;
    best = Math.max(best, j - i + 1);
  }
  if (best < R.structuringMinCount) return null;
  return signal(
    "STRUCTURING",
    "MEDIUM",
    `${best} transfers just under a round limit (like $950-$999) within ${R.structuringWindowH} hours: amounts look split to stay below thresholds.`,
    { count: best, windowHours: R.structuringWindowH }
  );
}

/** HIGH if any signal is HIGH, or two or more are MEDIUM (`combined`); otherwise the highest level present. */
export function combineSignals(signals) {
  const levels = signals.filter(Boolean).map((s) => s.level);
  if (levels.includes("HIGH")) return { level: "HIGH", combined: false };
  const medium = levels.filter((l) => l === "MEDIUM").length;
  if (medium >= 2) return { level: "HIGH", combined: true };
  if (medium === 1) return { level: "MEDIUM", combined: false };
  return { level: levels.includes("INFO") ? "INFO" : null, combined: false };
}
