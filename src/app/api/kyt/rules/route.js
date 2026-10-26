import { NextResponse } from "next/server";
import { DEFAULT_COMPLIANCE_RULES } from "@/lib/rules/ruleEngine";

let activeRules = [...DEFAULT_COMPLIANCE_RULES];

export async function GET() {
  return NextResponse.json({ rules: activeRules }, { status: 200 });
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (body.rules && Array.isArray(body.rules)) {
      activeRules = body.rules;
      return NextResponse.json({ success: true, rules: activeRules });
    }
    return NextResponse.json({ error: "Invalid rules array" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
