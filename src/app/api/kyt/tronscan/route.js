import { NextResponse } from "next/server";

const TRONSCAN_API = "https://apilist.tronscanapi.com/api";
const ENDPOINTS = {
  security: "/security/account/data", // fraud / blacklist flags
  account: "/accountv2", // balances, activity, red/grey/blue tags, feedbackRisk
};

async function callTronscan(path, address) {
  const res = await fetch(`${TRONSCAN_API}${path}?address=${encodeURIComponent(address)}`, {
    headers: { "TRON-PRO-API-KEY": process.env.TRONSCAN_API_KEY },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, response: body };
}

/**
 * GET /api/kyt/tronscan?address=T...
 * Proxies Tronscan's security and account endpoints so the API key stays on the server.
 * Returns each response untouched, plus the HTTP status it answered with.
 */
export async function GET(request) {
  const address = (request.nextUrl.searchParams.get("address") || "").trim();
  if (!address) {
    return NextResponse.json({ success: false, error: "address is required" }, { status: 400 });
  }
  if (!process.env.TRONSCAN_API_KEY) {
    return NextResponse.json({ success: false, error: "TRONSCAN_API_KEY is not set" }, { status: 500 });
  }

  try {
    const [security, account] = await Promise.all(
      Object.values(ENDPOINTS).map((path) => callTronscan(path, address)),
    );
    const success = security.status === 200 && account.status === 200;
    return NextResponse.json({ success, security, account });
  } catch (error) {
    console.error("Tronscan API error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to reach Tronscan: " + error.message },
      { status: 502 },
    );
  }
}
