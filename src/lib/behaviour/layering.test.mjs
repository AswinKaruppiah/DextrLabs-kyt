import { test } from "node:test";
import assert from "node:assert/strict";
import { traceLayering, layeringSignal } from "./layering.js";

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const MIN = 60_000;
const DAY = 86_400_000;
const t = (cp, dir, usd, minutesAgo) => ({ cp, dir, usd, ts: NOW - minutesAgo * MIN, tx: `${cp}-${dir}-${minutesAgo}` });
const FULL = { in: false, out: false };

const SANCTIONED = { category: "SANCTIONS", severe: true, entity: "Garantex", providers: ["EU"], risk: { id: "SANCTIONS_DESIGNATION" } };
const SCAM = { category: "SCAM_PHISHING", severe: false, entity: "Drainer", providers: ["ScamSniffer"], risk: { id: "PHISHING_SCAM" } };

/** world: address -> { transfers, createdAt, risk?, truncated?, error? } */
function deps(world) {
  const calls = [];
  return {
    calls,
    getHistory: async (a) => {
      calls.push(a);
      const w = world[a];
      if (!w) return { transfers: [], truncated: FULL };
      if (w.error) throw new Error("TronGrid down");
      return { transfers: w.transfers, truncated: w.truncated || FULL };
    },
    getAge: async (a) => world[a]?.createdAt ?? null,
    getRisk: async (a) => world[a]?.risk || null,
    deadline: Infinity,
    now: NOW,
  };
}

/** A fresh wallet that received $5,000 from `from` and passed it to `to` 15 minutes later. */
const layer = (from, to, minutesAgo, ageDays = 1) => ({
  createdAt: NOW - ageDays * DAY,
  transfers: [t(from, "in", 5000, minutesAgo), t(to, "out", 4950, minutesAgo - 15)],
});

test("back: sanctioned -> 3 fresh pass-through wallets -> screened  =>  LAYERED_FROM_LISTED HIGH, 3 layers", async () => {
  const world = {
    S: { risk: SANCTIONED, createdAt: NOW - 900 * DAY, transfers: [t("L1", "out", 5000, 200)] },
    L1: layer("S", "L2", 200),
    L2: layer("L1", "L3", 150),
    L3: layer("L2", "X", 100),
    X: { createdAt: NOW - 400 * DAY, transfers: [t("L3", "in", 4950, 85)] },
  };
  const back = await traceLayering("X", "back", deps(world));
  assert.deepEqual(back.layers.map((l) => l.address), ["L3", "L2", "L1"]);
  assert.equal(back.end.reason, "listed");
  assert.equal(back.end.address, "S");
  const s = layeringSignal(back, { layers: [], end: { reason: "not-a-layer" }, partial: false }, false);
  assert.equal(s.type, "LAYERED_FROM_LISTED");
  assert.equal(s.level, "HIGH");
  assert.match(s.reason, /Garantex/);
  assert.match(s.reason, /3 new wallets/);
});

test("forward: screened -> 2 fresh layers -> OSINT scam wallet  =>  LAYERED_TO_LISTED MEDIUM", async () => {
  const world = {
    X: { createdAt: NOW - 400 * DAY, transfers: [t("L1", "out", 5000, 300)] },
    L1: layer("X", "L2", 300),
    L2: layer("L1", "B", 250),
    B: { risk: SCAM, transfers: [] },
  };
  const fwd = await traceLayering("X", "forward", deps(world));
  assert.equal(fwd.layers.length, 2);
  assert.equal(fwd.end.reason, "listed");
  const s = layeringSignal({ layers: [], end: { reason: "not-a-layer" }, partial: false }, fwd, false);
  assert.equal(s.type, "LAYERED_TO_LISTED");
  assert.equal(s.level, "MEDIUM");
});

