"use client";

import React, { useState, useEffect, useCallback } from "react";
import { truncateAddress } from "@/lib/tron/tronUtils";
import { getExplorerAddressUrl } from "@/lib/chains/chainConfig";

export default function SanctionedWalletsDirectory() {
  const [sanctions, setSanctions] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [lastSync, setLastSync] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const [search, setSearch] = useState("");
  const [chainFilter, setChainFilter] = useState("ALL");
  const [providerFilter, setProviderFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [copiedAddress, setCopiedAddress] = useState(null);

  const [providerStats, setProviderStats] = useState({});

  const fetchSanctions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pageSize.toString(),
        chain: chainFilter,
        provider: providerFilter,
        search: search.trim(),
      });
      const res = await fetch(`/api/kyt/sanctions?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setSanctions(data.sanctions || []);
        setTotalCount(data.totalCount || 0);
        setFilteredCount(data.filteredCount || 0);
        setLastSync(data.lastSync || null);
        if (data.providerCounts) setProviderStats(data.providerCounts);
      }
    } catch (err) {
      console.error("Failed to load sanctions:", err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, chainFilter, providerFilter, search]);

  useEffect(() => {
    fetchSanctions();
  }, [fetchSanctions]);

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncSuccess(false);
    try {
      const res = await fetch("/api/kyt/sanctions/sync", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 4000);
        fetchSanctions();
      }
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleCopy = (address) => {
    navigator.clipboard.writeText(address);
    setCopiedAddress(address);
    setTimeout(() => setCopiedAddress(null), 2000);
  };

  const getProviderBadge = (provider) => {
    switch (provider) {
      case "US-OFAC":
        return "bg-blue-500/10 text-blue-400 border-blue-500/30";
      case "UK-OFSI":
        return "bg-purple-500/10 text-purple-400 border-purple-500/30";
      case "EU":
        return "bg-amber-500/10 text-amber-400 border-amber-500/30";
      case "UN":
        return "bg-cyan-500/10 text-cyan-400 border-cyan-500/30";
      case "JAPAN-MOFA":
        return "bg-rose-500/10 text-rose-400 border-rose-500/30";
      case "CANADA-SEMA":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
      case "AU-DFAT":
        return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
      case "SWISS-SECO":
        return "bg-indigo-500/10 text-indigo-400 border-indigo-500/30";
      case "IL-NBCTF":
        return "bg-orange-500/10 text-orange-400 border-orange-500/30";
      case "FBI-CYBER":
        return "bg-red-500/10 text-red-400 border-red-500/30";
      case "OPENSANCTIONS":
        return "bg-teal-500/10 text-teal-400 border-teal-500/30";
      case "TETHER ON-CHAIN":
        return "bg-teal-500/10 text-teal-400 border-teal-500/30";
      default:
        return "bg-slate-700/50 text-slate-300 border-slate-600";
    }
  };

  const getChainBadge = (chain) => {
    switch (chain?.toUpperCase()) {
      case "TRON":
        return "bg-red-500/10 text-red-400 border-red-500/20";
      case "ETHEREUM":
        return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
      case "BSC":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      case "BITCOIN":
        return "bg-orange-500/10 text-orange-400 border-orange-500/20";
      default:
        return "bg-slate-800 text-slate-400 border-slate-700";
    }
  };

  const totalPages = Math.ceil(filteredCount / pageSize) || 1;

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden space-y-4 p-5">
      
      {/* Top Header & Sync Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse"></span>
            Global Sanctioned Wallets Directory
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-mono">
              {filteredCount} of {totalCount} Listed
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Aggregated real-time sanctions database covering US (OFAC), UK (OFSI), EU, UN, Japan (MOFA), Israel (NBCTF), and On-Chain Blacklists.
          </p>
        </div>

        {/* Sync Status & Action */}
        <div className="flex items-center gap-3">
          {lastSync && (
            <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
              Synced: {new Date(lastSync).toLocaleDateString()} {new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={handleSyncNow}
            disabled={syncing}
            className="px-3.5 py-1.5 rounded-xl border border-slate-700 hover:border-slate-600 bg-slate-800/80 hover:bg-slate-800 text-slate-200 text-xs font-semibold flex items-center gap-2 transition-all disabled:opacity-50"
            title="Download latest feeds from all international sanction authorities"
          >
            <span className={syncing ? "animate-spin" : ""}>🔄</span>
            {syncing ? "Syncing Feeds..." : "Sync Feeds"}
          </button>
        </div>
      </div>

      {syncSuccess && (
        <div className="p-3 bg-emerald-950/70 border border-emerald-500/40 rounded-xl text-emerald-300 text-xs flex items-center justify-between">
          <span>Sanctions registry successfully updated and re-indexed across all global authorities!</span>
          <button onClick={() => setSyncSuccess(false)} className="text-emerald-400 hover:text-white ml-2">✕</button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="space-y-3 pt-1">
        {/* Search Input */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search by wallet address, entity name, or sanctions program..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 pl-9 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
            />
            <span className="absolute left-3 top-2.5 text-slate-500 text-xs">🔍</span>
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                className="absolute right-3 top-2 text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Chain Filters */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 px-2 uppercase tracking-wider">
              Chain:
            </span>
            {["ALL", "TRON", "ETHEREUM", "BSC"].map((c) => (
              <button
                key={c}
                onClick={() => {
                  setChainFilter(c);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  chainFilter === c
                    ? "bg-slate-800 text-white shadow font-bold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {c === "ALL" ? "All Chains" : c}
              </button>
            ))}
          </div>

          {/* Provider Authority Filter */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <span className="text-[11px] font-semibold text-slate-400 px-2 uppercase tracking-wider">
              Authority:
            </span>
            {[
              { id: "ALL", label: "All" },
              { id: "OPENSANCTIONS", label: "OpenSanctions" },
              { id: "US-OFAC", label: "US OFAC" },
              { id: "IL-NBCTF", label: "Israel NBCTF" },
              { id: "JAPAN-MOFA", label: "Japan MOFA" },
              { id: "UK-OFSI", label: "UK OFSI" },
              { id: "FBI-CYBER", label: "FBI Cyber" },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setProviderFilter(p.id);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  providerFilter === p.id
                    ? "bg-slate-800 text-white shadow font-bold"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Directory Table */}
      {loading ? (
        <div className="py-16 flex flex-col items-center justify-center space-y-3">
          <div className="w-8 h-8 border-3 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
          <span className="text-xs text-slate-400 font-mono">Querying sanctions database...</span>
        </div>
      ) : sanctions.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-400">
          No sanctioned wallets found matching the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/90 text-slate-400 font-mono uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Chain</th>
                <th className="py-3 px-4">Wallet Address</th>
                <th className="py-3 px-4">Entity & Reason</th>
                <th className="py-3 px-4">Designating Authorities</th>
                <th className="py-3 px-4">FATF / Regime</th>
                <th className="py-3 px-4">Official Citation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {sanctions.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-800/40 transition-colors group">
                  {/* Chain */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded font-bold text-[10px] border ${getChainBadge(item.chain)}`}>
                      {item.chain || "EVM"}
                    </span>
                  </td>

                  {/* Address */}
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
                        href={getExplorerAddressUrl(item.chain || "TRON", item.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View on Block Explorer"
                        className="text-slate-500 hover:text-cyan-400 text-[11px]"
                      >
                        ↗
                      </a>
                    </div>
                  </td>

                  {/* Entity Name */}
                  <td className="py-3 px-4">
                    <div className="font-sans">
                      <span className="font-bold text-white block text-xs">
                        {item.entity || "Sanctioned Entity"}
                      </span>
                      <span className="text-[11px] text-slate-400 line-clamp-1">
                        {item.programs?.join(", ") || item.details || "Official Sanctions Target"}
                      </span>
                    </div>
                  </td>

                  {/* Grouped Provider Badges */}
                  <td className="py-3 px-4">
                    <div className="flex flex-wrap gap-1">
                      {item.providers && item.providers.length > 0 ? (
                        item.providers.map((prov, pIdx) => (
                          <span
                            key={pIdx}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getProviderBadge(prov)}`}
                          >
                            {prov}
                          </span>
                        ))
                      ) : (
                        <span className="text-slate-500">Unspecified</span>
                      )}
                    </div>
                  </td>

                  {/* FATF / High-Risk Nexus */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    {item.fatfNexus ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold border bg-red-900/30 text-red-400 border-red-500/40">
                        {item.fatfNexus}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500">Standard</span>
                    )}
                  </td>

                  {/* Citation Links */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    {item.citations && item.citations.length > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        {item.citations.slice(0, 2).map((cit, cIdx) => (
                          <a
                            key={cIdx}
                            href={cit.url || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1 font-sans"
                            title={cit.authority}
                          >
                            <span>{cit.authority?.length > 25 ? cit.authority.slice(0, 25) + "..." : cit.authority}</span>
                            <span className="text-[9px]">↗</span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-500">Official Record</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs text-slate-400">
        <div>
          Showing {filteredCount === 0 ? 0 : (page - 1) * pageSize + 1} to{" "}
          {Math.min(page * pageSize, filteredCount)} of {filteredCount} entries
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
