import { fetchJson, sleep } from "../util/http.js";
import { CHAINS } from "../util/address.js";

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const PAGE_SIZE = 100; // API enforces 20..100
const LIST_URL = "https://apilist.tronscanapi.com/api/stableCoin/blackList";
const ATTEMPTS = 3;

/**
 * One full offset-paginated pass. The list can change while we page through it (a new
 * freeze shifts every row down, an unfreeze shifts rows up and makes us skip one), so a
 * pass whose reported total moves is thrown away and retried.
 */
async function readPass(headers, progress) {
  const rows = new Map(); // "txHash|address" -> row; overlapping pages repeat rows
  let total = null;
  for (let start = 0; total === null || start < total; start += PAGE_SIZE) {
    const page = await fetchJson(`${LIST_URL}?start=${start}&limit=${PAGE_SIZE}`, { headers, retries: 4 });
    const pageTotal = page.total ?? 0;
    if (total === null) total = pageTotal;
    else if (pageTotal !== total) return { changed: `total moved from ${total} to ${pageTotal} mid-read` };
    if (!page.data?.length) break;
    for (const row of page.data) rows.set(`${row.transHash}|${row.blackAddress}`, row);
    progress?.({ done: Math.min(start + PAGE_SIZE, total), total });
    await sleep(250);
  }
  return { rows: [...rows.values()], total };
}

/** Raw TronScan rows -> collector items (USDT contract only, one item per frozen address). */
function rowsToItems(rows) {
  const byAddress = new Map();
  for (const row of rows) {
    if (row.contractAddress && row.contractAddress !== USDT_TRC20) continue;
    if (byAddress.has(row.blackAddress)) continue;
    byAddress.set(row.blackAddress, {
      address: row.blackAddress,
      statedChain: CHAINS.TRON,
      entity: "Tether-frozen address",
      asset: "USDT",
      reference: { id: row.transHash, url: `https://tronscan.org/#/transaction/${row.transHash}` },
      listedAt: row.time ? new Date(row.time * 1000).toISOString() : null,
    });
  }
  return [...byAddress.values()];
}

/** Current Tether USDT-TRC20 blacklist (frozen addresses), as indexed by TronScan. */
export const tetherTron = {
  id: "tether-usdt-tron",
  name: "Tether USDT (TRC-20) frozen addresses",
  authority: "Tether Operations Ltd — on-chain blacklist",
  jurisdiction: "ISSUER",
  tier: 2,
  confidence: 90,
  category: "ISSUER_FREEZE",
  license: "Public on-chain data (via TronScan API)",
  homepage: "https://tronscan.org/#/data/stableCoin/blackList",
  mirror: false,
  // ~90s per full pass, up to ATTEMPTS passes.
  timeoutMs: 8 * 60 * 1000,

  async collect({ progress } = {}) {
    const headers = process.env.TRONSCAN_API_KEY
      ? { "TRON-PRO-API-KEY": process.env.TRONSCAN_API_KEY }
      : {};
    const problems = [];
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const pass = await readPass(headers, progress);
      if (pass.changed) {
        problems.push(pass.changed);
        continue;
      }
      // Every row the API says exists must have been read, otherwise freezes would be missing.
      if (pass.rows.length < pass.total) {
        problems.push(`read ${pass.rows.length} of ${pass.total} rows`);
        continue;
      }
      return {
        items: rowsToItems(pass.rows),
        notes: { reportedTotal: pass.total, rows: pass.rows.length, attempts: attempt },
      };
    }
    throw new Error(`TronScan blacklist incomplete after ${ATTEMPTS} attempts: ${problems.join("; ")}`);
  },
};
