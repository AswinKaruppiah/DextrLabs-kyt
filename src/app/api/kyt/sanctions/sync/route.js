import { NextResponse } from "next/server";
import { downloadAndAggregateSanctions } from "@/lib/intelligence/sanctionsDownloader";
import { reloadSanctionsCache } from "@/lib/intelligence/sanctionsRegistry";


/**
 * POST /api/kyt/sanctions/sync
 * Manually trigger re-sync and download of all global sanctions lists.
 */
export async function POST() {
  try {
    console.log("[SanctionsSync] Triggering on-demand multi-source sync...");
    const payload = await downloadAndAggregateSanctions();
    reloadSanctionsCache();

    return NextResponse.json({
      success: true,
      message: "Sanctions registry synchronized successfully",
      lastSync: payload.lastSync,
      totalCount: payload.totalCount,
      providerCounts: payload.providerCounts,
      chainCounts: payload.chainCounts,
    });
  } catch (error) {
    console.error("[SanctionsSync] Sync error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to sync sanctions databases: " + error.message },
      { status: 500 }
    );
  }
}
