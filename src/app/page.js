"use client";

import React, { useState, useEffect } from "react";
import MetricsHeader from "@/components/MetricsHeader";
import AlertsTable from "@/components/AlertsTable";
import TransactionDrawer from "@/components/TransactionDrawer";
import ScreeningSimulator from "@/components/ScreeningSimulator";
import SarExportModal from "@/components/SarExportModal";
import RuleManager from "@/components/RuleManager";
import { SUPPORTED_CHAINS, getExplorerAddressUrl } from "@/lib/chains/chainConfig";

export default function KytDashboardPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("FEED"); // "FEED" | "SIMULATOR"
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [sarAlert, setSarAlert] = useState(null);
  const [isRuleManagerOpen, setIsRuleManagerOpen] = useState(false);

  // Fetch alerts from backend API
  const fetchAlerts = async () => {
    try {
      const res = await fetch("/api/kyt/alerts");
      const data = await res.json();
      if (data.alerts) {
        setAlerts(data.alerts);
      }
    } catch (err) {
      console.error("Error loading alerts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  // Update alert status & notes
  const handleUpdateStatus = async (alertId, newStatus, noteText) => {
    try {
      const res = await fetch("/api/kyt/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_STATUS",
          alertId,
          status: newStatus,
          note: noteText,
          author: "Lead Compliance Officer",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? data.alert : a))
        );
        if (selectedAlert && selectedAlert.id === alertId) {
          setSelectedAlert(data.alert);
        }
      }
    } catch (e) {
      console.error("Failed to update alert:", e);
    }
  };

  // When simulator screens a new transaction, add it to alerts feed
  const handleNewScreenedTx = (result) => {
    const newAlert = {
      ...result,
      id: `ALT-SIM-${Date.now()}`,
      status: "OPEN",
      assignedTo: "Workbench Screening",
      notes: [
        {
          author: "Simulator Screening Engine",
          timestamp: new Date().toISOString(),
          text: `Real-time KYT evaluation: Score ${result.riskScore}/100. Action: ${result.finalAction || result.recommendedAction}`,
        },
      ],
    };
    setAlerts((prev) => [newAlert, ...prev]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-white">
      
      {/* Top Telemetry Header */}
      <MetricsHeader alerts={alerts} />

      {/* Primary Sub-Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/40 backdrop-blur-md px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          
          {/* Workspace Tabs */}
          <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              onClick={() => setActiveTab("FEED")}
              className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 ${
                activeTab === "FEED"
                  ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/20"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span className="flex h-2 w-2 rounded-full bg-emerald-400"></span>
              Alert Triage Feed ({alerts.length})
            </button>
            <button
              onClick={() => setActiveTab("SIMULATOR")}
              className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 ${
                activeTab === "SIMULATOR"
                  ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/20"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>🔬</span>
              Screening Workbench
            </button>
          </div>

          {/* Right Action Tools */}
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <button
              onClick={() => setIsRuleManagerOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors flex items-center gap-1.5 font-medium shadow-sm"
            >
              <span>⚙️</span>
              Compliance Rules
            </button>

            {/* Multi-Chain Contract Explorer Links */}
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-[11px] font-mono">
              <span className="text-[10px] font-sans font-semibold text-slate-400 uppercase tracking-wider mr-1">
                Contracts:
              </span>
              <a
                href={getExplorerAddressUrl("TRON", SUPPORTED_CHAINS.TRON.contract)}
                target="_blank"
                rel="noopener noreferrer"
                title="TRON TRC-20 USDT Contract"
                className="px-2 py-0.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all flex items-center gap-1"
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
                className="px-2 py-0.5 rounded-lg text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 border border-transparent hover:border-indigo-500/20 transition-all flex items-center gap-1"
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
                className="px-2 py-0.5 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20 transition-all flex items-center gap-1"
              >
                <span>BEP-20</span>
                <span className="text-[9px]">&#x2197;</span>
              </a>
            </div>
          </div>

        </div>
      </header>

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-4">
            <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
            <p className="text-xs font-mono text-slate-400">Initializing Multi-Chain USDT KYT Telemetry...</p>
          </div>
        ) : activeTab === "FEED" ? (
          <div className="space-y-6 animate-in fade-in duration-150">
            <AlertsTable
              alerts={alerts}
              onSelectAlert={(a) => setSelectedAlert(a)}
              onOpenSar={(a) => setSarAlert(a)}
            />
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in duration-150">
            <ScreeningSimulator onScreenComplete={handleNewScreenedTx} />
          </div>
        )}
      </main>

      {/* Footer Status */}
      <footer className="border-t border-slate-900 bg-slate-950/80 px-6 py-4 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>
            &copy; 2026 dextrlabs-kyt &bull; Built on TRM Labs Glass Box Compliance Standard for USDT across TRON, Ethereum, and BNB Smart Chain.
          </p>
          <div className="flex items-center space-x-3 text-[11px] font-mono">
            <span>Multi-Chain Synchronized</span>
            <span>&bull;</span>
            <span className="text-emerald-400">Tether On-Chain Blacklist Protocol Active</span>
          </div>
        </div>
      </footer>

      {/* Inspector Drawer */}
      {selectedAlert && (
        <TransactionDrawer
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onUpdateStatus={handleUpdateStatus}
          onOpenSar={(a) => {
            setSelectedAlert(null);
            setSarAlert(a);
          }}
        />
      )}

      {/* SAR Report Generator Modal */}
      {sarAlert && (
        <SarExportModal
          alert={sarAlert}
          onClose={() => setSarAlert(null)}
        />
      )}

      {/* Rule Manager Modal */}
      {isRuleManagerOpen && (
        <RuleManager onClose={() => setIsRuleManagerOpen(false)} />
      )}

    </div>
  );
}
