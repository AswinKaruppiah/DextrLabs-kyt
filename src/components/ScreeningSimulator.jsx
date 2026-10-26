"use client";

import React, { useState } from "react";
import { formatUsdt } from "@/lib/tron/tronUtils";
import HopFlowGraph from "./HopFlowGraph";
import {
  SUPPORTED_CHAINS,
  detectChainFromAddress,
  getExplorerTxUrl,
  getExplorerAddressUrl,
} from "@/lib/chains/chainConfig";

const MULTI_CHAIN_SCENARIOS = {
  TRON: [
    {
      title: "OFAC Sanctions (Lazarus)",
      chain: "TRON",
      description: "North Korea DPRK cyber exploitation cashout address",
      from: "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9",
      to: "TNDU9Z68eKx6H5k9bU1wX7Y8Z9kQ4V1m8K",
      amount: "75000",
      badge: "CRITICAL",
    },
    {
      title: "Tether Smart Contract Freeze",
      chain: "TRON",
      description: "On-chain frozen by Tether admin in TRC-20 contract (KK Park)",
      from: "TDqP8VvBknWk4C38Gv6HjL8kQ9bU1wX4Q9",
      to: "TWd4vBknWk4C38Gv6HjL8kQ9bU1wZ9K3P2",
      amount: "250000",
      badge: "CRITICAL",
    },
    {
      title: "Pig Butchering Scam Hub",
      chain: "TRON",
      description: "KK Park industrial fraud compound in Southeast Asia",
      from: "TScam8vBknWk4C38Gv6HjL8kQ9bU1wK8P1",
      to: "TPyjyZvBknWk4C38Gv6HjL8kQ9bU1wZ9K3",
      amount: "38500",
      badge: "HIGH",
    },
    {
      title: "Binance Verified Clean Deposit",
      chain: "TRON",
      description: "Regulated exchange inter-hot wallet transfer",
      from: "TKzBDW5kPqSL69c5eC26b4N6W5vT4HkU9k",
      to: "TWd4vBknWk4C38Gv6HjL8kQ9bU1wZ9K3P2",
      amount: "12400",
      badge: "LOW",
    },
  ],
  ETHEREUM: [
    {
      title: "OFAC Mixer (Tornado Cash)",
      chain: "ETHEREUM",
      description: "Core privacy mixer router contract sanctioned under EO 13694",
      from: "0xd90e2f925DA726b50C4Ed8D0Fb90Ad053324F31b",
      to: "0x28C6c06298d514Db089934071355E5743bf21d60",
      amount: "120000",
      badge: "CRITICAL",
    },
    {
      title: "Tether Freeze (Multichain Exploit)",
      chain: "ETHEREUM",
      description: "Stolen bridge reserves frozen on-chain via ERC-20 addBlackList()",
      from: "0x1da5821544e25c636c1417ba96ade4cf6d2f9b5a",
      to: "0xDFd5293D8e347dFe59E90eFd55b2956a1343963d",
      amount: "500000",
      badge: "CRITICAL",
    },
    {
      title: "Lazarus Ronin Bridge Loot",
      chain: "ETHEREUM",
      description: "Primary cyber laundering node for $620M Axie Ronin hack",
      from: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96",
      to: "0x28C6c06298d514Db089934071355E5743bf21d60",
      amount: "85000",
      badge: "CRITICAL",
    },
    {
      title: "Binance to Kraken Institutional",
      chain: "ETHEREUM",
      description: "Institutional ERC-20 USDT transfer between verified VASPs",
      from: "0xDFd5293D8e347dFe59E90eFd55b2956a1343963d",
      to: "0x6cC5F688a30d3790e980271DE884772113c450ada",
      amount: "45000",
      badge: "LOW",
    },
  ],
  BSC: [
    {
      title: "Tether Freeze (PinkDrainer)",
      chain: "BSC",
      description: "Web3 Discord approval drainer cashout node frozen on BSC",
      from: "0x3c7885b54687C5f92Aeb9d4a4d658C08A46eF915",
      to: "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3",
      amount: "95000",
      badge: "CRITICAL",
    },
    {
      title: "OFAC Sanctions (Garantex Gateway)",
      chain: "BSC",
      description: "Russian illicit crypto brokerage BEP-20 liquidation portal",
      from: "0x7F367cc41522cE07553e823bf3be79A889DEbe1B",
      to: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
      amount: "64500",
      badge: "HIGH",
    },
    {
      title: "Unhosted Whale Transfer ($180K)",
      chain: "BSC",
      description: "Large unhosted transfer triggering Enhanced Due Diligence (EDD)",
      from: "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3",
      to: "0x71C8705a2B88e60825706CE45749280e82f2244E",
      amount: "180000",
      badge: "MEDIUM",
    },
    {
      title: "PancakeSwap AMM Liquidity",
      chain: "BSC",
      description: "Clean decentralized liquidity pool routing on PancakeSwap",
      from: "0xF977814e90dA44bFA03b6295A0616a897441aceC",
      to: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
      amount: "35000",
      badge: "LOW",
    },
  ],
};

