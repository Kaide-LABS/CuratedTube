import { NextResponse } from "next/server";
import { DAILY_QUOTA, quotaSnapshot } from "@/lib/quota";

export const dynamic = "force-dynamic";

/**
 * Quota snapshot for the dev QuotaBadge (Implements PHASE_4_SPEC.md §4). Server-only, no key,
 * never cached. `visible` is false in production unless `CT_SHOW_QUOTA=1`, so the badge stays a
 * development affordance. `conditionalHits`/`savedUnits` expose the units avoided via 304s.
 */
export function GET() {
  const s = quotaSnapshot();
  const visible = process.env.NODE_ENV !== "production" || process.env.CT_SHOW_QUOTA === "1";
  return NextResponse.json({
    total: s.total,
    daily: DAILY_QUOTA,
    pct: s.pct,
    alert: s.alert,
    byType: s.byType,
    conditionalHits: s.conditionalHits,
    savedUnits: s.savedUnits,
    visible,
  });
}
