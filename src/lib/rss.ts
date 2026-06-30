// Zero-quota upload polling via the YouTube Atom feed (PRD §4.2, §9.4).
// feeds/videos.xml?playlist_id=<UULF…> returns the playlist's recent uploads as Atom
// XML at 0 Data API units. We use it to DETECT new ids cheaply; enrichment (stats,
// duration) still goes through videos.list. Verified compatible with UULF playlists.

import "server-only";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";

const FEED_BASE = "https://www.youtube.com/feeds/videos.xml";

export type RssEntry = {
  videoId: string;
  title: string;
  channelId: string;
  publishedAt: string;
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

// Deterministic validation boundary for the Atom feed (same posture as the Data API in
// youtube.ts): the untyped XMLParser output is parsed with Zod before any field is read,
// rather than asserted with an `as` cast. Unknown keys are tolerated; `title` may be a
// string or an object (xml-parser quirk), so it is coerced loosely and normalized below.
const AtomEntrySchema = z.object({
  "yt:videoId": z.string().optional(),
  "yt:channelId": z.string().optional(),
  title: z.unknown().optional(),
  published: z.string().optional(),
});
const AtomFeedSchema = z.object({
  feed: z
    .object({
      entry: z.union([AtomEntrySchema, z.array(AtomEntrySchema)]).optional(),
    })
    .optional(),
});

/**
 * Poll a playlist's RSS feed for its recent uploads. Returns [] on any network/parse
 * error so a flaky feed never breaks a render (callers fall back to the Data API).
 */
export async function pollUploads(uploadsPlaylistId: string): Promise<RssEntry[]> {
  try {
    const url = `${FEED_BASE}?playlist_id=${encodeURIComponent(uploadsPlaylistId)}`;
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return [];
    const xml = await res.text();
    const parsed = AtomFeedSchema.safeParse(parser.parse(xml));
    if (!parsed.success) return [];
    const raw = parsed.data.feed?.entry;
    if (!raw) return [];
    const entries = Array.isArray(raw) ? raw : [raw];
    return entries
      .map((e) => ({
        videoId: e["yt:videoId"] || "",
        title: typeof e.title === "string" ? e.title : "",
        channelId: e["yt:channelId"] || "",
        publishedAt: e.published || "",
      }))
      .filter((e) => e.videoId);
  } catch {
    return [];
  }
}

/** Diff freshly-polled ids against a set of ids we already know about. */
export function newVideoIds(entries: RssEntry[], known: Set<string>): string[] {
  return entries.map((e) => e.videoId).filter((id) => !known.has(id));
}
