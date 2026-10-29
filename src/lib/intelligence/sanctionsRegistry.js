import { lookupAddress } from "../collector/store";

// Short provider labels shown as badges in the screening result. The 0xB10C extract is a
// second copy of OFAC, so it is folded into US-OFAC rather than shown separately.
const PROVIDER_LABELS = {
  "ofac-sdn": "US-OFAC",
  "ofac-0xb10c": "US-OFAC",
  "eu-fsf": "EU",
  "uk-sanctions-list": "UK-FCDO",
  "un-consolidated": "UN",
  "il-nbctf": "IL-NBCTF",
};

/**
 * Checks an address against the government sanctions sources in the collected intel
 * database (MongoDB intel_wallets — see DATA_SOURCES.md).
 * @param {string} address
 * @param {string} chain  "TRON" | "ETHEREUM" | "BSC"
 * @returns {Promise<object|null>}
 */
export async function checkSanctions(address, chain) {
  const entry = await lookupAddress(chain, address);
  const designations = entry?.sources.filter((s) => s.category === "SANCTIONS") || [];
  if (!designations.length) return null;

  const providers = [...new Set(designations.map((s) => PROVIDER_LABELS[s.sourceId] || s.sourceId))];
  const jurisdictions = [...new Set(designations.map((s) => s.jurisdiction))];
  const programs = [...new Set(designations.flatMap((s) => s.programs || []))];
  const citations = designations
    .filter((s) => s.reference?.url && s.sourceId !== "ofac-0xb10c")
    .map((s) => ({ authority: s.authority, url: s.reference.url, id: s.reference.id }));
  // Prefer a real designated name over the generic label the 0xB10C extract carries.
  const named = designations.find((s) => s.entity && s.sourceId !== "ofac-0xb10c");
  const mirroredOnly = designations.every((s) => s.basis === "evm-mirror");

  return {
    address: entry.address,
    chain: entry.chain,
    entity: named?.entity || designations[0].entity || "Sanctioned Entity",
    providers,
    jurisdictions,
    programs,
    fatfNexus: null,
    threatType: "SANCTIONS_OFAC",
    threatLevel: "CRITICAL",
    riskWeight: 100,
    confidence: "CONFIRMED_SANCTIONED",
    authority: providers.join(", "),
    noticeId: programs.join(", ") || "Sanctioned Entity",
    legalCitation: citations[0]?.url || "Official Sanctions Registry",
    details:
      `Designated by: ${providers.join(", ")}` +
      (mirroredOnly ? ` (listed for another EVM chain; same key controls this ${entry.chain} address)` : ""),
    citations,
  };
}
