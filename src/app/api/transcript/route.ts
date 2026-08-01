import { NextResponse } from "next/server";
import { z } from "zod";
import { getTranscript } from "@/lib/transcript";
import {
  bustCachedTranscript,
  getCachedTranscript,
  setCachedTranscript,
  transcriptCacheKey,
} from "@/lib/transcriptCache";

export const dynamic = "force-dynamic";

// videoId shape matches the Data API's own id format; lang is a bare BCP-47-ish code the track
// list itself returned (never trusted further than "look this up in the cache/track list").
const QuerySchema = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/),
  lang: z.string().min(1).max(20).optional(),
});

/**
 * GET /api/transcript?videoId=...&lang=... — lazy, server-side transcript fetch (Cloud Run, not
 * the browser: avoids exposing the unofficial timedtext mechanism client-side and sidesteps any
 * client-side DNS block). Cached permanently (for this process's lifetime) by (videoId, lang) —
 * see transcriptCache.ts — since transcripts don't change once published. NO CAPTIONS AVAILABLE
 * is a normal 200 response (`{available: false}`), not an error status.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    videoId: url.searchParams.get("videoId") ?? "",
    lang: url.searchParams.get("lang") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { videoId, lang } = parsed.data;
  const key = transcriptCacheKey(videoId, lang);

  const cached = getCachedTranscript(key);
  if (cached) return NextResponse.json(cached);

  // Fail-soft is baked into getTranscript itself (network/timeout/shape-change -> {available:
  // false, reason: "unavailable"}), so this route never needs its own try/catch to stay up.
  // setCachedTranscript refuses to persist an "unavailable" result on its own (see
  // transcriptCache.ts) — this call site doesn't need to special-case it either.
  const result = await getTranscript(videoId, lang);
  setCachedTranscript(key, result);
  return NextResponse.json(result);
}

/**
 * DELETE /api/transcript?videoId=...&lang=... — manual cache-bust for one (videoId, lang) entry.
 * Internal/support use (e.g. re-testing a video after a fix landed), not wired to any UI button.
 */
export async function DELETE(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    videoId: url.searchParams.get("videoId") ?? "",
    lang: url.searchParams.get("lang") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  bustCachedTranscript(transcriptCacheKey(parsed.data.videoId, parsed.data.lang));
  return NextResponse.json({ busted: true });
}
