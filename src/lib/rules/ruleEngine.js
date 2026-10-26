/**
 * Compliance Rule Engine for TRC-20 USDT on TRON
 * Configurable rules that automate compliance actions based on organization risk tolerance.
 */

export const DEFAULT_COMPLIANCE_RULES = [
  {
    id: "RULE_OFAC_FREEZE",
    name: "Immediate OFAC Sanctions Enforcement",
    description: "Automatically blocks transactions and freezes funds with direct or indirect ties to OFAC SDN designated TRON addresses.",
    enabled: true,
    severity: "CRITICAL",
    categoryFilter: ["SANCTIONS_OFAC", "TERROR_FINANCE"],
    minExposurePercentage: 1.0,
    action: "BLOCK_AND_FREEZE",
  },
  {
    id: "RULE_TETHER_BLACKLIST",
    name: "Tether Smart Contract Blacklist Protocol",
    description: "Flags transactions interacting with addresses frozen on-chain by Tether Ltd to prevent stranded or contaminated liquidity.",
    enabled: true,
    severity: "CRITICAL",
    categoryFilter: ["TETHER_FROZEN"],
    minExposurePercentage: 1.0,
    action: "BLOCK_AND_FREEZE",
  },
  {
    id: "RULE_PIG_BUTCHERING",
    name: "Southeast Asia Scam & Fraud Syndicate Interceptor",
    description: "Flags deposits or withdrawals linked to industrial romance and investment scam compounds in Southeast Asia for SAR escalation.",
    enabled: true,
    severity: "HIGH",
    categoryFilter: ["PIG_BUTCHERING_SCAM", "EXCHANGE_EXPLOIT"],
    minExposurePercentage: 15.0,
    action: "ESCALATE_TO_MLRO",
  },
  {
    id: "RULE_LARGE_UNHOSTED",
    name: "High-Value Unhosted Wallet Threshold",
    description: "Requires Enhanced Due Diligence (EDD) for any transfer over $50,000 USDT to or from an unhosted private wallet.",
    enabled: true,
    severity: "MEDIUM",
    categoryFilter: ["CLEAN_UNHOSTED", "UNLICENSED_SHADOW_OTC"],
    minAmountUsdt: 50000,
    action: "ENHANCED_DUE_DILIGENCE",
  },
  {
    id: "RULE_SHADOW_BANKING",
    name: "Underground Brokerage & Guarantee Escrow",
    description: "Flags transactions with exposure to unlicensed shadow OTC brokers or guarantee platforms.",
    enabled: true,
    severity: "HIGH",
    categoryFilter: ["UNLICENSED_SHADOW_OTC"],
    minExposurePercentage: 25.0,
    action: "ESCALATE_TO_MLRO",
  },
];

/**
 * Evaluates a transaction's risk assessment result against active compliance rules
 * 
 * @param {object} evaluation - Result from evaluateTransactionRisk
 * @param {Array<object>} [customRules] - Optional override rules
 * @returns {object} Augmented evaluation with triggered rules and final action
 */
export function evaluateComplianceRules(evaluation, customRules = DEFAULT_COMPLIANCE_RULES) {
  const triggeredRules = [];
  let finalAction = evaluation.recommendedAction;
  let highestSeverityRank = getSeverityRank(evaluation.riskLevel);

  for (const rule of customRules) {
    if (!rule.enabled) continue;

    let isTriggered = false;
    let triggerReason = "";

    // Check category match in risk indicators
    const matchingIndicators = evaluation.riskIndicators.filter((ind) =>
      rule.categoryFilter.includes(ind.category)
    );

    if (matchingIndicators.length > 0) {
      for (const match of matchingIndicators) {
        if (rule.minExposurePercentage && match.exposurePercentage >= rule.minExposurePercentage) {
          isTriggered = true;
          triggerReason = `Triggered by ${match.exposurePercentage}% exposure to ${match.entity} (${match.categoryLabel})`;
          break;
        }
      }
    }

    // Check amount threshold (e.g. large unhosted transfer)
    if (!isTriggered && rule.minAmountUsdt && evaluation.amountUsdt >= rule.minAmountUsdt) {
      const isUnhosted =
        evaluation.sender.category.id === "CLEAN_UNHOSTED" ||
        evaluation.recipient.category.id === "CLEAN_UNHOSTED" ||
        evaluation.sender.category.id === "UNLICENSED_SHADOW_OTC" ||
        evaluation.recipient.category.id === "UNLICENSED_SHADOW_OTC";

      if (isUnhosted && rule.categoryFilter.includes("CLEAN_UNHOSTED")) {
        isTriggered = true;
        triggerReason = `Transfer of $${evaluation.amountUsdt.toLocaleString()} USDT exceeds $${rule.minAmountUsdt.toLocaleString()} threshold to an unhosted counterparty.`;
      }
    }

    if (isTriggered) {
      triggeredRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        action: rule.action,
        reason: triggerReason,
      });

      // Update final action if rule severity is higher
      const ruleRank = getSeverityRank(rule.severity);
      if (ruleRank > highestSeverityRank) {
        highestSeverityRank = ruleRank;
        finalAction = rule.action;
      }
    }
  }

  return {
    ...evaluation,
    finalAction: finalAction,
    triggeredRules: triggeredRules,
  };
}

function getSeverityRank(severity) {
  switch (severity) {
    case "CRITICAL":
      return 4;
    case "HIGH":
      return 3;
    case "MEDIUM":
      return 2;
    case "LOW":
    default:
      return 1;
  }
}
