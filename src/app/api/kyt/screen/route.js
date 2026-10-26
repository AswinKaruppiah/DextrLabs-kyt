import { NextResponse } from "next/server";
import { isValidTronAddress, isValidTronTxHash } from "@/lib/tron/tronUtils";
import { getLiveTronTransaction } from "@/lib/tron/trongridClient";
import { evaluateTransactionRisk } from "@/lib/engine/riskScorer";
import { evaluateComplianceRules } from "@/lib/rules/ruleEngine";
import {
  SUPPORTED_CHAINS,
  detectChainFromAddress,
  isValidAddressForChain,
} from "@/lib/chains/chainConfig";

const DEFAULT_CLEAN_RECIPIENTS = {
  TRON: process.env.NEXT_PUBLIC_DEFAULT_TRON_WALLET,
  ETHEREUM: process.env.NEXT_PUBLIC_DEFAULT_ETH_WALLET,
  BSC: process.env.NEXT_PUBLIC_DEFAULT_BSC_WALLET,
};

export async function POST(request) {
  try {
    const body = await request.json();
    let { txHash, from, to, amountUsdt = 1000, customHops, chain } = body;

    // Determine target chain
    const targetAddress = from || body.address || to || "";
    const effectiveChain = chain
      ? chain.toUpperCase()
      : detectChainFromAddress(targetAddress, "TRON");

    // Case 1: If on TRON and a live TX Hash is provided, attempt live lookup from TRON Mainnet
    if (effectiveChain === "TRON" && txHash && isValidTronTxHash(txHash)) {
      const liveTx = await getLiveTronTransaction(txHash);
      if (liveTx && liveTx.trc20) {
        from = liveTx.trc20.from || from;
        to = liveTx.trc20.to || to;
        amountUsdt = liveTx.trc20.amountUsdt || amountUsdt;
      }
    }

    // Clean input strings
    from = from ? from.trim() : "";
    to = to ? to.trim() : "";

    // Support single wallet screening: if one side is missing, use default clean recipient
    if (!from && body.address) {
      from = body.address.trim();
    }
    if (from && !to) {
      to = DEFAULT_CLEAN_RECIPIENTS[effectiveChain] || DEFAULT_CLEAN_RECIPIENTS.TRON;
    } else if (to && !from) {
      from = DEFAULT_CLEAN_RECIPIENTS[effectiveChain] || DEFAULT_CLEAN_RECIPIENTS.TRON;
    }

    if (!from || !to) {
      return NextResponse.json(
        {
          error: `Valid ${effectiveChain} wallet address is required for screening.`,
        },
        { status: 400 }
      );
    }

    // Validate address formats for the selected chain
    if (!isValidAddressForChain(effectiveChain, from)) {
      return NextResponse.json(
        {
          error: `Sender address "${from}" is not a valid ${effectiveChain} address (${
            effectiveChain === "TRON" ? "Base58 starting with T" : "0x-prefixed 40-hex string"
          }).`,
        },
        { status: 400 }
      );
    }

    if (!isValidAddressForChain(effectiveChain, to)) {
      return NextResponse.json(
        {
          error: `Recipient address "${to}" is not a valid ${effectiveChain} address (${
            effectiveChain === "TRON" ? "Base58 starting with T" : "0x-prefixed 40-hex string"
          }).`,
        },
        { status: 400 }
      );
    }

    // Execute Multi-Hop Risk Assessment
    const riskAssessment = await evaluateTransactionRisk({
      txHash: txHash || `${effectiveChain}_SIM_${Date.now()}`,
      from,
      to,
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
