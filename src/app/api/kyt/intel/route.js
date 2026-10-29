import { NextResponse } from "next/server";
import { queryIntel } from "@/lib/collector/store";

/**
 * GET /api/kyt/intel
 * Query params:
 *   - search:   substring of address / entity / program / reference id
 *   - chain:    "ALL" | "TRON" | "ETHEREUM" | "BSC"
 *   - category: "ALL" | "SANCTIONS" | "ISSUER_FREEZE" | "HACK_EXPLOIT" | "SCAM_PHISHING"
 *   - source:   "ALL" | collector source id (e.g. "ofac-sdn", "tether-usdt-tron")
 *   - status:   "ALL" | "active" | "delisted" (no longer listed by any publisher)
 *   - page, limit
 */
export async function GET(request) {
  try {
    const sp = request.nextUrl.searchParams;
    const result = await queryIntel({
      search: sp.get("search") || "",
      chain: sp.get("chain") || "ALL",
      category: sp.get("category") || "ALL",
      source: sp.get("source") || "ALL",
      status: sp.get("status") || "ALL",
      page: Math.max(1, parseInt(sp.get("page") || "1", 10)),
      limit: Math.min(200, Math.max(1, parseInt(sp.get("limit") || "50", 10))),
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Intel API error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to read intel database: " + error.message },
      { status: 500 },
    );
  }
}
