"use client";

import React, { useState } from "react";
import { formatUsdt, truncateAddress, truncateHash } from "@/lib/tron/tronUtils";
import {
  SUPPORTED_CHAINS,
  getExplorerTxUrl,
  getExplorerAddressUrl,
} from "@/lib/chains/chainConfig";
import HopFlowGraph from "./HopFlowGraph";

export default function TransactionDrawer({ alert, onClose, onUpdateStatus, onOpenSar }) {
  const [newNote, setNewNote] = useState("");

  if (!alert) return null;

  const chainKey = (alert.chain || "TRON").toUpperCase();
  const chainInfo = SUPPORTED_CHAINS[chainKey] || SUPPORTED_CHAINS.TRON;

  const handleAddNote = (e) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    onUpdateStatus(alert.id, alert.status, newNote.trim());
    setNewNote("");
  };

  const isCritical = alert.riskLevel === "CRITICAL";
  const isHigh = alert.riskLevel === "HIGH";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-3xl bg-slate-900 border-l border-slate-800 h-full overflow-y-auto flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        
        {/* Header */}
        <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur-md p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span
              className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider text-white shadow-sm"
              style={{ backgroundColor: alert.badgeColor || "#3B82F6" }}
            >
              {alert.riskLevel} ({alert.riskScore}/100)
            </span>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                TX: {truncateHash(alert.txHash)}
                <a
                  href={getExplorerTxUrl(chainKey, alert.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 text-xs font-normal"
                >
                  &#x2197; {chainInfo.explorerName}
                </a>
              </h2>
              <span className="text-xs text-slate-400">
                {chainInfo.name} &bull; {chainInfo.standard} USDT &bull; Contract: {chainInfo.contract.slice(0, 8)}...
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            &#x2715;
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-6 flex-1">
          
          {/* Executive Risk Rationale Banner (Glass Box summary) */}
          <div
            className={`p-4 rounded-2xl border ${
              isCritical
                ? "bg-red-950/40 border-red-500/50 text-red-200"
                : isHigh
                ? "bg-amber-950/40 border-amber-500/50 text-amber-200"
                : "bg-slate-800/50 border-slate-700 text-slate-200"
            }`}
          >
            <div className="flex items-start space-x-3">
              <span className="text-xl">⚠️</span>
              <div className="flex-1">
                <span className="text-xs font-bold uppercase tracking-wider block opacity-90">
                  Glass Box Compliance Rationale
                </span>
                <p className="text-sm font-medium mt-1 leading-relaxed">
                  {alert.summary}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">Recommended Action:</span>
                  <span className="px-2.5 py-1 rounded bg-black/40 font-mono font-bold text-white border border-white/10">
                    {alert.finalAction || alert.recommendedAction}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Action Compliance Controls */}
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-400 font-medium">Disposition:</span>
              <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-950/50 px-2.5 py-1 rounded border border-cyan-800">
                {alert.status}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onUpdateStatus(alert.id, "ESCALATED", "Escalated by analyst for SAR filing")}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600/20 text-amber-300 border border-amber-500/30 hover:bg-amber-600/30"
              >
                Escalate
              </button>
              <button
                onClick={() => onUpdateStatus(alert.id, "FREEZE_CONFIRMED", "Confirmed freeze order on counterparty")}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-500 shadow-md shadow-red-600/30"
              >
                Execute Policy Freeze
              </button>
              <button
                onClick={() => onOpenSar(alert)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-500 shadow-md shadow-cyan-600/20"
              >
                Generate SAR Report
              </button>
            </div>
          </div>

          {/* Sender vs Recipient Counterparty Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Sender */}
            <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Sender Address (From)
              </span>
              <div className="mt-2">
                <span className="text-sm font-bold text-white block">
                  {alert.sender?.entity || "Unhosted Node"}
                </span>
                <span className="text-xs font-mono text-cyan-300 block mt-0.5 break-all">
                  {alert.sender?.address}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {alert.sender?.category?.label || "Unhosted"}
                </span>
                {alert.sender?.isSanctioned && (
                  <span className="px-2 py-0.5 rounded bg-red-900/60 text-red-300 border border-red-700">
                    OFAC Sanctioned
                  </span>
                )}
                {alert.sender?.isTetherFrozen && (
                  <span className="px-2 py-0.5 rounded bg-rose-900/60 text-rose-300 border border-rose-700">
                    Tether Frozen
                  </span>
                )}
              </div>
            </div>

            {/* Recipient */}
            <div className="bg-slate-950/70 border border-slate-800 p-4 rounded-xl">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Recipient Address (To)
              </span>
              <div className="mt-2">
                <span className="text-sm font-bold text-white block">
                  {alert.recipient?.entity || "Unhosted Node"}
                </span>
                <span className="text-xs font-mono text-cyan-300 block mt-0.5 break-all">
                  {alert.recipient?.address}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {alert.recipient?.category?.label || "Unhosted"}
                </span>
                {alert.recipient?.isSanctioned && (
                  <span className="px-2 py-0.5 rounded bg-red-900/60 text-red-300 border border-red-700">
                    OFAC Sanctioned
                  </span>
                )}
                {alert.recipient?.isTetherFrozen && (
                  <span className="px-2 py-0.5 rounded bg-rose-900/60 text-rose-300 border border-rose-700">
                    Tether Frozen
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Multi-Hop Flow Visualization */}
          <HopFlowGraph evaluation={alert} />

          {/* Glass Box Evidence & Legal Citations */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-2">
              <span className="text-cyan-400 font-mono">&#9670;</span>
              Glass Box Evidentiary Citations ({alert.riskIndicators?.length || 0})
            </h3>
            {alert.riskIndicators && alert.riskIndicators.length > 0 ? (
              <div className="space-y-3">
                {alert.riskIndicators.map((ind, i) => (
                  <div key={i} className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">{ind.entity}</span>
                      <span className="px-2 py-0.5 rounded font-mono font-semibold bg-red-500/10 text-red-400 border border-red-500/30">
                        Hop {ind.hopDistance} &bull; {ind.exposurePercentage}% Exposure
                      </span>
                    </div>
                    {ind.evidence && ind.evidence.map((ev, j) => (
                      <div key={j} className="text-slate-400 bg-slate-950/50 p-2.5 rounded border border-slate-800/80">
                        <p><strong className="text-slate-300">Authority/Source:</strong> {ev.source || ev.authority || "Forensic Attribution"}</p>
                        {ev.legalCitation && <p className="mt-0.5"><strong className="text-slate-300">Legal Citation:</strong> {ev.legalCitation}</p>}
                        {ev.confidence && <p className="mt-0.5"><strong className="text-slate-300">Confidence Level:</strong> {ev.confidence}</p>}
                        {ev.details && <p className="mt-0.5 text-slate-300">{ev.details}</p>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">No adverse threat indicators or legal sanctions identified.</p>
            )}
          </div>

          {/* Compliance Audit Trail & Notes */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-3">
              Case Notes & Audit Trail
            </h3>
            <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
              {alert.notes && alert.notes.length > 0 ? (
                alert.notes.map((note, idx) => (
                  <div key={idx} className="p-2.5 rounded bg-slate-900 border border-slate-800/80 text-xs">
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span className="font-semibold text-slate-300">{note.author}</span>
                      <span>{new Date(note.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-slate-200">{note.text}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-400">No analyst notes recorded yet.</p>
              )}
            </div>

            <form onSubmit={handleAddNote} className="flex gap-2">
              <input
                type="text"
                placeholder="Add compliance note or disposition rationale..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold hover:bg-slate-700 transition-colors"
              >
                Add Note
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
