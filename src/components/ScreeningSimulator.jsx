"use client";

import React, { useState } from "react";
import HopFlowGraph from "./HopFlowGraph";
import ScreeningStepsGuide from "./ScreeningStepsGuide";
import {
  SUPPORTED_CHAINS,
  getExplorerAddressUrl,
  getExplorerTxUrl,
} from "@/lib/chains/chainConfig";
import { BEHAVIOUR_RULES } from "@/lib/exposure/rules";

// Verdict banner per risk level. HIGH / MEDIUM come from counterparty exposure or OSINT labels;
// only the wallet's own sanctions / freeze listing is CRITICAL.
const VERDICTS = {
  CRITICAL: {
    icon: "🚨",
    title: "BAD / SANCTIONED WALLET",
    action: "DO NOT TRANSACT",
    panel: "bg-red-950/70 border-red-500/40 text-red-100",
    badge: "bg-red-500 text-white border-red-400",
  },
  HIGH: {
    icon: "⚠️",
    title: "HIGH RISK / EXPOSED WALLET",
    action: "MANUAL REVIEW",
    panel: "bg-orange-950/70 border-orange-500/40 text-orange-100",
    badge: "bg-orange-500 text-white border-orange-400",
  },
  MEDIUM: {
    icon: "⚠️",
    title: "CAUTION / INDIRECT EXPOSURE",
    action: "REVIEW REQUIRED",
    panel: "bg-amber-950/70 border-amber-500/40 text-amber-100",
    badge: "bg-amber-500 text-slate-950 border-amber-400",
  },
  LOW: {
    icon: "✅",
    title: "GOOD / LOW RISK WALLET",
    action: "OK TO TRANSACT",
    panel: "bg-emerald-950/70 border-emerald-500/40 text-emerald-100",
    badge: "bg-emerald-500 text-white border-emerald-400",
  },
  // Nothing bad found, but a check failed (history fetch, live freeze check), so it can't be called good.
  UNKNOWN: {
    icon: "❔",
    title: "COULD NOT VERIFY WALLET",
    action: "RETRY / MANUAL REVIEW",
    panel: "bg-slate-800/80 border-slate-500/50 text-slate-100",
    badge: "bg-slate-500 text-white border-slate-400",
  },
};

const LEVEL_PILL = {
  HIGH: "bg-orange-500/15 text-orange-300 border-orange-500/40",
  MEDIUM: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  LOW: "bg-slate-500/15 text-slate-300 border-slate-500/40",
  INFO: "bg-sky-500/15 text-sky-300 border-sky-500/40",
};

const usd = (n) => `$${Math.round(n || 0).toLocaleString("en-US")}`;

