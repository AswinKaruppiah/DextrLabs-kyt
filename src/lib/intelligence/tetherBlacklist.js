/**
 * Tether (USDT) On-Chain Smart Contract Blacklist Registry
 * Covers:
 * - TRON (TRC-20): TR7NHqJEKQxGTCi8q8ZY4pL8otSzgjLj6t
 * - Ethereum (ERC-20): 0xdAC17F958D2ee523a2206206994597C13D831ec7
 * - BSC (BEP-20): 0x55d398326f99059fF775485246999027B3197955
 */

export const TETHER_FROZEN_ADDRESSES = {};

/**
 * Checks if an address (TRON, ETH, BSC) is in the Tether blacklist
 * @param {string} address 
 * @returns {object|null}
 */
export function checkTetherBlacklist(address) {
  if (!address) return null;
  const clean = address.trim();

  if (TETHER_FROZEN_ADDRESSES[clean]) {
    return TETHER_FROZEN_ADDRESSES[clean];
  }

  if (clean.startsWith("0x")) {
    const lower = clean.toLowerCase();
    for (const [addr, data] of Object.entries(TETHER_FROZEN_ADDRESSES)) {
      if (addr.toLowerCase() === lower) {
        return data;
      }
    }
  }

  return null;
}
