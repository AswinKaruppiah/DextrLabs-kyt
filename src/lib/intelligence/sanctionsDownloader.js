import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const CACHE_FILE = path.join(DATA_DIR, "sanctions-cache.json");

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

async function fetchWithTimeout(url, timeoutMs = 20000) {
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
 * Downloads, parses, and aggregates all public sanctions lists.
 * Saves results to data/sanctions-cache.json.
 */
export async function downloadAndAggregateSanctions() {
  const database = new Map();

  function upsertEntry(addr, data) {
    if (!addr || addr.length < 20) return;
    const cleanAddr = addr.trim();
    if (cleanAddr.includes(" ") || cleanAddr.includes('"')) return;

    const norm = normalizeAddressKey(cleanAddr);
    const chain = data.chain || detectChainFromFormat(cleanAddr);

    if (database.has(norm)) {
      const existing = database.get(norm);
      if (data.provider && !existing.providers.includes(data.provider)) {
        existing.providers.push(data.provider);
      }
      if (data.jurisdiction && !existing.jurisdictions.includes(data.jurisdiction)) {
        existing.jurisdictions.push(data.jurisdiction);
      }
      if (data.program && !existing.programs.includes(data.program)) {
        existing.programs.push(data.program);
      }
      if (data.citation && !existing.citations.some((c) => c.authority === data.citation.authority)) {
        existing.citations.push(data.citation);
      }
      if (
        data.entity &&
        (existing.entity === "Sanctioned Entity" || existing.entity === "Sanctioned Crypto Wallet")
      ) {
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
        providers: data.provider ? [data.provider] : [],
        jurisdictions: data.jurisdiction ? [data.jurisdiction] : [],
        programs: data.program ? [data.program] : [],
        fatfNexus: data.fatfNexus || null,
        threatType: data.threatType || "SANCTIONS_DESIGNATION",
        threatLevel: "CRITICAL",
        riskScore: 100,
        citations: data.citation ? [data.citation] : [],
      });
    }
  }

  // 1. Fetch 0xB10C OFAC Curated Lists
  const ofacChains = [
    { chain: "TRON", url: "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_TRX.json" },
    { chain: "ETHEREUM", url: "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.json" },
    { chain: "BSC", url: "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_BSC.json" },
    { chain: "BITCOIN", url: "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_XBT.json" },
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

  // 2. Fetch Safe-Research Multi-Jurisdiction Lists (UK, EU, UN, CH, US)
  const safeFeeds = [
    { code: "UK-OFSI", jur: "UK", url: "https://github.com/safe-research/sanctions-address-lists/releases/latest/download/uk.csv", auth: "UK HM Treasury (OFSI)" },
    { code: "EU", jur: "EU", url: "https://github.com/safe-research/sanctions-address-lists/releases/latest/download/eu.csv", auth: "European Union (EU FS)" },
    { code: "UN", jur: "UN", url: "https://github.com/safe-research/sanctions-address-lists/releases/latest/download/un.csv", auth: "United Nations Security Council" },
    { code: "SWISS-SECO", jur: "CH", url: "https://github.com/safe-research/sanctions-address-lists/releases/latest/download/ch-seco.csv", auth: "Swiss SECO" },
    { code: "US-OFAC", jur: "US", url: "https://github.com/safe-research/sanctions-address-lists/releases/latest/download/us-ofac.csv", auth: "US Department of the Treasury" },
  ];

  for (const feed of safeFeeds) {
    try {
      const text = await fetchWithTimeout(feed.url);
      const lines = text.trim().split("\n").slice(1);
      for (const line of lines) {
        const [address, , source, record_id, source_url] = line.split(",");
        if (address) {
          upsertEntry(address, {
            provider: feed.code,
            jurisdiction: feed.jur,
            program: source || feed.code,
            citation: {
              authority: feed.auth,
              url: source_url || feed.url,
              ref: record_id || feed.code,
            },
          });
        }
      }
    } catch (err) {
      console.warn(`[SanctionsSync] Failed fetching ${feed.code}:`, err.message);
    }
  }

  // 3. Fetch OpenSanctions Consolidated Sanctions
  try {
    const text = await fetchWithTimeout("https://data.opensanctions.org/datasets/latest/sanctions/targets.simple.csv");
    const lines = text.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.includes("CryptoWallet")) continue;
      const parts = l.split('","').map((s) => s.replace(/^"|"$/g, ""));
      if (parts.length < 13) continue;

      let addr = parts[2];
      if (!addr || addr.toLowerCase().includes("wallet")) {
        addr = parts[7];
      }
      if (!addr) continue;

      const ds = parts[12];
      let provider = "INTERNATIONAL-SANCTIONS";
      let jur = "INTERNATIONAL";
      let auth = ds;
      let fatfNexus = null;

      if (ds.includes("OFAC") || ds.includes("US")) {
        provider = "US-OFAC";
        jur = "US";
        auth = "US Department of the Treasury (OFAC)";
      } else if (ds.includes("UK") || ds.includes("FCDO") || ds.includes("HMT")) {
        provider = "UK-OFSI";
        jur = "UK";
        auth = "UK Foreign, Commonwealth & Development Office (OFSI)";
      } else if (ds.includes("Japan")) {
        provider = "JAPAN-MOFA";
        jur = "JP";
        auth = "Ministry of Finance Japan (MOFA)";
      } else if (ds.includes("Israel")) {
        provider = "IL-NBCTF";
        jur = "IL";
        auth = "Israel National Bureau for Counter Terror Financing (NBCTF)";
      } else if (ds.includes("European") || ds.includes("EU")) {
        provider = "EU";
        jur = "EU";
        auth = "European Union (EEAS)";
      } else if (ds.includes("United Nations") || ds.includes("UN")) {
        provider = "UN";
        jur = "UN";
        auth = "United Nations Security Council (UNSC)";
      } else if (ds.includes("Canada") || ds.includes("SEMA")) {
        provider = "CANADA-SEMA";
        jur = "CA";
        auth = "Global Affairs Canada (SEMA)";
      } else if (ds.includes("Australia") || ds.includes("DFAT")) {
        provider = "AU-DFAT";
        jur = "AU";
        auth = "Australian Department of Foreign Affairs and Trade (DFAT)";
      }

      if (
        parts[11] &&
        (parts[11].includes("DPRK") ||
          parts[11].includes("North Korea") ||
          parts[11].includes("IRAN") ||
          parts[11].includes("MYANMAR"))
      ) {
        fatfNexus = "FATF-BLACKLIST";
      }

      upsertEntry(addr, {
        provider,
        jurisdiction: jur,
        entity: parts[3] || parts[2] || "Sanctioned Crypto Asset",
        program: parts[11] || ds,
        fatfNexus,
        citation: {
          authority: auth,
          url: "https://www.opensanctions.org/entities/" + parts[0],
          ref: parts[0],
        },
      });
    }
  } catch (err) {
    console.warn("[SanctionsSync] Failed fetching OpenSanctions consolidated dataset:", err.message);
  }

  // 4. Fetch FBI Lazarus Dataset
  try {
    const text = await fetchWithTimeout("https://data.opensanctions.org/datasets/latest/us_fbi_lazarus_crypto/targets.simple.csv");
    const lines = text.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.includes("CryptoWallet")) continue;
      const parts = l.split('","').map((s) => s.replace(/^"|"$/g, ""));
      if (parts.length < 13) continue;
      let addr = parts[2] || parts[7];
      if (!addr) continue;

      upsertEntry(addr, {
        provider: "FBI-CYBER",
        jurisdiction: "US",
        entity: "Lazarus Group (DPRK Cyber Crime)",
        program: "DPRK Cyber Operations",
        fatfNexus: "FATF-BLACKLIST",
        citation: {
          authority: "Federal Bureau of Investigation (FBI)",
          url: "https://www.fbi.gov/news/press-releases/fbi-identifies-lazarus-group-cyber-actors-as-responsible-for-theft-of-41-million-from-stakecom",
          ref: parts[0],
        },
      });
    }
  } catch (err) {
    console.warn("[SanctionsSync] Failed fetching FBI Lazarus:", err.message);
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

/**
 * Perform a live check against OpenSanctions API if API key is provided
 * @param {string} address 
 * @param {string} apiKey 
 */
export async function queryOpenSanctionsApi(address, apiKey) {
  if (!apiKey || !address) return null;
  try {
    const url = `https://api.opensanctions.org/search/default?q=${encodeURIComponent(address)}&schema=CryptoWallet`;
    const res = await fetch(url, {
      headers: {
        Authorization: `ApiKey ${apiKey}`,
        "User-Agent": "DextrLabs-KYT-LiveCheck/1.0",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const match = data.results[0];
      return {
        matched: true,
        entity: match.caption || "Sanctioned Entity",
        datasets: match.datasets || [],
        properties: match.properties || {},
      };
    }
    return null;
  } catch (err) {
    console.warn("[OpenSanctions API] Query error:", err.message);
    return null;
  }
}
