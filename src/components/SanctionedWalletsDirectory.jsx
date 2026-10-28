"use client";

import React, { Fragment, useState, useEffect } from "react";
import { truncateAddress } from "@/lib/tron/tronUtils";
import { getExplorerAddressUrl } from "@/lib/chains/chainConfig";

const SOURCE_LABELS = {
  "ofac-sdn": "US OFAC",
  "ofac-0xb10c": "OFAC (0xB10C)",
  "eu-fsf": "EU",
  "uk-sanctions-list": "UK FCDO",
  "un-consolidated": "UN",
  "il-nbctf": "IL NBCTF",
  "tether-usdt-tron": "Tether · TRON",
  "tether-usdt-eth": "Tether · ETH",
  scamsniffer: "ScamSniffer",
  "mew-darklist": "MEW Darklist",
  "eth-labels-phish-hack": "Etherscan Phish/Hack",
  "forta-labelled": "Forta",
};

const SOURCE_BADGES = {
  "ofac-sdn": "bg-blue-500/10 text-blue-400 border-blue-500/30",
  "ofac-0xb10c": "bg-blue-500/5 text-blue-300 border-blue-500/20",
  "eu-fsf": "bg-amber-500/10 text-amber-400 border-amber-500/30",
  "uk-sanctions-list": "bg-purple-500/10 text-purple-400 border-purple-500/30",
  "un-consolidated": "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  "il-nbctf": "bg-orange-500/10 text-orange-400 border-orange-500/30",
  "tether-usdt-tron": "bg-teal-500/10 text-teal-400 border-teal-500/30",
  "tether-usdt-eth": "bg-teal-500/10 text-teal-400 border-teal-500/30",
};
const OSINT_BADGE = "bg-slate-700/50 text-slate-300 border-slate-600";

const CATEGORIES = [
  { id: "ALL", label: "All" },
  { id: "SANCTIONS", label: "Sanctions" },
  { id: "ISSUER_FREEZE", label: "Tether Freeze" },
  { id: "HACK_EXPLOIT", label: "Hack / Exploit" },
  { id: "SCAM_PHISHING", label: "Scam / Phishing" },
];

const CATEGORY_BADGES = {
  SANCTIONS: "bg-red-900/30 text-red-400 border-red-500/40",
  ISSUER_FREEZE: "bg-teal-900/30 text-teal-300 border-teal-500/40",
  HACK_EXPLOIT: "bg-orange-900/30 text-orange-300 border-orange-500/40",
  SCAM_PHISHING: "bg-yellow-900/30 text-yellow-300 border-yellow-500/40",
};

const STATUS_DOT = { ok: "bg-emerald-400", stale: "bg-amber-400", failed: "bg-red-500" };

const sourceLabel = (id) => SOURCE_LABELS[id] || id;
const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || id;

const getChainBadge = (chain) => {
  switch (chain) {
    case "TRON":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "ETHEREUM":
      return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
    case "BSC":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    default:
      return "bg-slate-800 text-slate-400 border-slate-700";
  }
};

