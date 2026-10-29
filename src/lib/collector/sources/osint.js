import { fetchJson, fetchText } from "../util/http.js";
import { CHAINS } from "../util/address.js";
import { csvToObjects, parseCsv } from "../util/text.js";

// Community / security-vendor lists (Ethereum, plus eth-labels' BSC labels). Never mirrored,
// never blocking on their own.
const OSINT_DEFAULTS = {
  jurisdiction: "OSINT",
  tier: 4,
  category: "SCAM_PHISHING",
  mirror: false,
};

const RAW = "https://raw.githubusercontent.com";

export const scamSniffer = {
  ...OSINT_DEFAULTS,
  id: "scamsniffer",
  name: "ScamSniffer scam-database address blacklist",
  authority: "ScamSniffer (Web3 anti-scam vendor)",
  confidence: 60,
  license: "GPL-3.0 — review before commercial redistribution",
  homepage: "https://github.com/scamsniffer/scam-database",

  // The address lists stopped in Feb 2024 (the repo now only adds domains). all.json's `address` key
  // is the last and largest copy (≈4.6k vs ≈2.5k in address.json); malformed entries fail validation.
  async collect() {
    const { address: list } = await fetchJson(`${RAW}/scamsniffer/scam-database/main/blacklist/all.json`, {
      timeoutMs: 180_000,
    });
    if (!Array.isArray(list) || !list.length) throw new Error("ScamSniffer all.json has no address list (format changed?)");
    return {
      items: list.map((address) => ({
        address,
        statedChain: CHAINS.ETHEREUM,
        entity: "Drainer / phishing address",
        reference: { id: "scamsniffer-blacklist", url: this.homepage },
      })),
    };
  },
};

export const mewDarklist = {
  ...OSINT_DEFAULTS,
  id: "mew-darklist",
  name: "MyEtherWallet address darklist",
  authority: "MyEtherWallet (community-maintained)",
  confidence: 60,
  license: "MIT",
  homepage: "https://github.com/MyEtherWallet/ethereum-lists",

  async collect() {
    const list = await fetchJson(
      `${RAW}/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json`,
    );
    return {
      items: list.map((row) => ({
        address: row.address,
        statedChain: CHAINS.ETHEREUM,
        entity: row.comment || "Darklisted address",
        reference: { id: "mew-darklist", url: this.homepage },
        listedAt: row.date || null,
      })),
    };
  },
};

export const ethLabels = {
  ...OSINT_DEFAULTS,
  id: "eth-labels-phish-hack",
  name: "eth-labels — Etherscan 'Phish / Hack' label set",
  authority: "dawsbot/eth-labels (Etherscan label mirror)",
  confidence: 70,
  category: "HACK_EXPLOIT",
  license: "MIT",
  homepage: "https://github.com/dawsbot/eth-labels",

  async collect() {
    const list = await fetchJson(`${RAW}/dawsbot/eth-labels/master/src/mainnet/phish-hack/all.json`);
    return {
      items: list.map((row) => ({
        address: row.address,
        statedChain: CHAINS.ETHEREUM,
        entity: row.nameTag || "Etherscan Phish/Hack label",
        reference: { id: "etherscan-phish-hack", url: `https://etherscan.io/address/${row.address}` },
      })),
    };
  },
};

// eth-labels' maintained export (branch v1) covers more chains and newer incident labels than the
// mainnet phish-hack file above. BSC "heist" labels are exploiters; "*-exploit" labels name the
// wallets behind a specific Ethereum incident (Bybit, WazirX, ...).
const ETH_LABELS_CSV = `${RAW}/dawsbot/eth-labels/v1/data/csv/accounts.csv`;
const EXPLORERS = { [CHAINS.ETHEREUM]: "https://etherscan.io", [CHAINS.BSC]: "https://bscscan.com" };

function exploitLabel(chainId, label) {
  if (chainId === "56" && label === "heist") return { chain: CHAINS.BSC, category: "HACK_EXPLOIT" };
  if (chainId === "56" && label === "scam") return { chain: CHAINS.BSC, category: "SCAM_PHISHING" };
  if (chainId === "1" && label.endsWith("-exploit")) return { chain: CHAINS.ETHEREUM, category: "HACK_EXPLOIT" };
  return null;
}

export const ethLabelsExploits = {
  ...OSINT_DEFAULTS,
  id: "eth-labels-exploits",
  name: "eth-labels — BSC heist/scam and Ethereum incident-exploit labels",
  authority: "dawsbot/eth-labels (Etherscan / BscScan label mirror)",
  confidence: 70,
  category: "HACK_EXPLOIT",
  license: "MIT",
  homepage: "https://github.com/dawsbot/eth-labels",

  async collect() {
    const rows = csvToObjects(parseCsv(await fetchText(ETH_LABELS_CSV)));
    if (!rows.length || !["address", "chainId", "label"].every((c) => c in rows[0])) {
      throw new Error("eth-labels accounts.csv is missing address/chainId/label columns (format changed?)");
    }
    const items = [];
    for (const row of rows) {
      const match = exploitLabel(row.chainId, row.label);
      if (!match) continue;
      items.push({
        address: row.address,
        statedChain: match.chain,
        category: match.category,
        entity: row.nameTag || row.label,
        programs: [row.label],
        reference: { id: `eth-labels:${row.label}`, url: `${EXPLORERS[match.chain]}/address/${row.address}` },
      });
    }
    if (!items.length) throw new Error("eth-labels accounts.csv has no heist/scam/exploit labels (format changed?)");
    return { items };
  },
};

const FORTA_BASE = `${RAW}/forta-network/labelled-datasets/main/labels/1`;

export const fortaLabels = {
  ...OSINT_DEFAULTS,
  id: "forta-labelled",
  name: "Forta labelled datasets (Ethereum phishing & malicious contracts)",
  authority: "Forta Network",
  confidence: 50,
  license: "MIT — static snapshot, last updated 2023-01",
  homepage: "https://github.com/forta-network/labelled-datasets",

  async collect() {
    const items = [];
    const load = async (file) => csvToObjects(parseCsv(await fetchText(`${FORTA_BASE}/${file}`)));

    for (const row of await load("phishing_scams.csv")) {
      items.push({
        address: row.address,
        statedChain: CHAINS.ETHEREUM,
        entity: row.etherscan_tag || "Phishing address",
        reference: { id: "forta/phishing_scams.csv", url: this.homepage },
      });
    }
    for (const row of await load("etherscan_malicious_labels.csv")) {
      items.push({
        address: row.banned_address,
        statedChain: CHAINS.ETHEREUM,
        entity: row.wallet_tag || "Malicious address",
        reference: { id: "forta/etherscan_malicious_labels.csv", url: this.homepage },
      });
    }
    for (const row of await load("malicious_smart_contracts.csv")) {
      const entity = row.contract_tag || row.contract_creator_tag || "Malicious smart contract";
      items.push({
        address: row.contract_address,
        statedChain: CHAINS.ETHEREUM,
        entity,
        category: "HACK_EXPLOIT",
        reference: { id: "forta/malicious_smart_contracts.csv", url: this.homepage },
      });
      if (row.contract_creator) {
        items.push({
          address: row.contract_creator,
          statedChain: CHAINS.ETHEREUM,
          entity: `Deployer of ${entity}`,
          category: "HACK_EXPLOIT",
          reference: { id: "forta/malicious_smart_contracts.csv", url: this.homepage },
        });
      }
    }
    return { items };
  },
};
