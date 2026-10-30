import { fetchJson, fetchText } from "../util/http.js";
import { CHAINS } from "../util/address.js";
import { mapLimit } from "./defiHackLabs.js";

const REPO = "tayvano/lazarus-bluenoroff-research";
const BRANCH = "main";
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
// One write-up per DPRK heist, plus the DPRK IT-worker wallet notes. more-hacks-and-thefts/ is
// skipped: it mixes in incidents the author marks "Not DPRK" and non-crime tracking (e.g. PulseX).
const INCIDENT_FILE = /^(hacks-and-thefts|dprk-it-workers)\/([^/]+)\.md$/;
const CONCURRENCY = 8;
// Fewer parsed write-ups than this means the markdown format changed.
const MIN_FILES = 150;

// The lookbehind keeps an address inside a longer token (or a URL path segment) from matching;
// the lookahead stops a 64-hex transaction hash from matching as an address.
const ADDRESS = /(?<![0-9A-Za-z/])(0x[a-fA-F0-9]{40}(?![a-fA-F0-9])|T[1-9A-HJ-NP-Za-km-z]{33}(?![0-9A-Za-z]))/g;

// Sections that list the people robbed (Atomic Wallet's "Theft Addresses + Amt Stolen" is the victim
// list), counterparties that sent funds in, or explicitly non-DPRK / whitehat actors.
const SKIP_SECTION = /victim|compromis|impact|amt stolen|at risk|affected|receives from|whitehat|white hat|not dprk/i;
// Per-address roles that are not the attacker: victims (incl. users who "interacted with" or
// "approved" a drainer), exchange / swap-service deposit addresses (owned by the service), and
// reference contracts the write-ups mention (USDT, 1inch, ...).
const SKIP_ROLE =
  /victim|interacted with|approved|exch|\bcex\b|binance|okx|kucoin|bybit cold|\bhtx\b|huobi|coinbase|kraken|hitbtc|gate\.io|mexc|bitget|changenow|fixedfloat|sideshift|thorswap|swapper|at risk|compromis|impacted|safe wallet|multisig|hot wallet|cold wallet|deposit addr|token contract|protocol|router|whitehat|not dprk/i;

/** Text on an address line once the addresses, links and list markup are removed: "Direct Theft". */
function roleOf(line) {
  return line
    .replace(ADDRESS, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*|]/g, " ")
    .replace(/^[\s\-–:]+|[\s\-–:]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

/**
 * One write-up -> attacker-side addresses. Lines look like
 *   - 0xbaf1…dd67 - Direct Theft / Tornado Cash
 *   | 0x7135… | Tornado Cash Withdrawal 8 | …
 * The incident title is the first "# " heading and the date the "Date::" line.
 */
function parseWriteUp(text) {
  const title = text.match(/^#\s+(.+)$/m)?.[1].trim() || null;
  const date = text.match(/^Date::\s*(.+)$/m)?.[1].trim() || null;
  const found = [];
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) {
      section = line.replace(/^#+/, "").trim();
      continue;
    }
    const addresses = line.match(ADDRESS);
    if (!addresses || SKIP_SECTION.test(section)) continue;
    const role = roleOf(line);
    if (SKIP_ROLE.test(role)) continue;
    for (const address of addresses) {
      const chain = address.startsWith("T") ? CHAINS.TRON : /\b(?:bsc|bnb)\b/i.test(role) ? CHAINS.BSC : CHAINS.ETHEREUM;
      found.push({ address, chain, role });
    }
  }
  return { title, date, found };
}

/**
 * Wallets behind North Korean (Lazarus / BlueNoroff / IT-worker) crypto thefts, from Tayvano's
 * public research notes: theft, laundering, Tornado Cash and dusting addresses per incident.
 */
export const lazarusTayvano = {
  id: "lazarus-tayvano",
  name: "Lazarus / DPRK heist and laundering wallets (Tayvano research notes)",
  authority: "tayvano/lazarus-bluenoroff-research (independent researcher)",
  jurisdiction: "OSINT",
  tier: 4,
  confidence: 70,
  category: "HACK_EXPLOIT",
  license: "CC0-1.0",
  homepage: `https://github.com/${REPO}`,
  mirror: false,

  async collect({ progress } = {}) {
    const tree = await fetchJson(TREE_URL, { headers: { accept: "application/vnd.github+json" } });
    if (tree.truncated) throw new Error("GitHub returned a truncated file tree");
    const files = tree.tree.filter((t) => t.type === "blob").map((t) => t.path.match(INCIDENT_FILE)).filter(Boolean);

    let done = 0;
    const parsed = await mapLimit(files, CONCURRENCY, async ([path, folder, name]) => {
      const writeUp = parseWriteUp(await fetchText(`${RAW}/${path}`, { retries: 2 }));
      progress?.({ done: ++done, total: files.length });
      return { ...writeUp, path, folder, name };
    });

    const withAddresses = parsed.filter((p) => p.found.length);
    if (withAddresses.length < MIN_FILES) {
      throw new Error(`only ${withAddresses.length} of ${files.length} write-ups had attacker addresses (format changed?)`);
    }
    const items = withAddresses.flatMap((p) => {
      const incident = p.folder === "dprk-it-workers" ? "DPRK IT workers" : p.title || p.name;
      const reference = { id: p.path, url: `https://github.com/${REPO}/blob/${BRANCH}/${p.path}` };
      return p.found.map(({ address, chain, role }) => ({
        address,
        statedChain: chain,
        entity: `Lazarus / DPRK — ${incident}${role ? ` (${role})` : ""}`,
        programs: [incident],
        reference,
        listedAt: p.date,
      }));
    });
    return {
      items,
      notes: { files: files.length, writeUpsWithAddresses: withAddresses.length },
    };
  },
};
