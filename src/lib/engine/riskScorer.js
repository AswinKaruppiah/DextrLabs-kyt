import { resolveEntity, RISK_CATEGORIES } from "../intelligence/entityAttribution";
import { formatUsdt } from "../tron/tronUtils";
import {
  SUPPORTED_CHAINS,
  detectChainFromAddress,
  getExplorerAddressUrl,
  getExplorerTxUrl,
} from "../chains/chainConfig";

// Hop decay weighting factors
const HOP_DECAY = {
  1: 1.0, // Direct counterparty: 100% impact
  2: 0.6, // Hop 2: 60% impact
  3: 0.3, // Hop 3: 30% impact
  4: 0.1, // Hop 4: 10% impact
};

/**
 * Evaluates risk for a USDT transaction across TRON (TRC-20), Ethereum (ERC-20), or BSC (BEP-20).
 * 
 * @param {object} params
 * @param {string} params.txHash
 * @param {string} params.from - Sender address
 * @param {string} params.to - Recipient address
 * @param {number} params.amountUsdt - USDT amount
 * @param {string} [params.chain] - "TRON" | "ETHEREUM" | "BSC" (auto-detected if omitted)
 * @param {string} [params.timestamp]
 * @param {Array<object>} [params.customHops] - Optional intermediate hops for multi-hop tracing
 * @returns {Promise<object>} Complete KYT risk assessment conforming to TRM schema
 */
