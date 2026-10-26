import fs from "fs";
import path from "path";
import { downloadAndAggregateSanctions, normalizeAddressKey, queryOpenSanctionsApi } from "./sanctionsDownloader";
import { TETHER_FROZEN_ADDRESSES, checkTetherBlacklist } from "./tetherBlacklist";

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "sanctions-cache.json");

// In-memory cache
let cachedData = null;

export function loadSanctionsCache() {
  if (cachedData) {
    return cachedData;
  }

  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf8");
      cachedData = JSON.parse(raw);
      return cachedData;
    }
  } catch (err) {
    console.error("[SanctionsRegistry] Error reading cache file:", err);
  }

  return {
    lastSync: null,
    totalCount: 0,
    providerCounts: {},
    chainCounts: {},
    addresses: {},
  };
}

export function reloadSanctionsCache() {
  cachedData = null;
  return loadSanctionsCache();
}

/**
 * Checks if an address (TRON, Ethereum, BSC, Bitcoin, etc.) is on any sanctions list.
 * @param {string} address 
 * @returns {Promise<object|null>}
 */
export async function checkSanctions(address) {
  if (!address) return null;
  const clean = address.trim();
  const normalizedKey = normalizeAddressKey(clean);

  const data = loadSanctionsCache();
  if (data.addresses && data.addresses[normalizedKey]) {
    const entry = data.addresses[normalizedKey];
    return {
      address: entry.address,
      chain: entry.chain,
      entity: entry.entity,
      providers: entry.providers || [],
      jurisdictions: entry.jurisdictions || [],
      programs: entry.programs || [],
      fatfNexus: entry.fatfNexus || null,
      threatType: entry.threatType || "SANCTIONS_DESIGNATION",
      threatLevel: entry.threatLevel || "CRITICAL",
      riskWeight: entry.riskScore || 100,
      confidence: "CONFIRMED_SANCTIONED",
      authority: (entry.providers || []).join(", "),
      noticeId: (entry.programs || []).join(", ") || "Sanctioned Entity",
      legalCitation: (entry.citations && entry.citations[0]?.url) || "Official Sanctions Registry",
      details: `Designated by: ${(entry.providers || []).join(", ")}${entry.fatfNexus ? " | High-Risk Jurisdictions: " + entry.fatfNexus : ""}`,
      citations: entry.citations || [],
    };
  }

  // Also check OpenSanctions API if API key configured
  const apiKey = process.env.OPENSANCTIONS_API_KEY;
  if (apiKey) {
    const liveMatch = await queryOpenSanctionsApi(clean, apiKey);
    if (liveMatch && liveMatch.matched) {
      return {
        address: clean,
        chain: "EVM/TRON",
        entity: liveMatch.entity,
        providers: ["OPENSANCTIONS_LIVE", ...liveMatch.datasets],
        jurisdictions: ["INTERNATIONAL"],
        programs: [],
        fatfNexus: null,
        threatType: "SANCTIONS_DESIGNATION",
        threatLevel: "CRITICAL",
        riskWeight: 100,
        confidence: "VERIFIED_LIVE_API",
        authority: "OpenSanctions API",
        noticeId: liveMatch.datasets?.join(", ") || "API Match",
        legalCitation: "https://www.opensanctions.org",
        details: `Identified by OpenSanctions API in datasets: ${(liveMatch.datasets || []).join(", ")}`,
        citations: [{ authority: "OpenSanctions", url: `https://api.opensanctions.org/search/default?q=${clean}` }],
      };
    }
  }

  return null;
}

/**
 * Returns a list of all known sanctioned entities, formatted for UI and exports.
 */
export function getAllSanctionedEntities(filter = {}) {
  const data = loadSanctionsCache();
  let list = Object.values(data.addresses || {});

  // Append any known Tether frozen addresses
  for (const [address, item] of Object.entries(TETHER_FROZEN_ADDRESSES)) {
    const norm = normalizeAddressKey(address);
    if (!data.addresses || !data.addresses[norm]) {
      list.push({
        address,
        chain: item.chain,
        entity: item.entity || "Tether Frozen Address",
        providers: ["TETHER ON-CHAIN"],
        jurisdictions: ["GLOBAL"],
        programs: ["USDT Blacklist"],
        fatfNexus: null,
        threatType: "TETHER_FROZEN",
        threatLevel: "CRITICAL",
        riskScore: 100,
        citations: [{ authority: "Tether Ltd On-Chain Contract", url: "https://tronscan.org" }],
      });
    }
  }

  // Optional Filtering
  if (filter.chain && filter.chain !== "ALL") {
    list = list.filter((e) => e.chain?.toUpperCase() === filter.chain.toUpperCase());
  }

  if (filter.provider && filter.provider !== "ALL") {
    list = list.filter((e) => e.providers && e.providers.includes(filter.provider));
  }

  if (filter.search && filter.search.trim()) {
    const q = filter.search.trim().toLowerCase();
    list = list.filter(
      (e) =>
        e.address.toLowerCase().includes(q) ||
        (e.entity && e.entity.toLowerCase().includes(q)) ||
        (e.programs && e.programs.some((p) => p.toLowerCase().includes(q)))
    );
  }

  return {
    total: list.length,
    lastSync: data.lastSync,
    providerCounts: data.providerCounts || {},
    chainCounts: data.chainCounts || {},
    items: list,
  };
}
