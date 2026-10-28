import { NextResponse } from "next/server";
import { runCollection } from "@/lib/collector/run";
import { invalidateIntelCache } from "@/lib/collector/store";

// A full collection pulls ~100 MB from 12 feeds and takes ~1.5 minutes.
export const maxDuration = 300;

/** POST /api/kyt/intel/sync — re-run every collector source and rebuild data/intel. */
export async function POST() {
  try {
    const manifest = await runCollection({ log: (line) => console.log("[IntelSync]" + line) });
    invalidateIntelCache();
    return NextResponse.json({
      success: true,
      runAt: manifest.runAt,
      totals: manifest.totals,
      sources: manifest.sources.map((s) => ({ id: s.id, status: s.status, records: s.records, lastError: s.lastError })),
    });
  } catch (error) {
    console.error("[IntelSync] error:", error);
    return NextResponse.json(
      { success: false, error: "Collection failed: " + error.message },
      { status: 500 },
    );
  }
}
