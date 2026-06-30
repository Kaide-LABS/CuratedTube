// Server-side YouTube Data API v3 module (PRD §4.2, §9.3). Keeps the API key
// server-only and never calls search.list (D4 — 100× quota cost).
//
// Endpoints + costs (1 unit each), anchored 2026-06-29:
//   playlistItems.list  https://developers.google.com/youtube/v3/docs/playlistItems/list
//   videos.list         https://developers.google.com/youtube/v3/docs/videos/list
//   channels.list       https://developers.google.com/youtube/v3/docs/channels/list
//
// All reads go through a single conditional-fetch path (`apiFetch`) with `cache: "no-store"`,
// so this module's ETag layer — not Next's fetch cache — is the sole authority on when a quota
// unit is spent (PHASE_4_SPEC.md §6). Each call sends `If-None-Match`; a `304 Not Modified`
// returns the previously-validated body at 0 units, a `200` re-validates and re-caches. This
// makes the Data-API-backed routes (home/channel/watch) render per-request rather than
// ISR-static — the right trade for a single-user tool, since quota is held down by the 0-unit
// RSS detection path plus these 304s, not by Next caching opaque payloads.

import "server-only";
import { z } from "zod";
import { recordConditional, type QuotaCallType } from "./quota";
import { getCachedBody, getETag, setCached } from "./etagCache";
import { VideoSchema, type Category, type ChannelMeta, type Tier, type Video } from "./types";
import {
  getCategoryOf,
  getTierOf,
  resolveUploadsPlaylistId,
  shouldFallbackToUU,
  USE_UULF,
} from "./channels";

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

// Deterministic validation boundary: every Data API response is parsed with a Zod schema
// before any field is read. A shape that doesn't match the documented response fails here
// rather than producing silent `undefined`s downstream. Unknown keys are tolerated (the API
// returns far more than we read); the fields we consume are validated.
//
// Conditional-request hardening (PHASE_4_SPEC.md §6): each call sends `If-None-Match` with the
// ETag of the last good response. A `304 Not Modified` returns the previously-validated body at
// **0 quota units**; a `200` re-validates, re-caches the ETag+body, and records the unit. Quota
// accounting is folded in here (via the call `type`) so the 304 path is provably free. We use
// `cache: "no-store"` so this ETag layer — not Next's fetch cache — is the single authority on
// when a unit is spent; this makes the Data-API-backed routes (home/channel/watch) render
// per-request rather than ISR-static, which is the right trade for a single-user tool: quota is
// held down by the 0-unit RSS detection path + these 304s, not by Next caching opaque payloads.
async function apiGet<T>(
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
  type: QuotaCallType,
): Promise<T> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey());

  // Cache/error key excludes the secret `key` param: the API key never enters the ETag map
  // nor any thrown error/log line.
  const safeParams = new URLSearchParams(url.searchParams);
  safeParams.delete("key");
  const cacheKey = `${path}?${safeParams.toString()}`;

  return apiFetch(url, cacheKey, path, schema, type);
}

/** Single conditional-fetch path: attaches If-None-Match, accounts quota, resolves 200/304. */
async function apiFetch<T>(
  url: URL,
  cacheKey: string,
  label: string,
  schema: z.ZodType<T>,
  type: QuotaCallType,
): Promise<T> {
  const etag = getETag(cacheKey);
  const res = await fetch(url, {
    cache: "no-store",
    headers: etag ? { "If-None-Match": etag } : undefined,
  });

  if (res.status === 304) {
    recordConditional(type, true); // 0 units
    const cached = getCachedBody<T>(cacheKey);
    if (cached !== undefined) return cached;
    // Defensive: a 304 without a cached body (ETag + body are written together, so this is
    // effectively unreachable). Re-request unconditionally and pay the one unit.
    return apiFetchUnconditional(url, cacheKey, label, schema, type);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API ${label} ${res.status}: ${body.slice(0, 300)}`);
  }

  const parsed = schema.parse(await res.json());
  const freshEtag = res.headers.get("ETag");
  if (freshEtag) setCached(cacheKey, freshEtag, parsed);
  recordConditional(type, false); // +COST[type]
  return parsed;
}

/** Unconditional re-fetch (no If-None-Match); used only on the unreachable 304-without-body path. */
async function apiFetchUnconditional<T>(
  url: URL,
  cacheKey: string,
  label: string,
  schema: z.ZodType<T>,
  type: QuotaCallType,
): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API ${label} ${res.status}: ${body.slice(0, 300)}`);
  }
  const parsed = schema.parse(await res.json());
  const freshEtag = res.headers.get("ETag");
  if (freshEtag) setCached(cacheKey, freshEtag, parsed);
  recordConditional(type, false);
  return parsed;
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
      "playlistItems.list",
    );
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

