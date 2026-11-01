"use client";

import React, { useEffect, useState } from "react";

// What the screening checks, with live wallet counts from the intel database (active listings only).
const BADGES = [
  { label: "Sanctions", detail: "OFAC · UN · EU · UK · IL", dot: "bg-red-400", count: (c) => c.SANCTIONS },
  { label: "Stablecoin freezes", detail: "Tether · Circle · Paxos · TUSD", dot: "bg-rose-400", count: (c) => c.ISSUER_FREEZE },
  { label: "Scam & hack labels", detail: "OSINT", dot: "bg-amber-400", count: (c) => (c.SCAM_PHISHING || 0) + (c.HACK_EXPLOIT || 0) },
  { label: "Counterparty tracing", detail: "2 hops", dot: "bg-cyan-400", count: null },
];

const CHAINS = [
  { name: "TRON", standard: "TRC-20", cls: "border-red-500/30 bg-red-500/10 text-red-300", dot: "bg-red-400" },
  { name: "Ethereum", standard: "ERC-20", cls: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300", dot: "bg-indigo-400" },
  { name: "BNB Smart Chain", standard: "BEP-20", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300", dot: "bg-amber-400" },
];

export default function MetricsHeader() {
  const [intel, setIntel] = useState(null);

  useEffect(() => {
    fetch("/api/kyt/intel?status=active&limit=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setIntel({ categories: data.facets?.category || {}, syncedAt: data.generatedAt }))
      .catch(() => {});
  }, []);

  return (
    <div className="w-full bg-slate-950 border-b border-slate-800/80 px-4 sm:px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">

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
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap mr-0.5">USDT Wallet Screening</span>
              {CHAINS.map((c) => (
                <span
                  key={c.standard}
                  title={c.name}
                  className={`inline-flex items-center gap-1 px-1.5 py-px rounded-md border text-[10px] font-mono font-semibold whitespace-nowrap ${c.cls}`}
                >
                  <span className={`w-1 h-1 rounded-full ${c.dot}`}></span>
                  {c.standard}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Real Status Indicators */}
        <div className="flex flex-col items-start lg:items-end gap-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {BADGES.map((b) => {
              const n = b.count && intel ? b.count(intel.categories) : null;
              return (
                <div
                  key={b.label}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${b.dot}`}></span>
                  <span className="font-semibold text-white">{b.label}</span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {n != null ? `${n.toLocaleString()} wallets` : b.detail}
                  </span>
                </div>
              );
            })}
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            {BADGES.slice(0, 2).map((b) => b.detail).join(" • ")}
            {intel?.syncedAt && <> &bull; intel synced {new Date(intel.syncedAt).toLocaleString()}</>}
          </span>
        </div>

      </div>
    </div>
  );
}
