"use client";

import React, { useState } from "react";

const CHAINS = {
  TRON: {
    label: "TRON",
    placeholder: "TRON address, e.g. T9yb6vP8o8PQJLNmcCkC9wfk73ULTCy2MB",
    url: (a) => `/api/kyt/tronscan?address=${encodeURIComponent(a)}`,
    source:
      "Data from Tronscan's security and account APIs. is_black_list comes from the USDT contract's isBlackListed record on the TRON chain (set by Tether).",
  },
  ETHEREUM: {
    label: "ETH",
    placeholder: "Ethereum address, e.g. 0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
    url: (a) => `/api/kyt/etherscan?chain=ETHEREUM&address=${encodeURIComponent(a)}`,
    source:
      "Data from the Etherscan API. usdtBlacklist is the USDT contract's isBlackListed record (set by Tether): ...01 = frozen, ...00 = not frozen.",
  },
};

export default function TronscanSecurityCheck() {
  const [chain, setChain] = useState("TRON");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const runCheck = async (e) => {
    e.preventDefault();
    const trimmed = address.trim();
    if (!trimmed) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(CHAINS[chain].url(trimmed));
      setResult({ chain, data: await res.json() });
    } catch (error) {
      setResult({ chain, data: { success: false, error: error.message } });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 space-y-5">
      <div>
        <h2 className="text-sm font-bold text-slate-100">Official Blacklist Check</h2>
        <p className="text-xs text-slate-400 mt-1">
          Fetches the official data for the address and shows the raw response.
        </p>
      </div>

      <form onSubmit={runCheck} className="flex flex-col sm:flex-row gap-3">
        <select
          value={chain}
          onChange={(e) => {
            setChain(e.target.value);
            setResult(null);
          }}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-slate-100 focus:border-emerald-500 focus:outline-none"
        >
          {Object.entries(CHAINS).map(([key, c]) => (
            <option key={key} value={key}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={CHAINS[chain].placeholder}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !address.trim()}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Checking..." : "Check"}
        </button>
      </form>

      {result && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Full response
          </p>
          <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-emerald-300">
            {JSON.stringify(result.data, null, 2)}
          </pre>
          <p className="text-xs text-slate-400">{CHAINS[result.chain].source}</p>
        </div>
      )}
    </div>
  );
}
