import { test } from "node:test";
import assert from "node:assert/strict";
import { mixerPoolPattern, mixerSignals } from "./mixer.js";
import { buildBehaviour } from "./behaviourCore.js";

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const MIN = 60_000;
const t = (cp, dir, usd, minutesAgo) => ({ cp, dir, usd, ts: NOW - minutesAgo * MIN, tx: `${cp}-${dir}-${minutesAgo}` });
const many = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const FULL = { in: false, out: false };
const call = (p) => p;

/** A Tornado-style pool: `n` wallets deposit the same amounts, `n` other wallets withdraw a little less (relayer fee). */
const poolTransfers = (n = 30, amounts = [100]) => [
  ...many(n, (i) => t(`DEP${i}`, "in", amounts[i % amounts.length], 1000 + i)),
  ...many(n, (i) => t(`WD${i}`, "out", amounts[i % amounts.length] - 0.37, 500 + i)),
];
const pool = (n, amounts) => ({ transfers: poolTransfers(n, amounts), truncated: FULL });

function deps({ world = {}, contracts = [], listed = [], isContract, ...over } = {}) {
  return {
    isContract: isContract || (async (a) => contracts.includes(a)),
    getHistory: async (a) => world[a] || { transfers: [], truncated: FULL },
    getRisk: async (a) => (listed.includes(a) ? { entity: "Tornado Cash", providers: ["x"], severe: true, risk: { id: "MIXER" } } : null),
    ...over,
  };
}

// ---- the pool pattern

test("pattern: 30 wallets deposit exactly $100, 30 others withdraw -> match", () => {
  const p = mixerPoolPattern(poolTransfers(30, [100]));
  assert.deepEqual(p.amounts, [100]);
  assert.equal(p.depositors, 30);
  assert.equal(p.recipients, 30);
  assert.equal(p.fixedShare, 1);
});

test("pattern: two pool sizes ($100 and $1,000) -> match with both amounts", () => {
  assert.deepEqual(mixerPoolPattern(poolTransfers(40, [100, 1000])).amounts.sort((a, b) => a - b), [100, 1000]);
});

test("pattern: DEX-router-like, every deposit a different amount -> null", () => {
  const tx = [...many(40, (i) => t(`U${i}`, "in", 137 + i * 11.3, 900 + i)), ...many(40, (i) => t(`R${i}`, "out", 150 + i, 400 + i))];
  assert.equal(mixerPoolPattern(tx), null);
});

test("pattern: payroll contract, one payer funds 40 equal salaries -> null (too few depositors)", () => {
  const tx = [...many(30, (i) => t("EMPLOYER", "in", 5000, 900 + i)), ...many(40, (i) => t(`EMP${i}`, "out", 3000, 400 + i))];
  assert.equal(mixerPoolPattern(tx), null);
});

test("pattern: fixed amounts in from many, but paid out to only 2 wallets -> null (collector, not a pool)", () => {
  const tx = [...many(40, (i) => t(`U${i}`, "in", 100, 900 + i)), t("A", "out", 2000, 10), t("B", "out", 2000, 5)];
  assert.equal(mixerPoolPattern(tx), null);
});

test("pattern: only 10 deposits -> null", () => {
  assert.equal(mixerPoolPattern(poolTransfers(10)), null);
});

test("pattern: dust deposits don't count toward the deposit minimum", () => {
  const tx = [...many(40, (i) => t(`P${i}`, "in", 1, 900 + i)), ...many(40, (i) => t(`R${i}`, "out", 50, 400 + i))];
  assert.equal(mixerPoolPattern(tx), null);
});

test("pattern: 70% fixed amounts is below the 80% bar -> null", () => {
  const tx = [
    ...many(28, (i) => t(`F${i}`, "in", 100, 900 + i)),
    ...many(12, (i) => t(`V${i}`, "in", 211 + i * 7, 800 + i)),
    ...many(30, (i) => t(`R${i}`, "out", 99, 400 + i)),
  ];
  assert.equal(mixerPoolPattern(tx), null);
});

// ---- counterparties and the wallet itself

