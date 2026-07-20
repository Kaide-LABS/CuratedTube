import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";

// data.ts and youtube.ts are server-only modules; stub the marker for the node test environment.
vi.mock("server-only", () => ({}));

import {
  clearChannelArchiveCache,
  CHANNEL_ARCHIVE_TTL_MS,
  FULL_CHANNEL_ARCHIVE_MAX_PAGES,
  getCachedChannelData,
  getChannelVideos,
  isChannelDataFresh,
  setCachedChannelData,
} from "../src/lib/data";
import { resolveUploadsPlaylistId } from "../src/lib/channels";
import { ChannelAdditionSchema } from "../src/lib/types";
import { clearETagCache } from "../src/lib/etagCache";
import { quotaSnapshot } from "../src/lib/quota";

const g = globalThis as unknown as { __ctQuota?: unknown };

beforeEach(() => {
  delete g.__ctQuota;
  clearETagCache();
  clearChannelArchiveCache();
  process.env.YOUTUBE_API_KEY = "test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRes(body: unknown): Response {
  return {
    status: 200,
    ok: true,
    json: async () => body,
    text: async () => "",
    headers: { get: () => null },
  } as unknown as Response;
}

const CHANNEL_ID = "UCabcdefghijklmnopqrstuv"; // UC + 22 chars

describe("getChannelVideos — shared fetch pipeline for base + user-added channel pages", () => {
  it("fetches and enriches a channel's uploads by (channelId, uploadsPlaylistId), UULF path", async () => {
    const uulf = resolveUploadsPlaylistId(CHANNEL_ID);
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      if (u.pathname.includes("/playlistItems")) {
        expect(u.searchParams.get("playlistId")).toBe(uulf);
        return makeRes({
          items: [
            { contentDetails: { videoId: "v1", videoPublishedAt: "2026-06-01T00:00:00Z" } },
          ],
        });
      }
      if (u.pathname.includes("/videos")) {
        return makeRes({
          items: [
            {
              id: "v1",
              snippet: { title: "T", publishedAt: "2026-06-01T00:00:00Z", channelId: CHANNEL_ID },
              statistics: { viewCount: "10", likeCount: "1" },
              contentDetails: { duration: "PT5M" },
            },
          ],
        });
      }
      if (u.pathname.includes("/channels")) {
        return makeRes({
          items: [{ id: CHANNEL_ID, snippet: { title: "Chan" }, statistics: {} }],
        });
      }
      throw new Error(`unexpected request ${u.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const videos = await getChannelVideos(CHANNEL_ID, uulf);
    expect(videos).toHaveLength(1);
    expect(videos[0].videoId).toBe("v1");

    const calledPaths = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledPaths.some((u) => u.includes("/search"))).toBe(false);
  });

  it("falls back to UU and filters Shorts when UULF is empty (never tier-gates)", async () => {
    const uulf = resolveUploadsPlaylistId(CHANNEL_ID);
    const uu = resolveUploadsPlaylistId(CHANNEL_ID, { useUULF: false });
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      if (u.pathname.includes("/playlistItems")) {
        const pid = u.searchParams.get("playlistId");
        if (pid === uulf) return makeRes({ items: [] });
        if (pid === uu) {
          return makeRes({
            items: [
              { contentDetails: { videoId: "short1", videoPublishedAt: "2026-06-01T00:00:00Z" } },
              { contentDetails: { videoId: "long1", videoPublishedAt: "2026-06-01T00:00:00Z" } },
            ],
          });
        }
        throw new Error(`unexpected playlistId ${pid}`);
      }
      if (u.pathname.includes("/videos")) {
        return makeRes({
          items: [
            {
              id: "short1",
              snippet: { title: "Short", publishedAt: "2026-06-01T00:00:00Z", channelId: CHANNEL_ID },
              statistics: { viewCount: "1", likeCount: "0" },
              contentDetails: { duration: "PT30S" }, // <=60s => filtered as a Short
            },
            {
              id: "long1",
              snippet: { title: "Long", publishedAt: "2026-06-01T00:00:00Z", channelId: CHANNEL_ID },
              statistics: { viewCount: "1", likeCount: "0" },
              contentDetails: { duration: "PT5M" },
            },
          ],
        });
      }
      if (u.pathname.includes("/channels")) {
        return makeRes({ items: [{ id: CHANNEL_ID, snippet: {}, statistics: {} }] });
      }
      throw new Error(`unexpected request ${u.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const videos = await getChannelVideos(CHANNEL_ID, uulf);
    expect(videos.map((v) => v.videoId)).toEqual(["long1"]); // short1 filtered out
  });

  it("paginates the FULL uploads playlist by default — a channel with 3 pages returns all 3 pages' videos, not just the first 50", async () => {
    const uulf = resolveUploadsPlaylistId(CHANNEL_ID);
    const pages = [
      { videoIds: ["p1-a", "p1-b"], nextPageToken: "page2" },
      { videoIds: ["p2-a", "p2-b"], nextPageToken: "page3" },
      { videoIds: ["p3-a"], nextPageToken: undefined }, // last page, no token -> loop stops
    ];
    const allIds = pages.flatMap((p) => p.videoIds);

    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      if (u.pathname.includes("/playlistItems")) {
        const token = u.searchParams.get("pageToken");
        const pageIndex = token ? Number(token.replace("page", "")) - 1 : 0;
        const page = pages[pageIndex];
        return makeRes({
          items: page.videoIds.map((videoId) => ({
            contentDetails: { videoId, videoPublishedAt: "2026-06-01T00:00:00Z" },
          })),
          ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
        });
      }
      if (u.pathname.includes("/videos")) {
        const ids = (u.searchParams.get("id") ?? "").split(",");
        return makeRes({
          items: ids.map((id) => ({
            id,
            snippet: { title: id, publishedAt: "2026-06-01T00:00:00Z", channelId: CHANNEL_ID },
            statistics: { viewCount: "1", likeCount: "0" },
            contentDetails: { duration: "PT5M" },
          })),
        });
      }
      if (u.pathname.includes("/channels")) {
        return makeRes({ items: [{ id: CHANNEL_ID, snippet: {}, statistics: {} }] });
      }
      throw new Error(`unexpected request ${u.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const videos = await getChannelVideos(CHANNEL_ID, uulf);
    expect(videos.map((v) => v.videoId).sort()).toEqual([...allIds].sort());

    // 3 playlistItems.list pages consumed — proves the loop actually walked all 3 pageTokens,
    // not just page 1 (each page a real quota unit, per PRD §7).
    const playlistCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/playlistItems"));
    expect(playlistCalls).toHaveLength(3);
    expect(quotaSnapshot().byType["playlistItems.list"]).toBe(3);
  });

  it("the full-archive default is a high, documented ceiling (100 pages / 5,000 videos), not the old 4-page/200-video cap", () => {
    expect(FULL_CHANNEL_ARCHIVE_MAX_PAGES).toBe(100);
  });

  it("an explicit small maxPages (e.g. a sidebar rail) still limits the fetch, unaffected by the full-archive default", async () => {
    const uulf = resolveUploadsPlaylistId(CHANNEL_ID);
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      if (u.pathname.includes("/playlistItems")) {
        // Always claims there's another page — if maxPages weren't respected, this would loop
        // far beyond 1 call.
        return makeRes({
          items: [{ contentDetails: { videoId: "r1", videoPublishedAt: "2026-06-01T00:00:00Z" } }],
          nextPageToken: "more",
        });
      }
      if (u.pathname.includes("/videos")) {
        return makeRes({
          items: [
            {
              id: "r1",
              snippet: { title: "R1", publishedAt: "2026-06-01T00:00:00Z", channelId: CHANNEL_ID },
              statistics: { viewCount: "1", likeCount: "0" },
              contentDetails: { duration: "PT5M" },
            },
          ],
        });
      }
      if (u.pathname.includes("/channels")) {
        return makeRes({ items: [{ id: CHANNEL_ID, snippet: {}, statistics: {} }] });
      }
      throw new Error(`unexpected request ${u.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await getChannelVideos(CHANNEL_ID, uulf, 1); // rail-style call, e.g. from PlaylistWatchView
    const playlistCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/playlistItems"));
    expect(playlistCalls).toHaveLength(1);
  });
});

describe("videos-route body schema — shape validation only (read-only fetch, never persisted)", () => {
  // Mirrors the route's own BodySchema exactly (src/app/api/channels/videos/route.ts).
  const BodySchema = ChannelAdditionSchema.pick({ channelId: true, uploadsPlaylistId: true }).extend({
    maxPages: z.number().int().positive().max(FULL_CHANNEL_ARCHIVE_MAX_PAGES).optional(),
  });

  it("accepts a well-formed (channelId, uploadsPlaylistId) pair with no maxPages", () => {
    const uulf = resolveUploadsPlaylistId(CHANNEL_ID);
    expect(() => BodySchema.parse({ channelId: CHANNEL_ID, uploadsPlaylistId: uulf })).not.toThrow();
  });

  it("rejects a malformed channelId", () => {
    expect(() => BodySchema.parse({ channelId: "not-a-channel-id", uploadsPlaylistId: "UULFxxxxxxxxxxxxxxxxxxxx" })).toThrow();
  });

  it("rejects a malformed uploadsPlaylistId", () => {
    expect(() => BodySchema.parse({ channelId: CHANNEL_ID, uploadsPlaylistId: "bogus" })).toThrow();
  });

  it("accepts an explicit small maxPages (the rail's use case)", () => {
    const uulf = resolveUploadsPlaylistId(CHANNEL_ID);
    expect(() =>
      BodySchema.parse({ channelId: CHANNEL_ID, uploadsPlaylistId: uulf, maxPages: 1 }),
    ).not.toThrow();
  });

  it("rejects a maxPages beyond the full-archive ceiling", () => {
    const uulf = resolveUploadsPlaylistId(CHANNEL_ID);
    expect(() =>
      BodySchema.parse({
        channelId: CHANNEL_ID,
        uploadsPlaylistId: uulf,
        maxPages: FULL_CHANNEL_ARCHIVE_MAX_PAGES + 1,
      }),
    ).toThrow();
  });
});

describe("channel archive cache — cross-request, so a full paginated fetch isn't re-run on every visit", () => {
  it("is a miss when nothing has been cached for a channelId", () => {
    expect(getCachedChannelData(CHANNEL_ID)).toBeUndefined();
    expect(isChannelDataFresh(getCachedChannelData(CHANNEL_ID), Date.now())).toBe(false);
  });

  it("a cached entry is fresh immediately after being set", () => {
    setCachedChannelData(CHANNEL_ID, { meta: null, videos: [] });
    const cached = getCachedChannelData(CHANNEL_ID);
    expect(cached).toBeDefined();
    expect(isChannelDataFresh(cached, Date.now())).toBe(true);
  });

  it("expires once the TTL window has passed", () => {
    setCachedChannelData(CHANNEL_ID, { meta: null, videos: [] });
    const cached = getCachedChannelData(CHANNEL_ID);
    const justAfterTtl = Date.now() + CHANNEL_ARCHIVE_TTL_MS + 1;
    expect(isChannelDataFresh(cached, justAfterTtl)).toBe(false);
  });

  it("is still fresh well within the TTL window and stale well past it", () => {
    setCachedChannelData(CHANNEL_ID, { meta: null, videos: [] });
    const cached = getCachedChannelData(CHANNEL_ID);
    const storedAt = cached!.storedAt;
    expect(isChannelDataFresh(cached, storedAt + CHANNEL_ARCHIVE_TTL_MS - 60_000)).toBe(true);
    expect(isChannelDataFresh(cached, storedAt + CHANNEL_ARCHIVE_TTL_MS + 60_000)).toBe(false);
  });

  it("clearChannelArchiveCache empties the store", () => {
    setCachedChannelData(CHANNEL_ID, { meta: null, videos: [] });
    clearChannelArchiveCache();
    expect(getCachedChannelData(CHANNEL_ID)).toBeUndefined();
  });
});
