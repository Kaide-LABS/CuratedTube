// Zero-quota upload polling via the YouTube Atom feed (PRD §4.2, §9.4).
// feeds/videos.xml?playlist_id=<UULF…> returns the playlist's recent uploads as Atom
// XML at 0 Data API units. We use it to DETECT new ids cheaply; enrichment (stats,
// duration) still goes through videos.list. Verified compatible with UULF playlists.

import "server-only";
import { XMLParser } from "fast-xml-parser";

const FEED_BASE = "https://www.youtube.com/feeds/videos.xml";

export type RssEntry = {
  videoId: string;
  title: string;
  channelId: string;
  publishedAt: string;
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

type AtomFeed = {
  feed?: {
    entry?:
      | AtomEntry
      | AtomEntry[];
  };
};
type AtomEntry = {
  "yt:videoId"?: string;
  "yt:channelId"?: string;
  title?: string;
  published?: string;
};

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
    const data = parser.parse(xml) as AtomFeed;
    const raw = data.feed?.entry;
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