test("sent $1,000 into an unlisted pool contract -> MIXER_LIKE_COUNTERPARTY MEDIUM", async () => {
  const history = { transfers: [t("A", "in", 1200, 900), t("POOL", "out", 1000, 600)], truncated: FULL };
  const r = await mixerSignals("ME", history, deps({ world: { POOL: pool(30, [1000]) }, contracts: ["POOL"] }), call);
  assert.equal(r.status, "complete");
  assert.equal(r.signals.length, 1);
  const [s] = r.signals;
  assert.equal(s.type, "MIXER_LIKE_COUNTERPARTY");
  assert.equal(s.level, "MEDIUM");
  assert.equal(s.evidence.contract, "POOL");
  assert.match(s.reason, /sent \$1,000 to POOL/);
});

test("received a withdrawal from an unlisted pool contract -> reason says received", async () => {
  const history = { transfers: [t("POOL", "in", 99.63, 600)], truncated: FULL };
  const r = await mixerSignals("ME", history, deps({ world: { POOL: pool(30, [100]) }, contracts: ["POOL"] }), call);
  assert.match(r.signals[0].reason, /received \$100 from POOL/);
});

test("pool pattern on an ordinary wallet (not a contract) -> no signal", async () => {
  const history = { transfers: [t("HUMAN", "out", 1000, 600)], truncated: FULL };
  const r = await mixerSignals("ME", history, deps({ world: { HUMAN: pool(30, [1000]) } }), call);
  assert.deepEqual(r.signals, []);
});

test("a listed counterparty (known Tornado pool) is left to exposure -> no behaviour signal, history not read", async () => {
  const history = { transfers: [t("TORNADO", "out", 1000, 600)], truncated: FULL };
  let read = 0;
  const d = deps({ contracts: ["TORNADO"], listed: ["TORNADO"], getHistory: async () => (read++, pool(30, [1000])) });
  const r = await mixerSignals("ME", history, d, call);
  assert.deepEqual(r.signals, []);
  assert.equal(read, 0);
});

test("TRON (contract check unsupported) -> skipped, no lookups", async () => {
  let looked = 0;
  const d = deps({ isContract: async () => null, getHistory: async () => (looked++, pool()) });
  const r = await mixerSignals("ME", { transfers: [t("X", "out", 1000, 600)], truncated: FULL }, d, call);
  assert.equal(r.status, "skipped");
  assert.deepEqual(r.signals, []);
  assert.equal(looked, 0);
});

test("screened address is itself a pool contract -> MIXER_LIKE MEDIUM", async () => {
  const r = await mixerSignals("ME", pool(30, [100]), deps({ contracts: ["ME"] }), call);
  assert.deepEqual(r.signals.map((s) => s.type), ["MIXER_LIKE"]);
  assert.match(r.signals[0].reason, /30 wallets paid in, 100% of deposits in the same amount \(\$100\)/);
});

test("contract check fails for a counterparty -> status partial, no signal", async () => {
  const d = deps({ isContract: async (a) => { if (a === "X") throw new Error("rpc down"); return false; } });
  const r = await mixerSignals("ME", { transfers: [t("X", "out", 1000, 600)], truncated: FULL }, d, call);
  assert.equal(r.status, "partial");
  assert.deepEqual(r.signals, []);
});

test("only the 5 largest counterparties are checked", async () => {
  const history = { transfers: many(8, (i) => t(`C${i}`, "out", 1000 + i * 100, 600 + i)), truncated: FULL };
  const checked = [];
  await mixerSignals("ME", history, deps({ isContract: async (a) => (checked.push(a), false) }), call);
  assert.deepEqual(checked.filter((a) => a !== "ME").sort(), ["C3", "C4", "C5", "C6", "C7"]);
});

// ---- entry router in front of the pool (how Tornado Cash takes deposits)

/** Router: `n` wallets deposit fixed amounts, everything forwarded to POOL (like the real Tornado router). */
const router = (n = 30, target = "POOL") => ({
  transfers: [...many(n, (i) => t(`U${i}`, "in", 100, 1000 + i)), ...many(n, (i) => t(target, "out", 100, 999 + i))],
  truncated: FULL,
});

test("deposited via an unlisted router whose target is a pool -> MIXER_LIKE_COUNTERPARTY naming both", async () => {
  const history = { transfers: [t("ROUTER", "out", 100, 600), t("ROUTER", "out", 100, 590)], truncated: FULL };
  const d = deps({ world: { ROUTER: router(), POOL: pool(30, [100]) }, contracts: ["ROUTER", "POOL"] });
  const [s] = (await mixerSignals("ME", history, d, call)).signals;
  assert.equal(s.type, "MIXER_LIKE_COUNTERPARTY");
  assert.equal(s.evidence.contract, "ROUTER");
  assert.equal(s.evidence.pool, "POOL");
  assert.match(s.reason, /sent \$200 to ROUTER, an unlisted contract that forwards fixed deposits to POOL/);
});

