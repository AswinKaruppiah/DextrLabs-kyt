import { fetchText } from "../util/http.js";
import { csvToObjects, extractLabelledAddresses, parseCsv } from "../util/text.js";

const UK_LIST_URL = "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv";

const NAME_PARTS = ["Name 1", "Name 2", "Name 3", "Name 4", "Name 5", "Name 6"];

const toIsoDate = (ddmmyyyy) => {
  const m = ddmmyyyy?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const REQUIRED_COLUMNS = ["Unique ID", "Name 1", "Name type", "Regime Name", "Date Designated"];

/** UK Sanctions List CSV -> items. Throws if the expected layout or columns are gone. */
function parseUkCsv(text) {
  // Line 1 is "Report Date: ..."; the header row follows.
  const firstBreak = text.indexOf("\n");
  const reportDate = text.slice(0, firstBreak).replace(/^\uFEFF/, "").trim();
  if (!/^Report Date:/i.test(reportDate)) {
    throw new Error(`UK list starts with "${reportDate.slice(0, 60)}", expected "Report Date: ..." (format changed?)`);
  }
  const rows = csvToObjects(parseCsv(text.slice(firstBreak + 1)));
  const missing = REQUIRED_COLUMNS.filter((c) => !(c in (rows[0] || {})));
  if (missing.length) throw new Error(`UK list is missing column(s) ${missing.join(", ")} (format changed?)`);

  // One row per name alias; group by designation id.
  const byId = new Map();
  for (const row of rows) {
    const id = row["Unique ID"];
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(row);
  }

  const items = [];
  for (const [id, aliasRows] of byId) {
    const blob = aliasRows.map((r) => Object.values(r).join(" \n ")).join(" \n ");
    const hits = extractLabelledAddresses(blob);
    if (!hits.length) continue;
    const primary = aliasRows.find((r) => r["Name type"] === "Primary Name") || aliasRows[0];
    const name = NAME_PARTS.map((k) => primary[k]).filter(Boolean).join(" ");
    // The same EVM address is often listed once per chain ("ETH: 0x.." / "BNB: 0x.."); keep every
    // hit so each chain is recorded as "listed" — duplicates are merged in run.js.
    for (const hit of hits) {
      items.push({
        address: hit.address,
        statedChain: hit.statedChain,
        entity: name,
        entityType: primary["Designation Type"],
        programs: [primary["Regime Name"]].filter(Boolean),
        reference: { id, url: "https://search-uk-sanctions-list.service.gov.uk/" },
        listedAt: toIsoDate(primary["Date Designated"]),
      });
    }
  }
  return { items, sourceDate: reportDate.replace(/^Report Date:\s*/, "") };
}

export const ukSanctions = {
  id: "uk-sanctions-list",
  name: "UK Sanctions List (FCDO / OFSI)",
  authority: "UK Foreign, Commonwealth & Development Office (FCDO)",
  jurisdiction: "UK",
  tier: 1,
  confidence: 100,
  category: "SANCTIONS",
  license: "Open Government Licence v3.0",
  homepage: "https://www.gov.uk/government/publications/the-uk-sanctions-list",
  mirror: true,

  async collect() {
    return parseUkCsv(await fetchText(UK_LIST_URL, { timeoutMs: 180_000 }));
  },
};
