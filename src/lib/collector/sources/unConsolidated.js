import { fetchText } from "../util/http.js";
import { extractLabelledAddresses, xmlBlocks, xmlTag } from "../util/text.js";

const UN_XML_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";

const UN_HOMEPAGE = "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list";

/** UN consolidated XML -> items. Throws if the document no longer looks like the UN list. */
function parseUnXml(xml) {
  const items = [];
  let records = 0;
  for (const tag of ["INDIVIDUAL", "ENTITY"]) {
    for (const block of xmlBlocks(xml, tag)) {
      records++;
      const hits = extractLabelledAddresses(block);
      if (!hits.length) continue;
      const name = ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME"]
        .map((t) => xmlTag(block, t))
        .filter(Boolean)
        .join(" ");
      for (const hit of hits) {
        items.push({
          address: hit.address,
          statedChain: hit.statedChain,
          entity: name,
          entityType: tag === "INDIVIDUAL" ? "Individual" : "Entity",
          programs: [xmlTag(block, "UN_LIST_TYPE")].filter(Boolean),
          reference: { id: xmlTag(block, "REFERENCE_NUMBER"), url: UN_HOMEPAGE },
          listedAt: xmlTag(block, "LISTED_ON"),
        });
      }
    }
  }
  // The list has ~1,000 designations; zero means we're no longer reading it correctly.
  if (!records) throw new Error("UN XML has no <INDIVIDUAL>/<ENTITY> records (format changed?)");
  return { items, sourceDate: xml.match(/dateGenerated="([^"]+)"/)?.[1] || null };
}

/**
 * The UN list currently publishes no wallet addresses (0 as of 2026-10), but it is scanned
 * every run so any future designation with an address is picked up automatically.
 */
export const unConsolidated = {
  id: "un-consolidated",
  name: "UN Security Council Consolidated List",
  authority: "United Nations Security Council",
  jurisdiction: "UN",
  tier: 1,
  confidence: 100,
  category: "SANCTIONS",
  license: "UN public data",
  homepage: UN_HOMEPAGE,
  mirror: true,

  async collect() {
    return parseUnXml(await fetchText(UN_XML_URL, { timeoutMs: 180_000 }));
  },
};
