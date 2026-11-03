"use client";

import React, { useState } from "react";
import { EXPOSURE_RULES as R } from "@/lib/exposure/rules";

const usd = (n) => `$${n.toLocaleString("en-US")}`;
const LIMIT = R.historyLimit.toLocaleString();

// The graph is truncated to graphMaxNodes; bad actors are placed first, so only clean / least serious wallets are grouped.
const GRAPH_NOTE =
  `Graph shows at most ${R.graphMaxNodes} wallets: every bad actor first (with the wallet that leads to it), then the largest clean ones. ` +
  `The rest are grouped into "+N more wallets" / "+N more listed wallets". Every finding is still in the findings list.`;

// What every check does, in order. Shown always, so users know how "good" or "bad" is decided.
const STEPS = [
  {
    id: "address",
    title: "Validate the address",
    text: "TRON addresses start with T (Base58). Ethereum and BSC addresses start with 0x (40 hex characters).",
  },
  {
    id: "own-listing",
    title: "Is the wallet itself on a list?",
    text: "The address is looked up in every list we collect. If it is sanctioned or frozen, the result is CRITICAL and the check stops.",
    chips: [
      "Tether USDT contract, live (TRON)",
      "Freeze lists: Tether, Circle, Paxos, TUSD",
      "Sanctions: OFAC, UN, EU, UK, IL-NBCTF",
      "Scam / phishing / hack labels",
    ],
  },
  {
    id: "hop1",
    title: "Who did it trade with? (hop 1)",
    text:
      `We read its newest ${R.historyLimit.toLocaleString()} incoming and ${R.historyLimit.toLocaleString()} outgoing USDT transfers ` +
      `and check every wallet on the other side against the same lists.`,
    chips: [
      "TRON: TronGrid · ETH / BSC: Alchemy",
      `Incoming transfers under ${usd(R.dustUsd)} ignored (dust / poisoning), unless those from one wallet add up to ${usd(R.dustSumUsd)} or more`,
      "Sending to a listed wallet always counts",
    ],
  },
  {
    id: "hop2",
    title: "Who did they trade with? (hop 2)",
    text:
      `For the ${R.hop2FanOut} largest clean counterparties (at least ${usd(R.hop2MinUsd)} moved), we read their transfers ` +
      `too and check their counterparties. If the wallet is listed itself, both hops still run for information ` +
      `(not scored), and hop 2 follows the wallets it sent the most to first.`,
    chips: [
      `Busy wallets (over ${LIMIT} transfers) are traced on their newest ${LIMIT} per direction`,
      { warn: true, text: GRAPH_NOTE },
      "In the graph, a traced wallet that connects to bad actors is marked ⚠ Leads to N listed; click it to see them",
      "History is cached for 24 h",
    ],
  },
  {
    id: "verdict",
    title: "Decide the result",
    text: "The most serious finding sets the level. Exposure alone never makes a wallet CRITICAL.",
    rules: [
      ["CRITICAL", "text-red-400", "The wallet itself is sanctioned or frozen"],
      [
        "HIGH",
        "text-orange-400",
        `Wallet labelled scam / hack, or traded directly with a sanctioned / frozen wallet: ≥ ${usd(R.highUsd)} or ≥ ${R.highPct}% of its volume`,
      ],
      [
        "MEDIUM",
        "text-amber-400",
        `Smaller direct exposure to a sanctioned / frozen wallet, large direct exposure to scam / hack wallets, or ≥ ${usd(R.highUsd)} between a counterparty and a sanctioned / frozen wallet at hop 2`,
      ],
      ["LOW", "text-emerald-400", "Nothing found, or only small scam / hack or hop-2 exposure (shown for context)"],
      ["UNKNOWN", "text-slate-300", "Nothing found, but the transfer history or live freeze check could not be fetched. Re-check before transacting"],
    ],
  },
];

/** "How this check works": the fixed screening steps, always visible so users know how "good" or "bad" is decided. */
export default function ScreeningStepsGuide() {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
          How this check works
        </span>
        <span className="text-xs text-slate-500">{open ? "Hide ▲" : "Show ▼"}</span>
      </button>

      {open && (
        <ol className="mt-4 space-y-4">
          {STEPS.map((step, i) => {
            return (
              <li key={step.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-cyan-500/50 bg-cyan-500/10 text-[11px] font-bold text-cyan-300">
                    {i + 1}
                  </span>
                  {i < STEPS.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-800" />}
                </div>

                <div className="min-w-0 flex-1 pb-1">
                  <span className="text-xs font-semibold text-white">
                    Step {i + 1}: {step.title}
                  </span>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{step.text}</p>

                  {step.chips && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {step.chips.map((c) => {
                        const { text, warn } = typeof c === "string" ? { text: c } : c;
                        return (
                          <span
                            key={text}
                            className={`rounded border px-2 py-0.5 text-[10px] ${
                              warn
                                ? "border-amber-500/50 bg-amber-950/50 font-semibold text-amber-300"
                                : "border-slate-700 bg-slate-900 text-slate-300"
                            }`}
                          >
                            {warn && "⚠ "}
                            {text}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {step.rules && (
                    <ul className="mt-1.5 space-y-1">
                      {step.rules.map(([level, cls, text]) => (
                        <li key={level} className="flex gap-2 text-[11px] text-slate-300">
                          <span className={`w-16 shrink-0 font-bold ${cls}`}>{level}</span>
                          <span>{text}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
