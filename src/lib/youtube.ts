// Server-side YouTube Data API v3 module (PRD §4.2, §9.3). Keeps the API key
// server-only and never calls search.list (D4 — 100× quota cost).
//
// Endpoints + costs (1 unit each), anchored 2026-06-29:
//   playlistItems.list  https://developers.google.com/youtube/v3/docs/playlistItems/list
//   videos.list         https://developers.google.com/youtube/v3/docs/videos/list
//   channels.list       https://developers.google.com/youtube/v3/docs/channels/list
//
// All reads go through Next's fetch with `next.revalidate` so repeated server renders
// reuse cached payloads (Next 16: fetch is NOT cached unless asked). The revalidate
// window defaults to the RSS poll cadence (30 min) and is configurable via env.

import "server-only";
import { z } from "zod";
import { recordQuota } from "./quota";
import { VideoSchema, type Category, type ChannelMeta, type Tier, type Video } from "./types";
import { getCategoryOf, getTierOf, USE_UULF } from "./channels";

const API_BASE = "https://www.googleapis.com/youtube/v3";

function apiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new MissingApiKeyError();
  }
  return key;
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("YOUTUBE_API_KEY is not set. Copy .env.example to .env and add a key.");
    this.name = "MissingApiKeyError";
  }
}

export function hasApiKey(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

function revalidateSeconds(): number {
  const v = Number(process.env.CT_REVALIDATE_SECONDS);
  return Number.isFinite(v) && v > 0 ? v : 1800;
}

// Deterministic validation boundary: every Data API response is parsed with a Zod schema
// before any field is read. A shape that doesn't match the documented response fails here
// rather than producing silent `undefined`s downstream. Unknown keys are tolerated (the API
// returns far more than we read); the fields we consume are validated.
async function apiGet<T>(
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey());

  const res = await fetch(url, { next: { revalidate: revalidateSeconds() } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return schema.parse(await res.json());
}

// ---------------------------------------------------------------------------
// ISO-8601 duration parser (PRD §9.3). e.g. "PT1H2M3S" -> 3723.
// ---------------------------------------------------------------------------
export function parseISODuration(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    (Number(d) || 0) * 86400 +
    (Number(h) || 0) * 3600 +
    (Number(min) || 0) * 60 +
    (Number(s) || 0)
  );
}

/** Shorts heuristic for the UU fallback (USE_UULF=false): <= 60s long-form excluded. */
export function isShort(durationSec: number): boolean {
  return durationSec > 0 && durationSec <= 60;
}

// ---------------------------------------------------------------------------
// YouTube API response schemas (only the fields we read; unknown keys tolerated).
// These are the deterministic validation boundary for the Data API.
// ---------------------------------------------------------------------------
const ThumbnailsSchema = z.record(z.object({ url: z.string() })).optional();

const PlaylistItemsResponseSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(
    z.object({
      snippet: z
        .object({
          title: z.string().optional(),
          publishedAt: z.string().optional(),
          channelId: z.string().optional(),
          channelTitle: z.string().optional(),
          resourceId: z.object({ videoId: z.string().optional() }).optional(),
          thumbnails: ThumbnailsSchema,
        })
        .optional(),
      contentDetails: z
        .object({ videoId: z.string().optional(), videoPublishedAt: z.string().optional() })
        .optional(),
    }),
  ),
});
type PlaylistItemsResponse = z.infer<typeof PlaylistItemsResponseSchema>;

const VideosResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z
        .object({
          title: z.string().optional(),
          publishedAt: z.string().optional(),
          channelId: z.string().optional(),
          channelTitle: z.string().optional(),
          thumbnails: ThumbnailsSchema,
        })
        .optional(),
      statistics: z
        .object({ viewCount: z.string().optional(), likeCount: z.string().optional() })
        .optional(),
      contentDetails: z.object({ duration: z.string().optional() }).optional(),
    }),
  ),
});
type VideosResponse = z.infer<typeof VideosResponseSchema>;

const ChannelsResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      snippet: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          customUrl: z.string().optional(),
          thumbnails: ThumbnailsSchema,
        })
        .optional(),
      statistics: z
        .object({
          subscriberCount: z.string().optional(),
          hiddenSubscriberCount: z.boolean().optional(),
        })
        .optional(),
      brandingSettings: z
        .object({ image: z.object({ bannerExternalUrl: z.string().optional() }).optional() })
        .optional(),
    }),
  ),
});
type ChannelsResponse = z.infer<typeof ChannelsResponseSchema>;

function bestThumb(thumbs?: Record<string, { url: string }>): string {
  if (!thumbs) return "";
  return (
    thumbs.maxres?.url ||
    thumbs.standard?.url ||
    thumbs.high?.url ||
    thumbs.medium?.url ||
    thumbs.default?.url ||
    ""
  );
}

