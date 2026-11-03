import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTronFunder, parseEvmFunder, parseTronCreateTime, parseFundedWallets } from "./funder.js";

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const DAY = 86_400_000;

// USDT contract address as a known base58 <-> hex pair.
const SELF = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const SELF_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";
const FUNDER_HEX = "41" + "ab".repeat(20);

// Shape of TronGrid /v1/accounts/{addr}/transactions entries.
const tronTx = (txID, type, owner, to, ts) => ({
  txID,
  block_timestamp: ts,
  raw_data: { contract: [{ type, parameter: { value: { owner_address: owner, ...(to && { to_address: to }), amount: 5_000_000 } } }] },
  ret: [{ contractRet: "SUCCESS" }],
});

test("parseTronFunder: picks oldest TransferContract sent TO the address", () => {
  const json = {
    success: true,
    data: [
      tronTx("aaa", "TriggerSmartContract", "41" + "cd".repeat(20), null, 1000),
      tronTx("bbb", "TransferContract", FUNDER_HEX, SELF_HEX, 2000),
      tronTx("ccc", "TransferContract", "41" + "ef".repeat(20), SELF_HEX, 3000),
    ],
  };
  const f = parseTronFunder(json, SELF);
  assert.equal(f.tx, "bbb");
  assert.equal(f.ts, 2000);
  assert.equal(f.funder.length, 34);
  assert.ok(f.funder.startsWith("T"));
  assert.notEqual(f.funder, SELF);
});

test("parseTronFunder: no TransferContract -> null", () => {
  const json = { success: true, data: [tronTx("aaa", "TriggerSmartContract", FUNDER_HEX, null, 1000)] };
  assert.equal(parseTronFunder(json, SELF), null);
  assert.equal(parseTronFunder({ success: true, data: [] }, SELF), null);
});

test("parseEvmFunder: first transfer's from, lowercased; empty transfers -> null", () => {
  const result = {
    transfers: [{ from: "0xABCDEF0000000000000000000000000000000001", hash: "0xh1", metadata: { blockTimestamp: "2024-05-01T10:00:00.000Z" } }],
  };
  assert.deepEqual(parseEvmFunder(result), {
    funder: "0xabcdef0000000000000000000000000000000001",
    tx: "0xh1",
    ts: Date.parse("2024-05-01T10:00:00.000Z"),
  });
  assert.equal(parseEvmFunder({ transfers: [] }), null);
});

test("parseTronCreateTime: {data:[{create_time: 1700000000000}]} -> 1700000000000; {data:[]} -> null", () => {
  assert.equal(parseTronCreateTime({ success: true, data: [{ create_time: 1_700_000_000_000 }] }), 1_700_000_000_000);
  assert.equal(parseTronCreateTime({ success: true, data: [] }), null);
});

test("parseFundedWallets: 25 TRX sends to 25 wallets in last 10 days -> wallets 25", () => {
  const data = Array.from({ length: 25 }, (_, i) =>
    tronTx(`t${i}`, "TransferContract", FUNDER_HEX, "41" + i.toString(16).padStart(40, "0"), NOW - (i % 10) * DAY)
  );
  assert.deepEqual(parseFundedWallets("TRON", { success: true, data, meta: {} }, NOW), { wallets: 25, truncated: false });
});

test("parseFundedWallets: sends older than factoryWindowDays are not counted", () => {
  const data = [
    tronTx("new", "TransferContract", FUNDER_HEX, "41" + "01".repeat(20), NOW - 5 * DAY),
    tronTx("old", "TransferContract", FUNDER_HEX, "41" + "02".repeat(20), NOW - 45 * DAY),
  ];
  assert.equal(parseFundedWallets("TRON", { success: true, data, meta: { fingerprint: "x" } }, NOW).wallets, 1);
  assert.equal(parseFundedWallets("TRON", { success: true, data, meta: { fingerprint: "x" } }, NOW).truncated, true);
});

test("parseFundedWallets: EVM counts distinct recipients, case-insensitive", () => {
  const result = {
    transfers: [
      { to: "0xAAA0000000000000000000000000000000000001", metadata: { blockTimestamp: new Date(NOW - DAY).toISOString() } },
      { to: "0xaaa0000000000000000000000000000000000001", metadata: { blockTimestamp: new Date(NOW - DAY).toISOString() } },
      { to: "0xbbb0000000000000000000000000000000000002", metadata: { blockTimestamp: new Date(NOW - DAY).toISOString() } },
    ],
  };
  assert.deepEqual(parseFundedWallets("ETHEREUM", result, NOW), { wallets: 2, truncated: false });
});
