import { NextResponse } from "next/server";
import { z } from "zod";
import { getChannelVideos } from "@/lib/data";
import { ChannelAdditionSchema } from "@/lib/types";
import { hasApiKey } from "@/lib/youtube";

export const dynamic = "force-dynamic";

// Only the two fields the fetch actually needs — reuses ChannelAdditionSchema's own
// channelId/uploadsPlaylistId regexes rather than restating them. Read-only: this route never
// writes to any roster or store, so a client-supplied (channelId, uploadsPlaylistId) pair is
// trusted only as far as "fetch this playlist with the server-side key" — never persisted.
const BodySchema = ChannelAdditionSchema.pick({ channelId: true, uploadsPlaylistId: true });

/**
 * POST /api/channels/videos — a single channel's video archive by (channelId,
 * uploadsPlaylistId). Used by the channel page for a user-added channel (IndexedDB overlay):
 * the client already holds its own addition record; this route validates its shape (Zod) and
 * does the actual Data API fetch server-side, so the key never reaches the browser.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!hasApiKey()) {
    return NextResponse.json({ error: "YouTube API key not configured" }, { status: 503 });
  }

  try {
    const videos = await getChannelVideos(body.channelId, body.uploadsPlaylistId);
    return NextResponse.json({ videos });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error fetching channel videos";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
