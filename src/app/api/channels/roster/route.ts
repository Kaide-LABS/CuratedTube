import { NextResponse } from "next/server";
import { getBaseRosterRows } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * GET /api/channels/roster — base (channels.json) roster rows for the Channel Library. The
 * client merges these with its IndexedDB user additions (mergeRosterRows) since the server
 * can't see IndexedDB. Cached process-wide in data.ts — this route does not re-enrich per visit.
 */
export async function GET(): Promise<NextResponse> {
  const rows = await getBaseRosterRows();
  return NextResponse.json({ rows });
}
