"use client";

import React, { useEffect, useState } from "react";
import { formatUsdt } from "@/lib/tron/tronUtils";

export default function MetricsHeader({ alerts = [] }) {
  const [tronBlock, setTronBlock] = useState(87443120);
  const [ethBlock, setEthBlock] = useState(21048990);
  const [bscBlock, setBscBlock] = useState(43312045);

  // Subtle live block height increment simulation
  useEffect(() => {
    const timer = setInterval(() => {
      setTronBlock((prev) => prev + 1);
      setEthBlock((prev) => (Math.random() > 0.6 ? prev + 1 : prev));
      setBscBlock((prev) => prev + 1);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const totalVolume = alerts.reduce((acc, a) => acc + (a.amountUsdt || 0), 0);
  const criticalCount = alerts.filter((a) => a.riskLevel === "CRITICAL").length;
  const highCount = alerts.filter((a) => a.riskLevel === "HIGH").length;
  const frozenAssets = alerts
    .filter((a) => a.finalAction === "BLOCK_AND_FREEZE" || a.riskLevel === "CRITICAL" || a.isTetherFrozen)
    .reduce((acc, a) => acc + (a.amountUsdt || 0), 0);

  return (
    <div className="w-full bg-slate-950 border-b border-slate-800/80 px-4 sm:px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        
        {/* Left Side: Brand Identity & Network Sync Telemetry */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 lg:gap-6">
          
          {/* Logo & Product Badge */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 shadow-md shadow-cyan-500/20 text-white font-black text-sm tracking-widest border border-cyan-400/30">
              KYT
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-lg font-bold text-white tracking-tight">dextrlabs</span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Live Monitor
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
                Glass Box Compliance Engine &bull; TRON, Ethereum &amp; BSC
              </p>
            </div>
          </div>

          {/* Network Sync Segmented Bar */}
          <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-900/80 border border-slate-800/80 text-xs">
            {/* TRON */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-950/30 border border-red-500/20 text-red-300">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
              <span className="font-semibold text-[11px]">TRON</span>
              <span className="text-[10px] font-mono text-red-400/80">#{tronBlock.toLocaleString()}</span>
            </div>

            {/* Ethereum */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-indigo-300">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
              <span className="font-semibold text-[11px]">ETH</span>
              <span className="text-[10px] font-mono text-indigo-400/80">#{ethBlock.toLocaleString()}</span>
            </div>

            {/* BSC */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/30 border border-amber-500/20 text-amber-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
              <span className="font-semibold text-[11px]">BSC</span>
              <span className="text-[10px] font-mono text-amber-400/80">#{bscBlock.toLocaleString()}</span>
            </div>
          </div>

        </div>

        {/* Right Side: Sleek Metrics Stat Cards (No Text Wrap) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
          
          {/* 1. 24h Scanned Volume */}
          <div className="bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 rounded-xl px-3.5 py-2 flex flex-col justify-center min-w-[130px] transition-colors">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block whitespace-nowrap">
              24h Volume
            </span>
            <div className="flex items-baseline gap-1 mt-0.5 whitespace-nowrap">
              <span className="text-base font-bold text-white font-mono tracking-tight">
                {formatUsdt(totalVolume, false, true)}
              </span>
              <span className="text-[10px] font-semibold text-slate-400">USDT</span>
            </div>
          </div>

          {/* 2. Critical Intercepts */}
          <div className="bg-slate-900/60 border border-red-500/30 hover:border-red-500/50 rounded-xl px-3.5 py-2 flex flex-col justify-center min-w-[130px] transition-colors">
            <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wider flex items-center gap-1 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
              Critical Threats
            </span>
            <div className="flex items-baseline gap-1 mt-0.5 whitespace-nowrap">
              <span className="text-base font-bold text-red-400 font-mono tracking-tight">
                {criticalCount}
              </span>
              <span className="text-[10px] text-slate-400">alerts</span>
            </div>
          </div>

          {/* 3. High Risk Cases */}
          <div className="bg-slate-900/60 border border-amber-500/30 hover:border-amber-500/50 rounded-xl px-3.5 py-2 flex flex-col justify-center min-w-[130px] transition-colors">
            <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              High Risk Review
            </span>
            <div className="flex items-baseline gap-1 mt-0.5 whitespace-nowrap">
              <span className="text-base font-bold text-amber-400 font-mono tracking-tight">
                {highCount}
              </span>
              <span className="text-[10px] text-slate-400">alerts</span>
            </div>
          </div>

          {/* 4. Policy Frozen Assets */}
          <div className="bg-slate-900/60 border border-cyan-500/30 hover:border-cyan-500/50 rounded-xl px-3.5 py-2 flex flex-col justify-center min-w-[130px] transition-colors">
            <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider block whitespace-nowrap">
              Policy Frozen
            </span>
            <div className="flex items-baseline gap-1 mt-0.5 whitespace-nowrap">
              <span className="text-base font-bold text-cyan-300 font-mono tracking-tight">
                {formatUsdt(frozenAssets, false, true)}
              </span>
              <span className="text-[10px] font-semibold text-slate-400">USDT</span>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
