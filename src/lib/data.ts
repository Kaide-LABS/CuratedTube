// Server-side data aggregators consumed by the surfaces (Home / Channel / Watch).
// RSS-primary (0 quota) for the home feed; Data API for enrichment, archives, and meta.
// Per-request memoized with React cache() so a page that reads the same data twice pays once.

import "server-only";
import { cache } from "react";
import { getActiveByTier, getChannelConfig } from "./channels";
import { pollUploads } from "./rss";
import {
  enrichWithAvatars,
  getChannelMeta,
  getChannelUploads,
  hasApiKey,
} from "./youtube";
import { sortVideos } from "./feed";
import type { ChannelAddition, ChannelMeta, SortMode, Tier, Video } from "./types";

const RSS_PER_CHANNEL = 12; // newest uploads to consider per channel for the home feed
const HOME_POOL_CAP = 150; // upper bound on enriched videos serialized to the client

type FeedChannel = { channelId: string; uploadsPlaylistId: string; tier: Tier; category: string };

/**
 * Shared RSS-primary (0 quota) + Data-API-fallback pipeline for a list of channels: poll each
 * channel's uploads feed, fall back per-channel to one Data API page when RSS is empty (D2's
 * UULF→UU drill lives inside getChannelUploads), enrich, and tag each video with the tier/
 * category of the channel it came from. The tag is an explicit overwrite (not a channels.json
 * lookup) so it works identically for base roster channels and user-added channels, which have
 * no channels.json entry for enrich()'s getTierOf/getCategoryOf to find.
 */
async function buildVideosForChannels(channels: FeedChannel[]): Promise<{
  videos: Video[];
  usedUUAnywhere: boolean;
}> {
  if (channels.length === 0) return { videos: [], usedUUAnywhere: false };

  const polled = await Promise.all(channels.map((c) => pollUploads(c.uploadsPlaylistId)));

  const ids = new Set<string>();
  const channelOf = new Map<string, FeedChannel>();
  let usedUUAnywhere = false;
  await Promise.all(
    channels.map(async (c, i) => {
      const entries = polled[i].slice(0, RSS_PER_CHANNEL);
      if (entries.length > 0) {
        for (const e of entries) {
          ids.add(e.videoId);
          channelOf.set(e.videoId, c);
        }
      } else {
        const { refs, usedUU } = await getChannelUploads(c.channelId, {
          primaryPlaylistId: c.uploadsPlaylistId,
          maxPages: 1,
          pageSize: RSS_PER_CHANNEL,
        });
        if (usedUU) usedUUAnywhere = true;
        for (const r of refs) {
          ids.add(r.videoId);
          channelOf.set(r.videoId, c);
        }
      }
    }),
  );

  if (ids.size === 0) return { videos: [], usedUUAnywhere };

  const videos = await enrichWithAvatars([...ids], { filterShorts: usedUUAnywhere });
  const tagged = videos.map((v) => {
    const c = channelOf.get(v.videoId);
    return c ? { ...v, tier: c.tier, category: c.category } : v;
  });
  return { videos: tagged, usedUUAnywhere };
}

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

  const { videos } = await buildVideosForChannels(channels);
  if (videos.length === 0) return { ready: true, videos: [] };

  videos.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return { ready: true, videos: videos.slice(0, HOME_POOL_CAP) };
});

/**
 * Videos for the user's IndexedDB channel additions (PRD: "add channels by URL" overlay).
 * Tier-3 additions are excluded up front — they get zero home slots, same as baked Tier 3,
 * so their uploads are never even fetched here (saves quota, not just feed slots). Not
 * `cache()`-memoized: the addition set differs per request (POSTed by the client), so there
 * is nothing stable for React's per-request cache key to dedupe against.
 */
export async function getAdditionVideos(additions: ChannelAddition[]): Promise<Video[]> {
  if (!hasApiKey()) return [];
  const channels: FeedChannel[] = additions
    .filter((a) => a.tier === 1 || a.tier === 2)
    .map((a) => ({
      channelId: a.channelId,
      uploadsPlaylistId: a.uploadsPlaylistId,
      tier: a.tier,
      category: a.category,
    }));
  const { videos } = await buildVideosForChannels(channels);
  return videos;
}

export type ChannelArchive = {
  meta: ChannelMeta | null;
  videos: Video[]; // full enriched archive (sorted client-side per tab)
};

/** Channel page: header meta + enriched archive (bounded), sorted by the active tab. */
export const getChannelArchive = cache(
  async (channelId: string, sort: SortMode = "latest", maxPages = 4): Promise<ChannelArchive> => {
    const cfg = getChannelConfig(channelId);
    if (!hasApiKey() || !cfg) return { meta: null, videos: [] };

    const [metas, uploads] = await Promise.all([
      getChannelMeta([channelId]),
      getChannelUploads(channelId, { primaryPlaylistId: cfg.uploadsPlaylistId, maxPages }),
    ]);
    const videos = await enrichWithAvatars(
      uploads.refs.map((r) => r.videoId),
      { filterShorts: uploads.usedUU },
    );
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

  const cfg = getChannelConfig(video.channelId);
  const [metas, uploads] = await Promise.all([
    getChannelMeta([video.channelId]),
    getChannelUploads(video.channelId, {
      primaryPlaylistId: cfg?.uploadsPlaylistId,
      maxPages: 1,
      pageSize: 16,
    }),
  ]);
  const railVideos = await enrichWithAvatars(
    uploads.refs.map((r) => r.videoId).filter((id) => id !== videoId).slice(0, 12),
    { filterShorts: uploads.usedUU },
  );

  return { video, meta: metas[0] ?? null, rail: railVideos };
});
