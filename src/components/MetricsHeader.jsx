"use client";

import React from "react";

export default function MetricsHeader() {
  return (
    <div className="w-full bg-slate-950 border-b border-slate-800/80 px-4 sm:px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        
        {/* Brand Identity & Title */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 shadow-md shadow-cyan-500/20 text-white font-black text-sm tracking-widest border border-cyan-400/30">
            KYT
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-lg font-bold text-white tracking-tight">dextrlabs</span>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Sanction Intelligence
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
              USDT Threat &amp; Sanction Checker &bull; TRON (TRC-20), Ethereum (ERC-20), BSC (BEP-20)
            </p>
          </div>
        </div>

        {/* Real Status Indicators */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
            <span className="font-semibold text-white">OFAC SDN</span>
            <span className="text-[10px] text-slate-400 font-mono">Registry Active</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
            <span className="font-semibold text-white">Tether Blacklist</span>
            <span className="text-[10px] text-slate-400 font-mono">On-Chain</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            <span className="font-semibold text-white">Scam DB</span>
            <span className="text-[10px] text-slate-400 font-mono">Clusters</span>
          </div>
        </div>

      </div>
    </div>
  );
}
