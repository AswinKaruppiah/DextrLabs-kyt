import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBehaviour } from "./behaviourCore.js";

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const MIN = 60_000;
const DAY = 86_400_000;
const t = (cp, dir, usd, minutesAgo) => ({ cp, dir, usd, ts: NOW - minutesAgo * MIN, tx: `${cp}-${dir}-${minutesAgo}` });
const many = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const FULL = { in: false, out: false };
const hubHistory = { transfers: many(600, (i) => t(`U${i}`, "in", 100, 1000 + i)), truncated: FULL };

/** Fake lookups. `world` maps address -> USDT history; the rest are per-test overrides. */
function fakeDeps({ world = {}, funding = null, createdAt = null, funded = { wallets: 0, truncated: false }, ...over } = {}) {
  return {
    findFirstFunder: async () => funding,
    getWalletAge: async () => (createdAt ? { createdAt, source: "account" } : { createdAt: null, source: "unknown" }),
    countFundedWallets: async () => funded,
    getHistory: async (a) => world[a] || { transfers: [], truncated: FULL },
    getRisk: async () => null,
    getAge: async () => null,
    isContract: async () => false,
    ...over,
  };
}

const run = (history, deps, deadline = Date.now() + 10_000) =>
  buildBehaviour({ address: "D", history, now: NOW, deadline, deps });

test("exchange deposit address: collector sweeping to a hub, gas from a filler wallet -> nothing above INFO", async () => {
  const history = {
    transfers: [...many(60, (i) => t(`S${i}`, "in", 200, 500 + i)), t("HOT", "out", 11_500, 10)],
    truncated: FULL,
  };
  const deps = fakeDeps({
    world: { HOT: hubHistory, G: { transfers: [], truncated: FULL } }, // gas filler holds no USDT
    funding: { funder: "G", ts: NOW - DAY, tx: "g1" },
    createdAt: NOW - DAY,
    funded: { wallets: 200, truncated: true },
  });
  const r = await run(history, deps);
  assert.deepEqual(r.indicators.filter((i) => i.score > 0).map((i) => i.type), []);
  assert.ok(r.indicators.some((i) => i.type === "DEPOSIT_ADDRESS"));
});

test("pass-through into a listed busy address (a mixer router) is not called an exchange deposit address", async () => {
  const history = {
    transfers: [
      t("A", "in", 500, 100), t("ROUTER", "out", 500, 90),
      t("A", "in", 500, 80), t("ROUTER", "out", 500, 70),
      t("A", "in", 500, 60), t("ROUTER", "out", 500, 50),
    ],
    truncated: FULL,
  };
  const deps = fakeDeps({
    world: { ROUTER: hubHistory },
    getRisk: async (a) => (a === "ROUTER" ? { entity: "Tornado Cash — router", providers: ["x"], severe: true, risk: { id: "MIXER" } } : null),
  });
  const r = await run(history, deps);
  assert.ok(!r.indicators.some((i) => i.type === "DEPOSIT_ADDRESS"));
  assert.equal(r.indicators.find((i) => i.type === "PASS_THROUGH")?.severity, "INFO"); // pattern only: shown, not scored
});

test("two pattern-only red flags (pass-through + new wallet) are shown but not scored: no HIGH", async () => {
  const history = {
    transfers: many(6, (i) => [t("A", "in", 5000, 300 - i * 20), t("B", "out", 4990, 290 - i * 20)]).flat(),
    truncated: FULL,
  };
  const r = await run(history, fakeDeps({ createdAt: NOW - 2 * DAY }));
  const types = r.indicators.map((i) => i.type);
  assert.ok(types.includes("PASS_THROUGH") && types.includes("NEW_WALLET_HIGH_VOLUME"));
  assert.ok(r.indicators.every((i) => i.score === 0));
  assert.equal(r.combined, false);
  assert.match(r.indicators.find((i) => i.type === "PASS_THROUGH").reason, /not scored/);
});

test("wallet factory: funder paid 30 wallets, this one funded 2 days ago -> WALLET_FACTORY MEDIUM", async () => {
  const history = { transfers: [t("A", "in", 300, 600)], truncated: FULL };
  const deps = fakeDeps({ funding: { funder: "F", ts: NOW - 2 * DAY, tx: "f1" }, createdAt: NOW - 2 * DAY, funded: { wallets: 30, truncated: false } });
  const r = await run(history, deps);
  assert.equal(r.indicators.find((i) => i.type === "WALLET_FACTORY")?.severity, "MEDIUM");
});

