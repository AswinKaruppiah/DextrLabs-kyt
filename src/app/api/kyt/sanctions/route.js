import { NextResponse } from "next/server";
import { getAllSanctionedEntities } from "@/lib/intelligence/sanctionsRegistry";


/**
 * GET /api/kyt/sanctions
 * Returns complete list of known sanctioned, Tether-frozen, and scam wallets.
 * Read-only lookup (zero mutation).
 */
export async function GET() {
  try {
    const list = getAllSanctionedEntities();
    return NextResponse.json({
      success: true,
      count: list.length,
      sanctions: list,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to fetch sanctioned wallets registry" },
      { status: 500 }
    );
  }
}
