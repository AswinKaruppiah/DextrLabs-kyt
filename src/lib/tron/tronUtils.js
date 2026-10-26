/**
 * TRON and TRC-20 USDT Utility Module
 * Target Smart Contract: TR7NHqJEKQxGTCi8q8ZY4pL8otSzgjLj6t (USDT on TRON)
 * Precision: 6 decimals (1 USDT = 1,000,000 SUN)
 */

export const USDT_TRON_CONTRACT = process.env.NEXT_PUBLIC_USDT_TRON_CONTRACT;
export const USDT_DECIMALS = 6;

// Base58 regex for TRON addresses (starts with 'T', 34 characters)
const TRON_ADDRESS_REGEX = /^T[1-9A-HJ-NP-za-km-z]{33}$/;
const TRON_TX_HASH_REGEX = /^(0x)?[0-9a-fA-F]{64}$/;

/**
 * Validates whether a string is a well-formed TRON Base58 address
 * @param {string} address 
 * @returns {boolean}
 */
export function isValidTronAddress(address) {
  if (!address || typeof address !== "string") return false;
  return TRON_ADDRESS_REGEX.test(address.trim());
}

/**
 * Validates whether a string is a 64-hex TRON transaction hash
 * @param {string} hash 
 * @returns {boolean}
 */
export function isValidTronTxHash(hash) {
  if (!hash || typeof hash !== "string") return false;
  return TRON_TX_HASH_REGEX.test(hash.trim());
}

/**
 * Converts raw token integer units (micro-USDT / 6 decimals) to formatted decimal USDT
 * @param {number|string} rawAmount 
 * @returns {number}
 */
export function rawToUsdt(rawAmount) {
  if (rawAmount === null || rawAmount === undefined) return 0;
  const num = typeof rawAmount === "string" ? parseFloat(rawAmount) : rawAmount;
  if (isNaN(num)) return 0;
  return num / Math.pow(10, USDT_DECIMALS);
}

/**
 * Formats a numerical USDT amount into currency string
 * e.g., 25000 -> "$25,000.00 USDT" or "$25,000" if compactDecimals
 * @param {number} amount 
 * @param {boolean} [includeSymbol=true] 
 * @param {boolean} [compactDecimals=false]
 * @returns {string}
 */
export function formatUsdt(amount, includeSymbol = true, compactDecimals = false) {
  const num = typeof amount === "string" ? parseFloat(amount) : Number(amount);
  if (isNaN(num)) return "$0.00";
  const hasDecimals = !compactDecimals || (num % 1 !== 0 && num < 10000);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0,
  }).format(num);
  return includeSymbol ? `$${formatted} USDT` : `$${formatted}`;
}

/**
 * Truncates a TRON address for clean table display
 * @param {string} address 
 * @param {number} start 
 * @param {number} end 
 * @returns {string}
 */
export function truncateAddress(address, start = 6, end = 5) {
  if (!address) return "";
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

/**
 * Truncates a 64-character TRON TX hash for display
 * @param {string} hash 
 * @param {number} start 
 * @param {number} end 
 * @returns {string}
 */
export function truncateHash(hash, start = 8, end = 6) {
  if (!hash) return "";
  const clean = hash.startsWith("0x") ? hash : `0x${hash}`;
  if (clean.length <= start + end) return clean;
  return `${clean.slice(0, start)}...${clean.slice(-end)}`;
}

/**
 * Generates official Tronscan block explorer link for an address
 * @param {string} address 
 * @returns {string}
 */
export function getTronscanAddressUrl(address) {
  return `https://tronscan.org/#/address/${encodeURIComponent(address)}`;
}

/**
 * Generates official Tronscan block explorer link for a transaction
 * @param {string} hash 
 * @returns {string}
 */
export function getTronscanTxUrl(hash) {
  const clean = hash?.replace(/^0x/, "") || "";
  return `https://tronscan.org/#/transaction/${encodeURIComponent(clean)}`;
}
