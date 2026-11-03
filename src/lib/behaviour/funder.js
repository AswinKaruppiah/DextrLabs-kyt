import { request, jsonRpc } from "../collector/util/http.js";
import { tronHexToBase58, normalizeAddress } from "../collector/util/address.js";
import { tronSlot } from "../tron/pacer.js";
import { alchemyUrl } from "../chains/alchemy.js";
import { BEHAVIOUR_RULES } from "../exposure/rules.js";

/**
 * Who paid a wallet's first fees (TRX / ETH / BNB), how old the wallet is, and how many wallets
 * that payer funded recently. Parsers are pure; the fetchers throw on HTTP failure, except
 * getWalletAge, which never throws.
 */

const HTTP_OPTS = { retries: 1, timeoutMs: 10_000 };
const DAY_MS = 86_400_000;

async function tronGet(path) {
  const key = process.env.TRONGRID_API_KEY;
  await tronSlot();
  const res = await request(`${process.env.TRONGRID_HOST}${path}`, {
    ...HTTP_OPTS,
    headers: key ? { "TRON-PRO-API-KEY": key } : {},
  });
  const body = await res.json();
  if (!body.success) throw new Error(`TronGrid: ${body.error || "request failed"}`);
  return body;
}

/** Native TRX transfers in a TronGrid transactions page: { from, to, ts, tx } with base58 addresses. */
function tronNativeTransfers(json) {
  const out = [];
  for (const t of json.data || []) {
    const c = t.raw_data?.contract?.[0];
    if (c?.type !== "TransferContract") continue;
    const v = c.parameter?.value || {};
    if (!v.owner_address || !v.to_address) continue;
    out.push({ from: tronHexToBase58(v.owner_address), to: tronHexToBase58(v.to_address), ts: t.block_timestamp, tx: t.txID });
  }
  return out;
}

/** Oldest native TRX transfer sent to `address` in an oldest-first page, or null. */
export function parseTronFunder(json, address) {
  const first = tronNativeTransfers(json)
    .filter((t) => t.to === address)
    .sort((a, b) => a.ts - b.ts)[0];
  return first ? { funder: first.from, ts: first.ts, tx: first.tx } : null;
}

/** First external (native ETH / BNB) transfer of an oldest-first alchemy_getAssetTransfers result, or null. */
export function parseEvmFunder(result) {
  const first = result?.transfers?.[0];
  if (!first?.from) return null;
  return { funder: normalizeAddress(first.from), tx: first.hash, ts: Date.parse(first.metadata.blockTimestamp) };
}

/** Account creation time (ms) from TronGrid /v1/accounts/{address}, or null for an unknown account. */
export const parseTronCreateTime = (json) => json?.data?.[0]?.create_time ?? null;

/** Distinct wallets a funder sent native coin to within factoryWindowDays (newest-first page). */
export function parseFundedWallets(chain, raw, now = Date.now()) {
  const since = now - BEHAVIOUR_RULES.factoryWindowDays * DAY_MS;
  const sends =
    chain === "TRON"
      ? tronNativeTransfers(raw).map((t) => ({ to: t.to, ts: t.ts }))
      : (raw?.transfers || []).map((t) => ({ to: normalizeAddress(t.to || ""), ts: Date.parse(t.metadata?.blockTimestamp) }));
  const wallets = new Set(sends.filter((s) => s.to && s.ts >= since).map((s) => s.to)).size;
  const truncated = chain === "TRON" ? !!raw?.meta?.fingerprint : !!raw?.pageKey;
  return { wallets, truncated };
}

const evmTransfers = (chain, filter) =>
  jsonRpc(
    alchemyUrl(chain),
    "alchemy_getAssetTransfers",
    [{ fromBlock: "0x0", toBlock: "latest", category: ["external"], withMetadata: true, ...filter }],
    HTTP_OPTS
  );

/** Who sent the wallet its first native coin (its first fees). */
export async function findFirstFunder(chain, address) {
  if (chain === "TRON") {
    const json = await tronGet(`/v1/accounts/${address}/transactions?only_to=true&order_by=block_timestamp,asc&limit=20`);
    return parseTronFunder(json, address);
  }
  return parseEvmFunder(await evmTransfers(chain, { toAddress: address, order: "asc", maxCount: "0x1" }));
}

/**
 * When the wallet was created. TRON keeps an account creation time; ETH / BSC don't, so the first
 * gas received stands in for it. `funding` is findFirstFunder's result (or null).
 */
export async function getWalletAge(chain, address, funding) {
  if (chain === "TRON") {
    try {
      const createdAt = parseTronCreateTime(await tronGet(`/v1/accounts/${address}`));
      if (createdAt) return { createdAt, source: "account" };
    } catch {
      // fall back to the first funding transfer below
    }
  }
  return funding?.ts ? { createdAt: funding.ts, source: "first-funding" } : { createdAt: null, source: "unknown" };
}

/** How many wallets `funder` sent native coin to recently (newest 200 sends). */
export async function countFundedWallets(chain, funder) {
  const raw =
    chain === "TRON"
      ? await tronGet(`/v1/accounts/${funder}/transactions?only_from=true&limit=200`)
      : await evmTransfers(chain, { fromAddress: funder, order: "desc", maxCount: "0xc8" });
  return parseFundedWallets(chain, raw);
}
