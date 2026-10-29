import { lookupAddress } from "../collector/store";

/**
 * Stablecoin issuer freeze lookup, backed by the collected intel database:
 * - Tether USDT on TRON (`tether-usdt-tron`) and Ethereum (`tether-usdt-eth`)
 * - other Ethereum issuers: Circle USDC/EURC, Paxos USDP/PYUSD, TrueUSD
 * - BSC: none — BSC-USD is Binance-issued and has no Tether blacklist.
 * Tether's own freeze is preferred when several issuers froze the same wallet (this is a USDT product).
 *
 * @param {string} address
 * @param {string} chain  "TRON" | "ETHEREUM" | "BSC"
 * @returns {Promise<object|null>} freeze details, or null if not frozen as of the last collection
 */
export async function checkTetherBlacklist(address, chain) {
  const freezes = (await lookupAddress(chain, address))?.sources.filter((s) => s.category === "ISSUER_FREEZE") || [];
  if (!freezes.length) return null;
  const freeze = freezes.find((s) => s.sourceId.startsWith("tether-")) || freezes[0];
  const isTether = freeze.sourceId.startsWith("tether-");
  const issuer = isTether ? "Tether Ltd" : freeze.authority.split(" — ")[0];
  const what = isTether ? "on the USDT contract" : `(${(freeze.programs || []).join(", ")})`;
  return {
    issuer,
    isTether,
    reason: `${issuer} has frozen this address ${what} (as of the last intel collection).`,
    freezeTxHash: freeze.reference?.id || null,
    freezeTxUrl: freeze.reference?.url || null,
    frozenAt: freeze.listedAt || null,
    fundsDestroyed: !!freeze.details?.fundsDestroyed,
  };
}