const formatDateTime = (iso) =>
  iso
    ? `${new Date(iso).toLocaleDateString()} ${new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "—";

export default function SanctionedWalletsDirectory() {
  const [items, setItems] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [facets, setFacets] = useState({ chain: {}, category: {}, source: {} });
  const [sources, setSources] = useState([]);
  const [loadedKey, setLoadedKey] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [chainFilter, setChainFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [copiedAddress, setCopiedAddress] = useState(null);
  const [expandedKey, setExpandedKey] = useState(null);

  // Debounce typing so every keystroke doesn't hit the API.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const query = new URLSearchParams({
    page: page.toString(),
    limit: pageSize.toString(),
    chain: chainFilter,
    category: categoryFilter,
    source: sourceFilter,
    search,
  }).toString();
  const requestKey = `${query}#${reloadTick}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/kyt/intel?${query}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) {
          setItems(data.items || []);
          setTotalCount(data.totalCount || 0);
          setFilteredCount(data.filteredCount || 0);
          setGeneratedAt(data.generatedAt || null);
          setFacets(data.facets || { chain: {}, category: {}, source: {} });
          setSources(data.sources || []);
        }
      })
      .catch((err) => console.error("Failed to load intel directory:", err))
      .finally(() => {
        if (!cancelled) setLoadedKey(requestKey);
      });
    // A newer request supersedes this one; drop its late response.
    return () => {
      cancelled = true;
    };
  }, [query, requestKey]);

  const reload = () => setReloadTick((t) => t + 1);

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/kyt/intel/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        const notFresh = data.sources.filter((s) => s.status !== "ok");
        setSyncResult({
          ok: notFresh.length === 0,
          text:
            `Collected ${data.totals.entries.toLocaleString()} addresses ` +
            `(+${data.totals.added} / -${data.totals.removed} since last run)` +
            (notFresh.length ? ` — ${notFresh.length} feed(s) kept previous data: ${notFresh.map((s) => sourceLabel(s.id)).join(", ")}` : ""),
        });
        reload();
      } else {
        setSyncResult({ ok: false, text: data.error || "Collection failed" });
      }
    } catch (err) {
      setSyncResult({ ok: false, text: "Collection request failed: " + err.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleCopy = (address) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const selectFilter = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const totalPages = Math.ceil(filteredCount / pageSize) || 1;
  const tierGroups = [
    { tier: 1, label: "Government sanctions" },
    { tier: 2, label: "Issuer freezes" },
    { tier: 4, label: "OSINT" },
  ];

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden space-y-4 p-5">
      {/* Top Header & Sync Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
            <span className="flex h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"></span>
            Global Sanctioned Wallets Directory
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
              {filteredCount.toLocaleString()} of {totalCount.toLocaleString()} Listed
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            USDT risk addresses on TRON, Ethereum and BSC — collected directly from OFAC, EU, UK, UN and Israel NBCTF,
            Tether on-chain freezes, and OSINT scam/hack feeds.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {generatedAt && (
            <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
              Collected: {formatDateTime(generatedAt)}
            </span>
          )}
          <button
            onClick={handleSyncNow}
            disabled={syncing}
            className="px-3.5 py-1.5 rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-800/80 hover:bg-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50"
            title="Re-download every source feed (takes about 1–2 minutes)"
          >
            <span className={syncing ? "animate-spin" : ""}>🔄</span>
            {syncing ? "Collecting feeds (~90s)..." : "Sync Feeds"}
          </button>
        </div>
      </div>

      {syncResult && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center justify-between border ${
            syncResult.ok
              ? "bg-emerald-950/70 border-emerald-500/40 text-emerald-300"
              : "bg-amber-950/70 border-amber-500/40 text-amber-300"
          }`}
        >
          <span>{syncResult.text}</span>
          <button onClick={() => setSyncResult(null)} className="hover:text-white ml-2">
            ✕
          </button>
        </div>
      )}

      {/* Source feeds — health + click-to-filter */}
      {sources.length > 0 && (
        <div className="space-y-2">
          {tierGroups.map(({ tier, label }) => {
            const group = sources.filter((s) => s.tier === tier);
            if (!group.length) return null;
            return (
              <div key={tier} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="w-36 shrink-0 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                  Tier {tier} · {label}
                </span>
                {group.map((s) => {
                  const active = sourceFilter === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => selectFilter(setSourceFilter)(active ? "ALL" : s.id)}
                      title={`${s.name}\n${s.authority}\nStatus: ${s.status}${s.lastError ? ` (${s.lastError})` : ""}\nFetched: ${formatDateTime(s.fetchedAt)}${s.sourceDate ? `\nSource date: ${s.sourceDate}` : ""}\nLicense: ${s.license}`}
                      className={`px-2 py-1 rounded-lg border flex items-center gap-1.5 transition-all ${
                        active
                          ? "bg-slate-700 border-slate-500 text-white"
                          : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s.status] || "bg-slate-500"}`}></span>
                      {sourceLabel(s.id)}
                      <span className="font-mono text-slate-500">{(facets.source[s.id] || 0).toLocaleString()}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="space-y-3 pt-1">
        <div className="relative">
          <input
            type="text"
            placeholder="Search by wallet address, entity name, sanctions program, or order number..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 pl-9 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
          />
          <span className="absolute left-3 top-2.5 text-slate-500 text-xs">🔍</span>
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-3 top-2 text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 px-2 uppercase tracking-wider">Chain:</span>
            {["ALL", "TRON", "ETHEREUM", "BSC"].map((c) => (
              <button
                key={c}
                onClick={() => selectFilter(setChainFilter)(c)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  chainFilter === c ? "bg-slate-800 text-white shadow font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                {c === "ALL" ? "All Chains" : c}
                {c !== "ALL" && (
                  <span className="ml-1 font-mono text-slate-500">{(facets.chain[c] || 0).toLocaleString()}</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 px-2 uppercase tracking-wider">Risk:</span>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => selectFilter(setCategoryFilter)(c.id)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  categoryFilter === c.id ? "bg-slate-800 text-white shadow font-bold" : "text-slate-400 hover:text-white"
                }`}
              >
                {c.label}
                {c.id !== "ALL" && (
                  <span className="ml-1 font-mono text-slate-500">{(facets.category[c.id] || 0).toLocaleString()}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Directory Table */}
      {loading ? (
        <div className="py-16 flex flex-col items-center justify-center space-y-3">
          <div className="w-8 h-8 border-3 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
          <span className="text-xs text-slate-400 font-mono">Querying intel database...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">
          {totalCount === 0
            ? "No collected data yet — click Sync Feeds (or run `npm run collect:intel`)."
            : "No wallets found matching the current filters."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/90 text-slate-400 font-mono uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Chain</th>
                <th className="py-3 px-4">Wallet Address</th>
                <th className="py-3 px-4">Entity & Program</th>
                <th className="py-3 px-4">Risk</th>
                <th className="py-3 px-4">Sources</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {items.map((item) => {
                const mirroredOnly = item.sources.every((s) => s.basis === "evm-mirror");
                const sourceIds = [...new Set(item.sources.map((s) => s.sourceId))];
                const programs = [...new Set(item.sources.flatMap((s) => s.programs || []))];
                const expanded = expandedKey === item.key;
                return (
                  <Fragment key={item.key}>
                    <tr
                      className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                      onClick={() => setExpandedKey(expanded ? null : item.key)}
                    >
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded font-bold text-[10px] border ${getChainBadge(item.chain)}`}>
                          {item.chain}
                        </span>
                        {mirroredOnly && (
                          <span
                            className="block mt-1 text-[9px] text-slate-500 font-sans"
                            title="Listed for another EVM chain; the same key controls this address here"
                          >
                            EVM mirror
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
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
                            title="View on Block Explorer"
                            className="text-slate-500 hover:text-cyan-400 text-[11px]"
                          >
                            ↗
                          </a>
                        </div>
                      </td>

                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-sans">
                          <span className="font-bold text-white block text-xs line-clamp-1" title={item.entities.join(" · ")}>
                            {item.entities[0] || "Unattributed address"}
                            {item.entities.length > 1 && (
                              <span className="text-slate-500 font-normal"> +{item.entities.length - 1}</span>
                            )}
                          </span>
                          <span className="text-[11px] text-slate-400 line-clamp-1" title={programs.join(", ")}>
                            {programs.join(", ") || "—"}
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${CATEGORY_BADGES[item.category] || OSINT_BADGE}`}>
                          {categoryLabel(item.category)}
                        </span>
                        <span className="block mt-1 text-[10px] text-slate-500">
                          Tier {item.tier} · {item.confidence}% conf.
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {sourceIds.map((id) => (
                            <span key={id} className={`px-2 py-0.5 rounded text-[10px] font-bold border ${SOURCE_BADGES[id] || OSINT_BADGE}`}>
                              {sourceLabel(id)}
                            </span>
                          ))}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-slate-500 text-[11px]">{expanded ? "▲" : "▼"}</td>
                    </tr>

                    {expanded && (
                      <tr className="bg-slate-950/60">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="font-sans text-[11px] space-y-2">
                            <div className="text-slate-400">
                              <span className="font-mono text-slate-300">{item.address}</span> · first seen{" "}
                              {formatDateTime(item.firstSeen)}
                            </div>
                            <table className="w-full">
                              <thead className="text-slate-500 text-[10px] uppercase tracking-wider">
                                <tr>
                                  <th className="text-left py-1 pr-3">Source</th>
                                  <th className="text-left py-1 pr-3">Authority</th>
                                  <th className="text-left py-1 pr-3">Entity / Program</th>
                                  <th className="text-left py-1 pr-3">Basis</th>
                                  <th className="text-left py-1 pr-3">Listed</th>
                                  <th className="text-left py-1">Reference</th>
                                </tr>
                              </thead>
                              <tbody className="text-slate-300">
                                {item.sources.map((s, i) => (
                                  <tr key={i} className="align-top">
                                    <td className="py-1 pr-3 whitespace-nowrap">{sourceLabel(s.sourceId)}</td>
                                    <td className="py-1 pr-3">{s.authority}</td>
                                    <td className="py-1 pr-3">
                                      {s.entity || "—"}
                                      {s.programs?.length > 0 && <span className="text-slate-500"> · {s.programs.join(", ")}</span>}
                                    </td>
                                    <td className="py-1 pr-3 whitespace-nowrap">
                                      {s.basis === "evm-mirror" ? "EVM mirror" : "Listed"} · {s.confidence}%
                                    </td>
                                    <td className="py-1 pr-3 whitespace-nowrap">{s.listedAt ? s.listedAt.slice(0, 10) : "—"}</td>
                                    <td className="py-1">
                                      {s.reference?.url ? (
                                        <a
                                          href={s.reference.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-cyan-400 hover:underline"
                                        >
                                          {s.reference.id ? truncateAddress(String(s.reference.id)) : "Open"} ↗
                                        </a>
                                      ) : (
                                        s.reference?.id || "—"
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 text-xs text-slate-400">
        <div className="flex items-center gap-3">
          <span>
            Showing {filteredCount === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, filteredCount)} of{" "}
            {filteredCount.toLocaleString()} entries
          </span>
          <select
            value={pageSize}
            onChange={(e) => selectFilter(setPageSize)(Number(e.target.value))}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-slate-300"
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:hover:bg-slate-800 transition-all font-mono"
          >
            Previous
          </button>
          <span className="px-2 py-1 font-mono text-slate-300">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40 disabled:hover:bg-slate-800 transition-all font-mono"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
