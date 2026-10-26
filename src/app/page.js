"use client";

import React, { useState } from "react";
import MetricsHeader from "@/components/MetricsHeader";
import ScreeningSimulator from "@/components/ScreeningSimulator";
import SanctionedWalletsDirectory from "@/components/SanctionedWalletsDirectory";
import { SUPPORTED_CHAINS, getExplorerAddressUrl } from "@/lib/chains/chainConfig";

export default function KytDashboardPage() {
  const [activeTab, setActiveTab] = useState("CHECKER"); // "CHECKER" | "SANCTIONS"

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-white">
      
      {/* Clean Top Header */}
      <MetricsHeader />

      {/* Primary Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/40 backdrop-blur-md px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          
          {/* Main Navigation Tabs */}
          <div className="flex items-center space-x-1.5 bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              onClick={() => setActiveTab("CHECKER")}
              className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 ${
                activeTab === "CHECKER"
                  ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/20 font-bold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>🔍</span>
              <span>Check Wallet (Good or Bad)</span>
            </button>
            <button
              onClick={() => setActiveTab("SANCTIONS")}
              className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 ${
                activeTab === "SANCTIONS"
                  ? "bg-red-600 text-white shadow-md shadow-red-600/20 font-bold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span className="flex h-2 w-2 rounded-full bg-red-400 animate-pulse"></span>
              <span>Sanctioned Wallets Directory</span>
            </button>
          </div>

          {/* Multi-Chain Contract Explorer Links */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono">
            <span className="text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider mr-1">
              USDT Contracts:
            </span>
            <a
              href={getExplorerAddressUrl("TRON", SUPPORTED_CHAINS.TRON.contract)}
              target="_blank"
              rel="noopener noreferrer"
              title="TRON TRC-20 USDT Contract"
              className="px-2 py-0.5 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all flex items-center gap-1"
            >
              <span>TRC-20</span>
              <span className="text-[9px]">&#x2197;</span>
            </a>
            <span className="text-slate-700">&bull;</span>
            <a
              href={getExplorerAddressUrl("ETHEREUM", SUPPORTED_CHAINS.ETHEREUM.contract)}
              target="_blank"
              rel="noopener noreferrer"
              title="Ethereum ERC-20 USDT Contract"
              className="px-2 py-0.5 rounded text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 border border-transparent hover:border-indigo-500/20 transition-all flex items-center gap-1"
            >
              <span>ERC-20</span>
              <span className="text-[9px]">&#x2197;</span>
            </a>
            <span className="text-slate-700">&bull;</span>
            <a
              href={getExplorerAddressUrl("BSC", SUPPORTED_CHAINS.BSC.contract)}
              target="_blank"
              rel="noopener noreferrer"
              title="BSC BEP-20 BSC-USD Contract"
              className="px-2 py-0.5 rounded text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 transition-all flex items-center gap-1"
            >
              <span>BEP-20</span>
              <span className="text-[9px]">&#x2197;</span>
            </a>
          </div>

        </div>
      </header>

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        {activeTab === "CHECKER" ? (
          <div className="space-y-6 animate-in fade-in duration-150">
            <ScreeningSimulator />
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in duration-150">
            <SanctionedWalletsDirectory />
          </div>
        )}
      </main>

      {/* Clean Read-Only Footer */}
      <footer className="border-t border-slate-900 bg-slate-950/80 px-6 py-4 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>
            &copy; 2026 dextrlabs-kyt &bull; Wallet Sanction & Threat Intelligence Registry for USDT across TRON, Ethereum, and BSC.
          </p>
          <div className="flex items-center space-x-3 text-[11px] font-mono">
            <span>Read-Only Verification</span>
            <span>&bull;</span>
            <span className="text-emerald-400">Zero In-Code Fallbacks</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
