"use client";

import React, { useState } from "react";
import { truncateAddress, formatUsdt, getTronscanAddressUrl } from "@/lib/tron/tronUtils";

export default function HopFlowGraph({ evaluation }) {
  const [activeNode, setActiveNode] = useState(null);

  if (!evaluation) return null;

  const flow = evaluation.flowPath || [
    { hopDistance: 0, address: evaluation.sender?.address, entity: evaluation.sender?.entity, category: evaluation.sender?.category, exposurePercentage: 100 },
    { hopDistance: 1, address: evaluation.recipient?.address, entity: evaluation.recipient?.entity, category: evaluation.recipient?.category, exposurePercentage: 100 }
  ];

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="flex h-2 w-2 rounded-full bg-cyan-400"></span>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Interactive Multi-Hop Fund Flow Visualizer
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Traces the direct and layered movement of TRC-20 USDT across intermediate TRON counterparties
          </p>
        </div>
        <span className="px-2.5 py-1 text-xs font-mono font-medium rounded-full bg-slate-800 text-slate-300 border border-slate-700">
          {flow.length} Monitored Hops
        </span>
      </div>

      {/* Visual Graph Area */}
      <div className="relative py-6 px-4 bg-slate-950/60 border border-slate-800/80 rounded-xl overflow-x-auto">
        <div className="flex items-center justify-between min-w-[620px] relative">
          
          {/* Animated Connecting Line */}
          <div className="absolute top-1/2 left-12 right-12 h-1 -translate-y-1/2 bg-gradient-to-r from-red-500/30 via-amber-500/30 to-cyan-500/30 z-0">
            <div className="w-full h-full border-t-2 border-dashed border-cyan-400/40 animate-pulse"></div>
          </div>

          {/* Node Renderers */}
          {flow.map((node, idx) => {
            const isCritical = node.category?.severity === "CRITICAL";
            const isHigh = node.category?.severity === "HIGH";
            const isClean = node.category?.id === "REGULATED_EXCHANGE" || node.category?.id === "CLEAN_UNHOSTED";

            let ringColor = "border-cyan-500/50 bg-slate-900 text-cyan-400";
            let glow = "shadow-cyan-500/10";
            if (isCritical) {
              ringColor = "border-red-500 bg-red-950/80 text-red-400";
              glow = "shadow-red-500/30 shadow-lg";
            } else if (isHigh) {
              ringColor = "border-amber-500 bg-amber-950/80 text-amber-400";
              glow = "shadow-amber-500/20 shadow-md";
            } else if (isClean) {
              ringColor = "border-emerald-500/60 bg-emerald-950/50 text-emerald-400";
            }

            return (
              <div
                key={idx}
                onClick={() => setActiveNode(node)}
                className={`relative z-10 flex flex-col items-center cursor-pointer group transition-all duration-200 transform hover:scale-105`}
              >
                {/* Node Pill */}
                <div
                  className={`flex flex-col items-center justify-center p-3 rounded-2xl border-2 ${ringColor} ${glow} backdrop-blur-md min-w-[140px]`}
                >
                  <span className="text-[10px] font-mono uppercase font-bold tracking-wider opacity-80">
                    {idx === 0 ? "Source Entity" : idx === flow.length - 1 ? "Target Wallet" : `Hop ${node.hopDistance || idx}`}
                  </span>
                  <span className="text-xs font-bold text-white mt-1 text-center truncate max-w-[130px]">
                    {node.entity || "Unhosted Node"}
                  </span>
                  <span className="text-[11px] font-mono text-slate-300 mt-0.5">
                    {truncateAddress(node.address)}
                  </span>
                  <div className="mt-2 text-[10px] px-2 py-0.5 rounded font-semibold bg-slate-950/60 text-slate-300 border border-slate-700/50">
                    {node.exposurePercentage || 100}% Exposure
                  </div>
                </div>

                {/* Arrow indicator between nodes */}
                {idx < flow.length - 1 && (
                  <div className="hidden"></div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Node Details Drawer */}
      {activeNode && (
        <div className="mt-4 p-4 rounded-xl bg-slate-800/70 border border-slate-700/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
          <div>
            <span className="text-slate-400">Selected Node: </span>
            <span className="font-bold text-white">{activeNode.entity}</span>
            <span className="ml-2 font-mono text-cyan-300">({activeNode.address})</span>
            <p className="text-slate-300 mt-1">
              Category: <span className="font-semibold text-white">{activeNode.category?.label || "Unhosted Wallet"}</span> &bull; Exposure: {activeNode.exposurePercentage}%
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={getTronscanAddressUrl(activeNode.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-600/30 transition-colors flex items-center gap-1"
            >
              Tronscan Explorer &rarr;
            </a>
            <button
              onClick={() => setActiveNode(null)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
