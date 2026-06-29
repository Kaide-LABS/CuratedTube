// Server-side data aggregators consumed by the surfaces (Home / Channel / Watch).
// RSS-primary (0 quota) for the home feed; Data API for enrichment, archives, and meta.
// Per-request memoized with React cache() so a page that reads the same data twice pays once.

import "server-only";
import { cache } from "react";
import { getActiveByTier, getChannelConfig, resolveUploadsPlaylistId } from "./channels";
import { pollUploads } from "./rss";
import {
  enrichWithAvatars,
  getChannelMeta,
  getUploads,
  hasApiKey,
} from "./youtube";
import { sortVideos } from "./feed";
import type { ChannelMeta, SortMode, Video } from "./types";

const RSS_PER_CHANNEL = 12; // newest uploads to consider per channel for the home feed
const HOME_POOL_CAP = 150; // upper bound on enriched videos serialized to the client

export type HomeFeed = {
  ready: boolean; // false => show setup state (no key or no resolved channels)
  reason?: "no-api-key" | "no-channels";
  // Enriched, newest-first pool. The client builds the balanced 24-item view and applies
  // the category filter (PRD §5.1: pills switch the active set, selection persists session).
  videos: Video[];
};

/** Home Focus Feed: RSS-detect recent uploads across all channels -> enrich -> balance. */
export const getHomeFeed = cache(async (): Promise<HomeFeed> => {
  // Tier model (PRD §2): home draws from Tier 1 ∪ Tier 2 ONLY. Tier 3 (Entertainment) and
  // parked channels are excluded at the source, so no Tier-3 video can enter the home pool.
  const channels = [...getActiveByTier(1), ...getActiveByTier(2)];
  if (!hasApiKey()) return { ready: false, reason: "no-api-key", videos: [] };
  if (channels.length === 0) return { ready: false, reason: "no-channels", videos: [] };

  // 1) Zero-quota detection across all channels (parallel).
  const polled = await Promise.all(channels.map((c) => pollUploads(c.uploadsPlaylistId)));

  // 2) Collect recent ids; RSS-empty channels fall back to one Data API page.
  const ids = new Set<string>();
  await Promise.all(
    channels.map(async (c, i) => {
      const entries = polled[i].slice(0, RSS_PER_CHANNEL);
      if (entries.length > 0) {
        for (const e of entries) ids.add(e.videoId);
      } else {
        const refs = await getUploads(c.uploadsPlaylistId, { maxPages: 1, pageSize: RSS_PER_CHANNEL });
        for (const r of refs) ids.add(r.videoId);
      }
    }),
  );

  if (ids.size === 0) return { ready: true, videos: [] };

  // 3) Enrich. Newest-first pool, capped; the client balances + filters.
  const videos = await enrichWithAvatars([...ids]);
  videos.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return { ready: true, videos: videos.slice(0, HOME_POOL_CAP) };
});

export type ChannelArchive = {
  meta: ChannelMeta | null;
  videos: Video[]; // full enriched archive (sorted client-side per tab)
};

/** Channel page: header meta + enriched archive (bounded), sorted by the active tab. */
export const getChannelArchive = cache(
  async (channelId: string, sort: SortMode = "latest", maxPages = 4): Promise<ChannelArchive> => {
    const cfg = getChannelConfig(channelId);
    if (!hasApiKey() || !cfg) return { meta: null, videos: [] };

    const [metas, refs] = await Promise.all([
      getChannelMeta([channelId]),
      getUploads(cfg.uploadsPlaylistId, { maxPages }),
    ]);
    const videos = await enrichWithAvatars(refs.map((r) => r.videoId));
    return { meta: metas[0] ?? null, videos: sortVideos(videos, sort) };
  },
);

export type WatchData = {
  video: Video | null;
  meta: ChannelMeta | null;
  rail: Video[]; // more from the SAME channel only (never cross-channel — PRD §5.3)
};

/** Watch page: the video + channel meta + a same-channel rail. */
export const getWatchData = cache(async (videoId: string): Promise<WatchData> => {
  if (!hasApiKey()) return { video: null, meta: null, rail: [] };

  const [video] = await enrichWithAvatars([videoId]);
  if (!video) return { video: null, meta: null, rail: [] };

  const uploadsPlaylistId = resolveUploadsPlaylistId(video.channelId);
  const [metas, refs] = await Promise.all([
    getChannelMeta([video.channelId]),
    getUploads(uploadsPlaylistId, { maxPages: 1, pageSize: 16 }),
  ]);
  const railVideos = await enrichWithAvatars(
    refs.map((r) => r.videoId).filter((id) => id !== videoId).slice(0, 12),
  );

  return { video, meta: metas[0] ?? null, rail: railVideos };
});
