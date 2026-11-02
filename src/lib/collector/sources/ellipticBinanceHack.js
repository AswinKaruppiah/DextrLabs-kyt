import { request } from "../util/http.js";
import { addressFamily } from "../util/address.js";

/**
 * Elliptic's free blocklist for the 29 Oct 2026 Binance hack. One address per line, no header and
 * no chain column. Elliptic asks screening teams to fetch it on a schedule and replace their copy
 * ("the same link always serves the latest version"). Page: no licence or terms, © Elliptic — use
 * for screening with attribution only; do not redistribute the full list.
 *
 * 0x addresses are mirrored to BSC (Elliptic: "screen it across every EVM chain you support");
 * BTC / SOL / XRP lines are skipped. Incident-specific: expect it to stop updating once tracing
 * ends (their Bybit list ran ~2.5 months, then was retired). Kept in its own module so it can be
 * removed by deleting this file and its line in index.js.
 */
const CSV_URL = "https://data-cdn.elliptic.co/blocklists/binance-hack-blocklist.csv";
// Fewer TRON / EVM addresses than this means the file format changed.
const MIN_ADDRESSES = 1000;

export const ellipticBinanceHack = {
  id: "elliptic-binance-hack",
  name: "Elliptic Binance hack 2026 blocklist",
  authority: "Elliptic (blockchain analytics vendor)",
  jurisdiction: "OSINT",
  tier: 4,
  confidence: 80,
  category: "HACK_EXPLOIT",
  license: "Free public data feed, no stated terms — screening use with attribution, do not redistribute",
  homepage: "https://www.elliptic.co/binance-hack-2026-blocklist/",
  mirror: true,

  async collect() {
    const res = await request(CSV_URL);
    const lines = (await res.text())
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    const addresses = lines.filter((line) => addressFamily(line));
    if (addresses.length < MIN_ADDRESSES) {
      throw new Error(`only ${addresses.length} TRON / EVM addresses in the blocklist (format changed?)`);
    }
    const reference = { id: "elliptic-binance-hack-2026", url: this.homepage };
    return {
      items: addresses.map((address) => ({
        address,
        statedChain: null,
        entity: "Binance hack 2026 — attacker / laundering address (Elliptic)",
        programs: ["Binance hack 2026"],
        reference,
        listedAt: "2026-10-29",
      })),
      sourceDate: res.headers.get("last-modified"),
      notes: { lines: lines.length, otherChainsSkipped: lines.length - addresses.length },
    };
  },
};