export async function evaluateTransactionRisk({
  txHash,
  from,
  to,
  amountUsdt = 0,
  chain = null,
  timestamp = new Date().toISOString(),
  customHops = null,
}) {
  // Determine effective chain (auto-detect from addresses if not explicitly given)
  const effectiveChain = chain
    ? chain.toUpperCase()
    : detectChainFromAddress(from || to, "TRON");
  const chainConfig = SUPPORTED_CHAINS[effectiveChain] || SUPPORTED_CHAINS.TRON;

  // 1. Resolve direct counterparties with chain awareness
  const [senderEntity, recipientEntity] = await Promise.all([
    resolveEntity(from, effectiveChain),
    resolveEntity(to, effectiveChain),
  ]);

  const riskIndicators = [];
  let highestScore = 0;
  let highestCategory = null;

  // 2. Check Hop 1 (Direct) Exposure on Sender
  if (senderEntity.category.id !== "REGULATED_EXCHANGE" && senderEntity.category.id !== "CLEAN_UNHOSTED") {
    const indicator = {
      id: `IND-DIR-SND-${Date.now()}`,
      direction: "ORIGIN",
      entity: senderEntity.entity,
      category: senderEntity.category.id,
      categoryLabel: senderEntity.category.label,
      severity: senderEntity.category.severity,
      hopDistance: 1,
      exposurePercentage: 100.0,
      amountUsdt: amountUsdt,
      confidence: senderEntity.confidence,
      evidence: senderEntity.evidence,
    };
    riskIndicators.push(indicator);

    if (senderEntity.category.baseScore > highestScore) {
      highestScore = senderEntity.category.baseScore;
      highestCategory = senderEntity.category;
    }
  }

  // 3. Check Hop 1 (Direct) Exposure on Recipient
  if (recipientEntity.category.id !== "REGULATED_EXCHANGE" && recipientEntity.category.id !== "CLEAN_UNHOSTED") {
    const indicator = {
      id: `IND-DIR-REC-${Date.now()}`,
      direction: "DESTINATION",
      entity: recipientEntity.entity,
      category: recipientEntity.category.id,
      categoryLabel: recipientEntity.category.label,
      severity: recipientEntity.category.severity,
      hopDistance: 1,
      exposurePercentage: 100.0,
      amountUsdt: amountUsdt,
      confidence: recipientEntity.confidence,
      evidence: recipientEntity.evidence,
    };
    riskIndicators.push(indicator);

    if (recipientEntity.category.baseScore > highestScore) {
      highestScore = recipientEntity.category.baseScore;
      highestCategory = recipientEntity.category;
    }
  }

  // 4. Multi-hop upstream/downstream tracing
  const flowPath = [];
  if (customHops && Array.isArray(customHops) && customHops.length > 0) {
    for (const hop of customHops) {
      const hopEntity = await resolveEntity(hop.address, effectiveChain);
      const decay = HOP_DECAY[hop.hopDistance] || 0.1;
      const hopExposure = hop.exposurePercentage || 100.0;
      const hopImpact = Math.round(hopEntity.category.baseScore * decay * (hopExposure / 100));

      if (hopEntity.category.id !== "REGULATED_EXCHANGE" && hopEntity.category.id !== "CLEAN_UNHOSTED") {
        riskIndicators.push({
          id: `IND-HOP-${hop.hopDistance}-${Date.now()}`,
          direction: hop.direction || "UPSTREAM",
          entity: hopEntity.entity,
          category: hopEntity.category.id,
          categoryLabel: hopEntity.category.label,
          severity: hopEntity.category.severity,
          hopDistance: hop.hopDistance,
          exposurePercentage: hopExposure,
          amountUsdt: (amountUsdt * (hopExposure / 100)),
          confidence: hopEntity.confidence,
          evidence: hopEntity.evidence,
        });

        if (hopImpact > highestScore) {
          highestScore = hopImpact;
          highestCategory = hopEntity.category;
        }
      }

      flowPath.push({
        hopDistance: hop.hopDistance,
        address: hop.address,
        entity: hopEntity.entity,
        category: hopEntity.category,
        exposurePercentage: hopExposure,
      });
    }
  } else {
    // Default 2-node flow (Sender -> Recipient)
    flowPath.push(
      { hopDistance: 0, address: from, entity: senderEntity.entity, category: senderEntity.category, exposurePercentage: 100 },
      { hopDistance: 1, address: to, entity: recipientEntity.entity, category: recipientEntity.category, exposurePercentage: 100 }
    );
  }

  // 5. Calculate Final Score (0 - 100)
  let finalScore = highestScore;
  if (senderEntity.isSanctioned || recipientEntity.isSanctioned || senderEntity.isTetherFrozen || recipientEntity.isTetherFrozen) {
    finalScore = 100;
  } else if (finalScore === 0) {
    finalScore = 4; // Baseline low risk for clean unhosted / exchange transfer
  }
  finalScore = Math.min(100, Math.max(0, finalScore));

  // 6. Determine Risk Tier & Recommended Action
  let riskLevel = "LOW";
  let recommendedAction = "APPROVE";
  let badgeColor = "#10B981";

  if (finalScore >= 85) {
    riskLevel = "CRITICAL";
    recommendedAction = "BLOCK_AND_FREEZE";
    badgeColor = "#EF4444";
  } else if (finalScore >= 60) {
    riskLevel = "HIGH";
    recommendedAction = "MANUAL_REVIEW_SAR";
    badgeColor = "#F97316";
  } else if (finalScore >= 30) {
    riskLevel = "MEDIUM";
    recommendedAction = "ENHANCED_DUE_DILIGENCE";
    badgeColor = "#EAB308";
  }

  // 7. Generate Glass Box Rationale Summary
  let summaryText = `Transaction of ${formatUsdt(amountUsdt)} on ${chainConfig.name} (${chainConfig.standard}) passed screening with low risk indicators.`;
  if (riskLevel === "CRITICAL") {
    const isOfac = riskIndicators.some(i => i.category === "SANCTIONS_OFAC");
    const isFrozen = riskIndicators.some(i => i.category === "TETHER_FROZEN");
    if (isOfac) {
      summaryText = `CRITICAL ALERT: Direct interaction with U.S. OFAC designated sanctioned entity on ${chainConfig.name}. Immediate freeze required under OFAC compliance regulations.`;
    } else if (isFrozen) {
      summaryText = `CRITICAL ALERT: Counterparty wallet is officially blacklisted on-chain by Tether on ${chainConfig.name} (${chainConfig.standard}). USDT transfer attempts will fail or expose the VASP to seized assets.`;
    } else {
      summaryText = `CRITICAL ALERT: Direct interaction with high-risk illicit finance entity on ${chainConfig.name}. Immediate compliance intervention required.`;
    }
  } else if (riskLevel === "HIGH") {
    summaryText = `HIGH RISK: Transaction on ${chainConfig.name} exhibits direct or layered exposure to fraudulent operations (scam compound, drainer, or hack exploit). Mandatory SAR review required.`;
  } else if (riskLevel === "MEDIUM") {
    summaryText = `MEDIUM RISK: Counterparty on ${chainConfig.name} identified as unlicensed shadow broker or high-risk OTC liquidity pool. Enhanced Due Diligence (EDD) recommended.`;
  }

  const generatedTxHash = txHash || `${effectiveChain}_SIM_${Date.now()}`;

  return {
    screeningId: `${effectiveChain}-KYT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    asset: "USDT",
    chain: effectiveChain,
    chainName: chainConfig.name,
    tokenStandard: chainConfig.standard,
    tokenContract: chainConfig.contract,
    tokenDecimals: chainConfig.decimals,
    brandColor: chainConfig.brandColor,
    badgeClass: chainConfig.badgeClass,
    txHash: generatedTxHash,
    explorerTxUrl: getExplorerTxUrl(effectiveChain, generatedTxHash),
    explorerSenderUrl: getExplorerAddressUrl(effectiveChain, from),
    explorerRecipientUrl: getExplorerAddressUrl(effectiveChain, to),
    amountUsdt: Number(amountUsdt),
    timestamp: timestamp,
    riskScore: finalScore,
    riskLevel: riskLevel,
    badgeColor: badgeColor,
    recommendedAction: recommendedAction,
    summary: summaryText,
    sender: {
      address: from,
      entity: senderEntity.entity,
      category: senderEntity.category,
      isSanctioned: senderEntity.isSanctioned,
      isTetherFrozen: senderEntity.isTetherFrozen,
    },
    recipient: {
      address: to,
      entity: recipientEntity.entity,
      category: recipientEntity.category,
      isSanctioned: recipientEntity.isSanctioned,
      isTetherFrozen: recipientEntity.isTetherFrozen,
    },
    riskIndicators: riskIndicators,
    flowPath: flowPath,
    highestRiskCategory: highestCategory ? highestCategory.id : "NONE",
  };
}
