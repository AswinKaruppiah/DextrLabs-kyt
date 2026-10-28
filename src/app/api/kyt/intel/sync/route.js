import { NextResponse, connection } from "next/server";
import { getSyncJob, startSync } from "@/lib/collector/syncJob";

/**
 * POST /api/kyt/intel/sync — start a background collection (or return the one already running).
 * Body (optional JSON):
 *   - only:         source ids to re-collect; the rest are merged from their last snapshot
 *   - acceptShrink: source ids whose large record-count drop should be accepted
 * Responds 202 with the job; poll GET for progress.
 */
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {}
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : null);

  const { started, job } = startSync({
    only: list(body.only)?.length ? list(body.only) : null,
    acceptShrink: list(body.acceptShrink) || [],
  });
  return NextResponse.json({ success: true, started, job }, { status: 202 });
}

/** GET /api/kyt/intel/sync — the running sync job, or the last finished one. */
export async function GET() {
  await connection(); // in-memory job state: never prerender
  return NextResponse.json({ success: true, job: getSyncJob() });
}
