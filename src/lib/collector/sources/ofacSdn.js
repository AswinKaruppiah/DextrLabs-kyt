import { fetchText } from "../util/http.js";
import { chainFromHint } from "../util/address.js";
import { xmlBlocks, xmlTag, xmlTags } from "../util/text.js";

const SDN_XML_URL =
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";

// "Digital Currency Address - <ASSET>" types that can hold TRON/EVM addresses.
// Asset-only tags (USDT, USDC, ARB) carry no chain; the address format decides.
const RELEVANT_ASSETS = new Set(["TRX", "ETH", "BSC", "BNB", "USDT", "USDC", "ARB"]);

/** SDN.XML -> items. Throws if the document no longer looks like the SDN list. */
function parseSdnXml(xml) {
  const entries = xmlBlocks(xml, "sdnEntry");
  if (!entries.length) throw new Error("SDN.XML has no <sdnEntry> records (format changed?)");
  const items = [];

  for (const entry of entries) {
    if (!entry.includes("Digital Currency Address")) continue;
    const uid = xmlTag(entry, "uid");
    const name = [xmlTag(entry, "firstName"), xmlTag(entry, "lastName")].filter(Boolean).join(" ");
    const programs = xmlTags(entry, "program");

    for (const id of xmlBlocks(entry, "id")) {
      const idType = xmlTag(id, "idType") || "";
      const asset = idType.match(/^Digital Currency Address - (\w+)/)?.[1];
      if (!asset || !RELEVANT_ASSETS.has(asset)) continue;
      items.push({
        address: xmlTag(id, "idNumber"),
        statedChain: chainFromHint(asset),
        entity: name,
        entityType: xmlTag(entry, "sdnType"),
        programs,
        asset,
        reference: {
          id: `SDN-${uid}`,
          url: `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=${uid}`,
        },
      });
    }
  }
  if (!items.length) {
    throw new Error("SDN.XML parsed but no TRON/EVM digital currency addresses found (format changed?)");
  }
  return { items, sourceDate: xmlTag(xml, "Publish_Date") };
}

export const ofacSdn = {
  id: "ofac-sdn",
  name: "OFAC Specially Designated Nationals (SDN) List",
  authority: "US Treasury — Office of Foreign Assets Control (OFAC)",
  jurisdiction: "US",
  tier: 1,
  confidence: 100,
  category: "SANCTIONS",
  license: "US Government public domain",
  homepage: "https://sanctionssearch.ofac.treas.gov/",
  mirror: true,

  async collect() {
    return parseSdnXml(await fetchText(SDN_XML_URL, { timeoutMs: 180_000 }));
  },
};