test("4 fresh pass-through wallets, no listed end  =>  LAYERING_CHAIN MEDIUM", async () => {
  const world = {
    O: { createdAt: NOW - 700 * DAY, transfers: [t("L4", "out", 5000, 400), t("job", "in", 9000, 9000)] },
    L4: layer("O", "L3", 400),
    L3: layer("L4", "L2", 350),
    L2: layer("L3", "L1", 300),
    L1: layer("L2", "X", 250),
    X: { createdAt: NOW - 400 * DAY, transfers: [t("L1", "in", 4950, 235)] },
  };
  const back = await traceLayering("X", "back", deps(world));
  assert.equal(back.layers.length, 4);
  assert.equal(back.end.reason, "not-a-layer");
  const s = layeringSignal(back, { layers: [], end: { reason: "not-a-layer" }, partial: false }, false);
  assert.equal(s.type, "LAYERING_CHAIN");
  assert.equal(s.level, "MEDIUM");
});

test("chain through a 2-year-old wallet stops there (not-a-layer)  =>  null", async () => {
  const world = {
    S: { risk: SANCTIONED, transfers: [] },
    OLD: layer("S", "X", 100, 730),
    X: { createdAt: NOW - 400 * DAY, transfers: [t("OLD", "in", 4950, 85)] },
  };
  const back = await traceLayering("X", "back", deps(world));
  assert.equal(back.layers.length, 0);
  assert.equal(back.end.reason, "not-a-layer");
  assert.equal(layeringSignal(back, { layers: [], end: {}, partial: false }, false), null);
});

test("chain reaching a hub stops (hub) and is not flagged", async () => {
  const hubTransfers = Array.from({ length: 600 }, (_, i) => t(`U${i}`, "in", 100, 1000 + i));
  const world = {
    H: { createdAt: NOW - 2 * DAY, transfers: [...hubTransfers, t("L1", "out", 5000, 200)] },
    L1: layer("H", "X", 200),
    X: { createdAt: NOW - 400 * DAY, transfers: [t("L1", "in", 4950, 185)] },
  };
  const back = await traceLayering("X", "back", deps(world));
  assert.equal(back.end.reason, "hub");
  assert.equal(back.end.address, "H");
  assert.equal(layeringSignal(back, { layers: [], end: {}, partial: false }, false), null);
});

test("split flow (largest counterparty only 30%) is not followed", async () => {
  const world = {
    X: {
      createdAt: NOW - 400 * DAY,
      transfers: [t("A", "in", 3000, 100), t("B", "in", 3000, 90), t("C", "in", 2000, 80), t("D", "in", 2000, 70)],
    },
    A: layer("S", "X", 110),
  };
  const d = deps(world);
  const back = await traceLayering("X", "back", d);
  assert.equal(back.layers.length, 0);
  assert.ok(!d.calls.includes("A"), "the 30% counterparty must not be fetched");
});

test("getHistory throws mid-path  =>  partial, signal from what was traced, no throw", async () => {
  const world = {
    L2: { error: true },
    L1: layer("L2", "X", 100),
    X: { createdAt: NOW - 400 * DAY, transfers: [t("L1", "in", 4950, 85)] },
  };
  const back = await traceLayering("X", "back", deps(world));
  assert.equal(back.partial, true);
  assert.equal(back.end.reason, "error");
  assert.deepEqual(back.layers.map((l) => l.address), ["L1"]);
});

test("cycle A->B->A does not loop forever", async () => {
  const world = {
    L1: layer("X", "X", 100),
    X: { createdAt: NOW - 1 * DAY, transfers: [t("L1", "in", 4950, 85), t("L1", "out", 5000, 100)] },
  };
  const back = await traceLayering("X", "back", deps(world));
  assert.ok(back.layers.length <= 1);
  assert.ok(back.end.reason);
});

test("screened wallet that is itself a layer joins back and forward rows", () => {
  const two = { layers: [{ address: "A" }, { address: "B" }].slice(0, 1), end: { reason: "not-a-layer" }, partial: false };
  // 1 back + screened + 1 forward = 3 in a row
  assert.equal(layeringSignal(two, two, true)?.type, "LAYERING_CHAIN");
  // without the screened wallet in the row, 1 and 1 are separate rows
  assert.equal(layeringSignal(two, two, false), null);
});
