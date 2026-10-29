import { fetchJson, fetchText } from "../util/http.js";
import { csvToObjects, parseCsv } from "../util/text.js";

const DATASET_API = "https://data.mendeley.com/public-api/datasets/62dmsngtfb";
const HOMEPAGE = "https://data.mendeley.com/datasets/62dmsngtfb";
const LABELS_FILE = /^judicial_ground_truth_address_labels_public.*\.csv$/;
const REQUIRED_COLUMNS = ["address", "ground_truth_role_label"];

// Court-documented roles. Victims are in the dataset too and must never be flagged.
const ROLES = {
  "fraud platform": "Fraud platform (court judgment)",
  "pseudo broker": "Money-laundering broker (court judgment)",
  "illegal broker": "Illegal broker (court judgment)",
};

/** Labels CSV -> items for the risky roles. Throws if the file no longer looks as expected. */
function parseLabels(text) {
  const rows = csvToObjects(parseCsv(text));
  if (!rows.length) throw new Error("judicial labels CSV is empty (format changed?)");
  const missing = REQUIRED_COLUMNS.filter((c) => !(c in rows[0]));
  if (missing.length) throw new Error(`judicial labels CSV is missing column(s) ${missing.join(", ")} (format changed?)`);

  const items = [];
  const skipped = {};
  let nonTron = 0;
  for (const row of rows) {
    const role = row.ground_truth_role_label.trim().toLowerCase();
    if (!ROLES[role]) {
      skipped[role] = (skipped[role] || 0) + 1;
      continue;
    }
    // TRON only: the release masks some addresses, and only TRON's base58 checksum reliably rejects
    // a masked one. EVM rows also don't say which EVM chain they are on.
    if (!row.address.trim().startsWith("T")) {
      nonTron++;
      continue;
    }
    items.push({
      address: row.address.trim(),
      statedChain: null,
      entity: ROLES[role],
      programs: [role],
      reference: { id: "doi:10.17632/62dmsngtfb", url: HOMEPAGE },
    });
  }
  if (!items.length) throw new Error("judicial labels CSV has no fraud / broker rows (format changed?)");
  return { items, notes: { rows: rows.length, skippedRoles: skipped, skippedNonTron: nonTron } };
}

/**
 * Wallet addresses named in criminal judgments on crypto fraud and money laundering, published
 * as a research dataset. Static: new versions appear only when the authors publish one.
 * Only fraud-platform / broker roles on TRON are kept (victims and non-TRON rows are dropped).
 */
export const judicialFraud = {
  id: "judicial-fraud-labels",
  name: "Judicially grounded fraud & money-laundering address labels",
  authority: "Court judgments, compiled by Meng Ling Tsai (Mendeley Data, doi:10.17632/62dmsngtfb)",
  jurisdiction: "COURT",
  tier: 3,
  confidence: 85,
  category: "SCAM_PHISHING",
  license:
    "CC BY 4.0 — Tsai, M. L., \"Judicially Grounded Virtual Asset Address Labels and TRON TRC20-USDT " +
    "Behavioral Analysis Dataset\", Mendeley Data, doi:10.17632/62dmsngtfb " +
    "(https://creativecommons.org/licenses/by/4.0/). Changed: victim addresses removed.",
  homepage: HOMEPAGE,
  mirror: false,

  async collect() {
    // The dataset API lists the current version's files with stable download links.
    const dataset = await fetchJson(DATASET_API);
    const file = (dataset.files || []).find((f) => LABELS_FILE.test(f.filename));
    const url = file?.content_details?.download_url;
    if (!url) throw new Error("judicial labels CSV not found in the dataset's file list (format changed?)");
    const result = parseLabels(await fetchText(url));
    return { ...result, sourceDate: `v${dataset.version} (${file.filename})` };
  },
};
