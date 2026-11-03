import { BEHAVIOUR_RULES as R } from "../exposure/rules.js";
import {
  detectPassThrough,
  detectFanPattern,
  detectNewWallet,
  detectPoisoner,
  detectPoisoningTarget,
  detectStructuring,
  combineSignals,
  walletAgeDays,
  earliestActivity,
} from "./detectors.js";
import { traceLayering, layeringSignal, isHub, asLayer } from "./layering.js";
import { withinDeadline } from "./deadline.js";

/**
 * Behaviour findings for one wallet, with every lookup injected (see analyzeBehaviour.js for the
 * real ones), so the combining rules are testable:
 * deps = { findFirstFunder(a), getWalletAge(a, funding), countFundedWallets(funder),
 *          getHistory(a), getRisk(a), getAge(a) }
 * All work shares one `deadline`; a lookup that misses it is reported in `coverage`, never thrown.
 */

const LEVEL_SCORES = { HIGH: 75, MEDIUM: 50, INFO: 0 };
const DAY_MS = 86_400_000;

const LABELS = {
  PASS_THROUGH: "Pass-through wallet",
  COLLECTOR: "Collector wallet",
  DISTRIBUTOR: "Distributor wallet",
  NEW_WALLET_HIGH_VOLUME: "New wallet, high volume",
  POISONER: "Address poisoner",
  POISONING_TARGET: "Targeted by address poisoning",
  STRUCTURING: "Structuring",
  FUNDED_BY_LISTED: "Funded by a listed wallet",
  DEPOSIT_ADDRESS: "Likely exchange deposit address",
  HIGH_ACTIVITY: "Very busy wallet",
  LAYERED_FROM_LISTED: "Layered funds from a listed wallet",
  LAYERED_TO_LISTED: "Layered funds to a listed wallet",
  LAYERING_CHAIN: "Layering through new wallets",
  WALLET_FACTORY: "Wallet factory",
  COMBINED_BEHAVIOUR: "Several behaviour red flags",
};

const toIndicator = (s) => ({
  id: `IND-BEH-${s.type}`,
  kind: "BEHAVIOUR",
  type: s.type,
  category: "SUSPICIOUS_BEHAVIOUR",
  categoryLabel: LABELS[s.type],
  severity: s.level,
  score: LEVEL_SCORES[s.level],
  reason: s.reason,
  evidence: s.evidence,
});

/** COLLECTOR / PASS_THROUGH that sweep to an exchange-like wallet are deposit addresses, not red flags. */
async function checkDepositAddress(sig, deps, call) {
  const target = sig.evidence.targets?.[0]?.address;
  if (!target) return sig;
  try {
    if (!isHub(await call(deps.getHistory(target)))) return sig;
  } catch {
    return sig; // can't tell: keep the signal for review
  }
  return {
    type: "DEPOSIT_ADDRESS",
    level: "INFO",
    reason: `Forwards its money to ${target}, a high-activity wallet: looks like an exchange deposit address.`,
    evidence: { target, insteadOf: sig.type },
  };
}

/** Funded by a listed wallet, or by a wallet that pays first fees for many wallets (factory). */
async function funderSignal(funding, deps, call, now) {
  const risk = await call(deps.getRisk(funding.funder));
  if (risk) {
    return {
      type: "FUNDED_BY_LISTED",
      level: risk.severe ? "HIGH" : "MEDIUM",
      reason: `This wallet's first fees were paid by ${risk.entity} (${risk.providers.join(", ")}).`,
      evidence: { funder: funding.funder, tx: funding.tx, category: risk.risk.id },
    };
  }
  // Only a recently funded wallet can be part of the funder's recent batch.
  if (now - funding.ts > R.factoryWindowDays * DAY_MS) return null;
  const { wallets, truncated } = await call(deps.countFundedWallets(funding.funder));
  if (wallets < R.factoryMinWallets) return null;
  // Exchanges and gas fillers pay first fees for many wallets nonstop: a full page of recent sends,
  // or a busy USDT history, marks the funder as a hub, not a factory.
  if (truncated || isHub(await call(deps.getHistory(funding.funder)))) return null;
  return {
    type: "WALLET_FACTORY",
    level: "MEDIUM",
    reason: `The wallet that paid this wallet's first fees (${funding.funder}) sent coins to ${wallets} wallets in the last ${R.factoryWindowDays} days: it looks like a wallet factory.`,
    evidence: { funder: funding.funder, wallets, windowDays: R.factoryWindowDays },
  };
}

