"use client";

import React, { useState, useEffect } from "react";
import { truncateAddress } from "@/lib/tron/tronUtils";
import { getExplorerAddressUrl } from "@/lib/chains/chainConfig";

export default function SanctionedWalletsDirectory() {
  const [sanctions, setSanctions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [chainFilter, setChainFilter] = useState("ALL");
  const [threatFilter, setThreatFilter] = useState("ALL");
  const [copiedAddress, setCopiedAddress] = useState(null);

  useEffect(() => {
    fetch("/api/kyt/sanctions")
      .then((r) => r.json())
      .then((data) => {
        if (data.sanctions) {
          setSanctions(data.sanctions);
        }
      })
      .catch((err) => console.error("Error loading sanctions list:", err))
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = (address) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const filtered = sanctions.filter((item) => {
    // Chain filter
    if (chainFilter !== "ALL" && item.chain !== chainFilter) return false;

    // Threat filter
    if (threatFilter !== "ALL" && item.threatType !== threatFilter) return false;

    return true;
  });

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden space-y-4 p-5">
      
      {/* Directory Title */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"></span>
            Known Sanctioned & Bad Wallets Directory
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
              {filtered.length} of {sanctions.length} Listed
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Public registry of government-designated OFAC targets, Tether on-chain freezes, and verified cyber scam clusters.
          </p>
        </div>
      </div>

      {/* Filter Chips Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        
        {/* Chain Filters */}
        <div className="flex items-center space-x-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 px-2 uppercase tracking-wider">
            Network:
          </span>
          {[
            { id: "ALL", label: "All Chains" },
            { id: "TRON", label: "TRON (TRC-20)", color: "text-red-400" },
            { id: "ETHEREUM", label: "Ethereum (ERC-20)", color: "text-indigo-400" },
            { id: "BSC", label: "BSC (BEP-20)", color: "text-amber-400" },
          ].map((c) => (
            <button
              key={c.id}
              onClick={() => setChainFilter(c.id)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                chainFilter === c.id
                  ? "bg-slate-800 text-white shadow font-bold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Threat Type Filters */}
        <div className="flex items-center space-x-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 px-2 uppercase tracking-wider">
            Threat:
          </span>
          {[
            { id: "ALL", label: "All Threats" },
            { id: "OFAC_SANCTION", label: "OFAC Sanctions" },
            { id: "TETHER_FROZEN", label: "Tether Frozen" },
            { id: "PIG_BUTCHERING", label: "Scam Compounds" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setThreatFilter(t.id)}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                threatFilter === t.id
                  ? "bg-slate-800 text-white shadow font-bold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Directory Table / Cards */}
      {loading ? (
        <div className="py-16 flex flex-col items-center justify-center space-y-3">
          <div className="w-8 h-8 border-3 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
          <span className="text-xs text-slate-400 font-mono">Loading Sanctioned Wallets Registry...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">
          No sanctioned wallets currently loaded in registry.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/90 text-slate-400 font-mono uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Chain</th>
                <th className="py-3 px-4">Wallet Address</th>
                <th className="py-3 px-4">Entity / Attribution</th>
                <th className="py-3 px-4">Threat Type</th>
                <th className="py-3 px-4">Legal Citation / Authority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filtered.map((item, idx) => {
                const chainColor =
                  item.chain === "TRON"
                    ? "text-red-400 bg-red-500/10 border-red-500/20"
                    : item.chain === "ETHEREUM"
                    ? "text-indigo-400 bg-indigo-500/10 border-indigo-500/20"
                    : "text-amber-400 bg-amber-500/10 border-amber-500/20";

                return (
                  <tr
                    key={idx}
                    className="hover:bg-slate-800/40 transition-colors group"
                  >
                    {/* Chain Badge */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded font-bold text-[10px] border ${chainColor}`}>
                        {item.chain}
                      </span>
                    </td>

                    {/* Address with Copy and Explorer link */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-white font-mono" title={item.address}>
                          {truncateAddress(item.address)}
                        </span>
                        <button
                          onClick={() => handleCopy(item.address)}
                          title="Copy Address"
                          className="text-slate-400 hover:text-cyan-400 text-[11px]"
                        >
                          {copiedAddress === item.address ? "✓" : "📋"}
                        </button>
                        <a
                          href={getExplorerAddressUrl(item.chain, item.address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View on Explorer"
                          className="text-slate-500 hover:text-cyan-400 text-[11px]"
                        >
                          ↗
                        </a>
                      </div>
                    </td>

                    {/* Entity Name & Details */}
                    <td className="py-3 px-4">
                      <div className="font-sans">
                        <span className="font-bold text-white block text-xs">
                          {item.entity}
                        </span>
                        <span className="text-[11px] text-slate-400 line-clamp-1">
                          {item.details}
                        </span>
                      </div>
                    </td>

                    {/* Threat Type Badge */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${item.badgeColor}`}>
                        {item.threatLabel}
                      </span>
                    </td>

                    {/* Legal Citation */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-sans">
                        <span className="text-slate-300 block text-xs font-medium">
                          {item.authority}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">
                          {item.noticeId}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
