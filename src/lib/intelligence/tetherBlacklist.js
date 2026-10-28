import { lookupAddress } from "../collector/store";

/**
 * Tether (USDT) blacklist lookup, backed by the collected intel database:
 * - TRON (TRC-20 TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t): source `tether-usdt-tron`
 * - Ethereum (ERC-20 0xdAC17F958D2ee523a2206206994597C13D831ec7): source `tether-usdt-eth`
 * - BSC: none — BSC-USD is Binance-issued and has no Tether blacklist.
 *
 * @param {string} address
 * @param {string} chain  "TRON" | "ETHEREUM" | "BSC"
 * @returns {object|null} freeze details, or null if not frozen as of the last collection
 */
export function checkTetherBlacklist(address, chain) {
  const freeze = lookupAddress(chain, address)?.sources.find((s) => s.category === "ISSUER_FREEZE");
  if (!freeze) return null;
  return {
    reason: `Tether Ltd has frozen this address on the USDT contract (as of the last intel collection).`,
    freezeTxHash: freeze.reference?.id || null,
    freezeTxUrl: freeze.reference?.url || null,
    frozenAt: freeze.listedAt || null,
    fundsDestroyed: !!freeze.details?.fundsDestroyed,
  };
}
