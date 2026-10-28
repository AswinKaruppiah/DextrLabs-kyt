import { USDT_TRON_CONTRACT } from "./tronUtils";

// Public TRON RPC Gateway & Contract Hex
const TRONGRID_HOST = process.env.TRONGRID_HOST;
const TRON_USDT_HEX = process.env.TRON_USDT_CONTRACT_HEX;
// Without this header TronGrid treats calls as anonymous: tight rate limits, and they
// don't show up in the TronGrid dashboard.
const TRONGRID_API_KEY = process.env.TRONGRID_API_KEY;

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Decodes a Base58Check TRON address into a 41-prefix Hex address
 * @param {string} base58 
 * @returns {string} 42-char hex string (e.g. 41a614...)
 */
export function tronAddressToHex(base58) {
  if (!base58 || typeof base58 !== "string") return "";
  let bytes = [0];
  for (let i = 0; i < base58.length; i++) {
    const c = base58[i];
    const value = ALPHABET.indexOf(c);
    if (value === -1) return "";
    for (let j = 0; j < bytes.length; j++) bytes[j] *= 58;
    bytes[0] += value;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < base58.length && base58[i] === "1"; i++) {
    bytes.push(0);
  }
  bytes.reverse();
  const hex = Buffer.from(bytes.slice(0, 21)).toString("hex");
  return hex.startsWith("41") ? hex : `41${hex.slice(2)}`;
}

/**
 * Checks in REAL-TIME on-chain whether a TRON address is blacklisted in Tether's USDT contract.
 * Directly calls the live smart contract function: `getBlackListStatus(address)`
 * @param {string} base58Address 
 * @returns {Promise<{isFrozen: boolean, method: string, contract: string, onChain: boolean}>}
 */
export async function checkLiveTetherBlacklistOnChain(base58Address) {
  try {
    const hexAddr = tronAddressToHex(base58Address);
    if (!hexAddr || hexAddr.length !== 42) {
      return { isFrozen: false, onChain: false, error: "Invalid address" };
    }

    // Pad 20-byte address to 32 bytes for EVM ABI parameter
    // hexAddr is 42 chars (21 bytes starting with 41). The EVM address is 20 bytes (chars 2..42).
    const evmAddr = hexAddr.slice(2);
    const paddedParam = evmAddr.padStart(64, "0");

    const response = await fetch(`${TRONGRID_HOST}/wallet/triggerconstantcontract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(TRONGRID_API_KEY ? { "TRON-PRO-API-KEY": TRONGRID_API_KEY } : {}),
      },
      body: JSON.stringify({
        owner_address: "410000000000000000000000000000000000000000",
        contract_address: TRON_USDT_HEX,
        function_selector: "getBlackListStatus(address)",
        parameter: paddedParam,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return { isFrozen: false, onChain: false, error: "RPC response error" };
    }

    const data = await response.json();
    if (data.constant_result && data.constant_result.length > 0) {
      const resultHex = data.constant_result[0];
      const isBlacklisted = parseInt(resultHex, 16) === 1;
      return {
        isFrozen: isBlacklisted,
        method: "smart_contract_call:getBlackListStatus",
        contract: USDT_TRON_CONTRACT,
        onChain: true,
      };
    }

    return { isFrozen: false, onChain: true };
  } catch (err) {
    console.error("Error executing on-chain getBlackListStatus:", err);
    return { isFrozen: false, onChain: false, error: err.message };
  }
}
