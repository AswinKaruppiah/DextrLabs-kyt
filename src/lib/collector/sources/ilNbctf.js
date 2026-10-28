import { request } from "../util/http.js";
import { addressFamily } from "../util/address.js";
import { csvToObjects, parseCsv } from "../util/text.js";

const ORIGIN = "https://matal.mod.gov.il";
// "חיפוש-סנקציות" (sanctions search) — the page that issues the anti-forgery token.
const SEARCH_PAGE = `${ORIGIN}/%D7%97%D7%99%D7%A4%D7%95%D7%A9-%D7%A1%D7%A0%D7%A7%D7%A6%D7%99%D7%95%D7%AA/`;
const EXPORT_URL = `${ORIGIN}/sanctions/export`;

// Multi-value cells are "Name: X" entries separated by dashed lines.
const cellValues = (cell) =>
  (cell || "")
    .split(/\n-{5,}\n/)
    .map((part) => part.replace(/^\s*Name:\s*/, "").trim())
    .filter(Boolean);

export const ilNbctf = {
  id: "il-nbctf",
  name: "Israel NBCTF cryptocurrency seizure & forfeiture orders",
  authority: "Israel National Bureau for Counter Terror Financing (NBCTF), Ministry of Defense",
  jurisdiction: "IL",
  tier: 1,
  confidence: 95,
  category: "SANCTIONS",
  license: "Israeli government publication",
  homepage: `${SEARCH_PAGE}#cryptocurrencyseizures`,
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
    const orders = csvToObjects(parseCsv(await res.text()));

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
          reference: { id: order["Name en"] || order["Order Number"], url: this.homepage },
          listedAt: order["Order Date"] || null,
          details: { validUntil: order["Validity Date"] || null },
        });
      }
    }
    return { items, notes: { orders: orders.length, canceledOrders, nonAddressAssets } };
  },
};
