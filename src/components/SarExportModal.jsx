"use client";

import React, { useState } from "react";
import { formatUsdt } from "@/lib/tron/tronUtils";
import { SUPPORTED_CHAINS } from "@/lib/chains/chainConfig";

export default function SarExportModal({ alert, onClose }) {
  const [copied, setCopied] = useState(false);

  if (!alert) return null;

  const chainKey = (alert.chain || "TRON").toUpperCase();
  const chainInfo = SUPPORTED_CHAINS[chainKey] || SUPPORTED_CHAINS.TRON;

  const sarReportText = `================================================================================
SUSPICIOUS ACTIVITY REPORT (SAR / STR) - DIGITAL ASSET TRANSACTION
REGULATORY COMPLIANCE MEMORANDUM & FILING DOSSIER
================================================================================
Filing Organization: dextrlabs-kyt Compliance Unit
Date of Report:      ${new Date().toISOString()}
Screening Identifier: ${alert.screeningId || alert.id}
Regulatory Standard: FATF Recommendation 15 / FinCEN Digital Asset Guidance

--------------------------------------------------------------------------------
1. SUSPICIOUS TRANSACTION DETAILS
--------------------------------------------------------------------------------
Blockchain Network:  ${chainInfo.name} (Mainnet)
Asset / Token:       Tether USD (${chainInfo.standard})
Smart Contract:      ${chainInfo.contract}
Transaction Hash:    ${alert.txHash}
Amount (USDT):       ${formatUsdt(alert.amountUsdt)}
Timestamp:           ${alert.timestamp}

Sender Address:      ${alert.sender?.address}
Sender Entity:       ${alert.sender?.entity || "Unhosted Node"}
Recipient Address:   ${alert.recipient?.address}
Recipient Entity:    ${alert.recipient?.entity || "Unhosted Node"}

--------------------------------------------------------------------------------
2. RISK EVALUATION & COMPLIANCE FINDINGS
--------------------------------------------------------------------------------
Risk Classification: ${alert.riskLevel}
Composite Score:     ${alert.riskScore} / 100
Primary Risk Vector: ${alert.highestRiskCategory}
Action Taken:        ${alert.finalAction || alert.recommendedAction}

Executive Summary:
${alert.summary}

--------------------------------------------------------------------------------
3. GLASS BOX EVIDENTIARY CITATIONS
--------------------------------------------------------------------------------
${
  alert.riskIndicators && alert.riskIndicators.length > 0
    ? alert.riskIndicators
        .map(
          (ind, idx) => `[Indicator #${idx + 1}]
Entity:        ${ind.entity}
Category:      ${ind.categoryLabel || ind.category}
Proximity:     Hop ${ind.hopDistance} (${ind.exposurePercentage}% Exposure)
Confidence:    ${ind.confidence}
Legal Basis:   ${ind.evidence?.[0]?.legalCitation || ind.evidence?.[0]?.source || "TRM Threat Intel Forensic Attribution"}`
        )
        .join("\n\n")
    : "No adverse sanctions or scam indicators detected."
}

--------------------------------------------------------------------------------
4. CASE NOTES & INVESTIGATOR DISPOSITION
--------------------------------------------------------------------------------
${
  alert.notes && alert.notes.length > 0
    ? alert.notes.map((n) => `[${n.timestamp}] ${n.author}: ${n.text}`).join("\n")
    : "Automated transaction rule intercept."
}
================================================================================
END OF REPORT
================================================================================`;

  const handleCopy = () => {
    navigator.clipboard.writeText(sarReportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const element = document.createElement("a");
    const file = new Blob([sarReportText], { type: "text/plain" });
    element.href = URL.createObjectURL(file);
    element.download = `SAR_REPORT_${chainKey}_${alert.id || "KYT"}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span className="text-cyan-400 font-mono">&#9670;</span>
              Suspicious Activity Report (SAR / STR) Generator
            </h3>
            <span className="text-xs text-slate-400">Formal regulatory dossier export</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            &#x2715;
          </button>
        </div>

        {/* Text Preview Area */}
        <div className="p-5 overflow-y-auto flex-1 font-mono text-xs bg-slate-950/80 text-slate-300 leading-relaxed whitespace-pre-wrap select-all border-b border-slate-800">
          {sarReportText}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-900 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            Audit-ready format for FinCEN, FIU, and internal compliance archives
          </span>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopy}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-white hover:bg-slate-700 transition-colors"
            >
              {copied ? "Copied!" : "Copy Report"}
            </button>
            <button
              onClick={handleDownload}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-500 transition-colors shadow-lg shadow-cyan-600/20"
            >
              Download Text Dossier
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