test("wallet factory is not checked for a wallet funded 4 years ago", async () => {
  const history = { transfers: [t("A", "in", 300, 600)], truncated: FULL };
  const deps = fakeDeps({ funding: { funder: "F", ts: NOW - 1460 * DAY, tx: "f1" }, createdAt: NOW - 1460 * DAY, funded: { wallets: 30, truncated: false } });
  const r = await run(history, deps);
  assert.ok(!r.indicators.some((i) => i.type === "WALLET_FACTORY"));
});

test("busy screened wallet (600 counterparties): no structuring / fan / pass-through, HIGH_ACTIVITY info", async () => {
  const history = {
    transfers: [...hubHistory.transfers, ...many(6, (i) => t(`J${i}`, "in", 990, i * 60))],
    truncated: FULL,
  };
  const r = await run(history, fakeDeps());
  assert.ok(!r.indicators.some((i) => ["STRUCTURING", "COLLECTOR", "PASS_THROUGH"].includes(i.type)));
  assert.equal(r.indicators.find((i) => i.type === "HIGH_ACTIVITY")?.severity, "INFO");
});

test("wallet age: USDT seen 700 days ago beats first gas 1 day ago", async () => {
  const history = { transfers: [t("A", "in", 30_000, 700 * 1440), t("B", "out", 100, 60)], truncated: FULL };
  const r = await run(history, fakeDeps({ createdAt: NOW - DAY }));
  assert.equal(r.wallet.ageDays, 700);
  assert.equal(r.wallet.ageSource, "first-transfer");
  assert.ok(!r.indicators.some((i) => i.type === "NEW_WALLET_HIGH_VOLUME"));
});

test("funder lookup throws -> coverage.funder unavailable, no throw", async () => {
  const deps = fakeDeps({ findFirstFunder: async () => { throw new Error("down"); } });
  const r = await run({ transfers: [t("A", "in", 300, 60)], truncated: FULL }, deps);
  assert.equal(r.coverage.funder, "unavailable");
});

test("funder found but its checks fail -> funder stays 'found', funderChecks 'unavailable'", async () => {
  const deps = fakeDeps({
    funding: { funder: "F", ts: NOW - 2 * DAY, tx: "f1" },
    createdAt: NOW - 2 * DAY,
    countFundedWallets: async () => { throw new Error("down"); },
  });
  const r = await run({ transfers: [t("A", "in", 300, 60)], truncated: FULL }, deps);
  assert.equal(r.coverage.funder, "found");
  assert.equal(r.coverage.funderChecks, "unavailable");
  assert.equal(r.wallet.funder.address, "F");
});

test("behaviour work respects the deadline even if a lookup hangs", async () => {
  const deps = fakeDeps({ findFirstFunder: () => new Promise(() => {}) });
  const started = Date.now();
  const r = await run({ transfers: [t("A", "in", 300, 60)], truncated: FULL }, deps, Date.now() + 300);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  assert.equal(r.coverage.funder, "unavailable");
});

test("no transfer history -> skipped, age still reported", async () => {
  const r = await run(null, fakeDeps({ createdAt: NOW - 3 * DAY }));
  assert.equal(r.coverage.status, "skipped");
  assert.equal(r.wallet.ageDays, 3);
  assert.deepEqual(r.indicators, []);
});

test("truncated history, no creation record -> age unknown, not the oldest transfer read", async () => {
  // A busy wallet: only its newest transfers (the last 12 days) were read in one direction.
  const history = { transfers: many(40, (i) => t(`C${i}`, "in", 500, (i + 1) * 300)), truncated: { in: true, out: false } };
  const r = await run(history, fakeDeps());
  assert.equal(r.wallet.ageDays, null);
  assert.equal(r.indicators.some((s) => s.type === "NEW_WALLET_HIGH_VOLUME"), false);
});

test("complete history, no creation record -> age from the oldest transfer", async () => {
  const history = { transfers: [t("A", "in", 300, 3 * 1440)], truncated: FULL };
  const r = await run(history, fakeDeps());
  assert.equal(r.wallet.ageDays, 3);
  assert.equal(r.wallet.ageSource, "first-transfer");
});

test("distributor paying a hub is not relabelled an exchange deposit address", async () => {
  // One funder in, 60 recipients out; the largest recipient is an exchange-like hub.
  const history = {
    transfers: [t("SRC", "in", 70_000, 3000), t("HOT", "out", 9_000, 100), ...many(60, (i) => t(`R${i}`, "out", 900, 200 + i))],
    truncated: FULL,
  };
  const r = await run(history, fakeDeps({ world: { HOT: hubHistory } }));
  const types = r.indicators.map((i) => i.type);
  assert.ok(types.includes("DISTRIBUTOR"), `got ${types}`);
  assert.equal(types.includes("DEPOSIT_ADDRESS"), false);
});
