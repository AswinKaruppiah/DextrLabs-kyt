import { fetchJson } from "../util/http.js";
import { chainFromHint } from "../util/address.js";

const BASE =
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists";
const ASSETS = ["TRX", "ETH", "BSC", "USDT", "USDC", "ARB"];

/**
 * Independent nightly extraction of the OFAC SDN list. Kept as a cross-check against
 * our own SDN parse (see crossCheck in the manifest) and as a fallback if treasury.gov is down.
 */
export const ofacMirror = {
  id: "ofac-0xb10c",
  name: "OFAC sanctioned addresses (0xB10C nightly extract)",
  authority: "US Treasury — Office of Foreign Assets Control (OFAC)",
  jurisdiction: "US",
  tier: 1,
  confidence: 100,
  category: "SANCTIONS",
  license: "MIT (extraction of public-domain OFAC data)",
  homepage: "https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses",
  mirror: true,

  async collect() {
    const items = [];
    for (const asset of ASSETS) {
      let list;
      try {
        list = await fetchJson(`${BASE}/sanctioned_addresses_${asset}.json`, { retries: 2 });
      } catch (err) {
        if (/HTTP 404/.test(err.message)) continue; // asset not (yet) present in the repo
        throw err;
      }
      if (!Array.isArray(list)) throw new Error(`0xB10C ${asset} list is not a JSON array (format changed?)`);
      for (const address of list) {
        items.push({
          address,
          statedChain: chainFromHint(asset),
          entity: "OFAC SDN designated address",
          asset,
          reference: { id: `0xB10C-${asset}`, url: `${BASE}/sanctioned_addresses_${asset}.json` },
        });
      }
    }
    if (!items.length) throw new Error("0xB10C lists are all empty or missing");
    return { items };
  },
};
