import crypto from "crypto";
import { USDT_TRON_CONTRACT } from "./tronUtils";

// Public TRON RPC Gateway & Contract Hex
const TRONGRID_HOST = process.env.TRONGRID_HOST;
const TRONGRID_API_KEY = process.env.TRONGRID_API_KEY;
const TRON_USDT_HEX = process.env.TRON_USDT_CONTRACT_HEX;

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
 * Encodes a 41-prefix Hex address into Base58Check TRON address
 * @param {string} hexStr 
 * @returns {string} Base58Check starting with 'T'
 */
export function hexToTronAddress(hexStr) {
  if (!hexStr || typeof hexStr !== "string") return "";
  let clean = hexStr.toLowerCase().replace(/^0x/, "");
  if (clean.length === 40 && !clean.startsWith("41")) {
    clean = "41" + clean;
  }
  const bytes = Buffer.from(clean, "hex");
  const hash1 = crypto.createHash("sha256").update(bytes).digest();
  const hash2 = crypto.createHash("sha256").update(hash1).digest();
  const checksum = hash2.subarray(0, 4);
  const fullBytes = Buffer.concat([bytes, checksum]);

  let digits = [0];
  for (let i = 0; i < fullBytes.length; i++) {
    for (let j = 0; j < digits.length; j++) digits[j] <<= 8;
    digits[0] += fullBytes[i];
    let carry = 0;
    for (let j = 0; j < digits.length; j++) {
      digits[j] += carry;
      carry = (digits[j] / 58) | 0;
      digits[j] %= 58;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = "";
  for (let i = 0; i < fullBytes.length && fullBytes[i] === 0; i++) str += ALPHABET[0];
  for (let i = digits.length - 1; i >= 0; i--) str += ALPHABET[digits[i]];
  return str;
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
      headers: { "Content-Type": "application/json" },
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

/**
 * Fetches live transaction details by TX Hash from TRON Mainnet
 * @param {string} txHash 
 * @returns {Promise<object|null>}
 */
export async function getLiveTronTransaction(txHash) {
  try {
    const cleanHash = txHash?.replace(/^0x/, "").trim();
    if (!cleanHash || cleanHash.length !== 64) return null;

    const res = await fetch(`${TRONGRID_HOST}/wallet/gettransactionbyid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: cleanHash }),
      cache: "no-store",
    });

    if (!res.ok) return null;
    const tx = await res.json();
    if (!tx || !tx.txID) return null;

    // Check if it's a TRC-20 TriggerSmartContract
    const contract = tx.raw_data?.contract?.[0];
    const isTrigger = contract?.type === "TriggerSmartContract";
    const valueData = contract?.parameter?.value;

    let trc20Details = null;
    if (isTrigger && valueData) {
      const contractHex = valueData.contract_address;
      const callerHex = valueData.owner_address;
      const dataHex = valueData.data || "";

      // Check for ERC-20/TRC-20 Transfer: method id a9059cbb
      if (dataHex.startsWith("a9059cbb") && dataHex.length >= 72) {
        const toHexRaw = dataHex.slice(8 + 24, 8 + 64);
        const toBase58 = hexToTronAddress("41" + toHexRaw);
        const amountHex = dataHex.slice(72, 136);
        const rawAmount = parseInt(amountHex, 16) || 0;
        const usdtAmount = rawAmount / 1_000_000;

        trc20Details = {
          from: hexToTronAddress(callerHex),
          to: toBase58,
          amountUsdt: usdtAmount,
          isUsdtContract: contractHex === TRON_USDT_HEX,
        };
      }
    }

    return {
      txHash: tx.txID,
      timestamp: tx.raw_data?.timestamp ? new Date(tx.raw_data.timestamp).toISOString() : new Date().toISOString(),
      feeTron: (tx.ret?.[0]?.fee || 0) / 1_000_000,
      status: tx.ret?.[0]?.contractRet || "SUCCESS",
      trc20: trc20Details,
      raw: tx,
    };
  } catch (err) {
    console.error("Live TRON TX fetch error:", err);
    return null;
  }
}
