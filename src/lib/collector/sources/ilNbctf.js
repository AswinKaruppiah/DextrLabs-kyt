import { request } from "../util/http.js";
import { addressFamily } from "../util/address.js";
import { csvToObjects, parseCsv } from "../util/text.js";

const ORIGIN = "https://matal.mod.gov.il";
// "חיפוש-סנקציות" (sanctions search) — the page that issues the anti-forgery token.
const SEARCH_PAGE = `${ORIGIN}/%D7%97%D7%99%D7%A4%D7%95%D7%A9-%D7%A1%D7%A0%D7%A7%D7%A6%D7%99%D7%95%D7%AA/`;
const EXPORT_URL = `${ORIGIN}/sanctions/export`;
const HOMEPAGE = `${SEARCH_PAGE}#cryptocurrencyseizures`;

// Multi-value cells are "Name: X" entries separated by dashed lines.
const cellValues = (cell) =>
  (cell || "")
    .split(/\n-{5,}\n/)
    .map((part) => part.replace(/^\s*Name:\s*/, "").trim())
    .filter(Boolean);

const REQUIRED_COLUMNS = ["Name en", "Order Number", "Order Type", "Assets", "Designated Organizations", "Is Canceled"];

/** NBCTF cryptocurrency-seizure CSV export -> items. Throws if the expected columns are gone. */
function parseNbctfCsv(text) {
  const orders = csvToObjects(parseCsv(text));
  if (!orders.length) throw new Error("NBCTF export has no orders (format changed?)");
  const missing = REQUIRED_COLUMNS.filter((c) => !(c in orders[0]));
  if (missing.length) throw new Error(`NBCTF export is missing column(s) ${missing.join(", ")} (format changed?)`);

  const items = [];
  let canceledOrders = 0;
  let nonAddressAssets = 0;
  for (const order of orders) {
    if (order["Is Canceled"] === "True") {
      canceledOrders++;
      continue;
    }
    const orgs = cellValues(order["Designated Organizations"]);
    for (const asset of cellValues(order["Assets"])) {
      // Assets also include phone-number-keyed payment accounts; keep wallets only.
      if (!addressFamily(asset)) {
        nonAddressAssets++;
        continue;
      }
      items.push({
        address: asset,
        statedChain: null,
        entity: orgs.join("; ") || order["Name en"],
        programs: [`${order["Order Type"]} ${order["Order Number"]}`.trim()],
        reference: { id: order["Name en"] || order["Order Number"], url: HOMEPAGE },
        listedAt: order["Order Date"] || null,
        details: { validUntil: order["Validity Date"] || null },
      });
    }
  }
  return { items, notes: { orders: orders.length, canceledOrders, nonAddressAssets } };
}

export const ilNbctf = {
  id: "il-nbctf",
  name: "Israel NBCTF cryptocurrency seizure & forfeiture orders",
  authority: "Israel National Bureau for Counter Terror Financing (NBCTF), Ministry of Defense",
  jurisdiction: "IL",
  tier: 1,
  confidence: 95,
  category: "SANCTIONS",
  license: "Israeli government publication",
  homepage: HOMEPAGE,
  mirror: true,

  async collect() {
    // The export form is protected by an ASP.NET anti-forgery cookie + token pair.
    const page = await request(SEARCH_PAGE);
    const html = await page.text();
    const cookie = page.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const token = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/)?.[1];
    if (!token) throw new Error("NBCTF anti-forgery token not found (page layout changed?)");

    const res = await request(EXPORT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie,
        referer: SEARCH_PAGE,
        origin: ORIGIN,
      },
      body: new URLSearchParams({
        Id: "",
        Culture: "en",
        SelectedTypes: "seizureAndForfeitureOrderCryptocurrency",
        FileType: "csv",
        __RequestVerificationToken: token,
        ApplyAdvancedSearchFilter: "false",
      }),
    });
    if (!/csv/i.test(res.headers.get("content-type") || "")) {
      throw new Error(`NBCTF export returned ${res.headers.get("content-type")}, expected CSV`);
    }
    return parseNbctfCsv(await res.text());
  },
};
