"use client";

import React, { useState } from "react";
import { formatUsdt, truncateAddress, truncateHash } from "@/lib/tron/tronUtils";
import {
  SUPPORTED_CHAINS,
  getExplorerTxUrl,
  getExplorerAddressUrl,
} from "@/lib/chains/chainConfig";

export default function AlertsTable({ alerts = [], onSelectAlert, onOpenSar }) {
  const [search, setSearch] = useState("");
  const [selectedChain, setSelectedChain] = useState("ALL");
  const [selectedSeverity, setSelectedSeverity] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");

  const filteredAlerts = alerts.filter((a) => {
    // Chain match
    const matchesChain =
      selectedChain === "ALL" || (a.chain || "TRON").toUpperCase() === selectedChain;

    // Search match
    const term = search.toLowerCase().trim();
    const matchesSearch =
      !term ||
      a.txHash?.toLowerCase().includes(term) ||
      a.sender?.address?.toLowerCase().includes(term) ||
      a.recipient?.address?.toLowerCase().includes(term) ||
      a.sender?.entity?.toLowerCase().includes(term) ||
      a.recipient?.entity?.toLowerCase().includes(term) ||
      a.chain?.toLowerCase().includes(term);

    // Severity match
    const matchesSeverity = selectedSeverity === "ALL" || a.riskLevel === selectedSeverity;

    // Status match
    const matchesStatus = selectedStatus === "ALL" || a.status === selectedStatus;

    return matchesChain && matchesSearch && matchesSeverity && matchesStatus;
  });

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
      
      {/* Header & Filter Controls Bar */}
      <div className="p-5 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            Multi-Chain Alert Triage Feed
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
              {filteredAlerts.length} Active
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time compliance monitoring across TRON (TRC-20), Ethereum (ERC-20), and BSC (BEP-20)
          </p>
        </div>

        {/* Filter Controls Group */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Chain Selector Tabs */}
          <div className="flex rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs">
            {[
              { id: "ALL", label: "All Networks" },
              { id: "TRON", label: "TRON", badge: "text-red-400" },
              { id: "ETHEREUM", label: "Ethereum", badge: "text-indigo-400" },
              { id: "BSC", label: "BSC", badge: "text-amber-400" },
            ].map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedChain(c.id)}
                className={`px-3 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                  selectedChain === c.id
                    ? "bg-slate-800 text-white shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {c.badge && <span className={`text-[10px] ${c.badge}`}>●</span>}
                {c.label}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search TX, wallet, entity..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 w-48 sm:w-56 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Severity Filter */}
          <div className="flex rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs">
            {["ALL", "CRITICAL", "HIGH", "LOW"].map((sev) => (
              <button
                key={sev}
                onClick={() => setSelectedSeverity(sev)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                  selectedSeverity === sev
                    ? "bg-slate-800 text-white shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* High-Density Alerts Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase tracking-wider font-semibold">
              <th className="py-3.5 px-4">Network</th>
              <th className="py-3.5 px-4">Severity &amp; Score</th>
              <th className="py-3.5 px-4">Transaction / Time</th>
              <th className="py-3.5 px-4">USDT Amount</th>
              <th className="py-3.5 px-4">Sender (From)</th>
              <th className="py-3.5 px-4">Recipient (To)</th>
              <th className="py-3.5 px-4">Top Trigger</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {filteredAlerts.length > 0 ? (
              filteredAlerts.map((alert) => {
                const chainKey = (alert.chain || "TRON").toUpperCase();
                const chainInfo = SUPPORTED_CHAINS[chainKey] || SUPPORTED_CHAINS.TRON;
                const isCritical = alert.riskLevel === "CRITICAL";
                const isHigh = alert.riskLevel === "HIGH";

                let sevBadge = "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
                if (isCritical) {
                  sevBadge = "bg-red-500/20 text-red-400 border-red-500/40 shadow-sm shadow-red-500/20 animate-pulse";
                } else if (isHigh) {
                  sevBadge = "bg-amber-500/15 text-amber-400 border-amber-500/30";
                } else if (alert.riskLevel === "MEDIUM") {
                  sevBadge = "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
                }

                return (
                  <tr
                    key={alert.id}
                    className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                    onClick={() => onSelectAlert(alert)}
                  >
                    {/* Network Badge */}
                    <td className="py-4 px-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold border ${chainInfo.badgeClass}`}>
                        <span>{chainInfo.name}</span>
                        <span className="opacity-75 font-mono text-[10px]">({chainInfo.standard})</span>
                      </span>
                    </td>

                    {/* Severity & Score */}
                    <td className="py-4 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        <span className={`px-2.5 py-1 rounded-md text-[11px] font-bold border uppercase ${sevBadge}`}>
                          {alert.riskLevel}
                        </span>
                        <span className="font-mono font-bold text-white text-xs">
                          {alert.riskScore}
                        </span>
                      </div>
                    </td>

                    {/* TX Hash & Time */}
                    <td className="py-4 px-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="font-mono text-cyan-400 group-hover:underline">
                          {truncateHash(alert.txHash)}
                        </span>
                        <span className="text-[11px] text-slate-500 mt-0.5">
                          {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </td>

                    {/* Amount */}
                    <td className="py-4 px-4 whitespace-nowrap">
                      <span className="font-mono font-bold text-white text-sm">
                        {formatUsdt(alert.amountUsdt)}
                      </span>
                    </td>

                    {/* Sender */}
                    <td className="py-4 px-4">
                      <div className="flex flex-col max-w-[150px]">
                        <span className="font-semibold text-white truncate">
                          {alert.sender?.entity || "Unhosted Node"}
                        </span>
                        <span className="font-mono text-slate-400 text-[11px] truncate">
                          {truncateAddress(alert.sender?.address)}
                        </span>
                      </div>
                    </td>

                    {/* Recipient */}
                    <td className="py-4 px-4">
                      <div className="flex flex-col max-w-[150px]">
                        <span className="font-semibold text-white truncate">
                          {alert.recipient?.entity || "Unhosted Node"}
                        </span>
                        <span className="font-mono text-slate-400 text-[11px] truncate">
                          {truncateAddress(alert.recipient?.address)}
                        </span>
                      </div>
                    </td>

                    {/* Top Trigger */}
                    <td className="py-4 px-4">
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700 max-w-[180px] truncate block">
                        {alert.triggeredRules?.[0]?.ruleName || alert.highestRiskCategory || "Standard Transfer"}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-4 px-4 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold font-mono bg-cyan-950/60 text-cyan-300 border border-cyan-800/80">
                        {alert.status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end space-x-1.5">
                        <button
                          onClick={() => onSelectAlert(alert)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                        >
                          Inspect
                        </button>
                        <button
                          onClick={() => onOpenSar(alert)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-600/30 transition-colors"
                        >
                          SAR
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-400">
                  No matching USDT transactions found for the selected network or filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