/** Pattern checks on the screened wallet's own history, and the layering trace. Runs alongside the funder work. */
async function historySignals(self, history, deps, call, deadline, now) {
  const { transfers } = history;
  const signals = [detectPoisoner(transfers), detectPoisoningTarget(transfers, self)];
  const busy = isHub(history);
  if (busy) {
    // A hub's volume and counterparties make single-user patterns meaningless.
    signals.push({
      type: "HIGH_ACTIVITY",
      level: "INFO",
      reason: `Very busy wallet (${R.hubCounterparties}+ counterparties or more history than we read): could be an exchange or service, so single-user pattern checks were skipped.`,
      evidence: {},
    });
  } else {
    signals.push(detectStructuring(transfers));
    const pattern = [detectFanPattern(transfers), detectPassThrough(transfers)].filter(Boolean);
    signals.push(...(await Promise.all(pattern.map((s) => checkDepositAddress(s, deps, call)))));
  }
  const layerDeps = { getHistory: deps.getHistory, getAge: deps.getAge, getRisk: deps.getRisk, deadline, now };
  const [back, forward] = await Promise.all([traceLayering(self, "back", layerDeps), traceLayering(self, "forward", layerDeps)]);
  return { signals, busy, back, forward };
}

export async function buildBehaviour({ address: self, history, now = Date.now(), deadline, deps }) {
  const call = (p) => withinDeadline(p, deadline);
  const coverage = { status: history ? "complete" : "skipped", funder: "none", layering: history ? "complete" : "skipped" };

  const funderWork = (async () => {
    let funding = null;
    try {
      funding = await call(deps.findFirstFunder(self));
      if (funding) coverage.funder = "found";
    } catch {
      coverage.funder = "unavailable";
    }
    let age = { createdAt: null, source: "unknown" };
    try {
      age = await call(deps.getWalletAge(self, funding));
    } catch {
      // age stays unknown
    }
    return { funding, age };
  })();
  const historyWork = history ? historySignals(self, history, deps, call, deadline, now) : null;

  const { funding, age } = await funderWork;
  // USDT can arrive before the first gas: the oldest transfer seen also bounds the age.
  const transfers = history?.transfers || [];
  const createdAt = earliestActivity(age.createdAt, transfers);
  const wallet = {
    createdAt,
    ageDays: walletAgeDays(createdAt, now),
    ageSource: createdAt !== null && createdAt !== age.createdAt ? "first-transfer" : age.source,
    funder: funding ? { address: funding.funder, tx: funding.tx, listed: false } : null,
  };

  const funderSig = funding
    ? funderSignal(funding, deps, call, now).catch(() => {
        coverage.funder = "unavailable";
        return null;
      })
    : null;
  const [hist, fSig] = await Promise.all([historyWork, funderSig]);
  if (fSig?.type === "FUNDED_BY_LISTED") wallet.funder.listed = true;

  const signals = [fSig];
  if (hist) {
    signals.push(...hist.signals);
    if (!hist.busy) signals.push(detectNewWallet(transfers, { createdAt, truncated: history.truncated }, now));
    if (hist.back.partial || hist.forward.partial) coverage.layering = "partial";
    signals.push(layeringSignal(hist.back, hist.forward, !!asLayer(self, history, createdAt, now)));
  }

  // One finding per type (a collector and a pass-through can both turn out to be the same deposit address).
  let found = signals.filter((s, i) => s && signals.findIndex((o) => o?.type === s.type) === i);
  // A deposit address is new and its gas comes from the exchange's filler wallet: age and funder
  // patterns describe the exchange, not a person, so they become information only.
  if (found.some((s) => s.type === "DEPOSIT_ADDRESS")) {
    found = found.map((s) =>
      s.type === "NEW_WALLET_HIGH_VOLUME" || s.type === "WALLET_FACTORY"
        ? { ...s, level: "INFO", reason: `${s.reason} (Likely an exchange deposit address, so not scored.)` }
        : s
    );
  }

  const { combined } = combineSignals(found);
  if (combined) {
    const flagged = found.filter((s) => s.level === "MEDIUM");
    found.push({
      type: "COMBINED_BEHAVIOUR",
      level: "HIGH",
      reason: `${flagged.length} behaviour red flags together: ${flagged.map((s) => LABELS[s.type].toLowerCase()).join(", ")}.`,
      evidence: { types: flagged.map((s) => s.type) },
    });
  }
  const indicators = found.map(toIndicator).sort((a, b) => b.score - a.score);
  return { indicators, combined, wallet, coverage };
}
