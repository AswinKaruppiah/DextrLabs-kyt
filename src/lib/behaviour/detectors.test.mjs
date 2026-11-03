import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectPassThrough,
  detectFanPattern,
  detectNewWallet,
  detectPoisoner,
  detectPoisoningTarget,
  detectStructuring,
  walletAgeDays,
  earliestActivity,
  holdStats,
  combineSignals,
} from "./detectors.js";

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const MIN = 60_000;
const DAY = 86_400_000;
const t = (cp, dir, usd, minutesAgo) => ({ cp, dir, usd, ts: NOW - minutesAgo * MIN, tx: `${cp}-${minutesAgo}` });
const many = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const FULL = { in: false, out: false };

// ---- pass-through

test("passThrough: 3 cycles of $5k in, out after 10 min -> MEDIUM", () => {
  const tx = [
    t("A", "in", 5000, 100), t("B", "out", 4950, 90),
    t("A", "in", 5000, 80), t("B", "out", 4950, 70),
    t("A", "in", 5000, 60), t("B", "out", 4950, 50),
  ];
  const s = detectPassThrough(tx);
  assert.equal(s.type, "PASS_THROUGH");
  assert.equal(s.level, "MEDIUM");
  assert.equal(s.evidence.medianHoldMinutes, 10);
  assert.equal(s.evidence.cycles, 3);
  assert.equal(s.evidence.targets[0].address, "B");
  assert.match(s.reason, /10 min/);
});

test("passThrough: money held 3 days -> null", () => {
  const tx = [
    t("A", "in", 5000, 3 * 1440 + 300), t("B", "out", 4950, 300),
    t("A", "in", 5000, 3 * 1440 + 200), t("B", "out", 4950, 200),
    t("A", "in", 5000, 3 * 1440 + 100), t("B", "out", 4950, 100),
  ];
  assert.equal(detectPassThrough(tx), null);
});

test("passThrough: out/in = 0.5 -> null", () => {
  const tx = [
    t("A", "in", 5000, 100), t("B", "out", 2500, 90),
    t("A", "in", 5000, 80), t("B", "out", 2500, 70),
    t("A", "in", 5000, 60), t("B", "out", 2500, 50),
  ];
  assert.equal(detectPassThrough(tx), null);
});

test("passThrough: only 2 cycles -> null", () => {
  const tx = [t("A", "in", 5000, 100), t("B", "out", 4950, 90), t("A", "in", 5000, 80), t("B", "out", 4950, 70)];
  assert.equal(detectPassThrough(tx), null);
});

test("holdStats: $1000 in, all out 30 min later -> ratio 1, median 30", () => {
  const h = holdStats([t("A", "in", 1000, 60), t("B", "out", 1000, 30)]);
  assert.equal(h.ratio, 1);
  assert.equal(h.medianHoldMinutes, 30);
});

// ---- fan-in / fan-out

test("fan: 60 senders x $200, forwarded to 1 wallet -> COLLECTOR MEDIUM", () => {
  const tx = [...many(60, (i) => t(`S${i}`, "in", 200, 500 + i)), t("B", "out", 11_500, 10)];
  const s = detectFanPattern(tx);
  assert.equal(s.type, "COLLECTOR");
  assert.equal(s.level, "MEDIUM");
  assert.equal(s.evidence.senders, 60);
  assert.equal(s.evidence.targets[0].address, "B");
});

test("fan: collector that keeps the money (forwards 50%) -> null", () => {
  const tx = [...many(60, (i) => t(`S${i}`, "in", 200, 500 + i)), t("B", "out", 6000, 10)];
  assert.equal(detectFanPattern(tx), null);
});

test("fan: 1 sender, 60 recipients -> DISTRIBUTOR MEDIUM", () => {
  const tx = [t("A", "in", 12_000, 500), ...many(60, (i) => t(`R${i}`, "out", 200, 400 - i))];
  const s = detectFanPattern(tx);
  assert.equal(s.type, "DISTRIBUTOR");
  assert.equal(s.level, "MEDIUM");
  assert.equal(s.evidence.recipients, 60);
});

test("fan: 60 dust senders (< $10) do not count as senders -> null", () => {
  const tx = [...many(60, (i) => t(`D${i}`, "in", 5, 600 + i)), t("A", "in", 2000, 100), t("B", "out", 1900, 50)];
  assert.equal(detectFanPattern(tx), null);
});

