import { NextResponse } from "next/server";
import { getAllSanctionedEntities, loadSanctionsCache } from "@/lib/intelligence/sanctionsRegistry";

/**
 * GET /api/kyt/sanctions
 * Query params:
 *   - search: string filter on address/entity
 *   - chain: "ALL" | "TRON" | "ETHEREUM" | "BSC" | "BITCOIN" | "OTHER"
 *   - provider: "ALL" | "US-OFAC" | "UK-OFSI" | "EU" | "JAPAN-MOFA" | "IL-NBCTF" | etc.
 *   - page: number (default 1)
 *   - limit: number (default 50)
 */
export async function GET(request) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get("search") || "";
    const chain = searchParams.get("chain") || "ALL";
    const provider = searchParams.get("provider") || "ALL";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const cache = loadSanctionsCache();

    const { total, lastSync, providerCounts, chainCounts, items } = getAllSanctionedEntities({
      search,
      chain,
      provider,
    });

    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const paginatedItems = items.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      lastSync,
      totalCount: cache.totalCount,
      filteredCount: total,
      page,
      totalPages,
      providerCounts,
      chainCounts,
      sanctions: paginatedItems,
    });
  } catch (error) {
    if (error?.digest === "NEXT_PRERENDER_INTERRUPTED") {
      throw error;
    }
    console.error("Sanctions API error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to retrieve sanctions dataset: " + error.message },
      { status: 500 }
    );
  }
}
