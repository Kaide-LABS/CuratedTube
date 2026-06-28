import { NextResponse } from "next/server";
import { quotaSnapshot } from "@/lib/quota";

export const dynamic = "force-dynamic";

export function GET() {
  const s = quotaSnapshot();
  return NextResponse.json({
    total: s.total,
    daily: 10_000,
    pct: s.pct,
    alert: s.alert,
    byType: s.byType,
  });
}
