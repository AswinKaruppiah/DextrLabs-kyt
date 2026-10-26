/**
 * TRON and TRC-20 USDT Utility Module
 * Target Smart Contract: TR7NHqJEKQxGTCi8q8ZY4pL8otSzgjLj6t (USDT on TRON)
 * Precision: 6 decimals (1 USDT = 1,000,000 SUN)
 */

export const USDT_TRON_CONTRACT = process.env.NEXT_PUBLIC_USDT_TRON_CONTRACT;
export const USDT_DECIMALS = 6;

// Base58 regex for TRON addresses (starts with 'T', 34 characters)
const TRON_ADDRESS_REGEX = /^T[1-9A-HJ-NP-za-km-z]{33}$/;

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
