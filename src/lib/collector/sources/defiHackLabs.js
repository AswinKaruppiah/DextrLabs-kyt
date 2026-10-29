import { fetchJson, fetchText } from "../util/http.js";
import { CHAINS } from "../util/address.js";

const REPO = "SunWeb3Sec/DeFiHackLabs";
const BRANCH = "main";
const TREE_URL = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;
// Incident reproductions live in src/test/<YYYY-MM>/<Name>_exp.sol.
const INCIDENT_FILE = /^src\/test\/(\d{4}-\d{2})\/([^/]+)\.sol$/;
const CONCURRENCY = 8;
// Fewer parsed incidents than this means the header format changed.
const MIN_INCIDENTS = 200;

const EVM_ADDRESS = /0x[a-fA-F0-9]{40}/g;

// Whitehat / rescue bots that show up as the "attacker" because they front-ran an exploit and
// returned the funds.
const WHITEHATS = new Set([
  "0xc0ffeebabe5d496b2dde509f9fa189c25cf29671", // c0ffeebabe.eth
]);

/**
 * The header comment of one incident file -> attacker addresses + chain.
 *   // @KeyInfo - Total Lost : 2.02 ETH
 *   // Attacker : 0xd49C…          (sometimes an explorer URL, sometimes several)
 *   // Attack Contract : 0xC3D4…
 *   // Attack Tx : https://etherscan.io/tx/0x…   (or bscscan.com)
 * Only Ethereum and BSC incidents are kept; incidents involving a whitehat rescue are skipped.
 */
function parseIncident(source) {
  const header = source.split("\n").slice(0, 40).filter((l) => l.trim().startsWith("//")).join("\n");
  if (/white\s?hat/i.test(header)) return null;
  const line = (label) => header.match(new RegExp(`^//\\s*${label}\\s*:?(.*)$`, "im"))?.[1] || "";
  const notWhitehat = (a) => !WHITEHATS.has(a.toLowerCase());
  const attackers = (line("Attacker").match(EVM_ADDRESS) || []).filter(notWhitehat);
  const contracts = (line("Attack Contract(?:\\(s\\))?").match(EVM_ADDRESS) || []).filter(notWhitehat);
  if (!attackers.length && !contracts.length) return null;

  // The explorer in the header names the chain; fall back to the fork the PoC runs on.
  const explorers = header.match(/https?:\/\/(?:www\.)?(etherscan\.io|bscscan\.com)/gi) || [];
  const fork = source.match(/createSelectFork\(\s*"(mainnet|bsc)"/)?.[1];
  let chain = null;
  if (explorers.some((u) => /bscscan/i.test(u)) || fork === "bsc") chain = CHAINS.BSC;
  else if (explorers.some((u) => /etherscan/i.test(u)) || fork === "mainnet") chain = CHAINS.ETHEREUM;
  if (!chain) return null;

  return {
    chain,
    attackers: [...new Set(attackers)],
    contracts: [...new Set(contracts)].filter((a) => !attackers.includes(a)),
    lost: line("@KeyInfo - Total Lost").trim() || null,
    attackTx: line("Attack Tx").trim() || null,
  };
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await fn(list[i], i);
      }
    }),
  );
  return out;
}

/**
 * Attacker wallets and attack contracts from DeFiHackLabs, an open collection of reproduced
 * DeFi exploits (Ethereum and BSC incidents only).
 */
export const defiHackLabs = {
  id: "defihacklabs",
  name: "DeFiHackLabs exploit attackers (Ethereum + BSC)",
  authority: "SunWeb3Sec / DeFiHackLabs (open-source incident reproductions)",
  jurisdiction: "OSINT",
  tier: 4,
  confidence: 75,
  category: "HACK_EXPLOIT",
  license: "Apache-2.0 (repository); addresses are facts taken from the incident headers",
  homepage: `https://github.com/${REPO}`,
  mirror: false,

  async collect({ progress } = {}) {
    const tree = await fetchJson(TREE_URL, { headers: { accept: "application/vnd.github+json" } });
    if (tree.truncated) throw new Error("GitHub returned a truncated file tree");
    const files = tree.tree.map((t) => t.path.match(INCIDENT_FILE)).filter(Boolean);

    let done = 0;
    const parsed = await mapLimit(files, CONCURRENCY, async ([path, month, name]) => {
      const incident = parseIncident(await fetchText(`${RAW}/${path}`, { retries: 2 }));
      progress?.({ done: ++done, total: files.length });
      return incident && { ...incident, path, month, name: name.replace(/_exp$/i, "") };
    });

    const incidents = parsed.filter(Boolean);
    if (incidents.length < MIN_INCIDENTS) {
      throw new Error(`only ${incidents.length} of ${files.length} incident files had attacker headers (format changed?)`);
    }
    const items = incidents.flatMap((inc) => {
      const base = {
        statedChain: inc.chain,
        programs: [inc.name],
        reference: { id: inc.path, url: `https://github.com/${REPO}/blob/${BRANCH}/${inc.path}` },
        listedAt: inc.month,
        details: { lost: inc.lost, attackTx: inc.attackTx },
      };
      return [
        ...inc.attackers.map((address) => ({ ...base, address, entity: `${inc.name} exploiter` })),
        ...inc.contracts.map((address) => ({ ...base, address, entity: `${inc.name} attack contract` })),
      ];
    });
    return {
      items,
      notes: {
        files: files.length,
        incidents: incidents.length,
        byChain: incidents.reduce((acc, i) => ({ ...acc, [i.chain]: (acc[i.chain] || 0) + 1 }), {}),
      },
    };
  },
};
