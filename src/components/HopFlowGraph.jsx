"use client";

import React, { useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  BaseEdge,
  getStraightPath,
  useInternalNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { truncateAddress } from "@/lib/tron/tronUtils";
import { getExplorerAddressUrl } from "@/lib/chains/chainConfig";
import { EXPOSURE_RULES } from "@/lib/exposure/rules";

const CARD_W = 230;
const CARD_H = 80;
const RING_GAP_X = 330; // hop-2 ring sits this much further out than hop 1 (horizontally)
const RING_GAP_Y = 190;

// Card colours by risk level of a listed wallet, else by role.
const LEVEL_STYLE = {
  CRITICAL: { card: "border-red-500 bg-red-950/90", text: "text-red-300", edge: "#EF4444" },
  HIGH: { card: "border-orange-500 bg-orange-950/90", text: "text-orange-300", edge: "#F97316" },
  MEDIUM: { card: "border-amber-500 bg-amber-950/90", text: "text-amber-300", edge: "#EAB308" },
  LOW: { card: "border-yellow-700 bg-yellow-950/70", text: "text-yellow-300", edge: "#A16207" },
  IGNORED: { card: "border-slate-500 border-dashed bg-slate-900/90", text: "text-slate-400", edge: "#475569" },
};
const ROLE_STYLE = {
  screened: { card: "border-cyan-400 bg-cyan-950/90", text: "text-cyan-300" },
  intermediary: { card: "border-sky-600 bg-slate-900/95", text: "text-sky-300" },
  unreached: { card: "border-slate-600 border-dashed bg-slate-900/90", text: "text-slate-400" },
  counterparty: { card: "border-slate-700 bg-slate-900/95", text: "text-slate-400" },
  more: { card: "border-slate-700 border-dashed bg-slate-950/90", text: "text-slate-500" },
};
// Column order, most relevant first.
const ROLE_ORDER = ["screened", "listed", "more-listed", "intermediary", "unreached", "counterparty", "more"];

const usd = (n) => {
  const v = Math.round(n || 0);
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}k`;
  return `$${v}`;
};

function roleLabel(n) {
  if (n.role === "screened") return "Screened wallet";
  if (n.role === "listed") return `Listed • hop ${n.hop}${n.risk?.level === "IGNORED" ? " • dust only" : ""}`;
  if (n.role === "intermediary") return n.truncated ? "Traced • newest 1,000 only" : "Traced • hop 1";
  if (n.role === "unreached") return "Trace failed";
  if (n.role === "more") return "Other counterparties";
  if (n.role === "more-listed") return "Listed • not drawn";
  return "Counterparty • hop 1";
}

function nodeTitle(n, screenedEntity) {
  if (n.role === "listed") return n.risk.entity;
  if (n.role === "screened") return screenedEntity || "Screened wallet";
  if (n.role === "more") return `+${n.count.toLocaleString()} more wallets`;
  if (n.role === "more-listed") return `+${n.count.toLocaleString()} more listed wallets`;
  return "Unlabelled wallet";
}

const LEVEL_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, IGNORED: 4 };

/** Listed wallets a traced wallet leads to (its hop-2 bad actors), most severe first. */
function listedReachedVia(graph, id) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges
    .filter((e) => e.source === id && byId.get(e.target)?.role === "listed")
    .map((e) => ({ target: byId.get(e.target), edge: e }))
    .sort((a, b) => LEVEL_ORDER[a.target.risk.level] - LEVEL_ORDER[b.target.risk.level] || b.edge.inUsd + b.edge.outUsd - (a.edge.inUsd + a.edge.outUsd));
}

// "+N more" nodes stand for many folded wallets, not one address.
const isSummary = (n) => n.role === "more" || n.role === "more-listed";

function WalletNode({ data }) {
  const { node, title, selected, reached } = data;
  const style = (node.risk && LEVEL_STYLE[node.risk.level]) || ROLE_STYLE[node.role] || ROLE_STYLE.counterparty;
  return (
    <div
      className={`w-[230px] rounded-xl border-2 px-3 py-2 shadow-lg backdrop-blur ${style.card} ${
        selected ? "ring-2 ring-white/70" : ""
      }`}
    >
      {/* Edges are drawn centre-to-centre and clipped at the card border (FloatingEdge), so the handles stay hidden. */}
      <Handle type="target" position={Position.Top} className={HIDDEN_HANDLE} />
      <div className={`text-[9px] font-mono font-bold uppercase tracking-wider ${style.text}`}>{roleLabel(node)}</div>
      <div className="mt-0.5 truncate text-xs font-bold text-white" title={title}>
        {title}
      </div>
      {!isSummary(node) && <div className="font-mono text-[10px] text-slate-400">{truncateAddress(node.id)}</div>}
      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-300">
        <span>{node.volumeUsd != null ? `${usd(node.volumeUsd)} volume` : ""}</span>
        {node.counterparties != null && <span>{node.counterparties.toLocaleString()} wallets</span>}
        {node.risk && node.role === "listed" && <span className={`font-bold ${style.text}`}>{node.risk.level}</span>}
        {node.role === "more-listed" && <span className={`font-bold ${style.text}`}>see findings list</span>}
      </div>
      {/* A traced wallet that leads to bad actors says so, and names the worst one. */}
      {reached?.length > 0 && (
        <div className="mt-1.5 rounded border border-red-500/50 bg-red-950/60 px-1.5 py-0.5 text-[10px] font-bold text-red-300 truncate">
          ⚠ Leads to {reached.length} listed: {reached[0].target.risk.entity}
        </div>
      )}
      <Handle type="source" position={Position.Top} className={HIDDEN_HANDLE} />
    </div>
  );
}

const HIDDEN_HANDLE = "!opacity-0 !pointer-events-none !top-1/2 !left-1/2";

/** Where the line from a card's centre towards `other` leaves the card. */
function borderPoint(node, other) {
  const w = node.measured?.width || CARD_W;
  const h = node.measured?.height || CARD_H;
  const cx = node.internals.positionAbsolute.x + w / 2;
  const cy = node.internals.positionAbsolute.y + h / 2;
  const ox = other.internals.positionAbsolute.x + (other.measured?.width || CARD_W) / 2;
  const oy = other.internals.positionAbsolute.y + (other.measured?.height || CARD_H) / 2;
  const dx = ox - cx;
  const dy = oy - cy;
  const t = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Straight edge between the nearest card borders, so it works for wallets in any direction. */
function FloatingEdge({ id, source, target, markerStart, markerEnd, style, label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius }) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s || !t) return null;
  const a = borderPoint(s, t);
  const b = borderPoint(t, s);
  const [path, labelX, labelY] = getStraightPath({ sourceX: a.x, sourceY: a.y, targetX: b.x, targetY: b.y });
  return (
    <BaseEdge
      id={id}
      path={path}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={labelStyle}
      labelShowBg
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
    />
  );
}

const NODE_TYPES = { wallet: WalletNode };
const EDGE_TYPES = { floating: FloatingEdge };

/** Old single-path results (wallet's own listing, custom hops) as a graph. */
function graphFromFlowPath(evaluation) {
  const path = (evaluation.flowPath || []).filter((n) => n.address);
  const nodes = path.map((n, i) => ({
    id: n.address,
    hop: i,
    role: i === 0 ? "screened" : "listed",
    volumeUsd: null,
    // The screened wallet is coloured by its own listing (e.g. red when sanctioned).
    risk:
      i === 0 && n.category?.severity === "LOW"
        ? null
        : { entity: n.entity, label: n.category?.label, level: n.category?.severity || "LOW" },
  }));
  const edges = path.slice(1).map((n, i) => ({
    id: `${path[i].address}->${n.address}`,
    source: path[i].address,
    target: n.address,
    hop: i + 1,
    inUsd: 0,
    outUsd: 0,
  }));
  return { nodes, edges };
}

/**
 * Radial layout: the screened wallet in the centre, hop 1 on an ellipse around it (listed and
 * traced wallets first, from the top), hop 2 on an outer ellipse beside the wallets that lead to them.
 */
function layout(graph) {
  const hop1 = graph.nodes.filter((n) => n.hop === 1);
  const hop2 = graph.nodes.filter((n) => n.hop >= 2);
  const rank = (n) => ROLE_ORDER.indexOf(n.role) * 1e15 - (n.volumeUsd || 0);
  hop1.sort((a, b) => rank(a) - rank(b));

  // Wide ellipse (the frame is landscape), big enough that hop-1 cards don't overlap.
  const rx = Math.max(380, hop1.length * 40);
  const ry = Math.max(220, rx * 0.55);
  const angle = new Map();
  hop1.forEach((n, i) => angle.set(n.id, -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, hop1.length)));

  // Hop 2: at the mean angle of their parents, nudged apart so cards don't stack.
  const parentAngle = (n) => {
    const as = graph.edges.filter((e) => e.target === n.id && angle.has(e.source)).map((e) => angle.get(e.source));
    return as.length ? as.reduce((x, y) => x + y, 0) / as.length : 0;
  };
  const minGap = (2 * Math.PI) / Math.max(12, (2 * Math.PI * (rx + RING_GAP_X)) / (CARD_W + 30));
  let prev = -Infinity;
  hop2
    .map((n) => [n, parentAngle(n)])
    .sort((x, y) => x[1] - y[1])
    .forEach(([n, a]) => {
      prev = Math.max(a, prev + minGap);
      angle.set(n.id, prev);
    });

  const at = (cx, cy) => ({ x: cx - CARD_W / 2, y: cy - CARD_H / 2 });
  const positions = new Map();
  for (const n of graph.nodes) {
    if (n.hop === 0) positions.set(n.id, at(0, 0));
    else {
      const a = angle.get(n.id);
      const [ex, ey] = n.hop === 1 ? [rx, ry] : [rx + RING_GAP_X, ry + RING_GAP_Y];
      positions.set(n.id, at(ex * Math.cos(a), ey * Math.sin(a)));
    }
  }
  return { positions };
}

export default function HopFlowGraph({ evaluation }) {
  const [activeId, setActiveId] = useState(null);

  const graph = useMemo(
    () => (evaluation ? evaluation.exposureGraph || graphFromFlowPath(evaluation) : null),
    [evaluation]
  );

  const { nodes, edges } = useMemo(() => {
    if (!graph) return { nodes: [], edges: [] };
    const { positions } = layout(graph);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const nodes = graph.nodes.map((n) => ({
      id: n.id,
      type: "wallet",
      position: positions.get(n.id),
      data: {
        node: n,
        title: nodeTitle(n, evaluation.sender?.entity),
        selected: n.id === activeId,
        reached: n.role === "intermediary" ? listedReachedVia(graph, n.id) : null,
      },
    }));
    const edges = graph.edges.map((e) => {
      const target = byId.get(e.target);
      const risky = (target?.role === "listed" || target?.role === "more-listed") && target.risk.level !== "IGNORED";
      const color = risky ? LEVEL_STYLE[target.risk.level]?.edge || "#EF4444" : "#475569";
      const marker = { type: MarkerType.ArrowClosed, color, width: 16, height: 16 };
      // Arrowheads show which way the money moved. Amounts are labelled on risky routes only;
      // dozens of labels on the fan-out edges would pile up beside the screened wallet.
      const label = risky
        ? [e.outUsd > 0 && `→ ${usd(e.outUsd)}`, e.inUsd > 0 && `← ${usd(e.inUsd)}`].filter(Boolean).join("  ")
        : "";
      return {
        id: e.id,
        type: "floating",
        source: e.source,
        target: e.target,
        animated: risky,
        markerEnd: e.outUsd > 0 ? marker : undefined,
        markerStart: e.inUsd > 0 ? marker : undefined,
        style: { stroke: color, strokeWidth: risky ? 2.2 : 1.2, opacity: risky ? 1 : 0.7 },
        label: label || undefined,
        labelStyle: { fill: "#CBD5E1", fontSize: 10, fontFamily: "monospace" },
        labelBgStyle: { fill: "#0F172A", fillOpacity: 0.9 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
      };
    });
    return { nodes, edges };
  }, [graph, activeId, evaluation]);

  if (!graph || !graph.nodes.length) return null;
  const active = activeId ? graph.nodes.find((n) => n.id === activeId) : null;
  const activeReached = active?.role === "intermediary" ? listedReachedVia(graph, active.id) : [];
  const listedCount = graph.nodes.filter((n) => n.role === "listed").length;
  const grouped = graph.nodes.filter(isSummary).sort((a, b) => (b.role === "more-listed") - (a.role === "more-listed"));
  const height = graph.nodes.length > 8 ? 620 : 420;

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="flex h-2 w-2 rounded-full bg-cyan-400"></span>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
              Interactive Multi-Hop Fund Flow Visualizer
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Who the screened wallet moved USDT with, and who they moved it with
            {evaluation.tokenStandard ? ` (${evaluation.tokenStandard} on ${evaluation.chainName})` : ""}. Drag to pan,
            scroll to zoom, click a wallet for details.
          </p>
          {Array.isArray(evaluation.networkFindings) && (
            <p className="text-[11px] mt-1 text-sky-300">
              This wallet is listed itself. The graph shows its network for investigation and doesn&apos;t change the score;
              hop 2 follows the wallets it sent the most to first, then its largest counterparties.
            </p>
          )}
          {/* Node truncation: say how many wallets are grouped instead of drawn */}
          <p className={`text-[11px] mt-1 ${grouped.length ? "text-amber-300" : "text-slate-500"}`}>
            {grouped.length ? "⚠ Graph truncated: " : ""}
            Shows at most {EXPOSURE_RULES.graphMaxNodes} wallets, every bad actor first (with the wallet that leads to it), then the
            largest clean ones.
            {grouped.map((n) => ` ${n.count.toLocaleString()} ${n.role === "more-listed" ? "less serious bad actors" : "other wallets"} are grouped into "${nodeTitle(n)}".`)}
            {grouped.length > 0 && " All findings are still in the findings list above."}
          </p>
        </div>
        <span className="px-2.5 py-1 text-xs font-mono font-medium rounded-full bg-slate-800 text-slate-300 border border-slate-700">
          {graph.nodes.length} wallets &bull; {listedCount} listed
        </span>
      </div>

      <div style={{ height }} className="rounded-xl border border-slate-800/80 bg-slate-950/60 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          colorMode="dark"
          style={{ "--xy-background-color": "transparent" }}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
          minZoom={0.2}
          nodesConnectable={false}
          onNodeClick={(_, n) => setActiveId(n.id === activeId ? null : n.id)}
          onPaneClick={() => setActiveId(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1E293B" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
        {[
          ["border-cyan-400", "Screened wallet"],
          ["border-orange-500", "Listed (sanctions / freeze / scam)"],
          ["border-sky-600", "Traced to hop 2"],
          ["border-slate-700", "Other counterparty"],
        ].map(([cls, text]) => (
          <span key={text} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm border-2 ${cls}`}></span>
            {text}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="rounded border border-red-500/50 bg-red-950/60 px-1 font-bold text-red-300">⚠ Leads to N listed</span>
          A traced wallet that connects to bad actors (click it to see them)
        </span>
        <span>→ sent by the nearer wallet &bull; ← received by it</span>
      </div>

      {/* Selected Node Details Drawer */}
      {active && (
        <div className="mt-4 p-4 rounded-xl bg-slate-800/70 border border-slate-700/80 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 text-xs">
          <div className="min-w-0">
            <span className="text-slate-400">{roleLabel(active)}: </span>
            <span className="font-bold text-white">{nodeTitle(active, evaluation.sender?.entity)}</span>
            {!isSummary(active) && <span className="ml-2 font-mono text-cyan-300 break-all">({active.id})</span>}
            <p className="text-slate-300 mt-1">
              {active.risk?.label && (
                <>
                  Category: <span className="font-semibold text-white">{active.risk.label}</span>
                  {active.risk.providers?.length > 0 && <> &bull; {active.risk.providers.join(", ")}</>} &bull;{" "}
                </>
              )}
              Volume: {usd(active.volumeUsd)}
              {active.txCount != null && <> &bull; {active.txCount} transfers</>}
              {active.truncated && <> &bull; traced on its newest 1,000 transfers per direction</>}
            </p>
            {activeReached.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-red-300">
                  Listed wallets reached through this wallet ({activeReached.length})
                </p>
                {activeReached.map(({ target, edge }) => (
                  <div key={target.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                    <span className={`font-bold ${LEVEL_STYLE[target.risk.level]?.text || "text-red-300"}`}>{target.risk.level}</span>
                    <button
                      type="button"
                      onClick={() => setActiveId(target.id)}
                      className="font-semibold text-white hover:underline"
                    >
                      {target.risk.entity}
                    </button>
                    <span className="text-slate-400">{target.risk.label}</span>
                    <span className="font-mono text-slate-300">
                      {[edge.outUsd > 0 && `sent it ${usd(edge.outUsd)}`, edge.inUsd > 0 && `received ${usd(edge.inUsd)} from it`]
                        .filter(Boolean)
                        .join(" • ")}
                    </span>
                    <a
                      href={getExplorerAddressUrl(evaluation.chain || "TRON", target.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-cyan-400 hover:underline"
                    >
                      {truncateAddress(target.id)} &#x2197;
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isSummary(active) && (
              <a
                href={getExplorerAddressUrl(evaluation.chain || "TRON", active.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-600/30 transition-colors flex items-center gap-1"
              >
                {evaluation.chain || "Blockchain"} Explorer &rarr;
              </a>
            )}
            <button
              onClick={() => setActiveId(null)}
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
