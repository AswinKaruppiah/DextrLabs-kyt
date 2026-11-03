import { getTransferHistory } from "../exposure/transferHistory.js";
import { riskOf } from "../exposure/exposure.js";
import { lookupAddresses } from "../collector/store.js";
import { normalizeAddress } from "../collector/util/address.js";
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
} from "./detectors.js";
import { findFirstFunder, getWalletAge, countFundedWallets } from "./funder.js";
import { traceLayering, layeringSignal, isHub, asLayer } from "./layering.js";

const LEVEL_SCORES = { HIGH: 75, MEDIUM: 50, INFO: 0 };

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

async function riskFor(chain, address) {
  const key = normalizeAddress(address);
  const entry = (await lookupAddresses(chain, [key])).get(key);
  return entry ? riskOf(entry) : null;
}

/** Age of any wallet: TRON account record first, else its first gas received. */
async function createdAtOf(chain, address) {
  const age = await getWalletAge(chain, address, null);
  if (age.createdAt) return age.createdAt;
  return (await findFirstFunder(chain, address))?.ts ?? null;
}

/** COLLECTOR / PASS_THROUGH that sweep to an exchange-like wallet are deposit addresses, not red flags. */
async function checkDepositAddress(chain, sig) {
  const target = sig.evidence.targets?.[0]?.address;
  if (!target) return sig;
  try {
    if (!isHub(await getTransferHistory(chain, target))) return sig;
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

async function funderSignals(chain, funding, wallet) {
  const risk = await riskFor(chain, funding.funder);
  wallet.funder = { address: funding.funder, tx: funding.tx, listed: !!risk };
  if (risk) {
    return {
      type: "FUNDED_BY_LISTED",
      level: risk.severe ? "HIGH" : "MEDIUM",
      reason: `This wallet's first fees were paid by ${risk.entity} (${risk.providers.join(", ")}).`,
      evidence: { funder: funding.funder, tx: funding.tx, category: risk.risk.id },
    };
  }
  const { wallets } = await countFundedWallets(chain, funding.funder);
  if (wallets < R.factoryMinWallets) return null;
  // Exchanges also pay first fees for many wallets (withdrawals); they are hubs, not factories.
  if (isHub(await getTransferHistory(chain, funding.funder))) return null;
  return {
    type: "WALLET_FACTORY",
    level: "MEDIUM",
    reason: `The wallet that paid this wallet's first fees (${funding.funder}) sent coins to ${wallets} wallets in the last ${R.factoryWindowDays} days: it looks like a wallet factory.`,
    evidence: { funder: funding.funder, wallets, windowDays: R.factoryWindowDays },
  };
}

/**
 * Behaviour findings for one wallet: how it moves money (detectors), who paid its first fees,
 * whether its money was layered through fresh wallets, and its age.
 * `history` is the transfer history analyzeExposure already fetched (null when it failed).
 * Never throws for a failed lookup; coverage says what could not run.
 */
export async function analyzeBehaviour(chain, address, history) {
  const self = normalizeAddress(address.trim());
  const now = Date.now();
  const coverage = { status: history ? "complete" : "skipped", funder: "none", layering: history ? "complete" : "skipped" };
  const signals = [];

  let funding = null;
  try {
    funding = await findFirstFunder(chain, self);
    if (funding) coverage.funder = "found";
  } catch {
    coverage.funder = "unavailable";
  }
  const age = await getWalletAge(chain, self, funding);
  const wallet = { createdAt: age.createdAt, ageDays: walletAgeDays(age.createdAt, now), ageSource: age.source, funder: null };

  if (funding) {
    try {
      signals.push(await funderSignals(chain, funding, wallet));
    } catch {
      coverage.funder = "unavailable";
    }
  }

  if (history) {
    const { transfers, truncated } = history;
    signals.push(
      detectNewWallet(transfers, { createdAt: age.createdAt, truncated }, now),
      detectPoisoner(transfers),
      detectPoisoningTarget(transfers, self),
      detectStructuring(transfers)
    );
    for (const sig of [detectFanPattern(transfers), detectPassThrough(transfers)]) {
      if (sig) signals.push(await checkDepositAddress(chain, sig));
    }

    const deps = {
      getHistory: (a) => getTransferHistory(chain, a),
      getAge: (a) => createdAtOf(chain, a),
      getRisk: (a) => riskFor(chain, a),
      deadline: now + R.layeringDeadlineMs,
      now,
    };
    const [back, forward] = await Promise.all([traceLayering(self, "back", deps), traceLayering(self, "forward", deps)]);
    if (back.partial || forward.partial) coverage.layering = "partial";
    signals.push(layeringSignal(back, forward, !!asLayer(self, history, age.createdAt, now)));
  }

  // One finding per type (a collector and a pass-through can both turn out to be the same deposit address).
  const found = signals.filter((s, i) => s && signals.findIndex((o) => o?.type === s.type) === i);
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
