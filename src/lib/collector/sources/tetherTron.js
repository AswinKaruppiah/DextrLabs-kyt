import { fetchJson, sleep } from "../util/http.js";
import { CHAINS } from "../util/address.js";

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const PAGE_SIZE = 100; // API enforces 20..100
const LIST_URL = "https://apilist.tronscanapi.com/api/stableCoin/blackList";

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

  async collect() {
    const headers = process.env.TRONSCAN_API_KEY
      ? { "TRON-PRO-API-KEY": process.env.TRONSCAN_API_KEY }
      : {};
    const items = [];
    let total = Infinity;
    for (let start = 0; start < total; start += PAGE_SIZE) {
      const page = await fetchJson(`${LIST_URL}?start=${start}&limit=${PAGE_SIZE}`, {
        headers,
        retries: 4,
      });
      total = page.total ?? 0;
      if (!page.data?.length) break;
      for (const row of page.data) {
        if (row.contractAddress && row.contractAddress !== USDT_TRC20) continue;
        items.push({
          address: row.blackAddress,
          statedChain: CHAINS.TRON,
          entity: "Tether-frozen address",
          asset: "USDT",
          reference: { id: row.transHash, url: `https://tronscan.org/#/transaction/${row.transHash}` },
          listedAt: row.time ? new Date(row.time * 1000).toISOString() : null,
        });
      }
      await sleep(250);
    }
    if (Number.isFinite(total) && items.length < total * 0.95) {
      throw new Error(`TronScan pagination incomplete: got ${items.length} of ${total}`);
    }
    return { items, notes: { reportedTotal: total } };
  },
};
