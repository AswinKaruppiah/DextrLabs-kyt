import { request, jsonRpc } from "../collector/util/http.js";
import { addressKey, normalizeAddress } from "../collector/util/address.js";
import { transferCacheCollection } from "../collector/db.js";
import { SUPPORTED_CHAINS } from "../chains/chainConfig";
import { EXPOSURE_RULES } from "./rules.js";
import { tronSlot } from "../tron/pacer.js";
import { alchemyUrl } from "../chains/alchemy.js";

// Newest transfers kept per direction.
const HISTORY_LIMIT = EXPOSURE_RULES.historyLimit;
const TRONGRID_PAGE = 200;
const HTTP_OPTS = { retries: 2, timeoutMs: 20_000 };


/**
 * One direction of a TRON wallet's USDT history from TronGrid, newest first.
 * @returns {Promise<{transfers: object[], truncated: boolean}>}
 */
async function tronDirection(address, direction) {
  const host = process.env.TRONGRID_HOST;
  const key = process.env.TRONGRID_API_KEY;
  const params = new URLSearchParams({
    limit: String(TRONGRID_PAGE),
    contract_address: SUPPORTED_CHAINS.TRON.contract,
    [direction === "in" ? "only_to" : "only_from"]: "true",
  });
  const transfers = [];
  let fingerprint = null;
  do {
    // TronGrid requires every other parameter to stay identical while paging.
    if (fingerprint) params.set("fingerprint", fingerprint);
    await tronSlot();
    const res = await request(`${host}/v1/accounts/${address}/transactions/trc20?${params}`, {
      ...HTTP_OPTS,
      headers: key ? { "TRON-PRO-API-KEY": key } : {},
    });
    const body = await res.json();
    if (!body.success) throw new Error(`TronGrid: ${body.error || "request failed"}`);
    for (const t of body.data || []) {
      // The feed also carries Approval events, whose value is an allowance (often max uint), not money moved.
      if (t.type !== "Transfer") continue;
      transfers.push({
        cp: direction === "in" ? t.from : t.to,
        dir: direction,
        usd: Number(t.value) / 10 ** (t.token_info?.decimals ?? 6),
        ts: t.block_timestamp,
        tx: t.transaction_id,
      });
    }
    fingerprint = body.meta?.fingerprint || null;
  } while (fingerprint && transfers.length < HISTORY_LIMIT);
  return { transfers: transfers.slice(0, HISTORY_LIMIT), truncated: !!fingerprint };
}

/** One direction of an Ethereum / BSC wallet's USDT history from Alchemy's Transfers API, newest first. */
async function alchemyDirection(chain, address, direction) {
  const result = await jsonRpc(
    alchemyUrl(chain),
    "alchemy_getAssetTransfers",
    [
      {
        fromBlock: "0x0",
        toBlock: "latest",
        [direction === "in" ? "toAddress" : "fromAddress"]: address,
        contractAddresses: [SUPPORTED_CHAINS[chain].contract],
        category: ["erc20"],
        withMetadata: true,
        maxCount: "0x" + HISTORY_LIMIT.toString(16),
        order: "desc",
      },
    ],
    HTTP_OPTS
  );
  return {
    transfers: result.transfers.map((t) => ({
      cp: normalizeAddress(direction === "in" ? t.from : t.to),
      dir: direction,
      usd: Number(t.value) || 0,
      ts: Date.parse(t.metadata.blockTimestamp),
      tx: t.hash,
    })),
    truncated: !!result.pageKey,
  };
}

const fetchDirection = (chain, address, direction) =>
  chain === "TRON" ? tronDirection(address, direction) : alchemyDirection(chain, address, direction);

/**
 * A wallet's newest USDT transfers in each direction (up to HISTORY_LIMIT each), cached for 24 h.
 * `truncated` means the wallet has more history than was read in that direction (an exchange,
 * contract or just a very active wallet); only its newest transfers are screened.
 *
 * @param {string} chain  "TRON" | "ETHEREUM" | "BSC"
 * @returns {Promise<{transfers: Array<{cp, dir, usd, ts, tx}>, truncated: {in: boolean, out: boolean}, fetchedAt: Date, cached: boolean}>}
 */
export async function getTransferHistory(chain, address) {
  const key = addressKey(chain, address);
  const cache = await transferCacheCollection();
  const hit = await cache.findOne({ _id: key });
  if (hit) return { transfers: hit.transfers, truncated: hit.truncated, fetchedAt: hit.fetchedAt, cached: true };

  const [incoming, outgoing] = await Promise.all([
    fetchDirection(chain, address, "in"),
    fetchDirection(chain, address, "out"),
  ]);
  const doc = {
    chain,
    address: normalizeAddress(address),
    fetchedAt: new Date(),
    transfers: [...incoming.transfers, ...outgoing.transfers],
    truncated: { in: incoming.truncated, out: outgoing.truncated },
  };
  await cache.replaceOne({ _id: key }, doc, { upsert: true });
  return { transfers: doc.transfers, truncated: doc.truncated, fetchedAt: doc.fetchedAt, cached: false };
}