/** A pool fed only by its router (like the real Tornado 1000 USDT pool: 996 of 1,000 deposits from the router). */
const fedPool = (router = "ROUTER", n = 30) => ({
  transfers: [...many(n, (i) => t(router, "in", 100, 999 + i)), ...many(n, (i) => t(`WD${i}`, "out", 99.6, 500 + i))],
  truncated: FULL,
});

test("deposited via a router into a pool whose deposits all come from that router -> detected", async () => {
  const d = deps({ world: { ROUTER: router(30, "POOL"), POOL: fedPool() }, contracts: ["ROUTER", "POOL"] });
  const [s] = (await mixerSignals("ME", { transfers: [t("ROUTER", "out", 100, 600)], truncated: FULL }, d, call)).signals;
  assert.equal(s?.evidence.pool, "POOL");
  assert.equal(s.evidence.depositors, 30); // the wallets that paid the router, not the pool's 1 direct depositor
});

test("withdrew from a router-fed pool -> detected, naming the router the deposits come through", async () => {
  const d = deps({ world: { ROUTER: router(30, "POOL"), POOL: fedPool() }, contracts: ["ROUTER", "POOL"] });
  const [s] = (await mixerSignals("ME", { transfers: [t("POOL", "in", 99.6, 600)], truncated: FULL }, d, call)).signals;
  assert.equal(s?.type, "MIXER_LIKE_COUNTERPARTY");
  assert.equal(s.evidence.feeder, "ROUTER");
  assert.match(s.reason, /received \$100 from POOL, an unlisted contract that works like a mixer pool, with deposits coming through ROUTER/);
});

test("payroll contract: one employer wallet (not a contract) funds equal salaries to 40 people -> no signal", async () => {
  const payroll = { transfers: [...many(30, (i) => t("EMPLOYER", "in", 5000, 900 + i)), ...many(40, (i) => t(`EMP${i}`, "out", 3000, 400 + i))], truncated: FULL };
  const d = deps({ world: { PAYROLL: payroll }, contracts: ["PAYROLL"] });
  const r = await mixerSignals("ME", { transfers: [t("PAYROLL", "in", 3000, 300)], truncated: FULL }, d, call);
  assert.deepEqual(r.signals, []);
});

test("router-shaped contract whose target is a treasury, not a pool -> no signal (subscription / payment collector)", async () => {
  const treasury = { transfers: [...many(30, (i) => t("ROUTER", "in", 100, 999 + i)), t("COLD", "out", 3000, 10)], truncated: FULL };
  const d = deps({ world: { ROUTER: router(30, "TREASURY"), TREASURY: treasury }, contracts: ["ROUTER", "TREASURY"] });
  const r = await mixerSignals("ME", { transfers: [t("ROUTER", "out", 100, 600)], truncated: FULL }, d, call);
  assert.deepEqual(r.signals, []);
});

test("router chains stop after one step: router -> router -> pool is not followed", async () => {
  const d = deps({ world: { R1: router(30, "R2"), R2: router(30, "POOL"), POOL: pool() }, contracts: ["R1", "R2", "POOL"] });
  const r = await mixerSignals("ME", { transfers: [t("R1", "out", 100, 600)], truncated: FULL }, d, call);
  assert.deepEqual(r.signals, []);
});

// ---- in the full behaviour result

test("buildBehaviour: mixer-like counterparty shows up as an indicator, coverage.mixer complete", async () => {
  const history = { transfers: [t("A", "in", 1200, 900), t("POOL", "out", 1000, 600)], truncated: FULL };
  const r = await buildBehaviour({
    address: "ME",
    history,
    now: NOW,
    deadline: Date.now() + 10_000,
    deps: {
      findFirstFunder: async () => null,
      getWalletAge: async () => ({ createdAt: null, source: "unknown" }),
      countFundedWallets: async () => ({ wallets: 0, truncated: false }),
      getAge: async () => null,
      ...deps({ world: { POOL: pool(30, [1000]) }, contracts: ["POOL"] }),
    },
  });
  const ind = r.indicators.find((i) => i.type === "MIXER_LIKE_COUNTERPARTY");
  assert.equal(ind.severity, "MEDIUM");
  assert.equal(ind.categoryLabel, "Dealt with a mixer-like contract");
  assert.equal(r.coverage.mixer, "complete");
});
