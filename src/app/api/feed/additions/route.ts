import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdditionVideos } from "@/lib/data";
import { ChannelAdditionSchema } from "@/lib/types";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ additions: z.array(ChannelAdditionSchema) });

/**
 * POST /api/feed/additions — the merge point for user-added channels (IndexedDB overlay).
 * The client's additions never touch the browser's YouTube API key surface; it only ever
 * POSTs the addition records here and the server does the Data API work, same as the base
 * home feed. Tier-3 additions are dropped inside getAdditionVideos before any fetch — they
 * get zero home slots, so there is no reason to spend quota fetching their uploads.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const videos = await getAdditionVideos(body.additions);
    return NextResponse.json({ videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error building addition videos";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
