import { fetchJson, fetchText } from "../util/http.js";
import { CHAINS } from "../util/address.js";
import { csvToObjects, parseCsv } from "../util/text.js";

// Community / security-vendor lists. Ethereum-only, never mirrored, never blocking on their own.
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

  async collect() {
    const list = await fetchJson(`${RAW}/scamsniffer/scam-database/main/blacklist/address.json`);
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