/** A `UU…` *full-uploads* playlist id (not the long-form `UULF…` variant). */
function isUuFull(playlistId: string): boolean {
  return playlistId.startsWith("UU") && !playlistId.startsWith("UULF");
}

// ---------------------------------------------------------------------------
// getChannelUploads — list a channel's uploads with the UULF→UU fallback drill (D2).
// ---------------------------------------------------------------------------
/**
 * List a channel's uploads, transparently falling back from the long-form `UULF` playlist to the
 * full `UU` uploads playlist when `UULF` lists nothing (Implements PHASE_4_SPEC.md §4/§6, D2).
 *
 * The fallback is **per channel**, so one channel's broken `UULF` never blanks the whole feed.
 * It NEVER calls `search.list`. `usedUU` is true when the *final* playlist was a `UU` full-uploads
 * list (via fallback, or because the supplied primary was already `UU`); callers must then enrich
 * those ids with `{ filterShorts: true }` so no Short reaches a surface.
 *
 * @param channelId        the channel's `UC…` id (source for the `UU`/`UULF` derivation)
 * @param opts.primaryPlaylistId  the playlist to try first (defaults to the resolved `UULF…`)
 */
export async function getChannelUploads(
  channelId: string,
  opts: { primaryPlaylistId?: string; maxPages?: number; pageSize?: number } = {},
): Promise<{ refs: UploadRef[]; usedUU: boolean }> {
  const { primaryPlaylistId, ...page } = opts;
  const primary = primaryPlaylistId ?? resolveUploadsPlaylistId(channelId);

  let refs = await getUploads(primary, page);
  let finalPlaylistId = primary;

  // Only a long-form `UULF` primary can fall back; `longformCount` is unknown at list time, so we
  // key the listing-stage decision on the item count (a broken/empty `UULF` lists nothing).
  if (primary.startsWith("UULF") && shouldFallbackToUU(refs.length, refs.length)) {
    const uuPlaylistId = resolveUploadsPlaylistId(channelId, { useUULF: false });
    refs = await getUploads(uuPlaylistId, page);
    finalPlaylistId = uuPlaylistId;
  }

  return { refs, usedUU: isUuFull(finalPlaylistId) };
}

// ---------------------------------------------------------------------------
// enrich — hydrate video ids into full Video objects. videos.list, batch 50. 1 unit/batch.
// ---------------------------------------------------------------------------
/**
 * Hydrate video ids into full {@link Video} objects (videos.list, batched at 50).
 * `opts.filterShorts` drops Shorts (≤60s) client-side; it defaults to `!USE_UULF` (the global
 * UU mode) and is forced `true` by callers whose ids came from a per-channel UULF→UU fallback,
 * so a fallback never lets a Short reach a surface (PHASE_4_SPEC.md §6, D2).
 */
export async function enrich(
  videoIds: string[],
  opts: { filterShorts?: boolean } = {},
): Promise<Video[]> {
  const filterShorts = opts.filterShorts ?? !USE_UULF;
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
      "videos.list",
    );
    for (const v of data.items) {
      const durationSec = parseISODuration(v.contentDetails?.duration || "");
      // Drop Shorts client-side on any UU (full-uploads) path — global or per-channel fallback.
      if (filterShorts && isShort(durationSec)) continue;
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
      "channels.list",
    );
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

/**
 * Convenience: enrich + join avatar urls from channel meta in one pass. `opts.filterShorts`
 * is forwarded to {@link enrich} so a per-channel UULF→UU fallback can force Shorts removal.
 */
export async function enrichWithAvatars(
  videoIds: string[],
  opts: { filterShorts?: boolean } = {},
): Promise<Video[]> {
  const videos = await enrich(videoIds, opts);
  const channelIds = [...new Set(videos.map((v) => v.channelId))];
  const metas = await getChannelMeta(channelIds);
  const avatarByChannel = new Map(metas.map((m) => [m.channelId, m.avatarUrl]));
  return videos.map((v) => ({
    ...v,
    channelAvatarUrl: avatarByChannel.get(v.channelId) || "",
  }));
}