/** Counterparty exposure findings and what the trace covered. */
function ExposurePanel({ result }) {
  const coverage = result.exposure;
  if (!coverage) return null;
  // A listed wallet's findings come back separately: shown for investigation, not scored.
  const infoOnly = Array.isArray(result.networkFindings);
  const findings = infoOnly ? result.networkFindings : (result.riskIndicators || []).filter((i) => i.kind === "EXPOSURE");
  const { hop1, hop2 } = coverage;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
          {infoOnly ? "Listed Wallet's Network" : "Counterparty Exposure"} ({findings.length} finding{findings.length === 1 ? "" : "s"})
        </h3>
        {infoOnly && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-sky-900/40 text-sky-300 border border-sky-500/40">
            Information only
          </span>
        )}
        {coverage.status !== "complete" && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-900/40 text-amber-300 border border-amber-500/40">
            {coverage.status === "partial" ? "Partial trace" : "Trace unavailable"}
          </span>
        )}
      </div>

      {infoOnly && (
        <p className="text-[11px] text-sky-300/90 leading-relaxed">
          This wallet is listed itself, so these findings don&apos;t change the score. They show who it dealt with; hop 2
          follows the wallets it sent the most USDT to first (where its money went), then its largest counterparties.
        </p>
      )}

      {hop1 && (
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Hop 1: {hop1.transfers.toLocaleString()} transfers with {hop1.counterparties.toLocaleString()} wallets ({usd(hop1.volumeUsd)} volume)
          {hop1.truncated && " — newest 1,000 per direction only"}
          {hop2 && (
            <>
              {" "}&bull; Hop 2: followed {hop2.followed} of the {infoOnly ? "largest recipients / counterparties" : "largest counterparties"} ({hop2.counterparties.toLocaleString()} more wallets)
              {hop2.truncated > 0 && `, ${hop2.truncated} of them from their newest 1,000 transfers only`}
            </>
          )}
          {hop1.dustIgnored > 0 && <> &bull; {hop1.dustIgnored} incoming dust transfers ignored</>}
          {hop1.cached && <> &bull; history cached {new Date(hop1.fetchedAt).toLocaleString()}</>}
        </p>
      )}

      {findings.length === 0 && coverage.status !== "unavailable" && (
        <p className="text-xs text-emerald-300">No transfers with sanctioned, frozen or scam-listed wallets found within 2 hops.</p>
      )}

      {findings.map((f) => (
        <div key={f.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${LEVEL_PILL[f.severity] || LEVEL_PILL.LOW}`}>
              {f.severity}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono text-slate-300 border border-slate-700">
              Hop {f.hopDistance}
            </span>
            <span className="text-xs font-semibold text-white">{f.categoryLabel}</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">{f.reason}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono">
            <a
              href={getExplorerAddressUrl(result.chain, f.counterparty)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:underline"
            >
              Listed wallet {f.counterparty.slice(0, 8)}…{f.counterparty.slice(-6)} &#x2197;
            </a>
            {f.sampleTx && (
              <a
                href={getExplorerTxUrl(result.chain, f.sampleTx.hash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline"
              >
                Largest tx {usd(f.sampleTx.usd)} &#x2197;
              </a>
            )}
          </div>
        </div>
      ))}

      {coverage.errors.length > 0 && (
        <details className="text-[11px] text-amber-300/80">
          <summary className="cursor-pointer">{coverage.errors.length} trace issue(s)</summary>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {coverage.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const short = (a) => (a ? `${a.slice(0, 8)}…${a.slice(-6)}` : "");

/** "2 years 3 months" / "5 days" / "less than a day". */
function ageText(days) {
  if (days === null || days === undefined) return null;
  if (days < 1) return "less than a day";
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  return [years && `${years} year${years === 1 ? "" : "s"}`, months && `${months} month${months === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" ");
}

/** Wallet age line, shown for every result. Under 7 days is highlighted. */
function WalletAge({ result }) {
  const w = result.wallet;
  if (!w) return null;
  const age = ageText(w.ageDays);
  const fresh = w.ageDays !== null && w.ageDays < BEHAVIOUR_RULES.newWalletDays;
  const source = w.ageSource === "account" ? "from account record" : "first gas received";
  return (
    <p className={`text-[11px] ${fresh ? "text-amber-300 font-semibold" : "text-slate-400"}`}>
      Wallet age:{" "}
      {age ? `${age} (created ${new Date(w.createdAt).toISOString().slice(0, 10)}, ${source})` : "unknown"}
      {w.funder && (
        <>
          {" "}&bull; First fees paid by{" "}
          <a href={getExplorerAddressUrl(result.chain, w.funder.address)} target="_blank" rel="noopener noreferrer" className="font-mono text-cyan-400 hover:underline">
            {short(w.funder.address)} &#x2197;
          </a>
          {w.funder.listed && <span className="text-red-300"> (listed)</span>}
        </>
      )}
    </p>
  );
}

/**
 * Layering path in money order, e.g. listed wallet → new wallet → new wallet → this wallet.
 * Traced layers are stored nearest-to-this-wallet first, so the "back" side is reversed.
 */
function LayeringPath({ result, evidence }) {
  const layer = (l) => ({ address: l.address, label: `new wallet, ${ageText(l.ageDays)} old, held ${l.holdHours} h` });
  const self = { address: null, label: "This wallet" };
  const end = evidence.end && { address: evidence.end.address, label: evidence.end.entity };
  let rows;
  if (evidence.direction === "back") rows = [end, ...[...evidence.layers].reverse().map(layer), self];
  else if (evidence.direction === "forward") rows = [self, ...evidence.layers.map(layer), end];
  else rows = [...[...evidence.back].reverse().map(layer), self, ...evidence.forward.map(layer)];
  return (
    <ol className="mt-1 space-y-0.5 text-[11px] text-slate-300">
      {rows.map((r, i) => (
        <li key={i} className="flex flex-wrap items-center gap-1.5">
          {i > 0 && <span className="text-slate-500">&darr;</span>}
          {r.address ? (
            <a href={getExplorerAddressUrl(result.chain, r.address)} target="_blank" rel="noopener noreferrer" className="font-mono text-cyan-400 hover:underline">
              {short(r.address)}
            </a>
          ) : null}
          <span>{r.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** How the wallet moves money: behaviour findings, scored unless the wallet is listed itself. */
function BehaviourPanel({ result }) {
  const b = result.behaviour;
  if (!b) return null;
  const infoOnly = Array.isArray(result.behaviourFindings);
  const findings = infoOnly ? result.behaviourFindings : b.indicators;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
          Behaviour ({findings.length} finding{findings.length === 1 ? "" : "s"})
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {infoOnly && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-sky-900/40 text-sky-300 border border-sky-500/40">
              Information only
            </span>
          )}
          {b.coverage.funder === "unavailable" && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-900/40 text-amber-300 border border-amber-500/40">
              Funder lookup unavailable
            </span>
          )}
          {b.coverage.layering === "partial" && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-900/40 text-amber-300 border border-amber-500/40">
              Layering trace partial
            </span>
          )}
        </div>
      </div>

      {b.coverage.status === "skipped" && (
        <p className="text-xs text-amber-300">Behaviour checks need the transfer history, which could not be fetched.</p>
      )}
      {findings.length === 0 && b.coverage.status !== "skipped" && (
        <p className="text-xs text-emerald-300">No suspicious money-movement patterns found.</p>
      )}

      {findings.map((f) => (
        <div key={f.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${LEVEL_PILL[f.severity] || LEVEL_PILL.LOW}`}>{f.severity}</span>
            <span className="text-xs font-semibold text-white">{f.categoryLabel}</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">{f.reason}</p>
          {(f.type === "LAYERED_FROM_LISTED" || f.type === "LAYERED_TO_LISTED" || f.type === "LAYERING_CHAIN") && (
            <LayeringPath result={result} evidence={f.evidence} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function ScreeningSimulator({ targetAddress = "", targetChain = "" }) {
  const [selectedChain, setSelectedChain] = useState("TRON");
  const [fromAddress, setFromAddress] = useState(targetAddress || "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const currentChainConfig = SUPPORTED_CHAINS[selectedChain] || SUPPORTED_CHAINS.TRON;

  // Sync when parent requests checking a specific address
  React.useEffect(() => {
    if (targetAddress) {
      setFromAddress(targetAddress);
      if (targetChain) {
        setSelectedChain(targetChain);
      }
    }
  }, [targetAddress, targetChain]);

  const handleChainChange = (chain) => {
    setSelectedChain(chain);
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
    setError(null);
    setResult(null);

    const target = fromAddress.trim();
    if (!target) {
      setError(`Please enter a ${currentChainConfig.name} wallet address to screen.`);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/kyt/screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain: selectedChain,
          from: target,
          address: target,
          amountUsdt: 0,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Screening failed");
      }

      setResult(data);
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

      {/* Input Form for Wallet Screening */}
      <form onSubmit={handleRunScreening} className="space-y-4 bg-slate-950/70 p-5 rounded-xl border border-slate-800">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300 block">
            Target Wallet Address ({selectedChain === "TRON" ? "TRON Base58 (starts with T)" : "EVM 0x-Hex"})
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder={selectedChain === "TRON" ? "Paste any TRON wallet (e.g. TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9)" : "Paste any 0x EVM wallet address..."}
              value={fromAddress}
              onChange={(e) => handleFromChange(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2.5 pr-9 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
            {fromAddress && (
              <button
                type="button"
                onClick={() => {
                  setFromAddress("");
                  setResult(null);
                  setError(null);
                }}
                title="Clear address"
                className="absolute right-3 top-2.5 text-slate-400 hover:text-white text-xs transition-colors"
              >
                ✕
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            Checks the wallet against sanctions, stablecoin freeze and scam lists, then traces who it moved USDT with (2 hops).
          </p>
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
                Tracing counterparties on {currentChainConfig.name}...
              </>
            ) : (
              <>Check Wallet on {currentChainConfig.name} &rarr;</>
            )}
          </button>
        </div>
      </form>

      {/* How the check works (static, so users know how the verdict is reached) */}
      <ScreeningStepsGuide />

      {/* Real-time Screening Results Display */}
      {result && (
        <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-5 animate-in fade-in duration-200">
          
          {/* Big Unmistakable Good vs Bad Verdict Banner */}
          {(() => {
            const v = VERDICTS[result.riskLevel] || VERDICTS.MEDIUM;
            // The wallet's own listing: not an exposure or behaviour finding.
            const listing = result.riskIndicators?.find((i) => i.kind !== "EXPOSURE" && i.kind !== "BEHAVIOUR");
            const behaviourLed = !listing && result.highestRiskCategory === "SUSPICIOUS_BEHAVIOUR";
            return (
              <div className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${v.panel}`}>
                <div className="flex items-center space-x-3.5">
                  <span className="text-3xl">{v.icon}</span>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-black uppercase tracking-wider">{v.title}</span>
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-black/40 border border-white/10 font-mono">
                        Score: {result.riskScore}/100
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 opacity-90 font-medium">
                      {result.riskLevel === "CRITICAL"
                        ? `Threat: ${listing?.entity || "Sanctions / Blacklist"} • Action: ${result.recommendedAction}`
                        : result.riskLevel === "LOW"
                        ? "Not on any sanctions, freeze or scam list, and no significant exposure to listed wallets."
                        : result.riskLevel === "UNKNOWN"
                        ? "Nothing bad found, but some checks could not run. Do not treat this wallet as clean until it is re-checked."
                        : listing
                        ? `Listed: ${listing.entity} (${listing.categoryLabel}).`
                        : behaviourLed
                        ? "Not listed, but behaves like a high-risk wallet. See behaviour below."
                        : "Not listed itself, but has moved USDT with listed wallets. See counterparty exposure below."}
                    </p>
                    {result.checkGaps?.length > 0 && (
                      <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-[11px] opacity-90">
                        {result.checkGaps.map((g, i) => (
                          <li key={i}>{g}</li>
                        ))}
                      </ul>
                    )}
                    {/* Detected Authorities Badges (the wallet's own listing) */}
                    {listing?.providers?.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-300">
                          Designations:
                        </span>
                        {listing.providers.map((prov, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-900/40 text-red-300 border border-red-500/50"
                          >
                            {prov}
                          </span>
                        ))}
                        {listing.fatfNexus && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-900/40 text-amber-300 border border-amber-500/50">
                            {listing.fatfNexus}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <span className={`px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border shrink-0 text-center ${v.badge}`}>
                  {v.action}
                </span>
              </div>
            );
          })()}

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
                  Action: {result.recommendedAction}
                </span>
                <span className="text-[11px] text-slate-400">
                  {result.chainName} ({result.tokenStandard}) &bull; ID: {result.screeningId}
                </span>
                <WalletAge result={result} />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-mono font-semibold text-slate-300 bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-800">
                Wallet Screening
              </span>
              <a
                href={result.explorerSenderUrl || result.explorerTxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-cyan-400 hover:underline px-2.5 py-1.5 bg-slate-900 rounded-lg border border-slate-800 flex items-center gap-1"
              >
                <span>Explorer</span>
                <span>&#x2197;</span>
              </a>
            </div>
          </div>

          <p className="text-xs font-medium text-slate-200 leading-relaxed bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
            {result.summary}
          </p>

          <ExposurePanel result={result} />

          <BehaviourPanel result={result} />

          {/* Flow Graph for Simulator Result */}
          <HopFlowGraph evaluation={result} />
        </div>
      )}
    </div>
  );
}
