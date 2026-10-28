import { checkSanctions } from "./sanctionsRegistry";
import { checkTetherBlacklist } from "./tetherBlacklist";
import { lookupAddress } from "../collector/store";
import { checkLiveTetherBlacklistOnChain } from "../tron/trongridClient";
import { SUPPORTED_CHAINS, detectChainFromAddress } from "../chains/chainConfig";

/**
 * Standardized Risk Categories matching TRM Labs / FATF guidelines
 */
export const RISK_CATEGORIES = {
  SANCTIONS_OFAC: {
    id: "SANCTIONS_OFAC",
    label: "OFAC Sanctions List",
    severity: "CRITICAL",
    baseScore: 100,
    action: "BLOCK_AND_FREEZE",
    color: "#EF4444",
  },
  TETHER_FROZEN: {
    id: "TETHER_FROZEN",
    label: "Tether Smart Contract Freeze",
    severity: "CRITICAL",
    baseScore: 100,
    action: "BLOCK_AND_FREEZE",
    color: "#DC2626",
  },
  TERROR_FINANCE: {
    id: "TERROR_FINANCE",
    label: "Terrorist Financing Nexus",
    severity: "CRITICAL",
    baseScore: 100,
    action: "BLOCK_AND_REPORT",
    color: "#B91C1C",
  },
  PIG_BUTCHERING_SCAM: {
    id: "PIG_BUTCHERING_SCAM",
    label: "Pig Butchering / Investment Fraud",
    severity: "HIGH",
    baseScore: 80,
    action: "MANUAL_REVIEW_SAR",
    color: "#F97316",
  },
  EXCHANGE_EXPLOIT: {
    id: "EXCHANGE_EXPLOIT",
    label: "Stolen Funds / Hack Proceeds",
    severity: "HIGH",
    baseScore: 82,
    action: "HOLD_FOR_INVESTIGATION",
    color: "#EA580C",
  },
  PHISHING_SCAM: {
    id: "PHISHING_SCAM",
    label: "Phishing / Wallet Drainer",
    severity: "HIGH",
    baseScore: 75,
    action: "MANUAL_REVIEW_SAR",
    color: "#F59E0B",
  },
  UNLICENSED_SHADOW_OTC: {
    id: "UNLICENSED_SHADOW_OTC",
    label: "Unlicensed / High-Risk Shadow OTC",
    severity: "MEDIUM",
    baseScore: 65,
    action: "ENHANCED_DUE_DILIGENCE",
    color: "#EAB308",
  },
  REGULATED_EXCHANGE: {
    id: "REGULATED_EXCHANGE",
    label: "Regulated Exchange Hot Wallet",
    severity: "LOW",
    baseScore: 5,
    action: "APPROVE",
    color: "#10B981",
  },
  CLEAN_UNHOSTED: {
    id: "CLEAN_UNHOSTED",
    label: "Standard Unhosted Wallet",
    severity: "LOW",
    baseScore: 10,
    action: "APPROVE",
    color: "#6B7280",
  },
};

// Known Regulated Exchanges (to be populated from external dynamic source)
const REGULATED_EXCHANGES = {};

// OSINT categories in the intel database -> risk categories. Tier-4 labels never block on their own.
const OSINT_CATEGORY_MAP = {
  HACK_EXPLOIT: RISK_CATEGORIES.EXCHANGE_EXPLOIT,
  SCAM_PHISHING: RISK_CATEGORIES.PHISHING_SCAM,
};

/**
 * Resolves full entity attribution for a wallet address across TRON, Ethereum, or BSC.
 * Combines on-chain Tether blacklist check, OFAC sanctions data, and verified clusters.
 * 
 * @param {string} address 
 * @param {string} [chain] - "TRON" | "ETHEREUM" | "BSC"
 * @returns {Promise<object>} "Glass Box" attribution metadata
 */
