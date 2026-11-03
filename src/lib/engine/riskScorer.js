import { resolveEntity, RISK_CATEGORIES } from "../intelligence/entityAttribution";
import { formatUsdt } from "../tron/tronUtils";
import { analyzeExposure } from "../exposure/exposure";
import { analyzeBehaviour } from "../behaviour/analyzeBehaviour";
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

  // 1. Resolve target counterparty with chain awareness
  const senderEntity = await resolveEntity(from, effectiveChain);
  const recipientEntity = to ? await resolveEntity(to, effectiveChain) : null;

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
      providers: senderEntity.providers || [],
      jurisdictions: senderEntity.jurisdictions || [],
      fatfNexus: senderEntity.fatfNexus || null,
      evidence: senderEntity.evidence,
    };
    riskIndicators.push(indicator);

    if (senderEntity.category.baseScore > highestScore) {
      highestScore = senderEntity.category.baseScore;
      highestCategory = senderEntity.category;
    }
  }

  // 3. Check Hop 1 (Direct) Exposure on Recipient (if recipient is provided)
  if (recipientEntity && recipientEntity.category.id !== "REGULATED_EXCHANGE" && recipientEntity.category.id !== "CLEAN_UNHOSTED") {
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
      providers: recipientEntity.providers || [],
      jurisdictions: recipientEntity.jurisdictions || [],
      fatfNexus: recipientEntity.fatfNexus || null,
      evidence: recipientEntity.evidence,
    };
    riskIndicators.push(indicator);

    if (recipientEntity.category.baseScore > highestScore) {
      highestScore = recipientEntity.category.baseScore;
      highestCategory = recipientEntity.category;
    }
  }

  // 4. Counterparty exposure from the sender's own transfer history (hop 1 + hop 2).
  // Always traced. When the wallet is itself sanctioned / frozen the verdict can't get worse, so
  // its findings are returned as `networkFindings` (information only, not scored) and hop 2
  // follows where its money went.
  const hasCustomHops = Array.isArray(customHops) && customHops.length > 0;
  const senderListed = senderEntity.isSanctioned || senderEntity.isTetherFrozen;
  let exposure = null;
  let networkFindings = null;
  if (!hasCustomHops && from) {
    exposure = await analyzeExposure(effectiveChain, from, { followOutflows: senderListed });
    if (senderListed) {
      networkFindings = exposure.indicators;
    } else {
      for (const ind of exposure.indicators) {
        riskIndicators.push(ind);
        if (ind.score > highestScore) {
          highestScore = ind.score;
          highestCategory = RISK_CATEGORIES[ind.category];
        }
      }
    }
  }
  const topExposure = (!senderListed && exposure?.indicators[0]) || null;

  // 4b. Behaviour: how the wallet moves money, its age and who funded it. Like exposure, a listed
  // wallet's findings are information only (`behaviourFindings`). Equal scores keep the listing /
  // exposure category, since those name a concrete counterparty.
  let behaviour = null;
  let behaviourFindings = null;
  if (!hasCustomHops && from) {
    behaviour = await analyzeBehaviour(effectiveChain, from, exposure?.history ?? null);
    if (senderListed) {
      behaviourFindings = behaviour.indicators;
    } else {
      for (const ind of behaviour.indicators) {
        riskIndicators.push(ind);
        if (ind.score > highestScore) {
          highestScore = ind.score;
          highestCategory = RISK_CATEGORIES.SUSPICIOUS_BEHAVIOUR;
        }
      }
    }
  }
  const topBehaviour = (!senderListed && behaviour?.indicators.find((i) => i.score > 0)) || null;

  // 5. Multi-hop upstream/downstream tracing
  const flowPath = [];
  if (hasCustomHops) {
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
    // Single or 2-node flow
    flowPath.push(
      { hopDistance: 0, address: from, entity: senderEntity.entity, category: senderEntity.category, exposurePercentage: 100 }
    );
    if (recipientEntity) {
      flowPath.push(
        { hopDistance: 1, address: to, entity: recipientEntity.entity, category: recipientEntity.category, exposurePercentage: 100 }
      );
    } else if (topExposure) {
      // Path to the most serious listed counterparty: wallet -> (intermediary) -> listed wallet
      if (topExposure.via) {
        flowPath.push({
          hopDistance: 1,
          address: topExposure.via.address,
          entity: "Intermediary wallet",
          category: RISK_CATEGORIES.CLEAN_UNHOSTED,
          exposurePercentage: 100,
        });
      }
      flowPath.push({
        hopDistance: topExposure.hopDistance,
        address: topExposure.counterparty,
        entity: topExposure.entity,
        category: RISK_CATEGORIES[topExposure.category],
        exposurePercentage: topExposure.exposurePercentage,
      });
    }
  }

  // 6. Calculate Final Score (0 - 100)
  let finalScore = highestScore;
  const isSenderFlagged = senderEntity.isSanctioned || senderEntity.isTetherFrozen;
  const isRecipientFlagged = recipientEntity && (recipientEntity.isSanctioned || recipientEntity.isTetherFrozen);
  if (isSenderFlagged || isRecipientFlagged) {
    finalScore = 100;
  } else if (finalScore === 0) {
    finalScore = 4; // Baseline low risk for clean unhosted / exchange transfer
  }
  finalScore = Math.min(100, Math.max(0, finalScore));

  // 7. Determine Risk Tier & Recommended Action
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

  // 7b. Checks that could not run. A wallet that looks clean but wasn't fully checked is UNKNOWN,
  // never LOW: a failed lookup must not read as "OK to transact". Worse levels stand on their evidence.
  const checkGaps = [
    ...(senderEntity.checkGaps || []),
    ...(recipientEntity?.checkGaps || []).map((g) => `Recipient: ${g}`),
  ];
  if (exposure?.coverage.status === "unavailable") {
    checkGaps.push(...exposure.coverage.errors.map((e) => `Counterparty trace did not run. ${e}`));
  }
  if (riskLevel === "LOW" && checkGaps.length) {
    riskLevel = "UNKNOWN";
    recommendedAction = "RETRY_OR_MANUAL_REVIEW";
    badgeColor = "#64748B";
  }

  // 8. Generate Glass Box Rationale Summary
  let summaryText = `Transaction of ${formatUsdt(amountUsdt)} on ${chainConfig.name} (${chainConfig.standard}) passed screening with low risk indicators.`;
  if (riskLevel === "CRITICAL") {
    const sanctioned = riskIndicators.find(i => i.category === "SANCTIONS_OFAC" || i.category === "SANCTIONS_DESIGNATION");
    const frozen = riskIndicators.find(i => i.category === "TETHER_FROZEN");
    const isTetherFreeze = frozen?.providers?.[0] === "TETHER ON-CHAIN";
    if (sanctioned) {
      // Name the authorities that actually list the wallet; only an OFAC listing is called OFAC.
      const by = sanctioned.providers?.length ? sanctioned.providers.join(", ") : "a government sanctions list";
      summaryText = `CRITICAL ALERT: Direct interaction with a sanctioned entity on ${chainConfig.name} (designated by ${by}). Immediate freeze required under sanctions compliance regulations.`;
    } else if (frozen && isTetherFreeze) {
      summaryText = `CRITICAL ALERT: Counterparty wallet is officially blacklisted on-chain by Tether on ${chainConfig.name} (${chainConfig.standard}). USDT transfer attempts will fail or expose the VASP to seized assets.`;
    } else if (frozen) {
      summaryText = `CRITICAL ALERT: Counterparty wallet is frozen on-chain by a stablecoin issuer (${frozen.entity}) on ${chainConfig.name}. Treat its funds as seized or illicit.`;
    } else {
      summaryText = `CRITICAL ALERT: Direct interaction with high-risk illicit finance entity on ${chainConfig.name}. Immediate compliance intervention required.`;
    }
  } else if (riskLevel === "HIGH") {
    summaryText = `HIGH RISK: Transaction on ${chainConfig.name} exhibits direct or layered exposure to fraudulent operations (scam compound, drainer, or hack exploit). Mandatory SAR review required.`;
  } else if (riskLevel === "MEDIUM") {
    summaryText = `MEDIUM RISK: Counterparty on ${chainConfig.name} identified as unlicensed shadow broker or high-risk OTC liquidity pool. Enhanced Due Diligence (EDD) recommended.`;
  }
  // When the level comes from counterparty exposure (not the wallet's own listing), say so.
  if (topExposure && topExposure.score === highestScore && riskLevel !== "CRITICAL") {
    const more = exposure.indicators.length - 1;
    const action = { HIGH: "Mandatory SAR review required.", MEDIUM: "Enhanced Due Diligence (EDD) recommended.", LOW: "Noted for context; no action required." }[riskLevel];
    summaryText =
      `${riskLevel} RISK on ${chainConfig.name}: wallet is not listed itself, but has counterparty exposure. ${topExposure.reason}` +
      (more > 0 ? ` (+${more} more exposure finding${more > 1 ? "s" : ""}.)` : "") +
      ` ${action}`;
  } else if (topBehaviour && topBehaviour.score === highestScore && (riskLevel === "HIGH" || riskLevel === "MEDIUM")) {
    const action = { HIGH: "Mandatory SAR review required.", MEDIUM: "Enhanced Due Diligence (EDD) recommended." }[riskLevel];
    summaryText = `${riskLevel} RISK on ${chainConfig.name}: suspicious behaviour. ${topBehaviour.reason} ${action}`;
  }
  if (riskLevel === "UNKNOWN") {
    summaryText =
      `UNVERIFIED on ${chainConfig.name}: no adverse findings, but the screening could not be completed. ` +
      `${checkGaps.join(" ")} Retry, or review manually before transacting.`;
  } else if (checkGaps.length) {
    summaryText += ` Note: some checks could not run (${checkGaps.join(" ")})`;
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
    explorerRecipientUrl: to ? getExplorerAddressUrl(effectiveChain, to) : null,
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
      providers: senderEntity.providers || [],
      jurisdictions: senderEntity.jurisdictions || [],
    },
    recipient: recipientEntity
      ? {
          address: to,
          entity: recipientEntity.entity,
          category: recipientEntity.category,
          isSanctioned: recipientEntity.isSanctioned,
          isTetherFrozen: recipientEntity.isTetherFrozen,
          providers: recipientEntity.providers || [],
          jurisdictions: recipientEntity.jurisdictions || [],
        }
      : null,
    riskIndicators: riskIndicators,
    checkGaps,
    exposure: exposure ? exposure.coverage : null,
    exposureGraph: exposure?.graph || null,
    networkFindings,
    behaviour: behaviour ? { indicators: behaviour.indicators, coverage: behaviour.coverage } : null,
    behaviourFindings,
    wallet: behaviour?.wallet || null,
    flowPath: flowPath,
    highestRiskCategory: highestCategory ? highestCategory.id : "NONE",
  };
}
