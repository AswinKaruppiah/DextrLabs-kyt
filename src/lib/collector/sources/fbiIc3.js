import { fetchText } from "../util/http.js";

// FBI public service announcements that publish wallet addresses. Add new ones here.
const ANNOUNCEMENTS = [
  {
    id: "PSA250226",
    url: "https://www.ic3.gov/PSA/2025/PSA250226",
    entity: "DPRK TraderTraitor (Lazarus) — Bybit hack laundering",
    listedAt: "2025-02-26",
  },
];

const EVM_ADDRESS = /\b0x[a-fA-F0-9]{40}\b/g;
const TRON_ADDRESS = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g;

/**
 * Addresses the FBI attributes to hacks or laundering in its IC3 public service announcements.
 * Ethereum addresses in these notices are mirrored to BSC: the same key controls both.
 */
export const fbiIc3 = {
  id: "fbi-ic3",
  name: "FBI IC3 public service announcements (attributed hack / laundering addresses)",
  authority: "US Federal Bureau of Investigation — Internet Crime Complaint Center (IC3)",
  jurisdiction: "US",
  tier: 1,
  confidence: 95,
  category: "HACK_EXPLOIT",
  license: "US Government public domain",
  homepage: "https://www.ic3.gov/PSA",
  mirror: true,

  async collect() {
    const items = [];
    const perNotice = {};
    for (const notice of ANNOUNCEMENTS) {
      const html = await fetchText(notice.url);
      const addresses = [...new Set([...(html.match(EVM_ADDRESS) || []), ...(html.match(TRON_ADDRESS) || [])])];
      // Every notice listed here was added because it names addresses; none means the page changed.
      if (!addresses.length) throw new Error(`${notice.id} lists no addresses any more (page changed?)`);
      perNotice[notice.id] = addresses.length;
      for (const address of addresses) {
        items.push({
          address,
          statedChain: null,
          entity: notice.entity,
          programs: [notice.id],
          reference: { id: notice.id, url: notice.url },
          listedAt: notice.listedAt,
        });
      }
    }
    return { items, notes: { perNotice } };
  },
};
