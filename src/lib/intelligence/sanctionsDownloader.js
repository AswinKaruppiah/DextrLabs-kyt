import fs from "fs";
import path from "path";
import readline from "readline";
import { Readable } from "node:stream";

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "sanctions-cache.json");

export const OPENSANCTIONS_BULK_URL =
  "https://data.opensanctions.org/datasets/latest/sanctions/targets.simple.csv";

// Helper to determine chain from address format
export function detectChainFromFormat(address) {
  if (!address) return "UNKNOWN";
  const clean = address.trim();
  if (/^T[1-9A-HJ-NP-za-km-z]{33}$/.test(clean)) return "TRON";
  if (/^0x[a-fA-F0-9]{40}$/.test(clean)) return "ETHEREUM";
  if (/^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,59}$/.test(clean)) return "BITCOIN";
  return "OTHER";
}

export function normalizeAddressKey(address) {
  if (!address) return "";
  const trimmed = address.trim();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

async function fetchWithTimeout(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "DextrLabs-KYT-Sync/1.0" },
      redirect: "follow",
    });
    clearTimeout(id);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.text();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/**
 * Downloads, parses, and aggregates all public sanctions lists directly from official remote URLs.
 * Saves aggregated results to data/sanctions-cache.json.
 */
export async function downloadAndAggregateSanctions() {
  const database = new Map();

  function upsertEntry(addr, data) {
    if (!addr || addr.length < 20) return;
    const cleanAddr = addr.trim();
    // Use detectChainFromFormat to validate and classify the address
    const chain =
      data.chain && data.chain !== "UNKNOWN" && data.chain !== "OTHER"
        ? data.chain
        : detectChainFromFormat(cleanAddr);

    // Strictly accept supported USDT networks (TRON, ETHEREUM, BSC); automatically rejects BITCOIN, OTHER, and UNKNOWN
    if (chain !== "TRON" && chain !== "ETHEREUM" && chain !== "BSC") {
      return;
    }

    const norm = normalizeAddressKey(cleanAddr);

    const incomingProviders = Array.isArray(data.providers)
      ? data.providers
      : data.provider
      ? [data.provider]
      : [];

    const incomingJurisdictions = Array.isArray(data.jurisdictions)
      ? data.jurisdictions
      : data.jurisdiction
      ? [data.jurisdiction]
      : [];

    const incomingPrograms = Array.isArray(data.programs)
      ? data.programs
      : data.program
      ? [data.program]
      : [];

    if (database.has(norm)) {
      const existing = database.get(norm);
      for (const p of incomingProviders) {
        if (!existing.providers.includes(p)) existing.providers.push(p);
      }
      for (const j of incomingJurisdictions) {
        if (!existing.jurisdictions.includes(j)) existing.jurisdictions.push(j);
      }
      for (const prog of incomingPrograms) {
        if (!existing.programs.includes(prog)) existing.programs.push(prog);
      }
      if (data.citation && !existing.citations.some((c) => c.authority === data.citation.authority)) {
        existing.citations.push(data.citation);
      }
      if (existing.entity === "Sanctioned Crypto Wallet" && data.entity) {
        existing.entity = data.entity;
      }
      if (data.fatfNexus && !existing.fatfNexus) {
        existing.fatfNexus = data.fatfNexus;
      }
    } else {
      database.set(norm, {
        address: cleanAddr,
        chain,
        entity: data.entity || "Sanctioned Crypto Wallet",
        providers: [...incomingProviders],
        jurisdictions: [...incomingJurisdictions],
        programs: [...incomingPrograms],
        fatfNexus: data.fatfNexus || null,
        threatType: data.threatType || "SANCTIONS_DESIGNATION",
        threatLevel: "CRITICAL",
        riskScore: 100,
        citations: data.citation ? [data.citation] : [],
      });
    }
  }

  // 1. Fetch 0xB10C OFAC Curated Lists (TRON, ETH, BSC)
  const ofacChains = [
    { chain: "TRON", url: "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_TRX.json" },
    { chain: "ETHEREUM", url: "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.json" },
    { chain: "BSC", url: "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_BSC.json" },
  ];

  for (const item of ofacChains) {
    try {
      const text = await fetchWithTimeout(item.url);
      const addresses = JSON.parse(text);
      for (const addr of Object.values(addresses)) {
        upsertEntry(addr, {
          chain: item.chain,
          provider: "US-OFAC",
          jurisdiction: "US",
          program: "OFAC SDN",
          entity: "OFAC Specially Designated National",
          citation: {
            authority: "US Department of the Treasury (OFAC)",
            url: "https://sanctionssearch.ofac.treas.gov/",
            ref: "OFAC SDN",
          },
        });
      }
    } catch (err) {
      console.warn(`[SanctionsSync] Failed fetching 0xB10C ${item.chain}:`, err.message);
    }
  }

  // 2. Fetch Direct Dedicated OpenSanctions Feeds
  const dedicatedOpenSanctions = [
    {
      code: "US-OFAC",
      jur: "US",
      url: "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv",
      auth: "US Department of the Treasury (OFAC)",
      defaultEntity: "OFAC Specially Designated National",
    },
    {
      code: "IL-NBCTF",
      jur: "IL",
      url: "https://data.opensanctions.org/datasets/latest/il_mod_crypto/targets.simple.csv",
      auth: "Israel National Bureau for Counter Terror Financing (NBCTF)",
      defaultEntity: "NBCTF Terror Finance Target",
    },
    {
      code: "UK-OFSI",
      jur: "UK",
      url: "https://data.opensanctions.org/datasets/latest/gb_fcdo_sanctions/targets.simple.csv",
      auth: "UK Foreign, Commonwealth & Development Office (OFSI)",
      defaultEntity: "UK OFSI Sanctioned Entity",
    },
    {
      code: "JAPAN-MOFA",
      jur: "JP",
      url: "https://data.opensanctions.org/datasets/latest/jp_mof_sanctions/targets.simple.csv",
      auth: "Ministry of Finance Japan (MOFA)",
      defaultEntity: "Japan MOFA Sanctioned Entity",
    },
    {
      code: "FBI-CYBER",
      jur: "US",
      url: "https://data.opensanctions.org/datasets/latest/us_fbi_lazarus_crypto/targets.simple.csv",
      auth: "Federal Bureau of Investigation (FBI)",
      defaultEntity: "Lazarus Group (DPRK Cyber Crime)",
      fatf: "FATF-BLACKLIST",
    },
  ];

  for (const feed of dedicatedOpenSanctions) {
    try {
      const text = await fetchWithTimeout(feed.url);
      const lines = text.split("\n");
      for (let i = 1; i < lines.length; i++) {
        const l = lines[i];
        if (!l.includes("CryptoWallet")) continue;
        const parts = l.split('","').map((s) => s.replace(/^"|"$/g, ""));
        if (parts.length < 13) continue;
        const addr = parts[2] || parts[7];
        if (!addr) continue;

        upsertEntry(addr, {
          providers: [feed.code, "OPENSANCTIONS"],
          jurisdiction: feed.jur,
          entity: parts[3] || feed.defaultEntity,
          program: parts[11] || feed.code,
          fatfNexus: feed.fatf || null,
          citation: {
            authority: feed.auth,
            url: "https://www.opensanctions.org/entities/" + parts[0],
            ref: parts[0],
          },
        });
      }
    } catch (err) {
      console.warn(`[SanctionsSync] Failed fetching ${feed.code}:`, err.message);
    }
  }

  // 3. Stream Bulk OpenSanctions Sanctions Feed (Live Remote Fetch Only)
  try {
    console.log(`[SanctionsSync] Streaming bulk OpenSanctions feed from ${OPENSANCTIONS_BULK_URL}...`);
    const res = await fetch(OPENSANCTIONS_BULK_URL, {
      headers: { "User-Agent": "DextrLabs-KYT-Sync/1.0" },
    });

    if (res.ok && res.body) {
      const rl = readline.createInterface({
        input: Readable.fromWeb(res.body),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line || !line.includes('"CryptoWallet"')) continue;
        const parts = line.split('","').map((s) => s.replace(/^"|"$/g, ""));
        if (parts.length < 13) continue;

        const candidateAddrs = [parts[2], parts[7], parts[3]].filter(Boolean);
        let validAddr = null;
        let chain = null;

        for (const cand of candidateAddrs) {
          const detectedChain = detectChainFromFormat(cand);
          if (detectedChain === "TRON" || detectedChain === "ETHEREUM") {
            validAddr = cand.trim();
            chain = detectedChain;
            break;
          }
        }

        if (!validAddr) continue;

        const datasetName = (parts[12] || "").toLowerCase();
        let provider = "OPENSANCTIONS";
        let jurisdiction = "GLOBAL";
        let authority = parts[12] || "OpenSanctions";
        let program = parts[11] || "International Sanctions";
        let defaultEntity = "Sanctioned Entity";
        let fatfNexus = null;

        if (datasetName.includes("ofac") || datasetName.includes("sdn")) {
          provider = "US-OFAC";
          jurisdiction = "US";
          authority = "US Department of the Treasury (OFAC)";
          program = "OFAC SDN";
          defaultEntity = "OFAC Specially Designated National";
        } else if (datasetName.includes("israel") || datasetName.includes("nbctf") || datasetName.includes("mod_crypto")) {
          provider = "IL-NBCTF";
          jurisdiction = "IL";
          authority = "Israel National Bureau for Counter Terror Financing (NBCTF)";
          program = "NBCTF Terror Finance Order";
          defaultEntity = "NBCTF Terror Finance Target";
        } else if (datasetName.includes("uk") || datasetName.includes("fcdo") || datasetName.includes("ofsi")) {
          provider = "UK-OFSI";
          jurisdiction = "UK";
          authority = "UK Foreign, Commonwealth & Development Office (OFSI)";
          program = "UK Sanctions List";
          defaultEntity = "UK OFSI Sanctioned Entity";
        } else if (datasetName.includes("japan") || datasetName.includes("mofa") || datasetName.includes("mof")) {
          provider = "JAPAN-MOFA";
          jurisdiction = "JP";
          authority = "Ministry of Finance Japan (MOFA)";
          program = "Japan FEFTA Asset Freeze";
          defaultEntity = "Japan MOFA Sanctioned Entity";
        } else if (datasetName.includes("fbi") || datasetName.includes("lazarus")) {
          provider = "FBI-CYBER";
          jurisdiction = "US";
          authority = "Federal Bureau of Investigation (FBI)";
          program = "FBI Cyber Alert";
          defaultEntity = "Lazarus Group (DPRK Cyber Crime)";
          fatfNexus = "FATF-BLACKLIST";
        } else if (datasetName.includes("european") || datasetName.includes("eu")) {
          provider = "EU";
          jurisdiction = "EU";
          authority = "European External Action Service (EU)";
          program = "EU Sanctions";
          defaultEntity = "EU Sanctioned Entity";
        } else if (datasetName.includes("united nations") || datasetName.includes("un")) {
          provider = "UN";
          jurisdiction = "UN";
          authority = "United Nations Security Council (UN)";
          program = "UN Sanctions";
          defaultEntity = "UN Sanctioned Entity";
        } else if (datasetName.includes("canada") || datasetName.includes("sema")) {
          provider = "CANADA-SEMA";
          jurisdiction = "CA";
          authority = "Global Affairs Canada (SEMA)";
          program = "Special Economic Measures Act";
          defaultEntity = "Canada SEMA Sanctioned Entity";
        } else if (datasetName.includes("australia") || datasetName.includes("dfat")) {
          provider = "AU-DFAT";
          jurisdiction = "AU";
          authority = "Department of Foreign Affairs and Trade (DFAT)";
          program = "Autonomous Sanctions Regulations";
          defaultEntity = "Australia DFAT Sanctioned Entity";
        }

        let entityTitle = defaultEntity;
        if (parts[2] && parts[2] !== validAddr && parts[2] !== "Cryptocurrency wallet" && !parts[2].startsWith("T") && !parts[2].startsWith("0x")) {
          entityTitle = parts[2];
        } else if (parts[3] && !parts[3].startsWith("T") && !parts[3].startsWith("0x")) {
          entityTitle = parts[3];
        }

        const providers = [provider];
        if (!providers.includes("OPENSANCTIONS")) {
          providers.push("OPENSANCTIONS");
        }

        upsertEntry(validAddr, {
          chain,
          providers,
          jurisdiction,
          program,
          entity: entityTitle,
          fatfNexus,
          citation: {
            authority,
            url: "https://www.opensanctions.org/entities/" + parts[0],
            ref: parts[0],
          },
        });
      }
    }
  } catch (err) {
    console.warn("[SanctionsSync] Failed streaming bulk OpenSanctions feed:", err.message);
  }

  const result = Array.from(database.values());
  const providerCounts = {};
  for (const e of result) {
    for (const p of e.providers) {
      providerCounts[p] = (providerCounts[p] || 0) + 1;
    }
  }

  const chainCounts = {};
  for (const e of result) {
    chainCounts[e.chain] = (chainCounts[e.chain] || 0) + 1;
  }

  const payload = {
    lastSync: new Date().toISOString(),
    totalCount: result.length,
    providerCounts,
    chainCounts,
    addresses: Object.fromEntries(database),
  };

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), "utf8");

  return payload;
}
