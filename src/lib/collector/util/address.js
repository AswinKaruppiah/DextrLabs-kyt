import { createHash } from "node:crypto";

export const CHAINS = Object.freeze({ TRON: "TRON", ETHEREUM: "ETHEREUM", BSC: "BSC" });

const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;

// Global variants for scanning free text.
export const ADDRESS_SCAN_RE = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b|\b0x[a-fA-F0-9]{40}\b/g;

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const sha256 = (buf) => createHash("sha256").update(buf).digest();

function base58Encode(buf) {
  let n = BigInt("0x" + (buf.toString("hex") || "0"));
  let out = "";
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of buf) {
    if (byte !== 0) break;
    out = "1" + out;
  }
  return out;
}

function base58Decode(str) {
  let n = 0n;
  for (const ch of str) {
    const v = BASE58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const leading = str.match(/^1*/)[0].length;
  return Buffer.concat([Buffer.alloc(leading), Buffer.from(hex, "hex")]);
}

/** Verifies the base58check checksum, so typos in source lists are rejected. */
export function isValidTron(address) {
  if (!TRON_RE.test(address)) return false;
  const raw = base58Decode(address);
  if (!raw || raw.length !== 25 || raw[0] !== 0x41) return false;
  const checksum = sha256(sha256(raw.subarray(0, 21))).subarray(0, 4);
  return checksum.equals(raw.subarray(21));
}

export const isValidEvm = (address) => EVM_RE.test(address);

/** "TRON" | "EVM" | null */
export function addressFamily(address) {
  if (!address) return null;
  if (isValidTron(address)) return "TRON";
  if (isValidEvm(address)) return "EVM";
  return null;
}

/** 20-byte hex (with or without 0x / 41 prefix) -> TRON base58check address. */
export function tronHexToBase58(hex) {
  const clean = hex.replace(/^0x/i, "").toLowerCase();
  const body = clean.length === 42 && clean.startsWith("41") ? clean : "41" + clean.slice(-40);
  const raw = Buffer.from(body, "hex");
  const checksum = sha256(sha256(raw)).subarray(0, 4);
  return base58Encode(Buffer.concat([raw, checksum]));
}

/** Canonical form used for keys: EVM lowercased, TRON as-is (base58 is case-sensitive). */
export const normalizeAddress = (address) =>
  address.startsWith("0x") || address.startsWith("0X") ? address.toLowerCase() : address;

export const addressKey = (chain, address) => `${chain}:${normalizeAddress(address)}`;

/**
 * Chain hints used by sanctions publishers ("ETH:", "BNB:", "TRC20", "USDT" ...),
 * mapped to the chain the publisher explicitly named. null = asset-only hint (e.g. USDT).
 */
const CHAIN_HINTS = [
  [/\b(TRX|TRON|TRC-?20)\b/gi, CHAINS.TRON],
  [/\b(BSC|BNB|BEP-?20|BINANCE SMART CHAIN|BNB SMART CHAIN)\b/gi, CHAINS.BSC],
  [/\b(ETH|ETHEREUM|ERC-?20)\b/gi, CHAINS.ETHEREUM],
];

/** The chain named closest to the end of `hint` (i.e. nearest the address that follows it). */
export function chainFromHint(hint) {
  if (!hint) return null;
  let best = null;
  let bestIndex = -1;
  for (const [re, chain] of CHAIN_HINTS) {
    for (const m of hint.matchAll(re)) {
      if (m.index > bestIndex) {
        bestIndex = m.index;
        best = chain;
      }
    }
  }
  return best;
}

/**
 * Resolves which chains a listed address applies to.
 *  - TRON addresses -> TRON.
 *  - EVM addresses -> ETHEREUM and BSC. The same private key controls the address on every
 *    EVM chain, so a sanctioned EVM address is mirrored. The chain the publisher named is
 *    basis "listed"; the other is "evm-mirror". With no chain named, Ethereum is treated as listed.
 * @param {boolean} mirror  false for chain-specific facts (e.g. a token-contract freeze)
 */
export function resolveTargets(address, statedChain, { mirror = true } = {}) {
  const family = addressFamily(address);
  if (family === "TRON") return [{ chain: CHAINS.TRON, basis: "listed" }];
  if (family !== "EVM") return [];
  const listed = statedChain === CHAINS.BSC ? CHAINS.BSC : CHAINS.ETHEREUM;
  const targets = [{ chain: listed, basis: "listed" }];
  if (mirror) {
    targets.push({ chain: listed === CHAINS.BSC ? CHAINS.ETHEREUM : CHAINS.BSC, basis: "evm-mirror" });
  }
  return targets;
}
