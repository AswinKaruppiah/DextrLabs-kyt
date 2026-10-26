/**
 * Multi-Chain Configuration for USDT (TRON, Ethereum, BSC)
 */

export const SUPPORTED_CHAINS = {
  TRON: {
    id: "TRON",
    name: "TRON",
    symbol: "TRX",
    token: "USDT",
    standard: "TRC-20",
    contract: process.env.NEXT_PUBLIC_USDT_TRON_CONTRACT,
    decimals: 6,
    explorerName: "Tronscan",
    explorerBaseUrl: process.env.NEXT_PUBLIC_TRON_EXPLORER_URL,
    addressRegex: /^T[1-9A-HJ-NP-za-km-z]{33}$/,
    txRegex: /^(0x)?[0-9a-fA-F]{64}$/,
    brandColor: "#FF060A",
    badgeClass: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  ETHEREUM: {
    id: "ETHEREUM",
    name: "Ethereum",
    symbol: "ETH",
    token: "USDT",
    standard: "ERC-20",
    contract: process.env.NEXT_PUBLIC_USDT_ETH_CONTRACT,
    decimals: 6,
    explorerName: "Etherscan",
    explorerBaseUrl: process.env.NEXT_PUBLIC_ETH_EXPLORER_URL,
    addressRegex: /^0x[0-9a-fA-F]{40}$/,
    txRegex: /^0x[0-9a-fA-F]{64}$/,
    brandColor: "#627EEA",
    badgeClass: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  },
  BSC: {
    id: "BSC",
    name: "BNB Smart Chain",
    symbol: "BNB",
    token: "USDT",
    standard: "BEP-20",
    contract: process.env.NEXT_PUBLIC_USDT_BSC_CONTRACT,
    decimals: 18,
    explorerName: "BscScan",
    explorerBaseUrl: process.env.NEXT_PUBLIC_BSC_EXPLORER_URL,
    addressRegex: /^0x[0-9a-fA-F]{40}$/,
    txRegex: /^0x[0-9a-fA-F]{64}$/,
    brandColor: "#F0B90B",
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
};

/**
 * Auto-detects the blockchain network based on address format and context
 * @param {string} address 
 * @param {string} [preferredChain] 
 * @returns {string} Chain ID ("TRON", "ETHEREUM", "BSC")
 */
export function detectChainFromAddress(address, preferredChain = "TRON") {
  if (!address || typeof address !== "string") return preferredChain;
  const clean = address.trim();

  // TRON Base58Check starts with 'T'
  if (/^T[1-9A-HJ-NP-za-km-z]{33}$/.test(clean)) {
    return "TRON";
  }

  // EVM 0x-hex can be Ethereum or BSC
  if (/^0x[0-9a-fA-F]{40}$/.test(clean)) {
    if (preferredChain === "BSC") return "BSC";
    return "ETHEREUM";
  }

  return preferredChain;
}

/**
 * Validates whether an address is valid for a given chain
 * @param {string} chain 
 * @param {string} address 
 * @returns {boolean}
 */
export function isValidAddressForChain(chain, address) {
  const cfg = SUPPORTED_CHAINS[chain] || SUPPORTED_CHAINS.TRON;
  return cfg.addressRegex.test(address?.trim() || "");
}

/**
 * Formats a block explorer link for an address
 * @param {string} chain 
 * @param {string} address 
 * @returns {string}
 */
export function getExplorerAddressUrl(chain, address) {
  const cfg = SUPPORTED_CHAINS[chain] || SUPPORTED_CHAINS.TRON;
  if (cfg.id === "TRON") {
    return `${cfg.explorerBaseUrl}/#/address/${encodeURIComponent(address)}`;
  }
  return `${cfg.explorerBaseUrl}/address/${encodeURIComponent(address)}`;
}

/**
 * Formats a block explorer link for a transaction hash
 * @param {string} chain 
 * @param {string} txHash 
 * @returns {string}
 */
export function getExplorerTxUrl(chain, txHash) {
  const cfg = SUPPORTED_CHAINS[chain] || SUPPORTED_CHAINS.TRON;
  const clean = txHash?.trim() || "";
  if (cfg.id === "TRON") {
    const no0x = clean.replace(/^0x/, "");
    return `${cfg.explorerBaseUrl}/#/transaction/${encodeURIComponent(no0x)}`;
  }
  const with0x = clean.startsWith("0x") ? clean : `0x${clean}`;
  return `${cfg.explorerBaseUrl}/tx/${encodeURIComponent(with0x)}`;
}
