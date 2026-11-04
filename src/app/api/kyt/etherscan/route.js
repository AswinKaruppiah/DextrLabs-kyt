import { NextResponse } from "next/server";
import { SUPPORTED_CHAINS } from "@/lib/chains/chainConfig";

const ETHERSCAN_V2_API = "https://api.etherscan.io/v2/api";
const CHAIN_IDS = { ETHEREUM: 1 };
const IS_BLACKLISTED_SELECTOR = "0xe47d6060"; // isBlackListed(address)
const CALL_SPACING_MS = 400;

async function callEtherscan(chainId, params) {
  const qs = new URLSearchParams({ chainid: String(chainId), ...params, apikey: process.env.ETHERSCAN_API_KEY });
  const res = await fetch(`${ETHERSCAN_V2_API}?${qs}`, { signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: "0", message: "NOTOK", result: text };
  }
}

/**
 * GET /api/kyt/etherscan?chain=ETHEREUM&address=0x...
 * Proxies Etherscan API V2 so the API key stays on the server.
 * Returns each endpoint's response untouched.
 */
export async function GET(request) {
  const sp = request.nextUrl.searchParams;
  const chain = sp.get("chain") || "";
  const address = (sp.get("address") || "").trim();
  if (!CHAIN_IDS[chain]) {
    return NextResponse.json({ success: false, error: "chain must be ETHEREUM" }, { status: 400 });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ success: false, error: "address must be a 0x... EVM address" }, { status: 400 });
  }
  if (!process.env.ETHERSCAN_API_KEY) {
    return NextResponse.json({ success: false, error: "ETHERSCAN_API_KEY is not set" }, { status: 500 });
  }

  const chainId = CHAIN_IDS[chain];
  const usdt = SUPPORTED_CHAINS.ETHEREUM.contract || "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  const calls = {
    nameTag: { module: "nametag", action: "getaddresstag", address },
    balance: { module: "account", action: "balance", address, tag: "latest" },
    usdtBalance: { module: "account", action: "tokenbalance", contractaddress: usdt, address, tag: "latest" },
    txCount: { module: "proxy", action: "eth_getTransactionCount", address, tag: "latest" },
    code: { module: "proxy", action: "eth_getCode", address, tag: "latest" },
    usdtBlacklist: {
      module: "proxy",
      action: "eth_call",
      to: usdt,
      data: IS_BLACKLISTED_SELECTOR + address.slice(2).toLowerCase().padStart(64, "0"),
      tag: "latest",
    },
  };

  try {
    // Sequential and spaced out: the free plan allows 3 calls per second.
    const responses = {};
    for (const [name, params] of Object.entries(calls)) {
      if (Object.keys(responses).length) await new Promise((r) => setTimeout(r, CALL_SPACING_MS));
      responses[name] = await callEtherscan(chainId, params);
    }
    return NextResponse.json({ success: true, chain, responses });
  } catch (error) {
    console.error("Etherscan API error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to reach Etherscan: " + error.message },
      { status: 502 },
    );
  }
}
