import { BEHAVIOUR_RULES as R, EXPOSURE_RULES } from "../exposure/rules.js";

/**
 * Mixer-like contracts no list names yet (a new Tornado clone, a renamed fork). A mixer pool takes
 * the same few exact amounts from many wallets and pays out to many other wallets. Payroll,
 * airdrop and batch-payment contracts fail the first part (one payer, or varied amounts), DEX
 * routers the second (varied amounts), so all of it must hold, and the address must be a contract.
 * A lottery or game with a fixed ticket price can still match: findings are MEDIUM, for review.
 */

const isDust = (t) => t.usd < EXPOSURE_RULES.dustUsd;
const usd = (n) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Fixed-amount deposits from at least `minDepositors` wallets, or null. Amounts are compared to the
 * cent. `recipients` maps each wallet paid out (non-dust) to the total it received; `topDepositor`
 * is the wallet that made the most deposits.
 */
function fixedDeposits(transfers, minDepositors = R.mixerMinWallets) {
  const deposits = transfers.filter((t) => t.dir === "in" && !isDust(t));
  if (deposits.length < R.mixerMinDeposits) return null;
  const perDepositor = new Map();
  for (const t of deposits) perDepositor.set(t.cp, (perDepositor.get(t.cp) || 0) + 1);
  const depositors = perDepositor.size;
  if (depositors < minDepositors) return null;
  const [topDepositor] = [...perDepositor].sort((a, b) => b[1] - a[1])[0];
  const counts = new Map();
  for (const t of deposits) {
    const cents = Math.round(t.usd * 100);
    counts.set(cents, (counts.get(cents) || 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, R.mixerMaxDenominations);
  const fixedShare = top.reduce((n, [, c]) => n + c, 0) / deposits.length;
  if (fixedShare < R.mixerFixedShare) return null;
  const recipients = new Map();
  for (const t of transfers) if (t.dir === "out" && !isDust(t)) recipients.set(t.cp, (recipients.get(t.cp) || 0) + t.usd);
  return { deposits: deposits.length, depositors, fixedShare, amounts: top.map(([cents]) => cents / 100), recipients, topDepositor };
}

/**
 * The pool pattern in one address's USDT transfers, or null: fixed-amount deposits from many
 * wallets (`minDepositors`), paid out to many wallets.
 * @returns {{deposits, depositors, recipients, fixedShare, amounts: number[], topDepositor} | null}
 */
export function mixerPoolPattern(transfers, { minDepositors } = {}) {
  const d = fixedDeposits(transfers, minDepositors);
  if (!d || d.recipients.size < R.mixerMinWallets) return null;
  return { ...d, recipients: d.recipients.size };
}

/**
 * The entry-router pattern, or null: fixed-amount deposits from many wallets, all passed on to a
 * few addresses (Tornado's router forwards every deposit to its pools). Returns where it forwards
 * the most, which must itself be a pool for this to mean a mixer.
 */
export function mixerRouterPattern(transfers) {
  const d = fixedDeposits(transfers);
  if (!d || !d.recipients.size || d.recipients.size > R.mixerMaxDenominations) return null;
  const targets = [...d.recipients].sort((a, b) => b[1] - a[1]).map(([address]) => address);
  return { deposits: d.deposits, depositors: d.depositors, fixedShare: d.fixedShare, amounts: d.amounts, target: targets[0], targets };
}

const patternText = (p) =>
  `${p.depositors} wallets paid in, ${Math.round(p.fixedShare * 100)}% of deposits in the same ` +
  `amount${p.amounts.length > 1 ? "s" : ""} (${p.amounts.map(usd).join(", ")}), and ${p.recipients} wallets were paid out`;

/** The wallet's largest counterparties by non-dust volume: [{ cp, inUsd, outUsd }]. */
function largestCounterparties(transfers, self, n) {
  const byCp = new Map();
  for (const t of transfers) {
    if (isDust(t) || t.cp === self) continue;
    const a = byCp.get(t.cp) || { cp: t.cp, inUsd: 0, outUsd: 0 };
    a[t.dir === "in" ? "inUsd" : "outUsd"] += t.usd;
    byCp.set(t.cp, a);
  }
  return [...byCp.values()].sort((a, b) => b.inUsd + b.outUsd - (a.inUsd + a.outUsd)).slice(0, n);
}

const flowText = (a) =>
  a.inUsd && a.outUsd
    ? `exchanged ${usd(a.inUsd + a.outUsd)} with`
    : a.inUsd
      ? `received ${usd(a.inUsd)} from`
      : `sent ${usd(a.outUsd)} to`;

/**
 * Mixer-like findings for one wallet: the wallet itself (MIXER_LIKE) and its largest counterparties
 * (MIXER_LIKE_COUNTERPARTY). Listed counterparties are skipped: exposure already reports them.
 * deps = { isContract(a) -> true | false | null (chain not supported), getHistory(a), getRisk(a) }
 * @returns {Promise<{signals: object[], status: "complete" | "partial" | "skipped"}>}
 */
export async function mixerSignals(self, history, deps, call) {
  const selfIsContract = await call(deps.isContract(self)).catch(() => undefined);
  if (selfIsContract === null) return { signals: [], status: "skipped" };
  let failed = selfIsContract === undefined;
  const signals = [];

  const own = selfIsContract && mixerPoolPattern(history.transfers);
  if (own) {
    signals.push({
      type: "MIXER_LIKE",
      level: "MEDIUM",
      reason: `This address is a contract that works like a mixer pool: ${patternText(own)}.`,
      evidence: { ...own },
    });
  }

  // History of an unlisted contract, or null (not a contract, or listed: exposure reports those).
  const unlistedContract = async (cp) => {
    if (!(await call(deps.isContract(cp)))) return null;
    if (await call(deps.getRisk(cp))) return null;
    return (await call(deps.getHistory(cp))).transfers;
  };
  // An unlisted contract that is a pool, or a router whose main target is a pool. Tornado-style
  // pools get nearly every deposit through their router, so a pool with few direct depositors
  // counts when its main depositor is a router taking fixed amounts from many wallets. Only one
  // router step is followed either way.
  const asMixer = async (cp, viaRouter = false) => {
    const transfers = await unlistedContract(cp);
    if (!transfers) return null;
    const pattern = mixerPoolPattern(transfers);
    if (pattern) return { pattern };
    const fed = mixerPoolPattern(transfers, { minDepositors: 1 });
    if (viaRouter) return fed && { pattern: fed };
    if (fed && fed.topDepositor !== cp) {
      const feederHistory = await unlistedContract(fed.topDepositor);
      const feeder = feederHistory && mixerRouterPattern(feederHistory);
      if (feeder?.targets.includes(cp)) return { pattern: { ...fed, depositors: feeder.depositors }, feeder: fed.topDepositor };
    }
    const router = mixerRouterPattern(transfers);
    if (!router || router.target === cp) return null;
    const pool = await asMixer(router.target, true);
    return pool && { pattern: { ...pool.pattern, depositors: router.depositors }, router, pool: router.target };
  };
  const checked = await Promise.all(
    largestCounterparties(history.transfers, self, R.mixerCandidates).map(async (a) => {
      try {
        const found = await asMixer(a.cp);
        return found && { ...a, ...found };
      } catch {
        failed = true;
        return null;
      }
    })
  );
  const hit = checked.find(Boolean); // largest first
  if (hit) {
    const via = hit.pool
      ? `an unlisted contract that forwards fixed deposits to ${hit.pool}, which works like a mixer pool: `
      : hit.feeder
        ? `an unlisted contract that works like a mixer pool, with deposits coming through ${hit.feeder}: `
        : "an unlisted contract that works like a mixer pool: ";
    signals.push({
      type: "MIXER_LIKE_COUNTERPARTY",
      level: "MEDIUM",
      reason: `This wallet ${flowText(hit)} ${hit.cp}, ${via}${patternText(hit.pattern)}.`,
      evidence: { contract: hit.cp, pool: hit.pool || hit.cp, feeder: hit.feeder || null, inUsd: hit.inUsd, outUsd: hit.outUsd, ...hit.pattern },
    });
  }
  return { signals, status: failed ? "partial" : "complete" };
}
