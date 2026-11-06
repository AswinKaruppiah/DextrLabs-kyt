import { test } from "node:test";
import assert from "node:assert/strict";
import { freezeTime } from "./freezeTime.js";

// Block timestamps are cached on globalThis; seeding it keeps these tests off the network.
const blockTimes = (globalThis.__kytBlockTimes ??= new Map());
blockTimes.set(26_301_278, Promise.resolve(Date.UTC(2026, 9, 31)));
blockTimes.set(20_000_000, Promise.resolve(Date.UTC(2024, 4, 19)));

const freeze = (over) => ({ category: "ISSUER_FREEZE", status: "active", listedAt: null, details: null, ...over });

test("Tether TRON: freeze time comes from listedAt", async () => {
  const at = await freezeTime({ sources: [freeze({ listedAt: "2020-06-26T15:22:39.000Z" })] });
  assert.equal(at, Date.parse("2020-06-26T15:22:39.000Z"));
});

test("Tether ETH: freeze block is turned into its timestamp", async () => {
  assert.equal(await freezeTime({ sources: [freeze({ details: { frozenAtBlock: 26_301_278 } })] }), Date.UTC(2026, 9, 31));
});

test("several issuers: the earliest freeze wins (Circle froze first)", async () => {
  const entry = {
    sources: [
      freeze({ details: { frozenAtBlock: 26_301_278 } }),
      freeze({ details: { freezes: { USDC: { tx: "0x1", block: 20_000_000 } } } }),
    ],
  };
  assert.equal(await freezeTime(entry), Date.UTC(2024, 4, 19));
});

test("removed freezes and non-freeze listings are ignored -> null", async () => {
  const entry = {
    sources: [
      freeze({ status: "removed", listedAt: "2021-01-01T00:00:00Z" }),
      { category: "SANCTIONS", status: "active", listedAt: "2022-08-08T00:00:00Z" },
    ],
  };
  assert.equal(await freezeTime(entry), null);
});