// ---- wallet age / new wallet

test("newWallet: createdAt 2 days ago, $20k moved -> MEDIUM, reason says '2 days old'", () => {
  const s = detectNewWallet([t("A", "in", 20_000, 60)], { createdAt: NOW - 2 * DAY, truncated: FULL }, NOW);
  assert.equal(s.type, "NEW_WALLET_HIGH_VOLUME");
  assert.equal(s.level, "MEDIUM");
  assert.equal(s.evidence.ageDays, 2);
  assert.equal(s.evidence.volumeUsd, 20_000);
  assert.match(s.reason, /2 days old/);
});

test("newWallet: createdAt 400 days ago, $20k moved -> null", () => {
  assert.equal(detectNewWallet([t("A", "in", 20_000, 60)], { createdAt: NOW - 400 * DAY, truncated: FULL }, NOW), null);
});

test("newWallet: 2 days old but only $5k moved -> null", () => {
  assert.equal(detectNewWallet([t("A", "in", 5000, 60)], { createdAt: NOW - 2 * DAY, truncated: FULL }, NOW), null);
});

test("newWallet: no createdAt, oldest transfer 2 days ago, not truncated -> MEDIUM", () => {
  const tx = [t("A", "in", 15_000, 2 * 1440), t("B", "out", 14_000, 60)];
  assert.equal(detectNewWallet(tx, { createdAt: null, truncated: FULL }, NOW)?.level, "MEDIUM");
});

test("newWallet ignores truncated history without createdAt", () => {
  const tx = [t("A", "in", 15_000, 2 * 1440), t("B", "out", 14_000, 60)];
  assert.equal(detectNewWallet(tx, { createdAt: null, truncated: { in: true, out: false } }, NOW), null);
});

test("newWallet uses createdAt even when history is truncated", () => {
  const tx = [t("A", "in", 15_000, 60)];
  const s = detectNewWallet(tx, { createdAt: NOW - 2 * DAY, truncated: { in: true, out: true } }, NOW);
  assert.equal(s?.level, "MEDIUM");
});

test("newWallet: first gas 1 day ago but USDT history goes back 700 days -> null (older activity wins)", () => {
  const tx = [t("A", "in", 30_000, 700 * 1440), t("B", "out", 100, 60)];
  assert.equal(detectNewWallet(tx, { createdAt: NOW - 1 * DAY, truncated: FULL }, NOW), null);
});

test("earliestActivity: the older of createdAt and the oldest transfer", () => {
  assert.equal(earliestActivity(NOW - DAY, [t("A", "in", 5, 700 * 1440)]), NOW - 700 * DAY);
  assert.equal(earliestActivity(NOW - DAY, [t("A", "in", 5, 60)]), NOW - DAY);
  assert.equal(earliestActivity(null, []), null);
});

test("walletAgeDays: 36h ago -> 1; null -> null", () => {
  assert.equal(walletAgeDays(NOW - 36 * 3_600_000, NOW), 1);
  assert.equal(walletAgeDays(null, NOW), null);
});

// ---- address poisoning

test("poisoner: 25 outgoing $0.001 to 25 wallets -> MEDIUM", () => {
  const s = detectPoisoner(many(25, (i) => t(`P${i}`, "out", 0.001, i)));
  assert.equal(s.type, "POISONER");
  assert.equal(s.level, "MEDIUM");
  assert.equal(s.evidence.targets, 25);
});

test("poisoner: dust is only half of the wallet's outgoing transfers -> null", () => {
  const tx = [...many(25, (i) => t(`P${i}`, "out", 0.001, i)), ...many(25, (i) => t(`R${i}`, "out", 500, 100 + i))];
  assert.equal(detectPoisoner(tx), null);
});

const SELF = "TSelfSelfSelfSelfSelfSelfSelfSel1";
const REAL = "TXyzAbcdefghijkmnopqrstuvwxyz9aKp"; // 34 chars
const FAKE = "TXyzAQQQQQQQQQQQQQQQQQQQQQQQQ9aKp"; // same first 5 / last 4