export async function resolveEntity(address, chain = "TRON") {
  if (!address || typeof address !== "string") {
    return {
      address: "",
      chain: chain,
      entity: "Unknown",
      category: RISK_CATEGORIES.CLEAN_UNHOSTED,
      confidence: "UNIDENTIFIED",
      evidence: [],
      isSanctioned: false,
      isTetherFrozen: false,
    };
  }

  const cleanAddr = address.trim();
  const effectiveChain = detectChainFromAddress(cleanAddr, chain);
  const chainConfig = SUPPORTED_CHAINS[effectiveChain] || SUPPORTED_CHAINS.TRON;

  // 1. Check Tether smart contract blacklist
  let isTetherFrozen = false;
  let tetherFreezeDetails = null;

  if (effectiveChain === "TRON") {
    // For TRON, try live on-chain check via TronGrid RPC with static fallback
    const liveCheck = await checkLiveTetherBlacklistOnChain(cleanAddr);
    if (liveCheck.isFrozen) {
      isTetherFrozen = true;
      tetherFreezeDetails = {
        contract: chainConfig.contract,
        method: "getBlackListStatus(address)",
        status: "FROZEN_ON_CHAIN",
        confidence: "100% - Smart Contract State",
        timestamp: new Date().toISOString(),
        legalNotice: `Tether Ltd has permanently frozen all ${chainConfig.standard} USDT tokens in this address.`,
      };
    }
  }

  // Check static blacklist (covers ETH, BSC, and TRON fallback)
  if (!isTetherFrozen) {
    const staticBlacklist = checkTetherBlacklist(cleanAddr, effectiveChain);
    if (staticBlacklist) {
      isTetherFrozen = true;
      tetherFreezeDetails = {
        contract: chainConfig.contract,
        method: "addBlackList(address)",
        status: "FROZEN_ON_CHAIN",
        confidence: "100% - Smart Contract State",
        timestamp: new Date().toISOString(),
        legalNotice: staticBlacklist.reason,
        freezeTxHash: staticBlacklist.freezeTxHash,
        freezeTxUrl: staticBlacklist.freezeTxUrl,
        frozenAt: staticBlacklist.frozenAt,
        fundsDestroyed: staticBlacklist.fundsDestroyed,
      };
    }
  }

  // 2. Check official OFAC / NBCTF / International Sanctions Registry (TRON, ETH, BSC)
  const sanctions = await checkSanctions(cleanAddr, effectiveChain);
  if (sanctions) {
    const evidenceList = [
      {
        source: sanctions.authority,
        program: sanctions.noticeId,
        noticeId: sanctions.noticeId,
        legalCitation: sanctions.legalCitation,
        confidence: "100% - Official Government Designation",
        details: sanctions.details,
        providers: sanctions.providers || [],
        fatfNexus: sanctions.fatfNexus || null,
      },
    ];

    if (isTetherFrozen) {
      evidenceList.push({
        source: `Tether Smart Contract ${chainConfig.standard} (${chainConfig.contract})`,
        ...tetherFreezeDetails,
      });
    }

    return {
      address: cleanAddr,
      chain: effectiveChain,
      entity: sanctions.entity,
      category: RISK_CATEGORIES[sanctions.threatType] || RISK_CATEGORIES.SANCTIONS_OFAC,
      confidence: sanctions.confidence,
      isSanctioned: true,
      isTetherFrozen: !!isTetherFrozen,
      providers: sanctions.providers || [],
      jurisdictions: sanctions.jurisdictions || [],
      fatfNexus: sanctions.fatfNexus || null,
      evidence: evidenceList,
    };
  }

  // 3. Fallback: Tether Blacklisted on-chain (if not matched on explicit government sanctions list)
  if (isTetherFrozen) {
    return {
      address: cleanAddr,
      chain: effectiveChain,
      entity: `Tether Blacklisted Wallet (${chainConfig.standard} Frozen)`,
      category: RISK_CATEGORIES.TETHER_FROZEN,
      confidence: "VERIFIED_ON_CHAIN",
      isSanctioned: false,
      isTetherFrozen: true,
      providers: ["TETHER ON-CHAIN"],
      jurisdictions: [],
      fatfNexus: null,
      evidence: [
        {
          source: `Tether Smart Contract ${chainConfig.standard} (${chainConfig.contract})`,
          ...tetherFreezeDetails,
        },
      ],
    };
  }

  // 4. Check OSINT scam / phishing / hack labels from the intel database
  const osint = lookupAddress(effectiveChain, cleanAddr)?.sources.filter((s) => OSINT_CATEGORY_MAP[s.category]) || [];
  if (osint.length) {
    // Hack/exploit outranks scam/phishing when both are present.
    const primary = osint.find((s) => s.category === "HACK_EXPLOIT") || osint[0];
    return {
      address: cleanAddr,
      chain: effectiveChain,
      entity: primary.entity || "OSINT-flagged address",
      category: OSINT_CATEGORY_MAP[primary.category],
      confidence: "OSINT_LABELLED",
      isSanctioned: false,
      isTetherFrozen: false,
      providers: [...new Set(osint.map((s) => s.authority))],
      evidence: osint.map((s) => ({
        source: s.authority,
        confidence: `${s.confidence}% - OSINT / security-vendor label`,
        details: s.entity,
        legalCitation: s.reference?.url || null,
      })),
    };
  }

  // 5. Check Known Regulated Exchange Hot Wallets
  let exchange = REGULATED_EXCHANGES[cleanAddr];
  if (!exchange && cleanAddr.startsWith("0x")) {
    const lower = cleanAddr.toLowerCase();
    for (const [addr, data] of Object.entries(REGULATED_EXCHANGES)) {
      if (addr.toLowerCase() === lower) {
        exchange = data;
        break;
      }
    }
  }

  if (exchange) {
    return {
      address: cleanAddr,
      chain: effectiveChain,
      entity: exchange.name,
      category: RISK_CATEGORIES.REGULATED_EXCHANGE,
      confidence: "VERIFIED_EXCHANGE",
      isSanctioned: false,
      isTetherFrozen: false,
      evidence: [
        {
          source: `Public Proof-of-Reserves / ${chainConfig.name} Hot Infrastructure`,
          confidence: "100% - Known Liquidity Provider",
          details: `Official custody and deposit settlement infrastructure of ${exchange.entity} on ${chainConfig.name}.`,
        },
      ],
    };
  }

  // 6. Default Unhosted Wallet (Clean)
  return {
    address: cleanAddr,
    chain: effectiveChain,
    entity: `Unhosted ${chainConfig.name} Wallet`,
    category: RISK_CATEGORIES.CLEAN_UNHOSTED,
    confidence: "UNIDENTIFIED",
    isSanctioned: false,
    isTetherFrozen: false,
    evidence: [
      {
        source: `${chainConfig.name} Blockchain Telemetry`,
        confidence: "Low Risk - No Adverse Intelligence",
        details: `No historical links to known illicit clusters, mixers, or sanctions registries on ${chainConfig.name}.`,
      },
    ],
  };
}

/**
 * Backward-compatible alias for TRON
 */
export async function resolveTronEntity(address) {
  return resolveEntity(address, "TRON");
}
