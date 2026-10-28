import { fetchText } from "../util/http.js";
import { extractLabelledAddresses, xmlBlocks } from "../util/text.js";

const EU_FSF_URL =
  "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw";

const attr = (fragment, name) => fragment.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] || null;

/** EU FSF XML -> items. Throws if the document no longer looks like the FSF list. */
function parseEuXml(xml) {
  const entities = xmlBlocks(xml, "sanctionEntity");
  if (!entities.length) throw new Error("EU FSF XML has no <sanctionEntity> records (format changed?)");
  const items = [];

  for (const entity of entities) {
    const hits = extractLabelledAddresses(entity);
    if (!hits.length) continue;
    const open = entity.slice(0, entity.indexOf(">") + 1);
    const name = attr(entity.match(/<nameAlias[^>]*>/)?.[0] || "", "wholeName");
    const regulation = entity.match(/<regulation[^>]*>/)?.[0] || "";
    const euRef = attr(open, "euReferenceNumber");
    for (const hit of hits) {
      items.push({
        address: hit.address,
        statedChain: hit.statedChain,
        entity: name,
        programs: [attr(regulation, "programme")].filter(Boolean),
        reference: {
          id: euRef || `EU-${attr(open, "logicalId")}`,
          url: attr(regulation, "publicationUrl"),
        },
        listedAt: attr(regulation, "entryIntoForceDate"),
      });
    }
  }
  return { items, sourceDate: attr(xml.slice(0, 500), "generationDate") };
}

export const euFsf = {
  id: "eu-fsf",
  name: "EU Consolidated Financial Sanctions List (FSF)",
  authority: "European Commission — Financial Sanctions Files",
  jurisdiction: "EU",
  tier: 1,
  confidence: 100,
  category: "SANCTIONS",
  license: "EU public data (reuse permitted with attribution)",
  homepage: "https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions",
  mirror: true,

  async collect() {
    return parseEuXml(await fetchText(EU_FSF_URL, { timeoutMs: 180_000 }));
  },
};