// ---------------------------------------------------------------------------
// getUploads — list video ids from an uploads playlist (paginated). 1 unit/page.
// ---------------------------------------------------------------------------
export type UploadRef = { videoId: string; publishedAt: string };

export async function getUploads(
  uploadsPlaylistId: string,
  opts: { maxPages?: number; pageSize?: number } = {},
): Promise<UploadRef[]> {
  const maxPages = opts.maxPages ?? 4;
  const pageSize = Math.min(opts.pageSize ?? 50, 50);
  const refs: UploadRef[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const params: Record<string, string> = {
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: String(pageSize),
    };
    if (pageToken) params.pageToken = pageToken;
    const data = await apiGet<PlaylistItemsResponse>(
      "playlistItems",
      params,
      PlaylistItemsResponseSchema,
    );
    recordQuota("playlistItems.list");
    for (const it of data.items) {
      const videoId = it.contentDetails?.videoId;
      if (!videoId) continue;
      refs.push({
        videoId,
        publishedAt: it.contentDetails?.videoPublishedAt || "",
      });
    }
    pageToken = data.nextPageToken;
    pages += 1;
  } while (pageToken && pages < maxPages);

  return refs;
}

// ---------------------------------------------------------------------------
// enrich — hydrate video ids into full Video objects. videos.list, batch 50. 1 unit/batch.
// ---------------------------------------------------------------------------
export async function enrich(videoIds: string[]): Promise<Video[]> {
  const out: Video[] = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    if (batch.length === 0) continue;
    const data = await apiGet<VideosResponse>(
      "videos",
      {
        part: "snippet,statistics,contentDetails",
        id: batch.join(","),
        maxResults: "50",
      },
      VideosResponseSchema,
    );
    recordQuota("videos.list");
    for (const v of data.items) {
      const durationSec = parseISODuration(v.contentDetails?.duration || "");
      // UU fallback: drop Shorts client-side when not already excluded by UULF.
      if (!USE_UULF && isShort(durationSec)) continue;
      const channelId = v.snippet?.channelId || "";
      // Category + tier are carried from the roster config (tier drives home composition).
      const category: Category = getCategoryOf(channelId) ?? "";
      const tier: Tier = getTierOf(channelId) ?? null;
      out.push(
        VideoSchema.parse({
          videoId: v.id,
          channelId,
          channelTitle: v.snippet?.channelTitle || "",
          channelAvatarUrl: "", // filled by callers that join channel meta
          title: v.snippet?.title || "",
          thumbnailUrl: bestThumb(v.snippet?.thumbnails),
          durationSec,
          viewCount: Number(v.statistics?.viewCount || 0),
          likeCount: Number(v.statistics?.likeCount || 0),
          publishedAt: v.snippet?.publishedAt || "",
          category,
          tier,
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// getChannelMeta — channel headers. channels.list, batch 50. 1 unit/batch.
// ---------------------------------------------------------------------------
export async function getChannelMeta(channelIds: string[]): Promise<ChannelMeta[]> {
  const out: ChannelMeta[] = [];
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    if (batch.length === 0) continue;
    const data = await apiGet<ChannelsResponse>(
      "channels",
      {
        part: "snippet,statistics,brandingSettings",
        id: batch.join(","),
        maxResults: "50",
      },
      ChannelsResponseSchema,
    );
    recordQuota("channels.list");
    for (const c of data.items) {
      out.push({
        channelId: c.id,
        title: c.snippet?.title || "",
        handle: c.snippet?.customUrl || "",
        avatarUrl: bestThumb(c.snippet?.thumbnails),
        bannerUrl: c.brandingSettings?.image?.bannerExternalUrl || null,
        subscriberCount: Number(c.statistics?.subscriberCount || 0),
        hiddenSubscriberCount: Boolean(c.statistics?.hiddenSubscriberCount),
        description: c.snippet?.description || "",
        category: getCategoryOf(c.id) ?? "",
        tier: getTierOf(c.id) ?? null,
      });
    }
  }
  return out;
}

/** Convenience: enrich + join avatar urls from channel meta in one pass. */
export async function enrichWithAvatars(videoIds: string[]): Promise<Video[]> {
  const videos = await enrich(videoIds);
  const channelIds = [...new Set(videos.map((v) => v.channelId))];
  const metas = await getChannelMeta(channelIds);
  const avatarByChannel = new Map(metas.map((m) => [m.channelId, m.avatarUrl]));
  return videos.map((v) => ({
    ...v,
    channelAvatarUrl: avatarByChannel.get(v.channelId) || "",
  }));
}
