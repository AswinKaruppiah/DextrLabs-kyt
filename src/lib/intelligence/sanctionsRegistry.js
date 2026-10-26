/**
 * U.S. OFAC SDN & International Sanctions Registry
 * Supports TRON (Base58), Ethereum (EVM 0x), and BSC (EVM 0x) digital currency addresses.
 */

export const SANCTIONED_ADDRESSES = {};

/**
 * Checks if an address (TRON, Ethereum, or BSC) is on official sanctions registries
 * Case-insensitive match for EVM addresses.
 * @param {string} address 
 * @returns {object|null}
 */
export function checkSanctions(address) {
  if (!address) return null;
  const clean = address.trim();

  // Direct match (TRON Base58 is case-sensitive)
  if (SANCTIONED_ADDRESSES[clean]) {
    return SANCTIONED_ADDRESSES[clean];
  }

  // Case-insensitive match for 0x EVM addresses (Ethereum & BSC)
  if (clean.startsWith("0x")) {
    const lower = clean.toLowerCase();
    for (const [addr, data] of Object.entries(SANCTIONED_ADDRESSES)) {
      if (addr.toLowerCase() === lower) {
        return data;
      }
    }
  }

  return null;
}

import { TETHER_FROZEN_ADDRESSES } from "./tetherBlacklist";

/**
 * Returns a consolidated, searchable array of all known sanctioned and bad wallets.
 */
export function getAllSanctionedEntities() {
  const list = [];

  // 1. OFAC / Government Sanctions
  for (const [address, data] of Object.entries(SANCTIONED_ADDRESSES)) {
    list.push({
      address,
      chain: data.chain,
      entity: data.entity,
      threatType: "OFAC_SANCTION",
      threatLabel: "OFAC Sanctions List",
      badgeColor: "bg-red-500/20 text-red-400 border-red-500/30",
      authority: data.authority,
      noticeId: data.noticeId,
      legalCitation: data.legalCitation,
      details: data.details,
      riskScore: data.riskWeight || 100,
      verdict: "BAD",
    });
  }

  // 2. Tether Smart Contract On-Chain Blacklist
  for (const [address, data] of Object.entries(TETHER_FROZEN_ADDRESSES)) {
    list.push({
      address,
      chain: data.chain,
      entity: data.entity,
      threatType: "TETHER_FROZEN",
      threatLabel: "Tether Smart Contract Freeze",
      badgeColor: "bg-rose-500/20 text-rose-400 border-rose-500/30",
      authority: "Tether Ltd On-Chain Admin",
      noticeId: data.freezeTxHash ? `${data.freezeTxHash.slice(0, 10)}...` : "ON-CHAIN-FREEZE",
      legalCitation: "Smart Contract addBlackList()",
      details: data.reason,
      riskScore: 100,
      verdict: "BAD",
    });
  }

  return list;
}
