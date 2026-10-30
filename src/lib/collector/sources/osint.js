import { decompress } from "fzstd";
import { fetchJson, fetchText, request } from "../util/http.js";
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

// Hugging Face aggregate of public Ethereum scam lists (MEW, ScamSniffer, Forta, CryptoScamDB, Etherscan
// labels, Kaggle, XBlock, BlockSec phishing-contract papers). The "balanced" file holds every is_scam=1 row
// of the full 100 MB file (54,653 addresses) in 3.8 MB. Static since Aug 2025.
const HF_ETH_FRAUD = "https://huggingface.co/datasets/fesevu/ethereum_fraud_dataset_by_activity";

// Dropped because they are not scammers: "Parity Bug" (frozen-wallet victims), Etherscan "take-action"
// hack alerts (users with approvals open to a hacked contract, e.g. Multichain) and "Spam Token" airdrops.
function hfFraudCategory(description) {
  const d = description.toLowerCase();
  if (d.includes("parity bug") || d.includes("take-action") || d.includes("spam token")) return null;
  if (/exploit|heist|hack/.test(d)) return "HACK_EXPLOIT";
  return "SCAM_PHISHING";
}

export const hfEthFraud = {
  ...OSINT_DEFAULTS,
  id: "hf-eth-fraud",
  name: "Hugging Face Ethereum fraud dataset (aggregated scam / phishing labels)",
  authority: "fesevu/ethereum_fraud_dataset_by_activity (Hugging Face)",
  confidence: 50,
  license: "CC BY 4.0 (credit required) — aggregates upstream lists, some without a licence",
  homepage: HF_ETH_FRAUD,

  async collect() {
    const res = await request(`${HF_ETH_FRAUD}/resolve/main/addr_labels_balanced.csv.zst`, { timeoutMs: 180_000 });
    const csv = new TextDecoder().decode(decompress(new Uint8Array(await res.arrayBuffer())));
    const rows = csvToObjects(parseCsv(csv));
    if (!rows.length || !["address", "is_scam", "description", "is_contract"].every((c) => c in rows[0])) {
      throw new Error("HF fraud dataset is missing address/is_scam/description/is_contract columns (format changed?)");
    }
    const items = [];
    for (const row of rows) {
      if (row.is_scam !== "1") continue;
      const category = hfFraudCategory(row.description);
      if (!category) continue;
      const kind = row.is_contract === "1" ? "contract" : "wallet";
      items.push({
        address: row.address,
        statedChain: CHAINS.ETHEREUM,
        category,
        entity: row.description ? `${row.description} (${kind})` : `Scam ${kind}`,
        reference: { id: "hf-eth-fraud", url: this.homepage },
      });
    }
    if (!items.length) throw new Error("HF fraud dataset has no is_scam=1 rows (format changed?)");
    return { items };
  },
};

// Poison-Hunter (ACM CCS'24): address-poisoning look-alike addresses labelled by both Etherscan and Forta,
// plus the attacker column of the paper's sample transfers (its victim / token columns are not scammers).
// benign_addresses_on_etherscan.txt is the paper's negative set and is never read. Static since 2025-04.
const POISON_HUNTER = `${RAW}/DS2L/Poison-Hunter/main`;

export const poisonHunter = {
  ...OSINT_DEFAULTS,
  id: "poison-hunter",
  name: "Poison-Hunter — Ethereum address-poisoning attackers (ACM CCS'24)",
  authority: "Guan & Li, Characterizing Ethereum Address Poisoning Attack (DS2L)",
  confidence: 70,
  license: "No licence file — research data, ask the authors before commercial use",
  homepage: "https://github.com/DS2L/Poison-Hunter",

  async collect() {
    const reference = { id: "poison-hunter", url: this.homepage };
    const groundTruth = (await fetchText(`${POISON_HUNTER}/phishing_address_groundtruth.txt`))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const samples = csvToObjects(parseCsv(await fetchText(`${POISON_HUNTER}/phishing_transfers_sample.csv`)));
    if (!groundTruth.length || !samples.length || !("attacker" in samples[0])) {
      throw new Error("Poison-Hunter files are empty or missing the attacker column (format changed?)");
    }
    return {
      items: [
        ...groundTruth.map((address) => ({
          address,
          statedChain: CHAINS.ETHEREUM,
          entity: "Address-poisoning look-alike address",
          reference,
        })),
        ...samples.map((row) => ({
          address: row.attacker,
          statedChain: CHAINS.ETHEREUM,
          entity: `Address-poisoning attacker (${row.phishing_type || "poisoning"} transfer)`,
          reference,
        })),
      ],
    };
  },
};

// Drainer-as-a-Service (IMC'25): wallets and contracts behind drainer kits, identified from the
// kits' profit-sharing payments. profit_sharing_transactions.log is the evidence (tx hashes) and
// is not read. Static since 2025-11.
const DAAS = `${RAW}/blocksecteam/DaaS_dataset/main`;
const DAAS_FILES = [
  { file: "operator_accounts.log", entity: "Drainer-as-a-Service operator" },
  { file: "affiliate_accounts.log", entity: "Drainer-as-a-Service affiliate (phisher)" },
  { file: "profit_sharing_contracts.log", entity: "Drainer profit-sharing contract" },
];

export const drainerDaas = {
  ...OSINT_DEFAULTS,
  id: "drainer-daas",
  name: "Drainer-as-a-Service operators, affiliates and profit-sharing contracts (IMC'25)",
  authority: "He et al., Unmasking the Shadow Economy (BlockSec)",
  confidence: 70,
  license: "No licence file — research data, ask the authors before commercial use",
  homepage: "https://github.com/blocksecteam/DaaS_dataset",

  async collect() {
    const items = [];
    for (const { file, entity } of DAAS_FILES) {
      const addresses = (await fetchText(`${DAAS}/${file}`))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!addresses.length) throw new Error(`DaaS ${file} is empty (format changed?)`);
      for (const address of addresses) {
        items.push({
          address,
          statedChain: CHAINS.ETHEREUM,
          entity,
          reference: { id: `drainer-daas/${file}`, url: this.homepage },
        });
      }
    }
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