export default function ScreeningSimulator({ onScreenComplete }) {
  const [selectedChain, setSelectedChain] = useState("TRON");
  const [fromAddress, setFromAddress] = useState(process.env.NEXT_PUBLIC_DEFAULT_TRON_SENDER);
  const [toAddress, setToAddress] = useState(process.env.NEXT_PUBLIC_DEFAULT_TRON_WALLET);
  const [amount, setAmount] = useState("75000");
  const [txHash, setTxHash] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const currentChainConfig = SUPPORTED_CHAINS[selectedChain] || SUPPORTED_CHAINS.TRON;

  const handleChainChange = (chain) => {
    setSelectedChain(chain);
    if (chain === "TRON") {
      setFromAddress(process.env.NEXT_PUBLIC_DEFAULT_TRON_SENDER);
      setToAddress(process.env.NEXT_PUBLIC_DEFAULT_TRON_WALLET);
    } else if (chain === "ETHEREUM") {
      setFromAddress(process.env.NEXT_PUBLIC_DEFAULT_ETH_SENDER);
      setToAddress(process.env.NEXT_PUBLIC_DEFAULT_ETH_WALLET);
    } else if (chain === "BSC") {
      setFromAddress(process.env.NEXT_PUBLIC_DEFAULT_BSC_SENDER);
      setToAddress(process.env.NEXT_PUBLIC_DEFAULT_BSC_WALLET);
    }
    setTxHash("");
    setResult(null);
    setError(null);
  };

  const applyScenario = (s) => {
    setSelectedChain(s.chain);
    setFromAddress(s.from);
    setToAddress(s.to);
    setAmount(s.amount);
    setTxHash("");
    setResult(null);
    setError(null);
  };

  // Auto-detect chain when typing or pasting address
  const handleFromChange = (val) => {
    setFromAddress(val);
    const clean = val.trim();
    if (clean.startsWith("T") && clean.length > 5 && selectedChain !== "TRON") {
      setSelectedChain("TRON");
    } else if (clean.startsWith("0x") && clean.length > 5 && selectedChain === "TRON") {
      setSelectedChain("ETHEREUM");
    }
  };

  const handleRunScreening = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/kyt/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain: selectedChain,
          txHash: txHash.trim() || undefined,
          from: fromAddress.trim(),
          to: toAddress.trim(),
          amountUsdt: Number(amount) || 1000,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Screening failed");
      }

      setResult(data);
      if (onScreenComplete) {
        onScreenComplete(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
      
      {/* Header & Chain Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-800 gap-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-cyan-400"></span>
            Multi-Chain USDT Screening Workbench
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Evaluate counterparty risk on TRON (TRC-20), Ethereum (ERC-20), or BSC (BEP-20)
          </p>
        </div>

        {/* Chain Selector Pill Switcher */}
        <div className="flex items-center rounded-xl bg-slate-950 p-1 border border-slate-800 text-xs">
          {[
            { id: "TRON", name: "TRON", standard: "TRC-20", color: "text-red-400" },
            { id: "ETHEREUM", name: "Ethereum", standard: "ERC-20", color: "text-indigo-400" },
            { id: "BSC", name: "BSC", standard: "BEP-20", color: "text-amber-400" },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleChainChange(c.id)}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                selectedChain === c.id
                  ? "bg-slate-800 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span className={c.color}>●</span>
              <span>{c.name}</span>
              <span className="text-[10px] opacity-75 font-mono">({c.standard})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Contract & Decimals Telemetry Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/60 px-4 py-2.5 rounded-xl border border-slate-800 text-xs">
        <div className="flex items-center space-x-2">
          <span className="text-slate-400">Target Asset:</span>
          <span className="font-bold text-white">USDT</span>
          <span className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] border ${currentChainConfig.badgeClass}`}>
            {currentChainConfig.standard}
          </span>
          <span className="text-slate-500 font-mono text-[11px]">
            Decimals: {currentChainConfig.decimals}
          </span>
        </div>
        <div className="flex items-center space-x-2 font-mono text-[11px]">
          <span className="text-slate-400">Contract:</span>
          <a
            href={getExplorerAddressUrl(currentChainConfig.id, currentChainConfig.contract)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-400 hover:text-cyan-300 underline"
          >
            {currentChainConfig.contract} &#x2197;
          </a>
        </div>
      </div>

      {/* Preset Scenario Quick-Pickers */}
      <div>
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
          {currentChainConfig.name} Real-World Test Scenarios:
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {MULTI_CHAIN_SCENARIOS[selectedChain].map((s, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => applyScenario(s)}
              className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 text-left transition-all hover:bg-slate-800/60 group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white group-hover:text-cyan-300">
                  {s.title}
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    s.badge === "CRITICAL"
                      ? "bg-red-500/20 text-red-400 border border-red-500/30"
                      : s.badge === "HIGH"
                      ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      : s.badge === "MEDIUM"
                      ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                      : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  }`}
                >
                  {s.badge}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 line-clamp-1">
                {s.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={handleRunScreening} className="space-y-4 bg-slate-950/70 p-5 rounded-xl border border-slate-800">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* Sender Address */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              Sender Address ({selectedChain === "TRON" ? "TRON Base58" : "EVM 0x-Hex"})
            </label>
            <input
              type="text"
              required
              placeholder={selectedChain === "TRON" ? "T..." : "0x..."}
              value={fromAddress}
              onChange={(e) => handleFromChange(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Recipient Address */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              Recipient Address ({selectedChain === "TRON" ? "TRON Base58" : "EVM 0x-Hex"})
            </label>
            <input
              type="text"
              required
              placeholder={selectedChain === "TRON" ? "T..." : "0x..."}
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Amount USDT */}
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              Amount (USDT &bull; {currentChainConfig.standard})
            </label>
            <input
              type="number"
              step="any"
              required
              placeholder="25000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        {/* Optional TX Hash */}
        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
            Optional: Live Transaction Hash (64-char Hex)
          </label>
          <input
            type="text"
            placeholder={selectedChain === "TRON" ? "e.g. 62caaebc0359cb6c3445daba..." : "e.g. 0x89e2f4a5b6c7d8e9f0a1b2..."}
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Error Notification */}
        {error && (
          <div className="p-3 rounded-lg bg-red-950/80 border border-red-500/50 text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* Submit Button */}
        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                Evaluating on {currentChainConfig.name}...
              </>
            ) : (
              <>Run {currentChainConfig.name} KYT Screen &rarr;</>
            )}
          </button>
        </div>
      </form>

      {/* Real-time Screening Results Display */}
      {result && (
        <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-5 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
            <div className="flex items-center space-x-3">
              <span
                className="px-3.5 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider text-white shadow"
                style={{ backgroundColor: result.badgeColor || "#3B82F6" }}
              >
                {result.riskLevel} &bull; Score: {result.riskScore}/100
              </span>
              <div>
                <span className="text-xs font-semibold text-white block">
                  Action: {result.finalAction || result.recommendedAction}
                </span>
                <span className="text-[11px] text-slate-400">
                  {result.chainName} ({result.tokenStandard}) &bull; ID: {result.screeningId}
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono font-bold text-white bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
                {formatUsdt(result.amountUsdt)}
              </span>
              <a
                href={result.explorerTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-cyan-400 hover:underline px-2 py-1 bg-slate-900 rounded border border-slate-800"
              >
                Explorer &#x2197;
              </a>
            </div>
          </div>

          <p className="text-xs font-medium text-slate-200 leading-relaxed bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
            {result.summary}
          </p>

          {/* Flow Graph for Simulator Result */}
          <HopFlowGraph evaluation={result} />
        </div>
      )}
    </div>
  );
}
