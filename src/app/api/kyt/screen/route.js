import { NextResponse } from "next/server";
import { evaluateTransactionRisk } from "@/lib/engine/riskScorer";
import {
  SUPPORTED_CHAINS,
  detectChainFromAddress,
  isValidAddressForChain,
} from "@/lib/chains/chainConfig";
import { isValidTron } from "@/lib/collector/util/address";

// Format check plus, for TRON, the base58check checksum (catches typos the regex can't).
const isValidAddress = (chain, address) =>
  isValidAddressForChain(chain, address) && (chain !== "TRON" || isValidTron(address));

export async function POST(request) {
  try {
    const body = await request.json();
    // customHops is not accepted here: client-supplied hops would replace the real exposure trace.
    let { from, to, amountUsdt = 0, chain } = body;

    // Determine target chain
    const targetAddress = (from || body.address || "").trim();
    const effectiveChain = chain
      ? chain.toUpperCase()
      : detectChainFromAddress(targetAddress, "TRON");

    if (!SUPPORTED_CHAINS[effectiveChain]) {
      return NextResponse.json(
        { error: `Unsupported chain "${chain}". Use one of: ${Object.keys(SUPPORTED_CHAINS).join(", ")}.` },
        { status: 400 }
      );
    }

    if (!targetAddress) {
      return NextResponse.json(
        {
          error: `Valid ${effectiveChain} wallet address is required for screening.`,
        },
        { status: 400 }
      );
    }

    // Validate address formats for the selected chain
    if (!isValidAddress(effectiveChain, targetAddress)) {
      return NextResponse.json(
        {
          error: `Wallet address "${targetAddress}" is not a valid ${effectiveChain} address (${
            effectiveChain === "TRON" ? "Base58 starting with T, with a valid checksum" : "0x-prefixed 40-hex string"
          }).`,
        },
        { status: 400 }
      );
    }

    const cleanTo = to ? to.trim() : null;
    if (cleanTo && !isValidAddress(effectiveChain, cleanTo)) {
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
      amountUsdt: Number(amountUsdt) || 0,
      chain: effectiveChain,
    });

    return NextResponse.json(riskAssessment, { status: 200 });
  } catch (error) {
    console.error("Screening endpoint error:", error);
    return NextResponse.json(
      { error: "Internal error processing multi-chain KYT screening", details: error.message },
      { status: 500 }
    );
  }
}
