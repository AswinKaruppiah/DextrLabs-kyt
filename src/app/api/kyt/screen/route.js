import { NextResponse } from "next/server";
import { evaluateTransactionRisk } from "@/lib/engine/riskScorer";
import { evaluateComplianceRules } from "@/lib/rules/ruleEngine";
import {
  detectChainFromAddress,
  isValidAddressForChain,
} from "@/lib/chains/chainConfig";

export async function POST(request) {
  try {
    const body = await request.json();
    let { from, to, amountUsdt = 0, customHops, chain } = body;

    // Determine target chain
    const targetAddress = (from || body.address || "").trim();
    const effectiveChain = chain
      ? chain.toUpperCase()
      : detectChainFromAddress(targetAddress, "TRON");

    if (!targetAddress) {
      return NextResponse.json(
        {
          error: `Valid ${effectiveChain} wallet address is required for screening.`,
        },
        { status: 400 }
      );
    }

    // Validate address formats for the selected chain
    if (!isValidAddressForChain(effectiveChain, targetAddress)) {
      return NextResponse.json(
        {
          error: `Wallet address "${targetAddress}" is not a valid ${effectiveChain} address (${
            effectiveChain === "TRON" ? "Base58 starting with T" : "0x-prefixed 40-hex string"
          }).`,
        },
        { status: 400 }
      );
    }

    const cleanTo = to ? to.trim() : null;
    if (cleanTo && !isValidAddressForChain(effectiveChain, cleanTo)) {
      return NextResponse.json(
        {
          error: `Recipient address "${cleanTo}" is not a valid ${effectiveChain} address.`,
        },
        { status: 400 }
      );
    }

    // Execute Risk Assessment
    const riskAssessment = await evaluateTransactionRisk({
      txHash: `${effectiveChain}_AUDIT_${Date.now()}`,
      from: targetAddress,
      to: cleanTo,
      amountUsdt: Number(amountUsdt),
      chain: effectiveChain,
      customHops,
    });

    // Apply Compliance Policies & Rules
    const finalResult = evaluateComplianceRules(riskAssessment);

    return NextResponse.json(finalResult, { status: 200 });
  } catch (error) {
    console.error("Screening endpoint error:", error);
    return NextResponse.json(
      { error: "Internal error processing multi-chain KYT screening", details: error.message },
      { status: 500 }
    );
  }
}