test("poisoningTarget: dust from lookalike of a real counterparty -> INFO", () => {
  const s = detectPoisoningTarget([t(REAL, "out", 500, 100), t(FAKE, "in", 0.5, 90)], SELF);
  assert.equal(s.type, "POISONING_TARGET");
  assert.equal(s.level, "INFO");
  assert.equal(s.evidence.lookalike, FAKE);
  assert.equal(s.evidence.real, REAL);
});

test("poisoningTarget: TRON comparison is case-sensitive", () => {
  const otherCase = "TXYZAQQQQQQQQQQQQQQQQQQQQQQQQ9AKP";
  assert.equal(detectPoisoningTarget([t(REAL, "out", 500, 100), t(otherCase, "in", 0.5, 90)], SELF), null);
});

test("poisoningTarget compares EVM case-insensitively", () => {
  const real = "0xabcd" + "1".repeat(32) + "ef12";
  const fake = "0xABCD" + "9".repeat(32) + "EF12";
  const s = detectPoisoningTarget([t(real, "out", 500, 100), t(fake, "in", 0, 90)], "0x" + "5".repeat(40));
  assert.equal(s?.evidence.real, real);
});

// ---- structuring

test("structuring: 6 transfers of $950-$999 within 12h -> MEDIUM", () => {
  const amounts = [950, 960, 975, 990, 999, 980];
  const s = detectStructuring(amounts.map((usd, i) => t(`S${i}`, "in", usd, i * 120)));
  assert.equal(s.type, "STRUCTURING");
  assert.equal(s.level, "MEDIUM");
  assert.equal(s.evidence.count, 6);
});

test("structuring: 6 such transfers spread over 10 days -> null", () => {
  assert.equal(detectStructuring(many(6, (i) => t(`S${i}`, "in", 990, i * 2 * 1440))), null);
});

test("structuring: exactly $1,000 is not 'just below' -> null", () => {
  assert.equal(detectStructuring(many(6, (i) => t(`S${i}`, "in", 1000, i * 60))), null);
});

test("structuring: P2P buyer forwarding 3 x $990 lots to an exchange -> null (directions counted separately)", () => {
  const tx = [
    t("seller1", "in", 990, 360), t("deposit", "out", 990, 355),
    t("seller2", "in", 990, 240), t("deposit", "out", 990, 235),
    t("seller3", "in", 990, 120), t("deposit", "out", 990, 115),
  ];
  assert.equal(detectStructuring(tx), null);
});

test("structuring: $2,700-$2,999 band also counts", () => {
  assert.equal(detectStructuring(many(5, (i) => t(`S${i}`, "out", 2950, i * 60)))?.type, "STRUCTURING");
});

// ---- edge cases

test("all detectors return null on empty and dust-only history", () => {
  for (const tx of [[], many(10, (i) => t(`D${i}`, "in", 1, i))]) {
    assert.equal(detectPassThrough(tx), null);
    assert.equal(detectFanPattern(tx), null);
    assert.equal(detectNewWallet(tx, { createdAt: null, truncated: FULL }, NOW), null);
    assert.equal(detectPoisoner(tx), null);
    assert.equal(detectPoisoningTarget(tx, SELF), null);
    assert.equal(detectStructuring(tx), null);
  }
});

test("below minVolumeUsd every detector except poisoner and poisoningTarget returns null", () => {
  // Pass-through and collector shapes, but small amounts (in + out under $1,000).
  const pass = [
    t("A", "in", 100, 100), t("B", "out", 100, 95),
    t("A", "in", 100, 80), t("B", "out", 100, 75),
    t("A", "in", 100, 60), t("B", "out", 100, 55),
  ];
  assert.equal(detectPassThrough(pass), null);
  const fan = [...many(52, (i) => t(`S${i}`, "in", 10, 500 + i)), t("B", "out", 470, 10)]; // $990 total
  assert.equal(detectFanPattern(fan), null);
});

// ---- combining

test("combineSignals: two MEDIUM -> HIGH combined; one MEDIUM + INFO -> MEDIUM; [] -> null", () => {
  const m = { level: "MEDIUM" };
  assert.deepEqual(combineSignals([m, { level: "MEDIUM" }]), { level: "HIGH", combined: true });
  assert.deepEqual(combineSignals([m, { level: "INFO" }, null]), { level: "MEDIUM", combined: false });
  assert.deepEqual(combineSignals([{ level: "HIGH" }]), { level: "HIGH", combined: false });
  assert.deepEqual(combineSignals([]), { level: null, combined: false });
});
