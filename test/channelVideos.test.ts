import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// data.ts and youtube.ts are server-only modules; stub the marker for the node test environment.
vi.mock("server-only", () => ({}));

import { getChannelVideos } from "../src/lib/data";
import { resolveUploadsPlaylistId } from "../src/lib/channels";
import { ChannelAdditionSchema } from "../src/lib/types";
import { clearETagCache } from "../src/lib/etagCache";

const g = globalThis as unknown as { __ctQuota?: unknown };

beforeEach(() => {
  delete g.__ctQuota;
  clearETagCache();
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
});

describe("videos-route body schema — shape validation only (read-only fetch, never persisted)", () => {
  const BodySchema = ChannelAdditionSchema.pick({ channelId: true, uploadsPlaylistId: true });

  it("accepts a well-formed (channelId, uploadsPlaylistId) pair", () => {
    const uulf = resolveUploadsPlaylistId(CHANNEL_ID);
    expect(() => BodySchema.parse({ channelId: CHANNEL_ID, uploadsPlaylistId: uulf })).not.toThrow();
  });

  it("rejects a malformed channelId", () => {
    expect(() => BodySchema.parse({ channelId: "not-a-channel-id", uploadsPlaylistId: "UULFxxxxxxxxxxxxxxxxxxxx" })).toThrow();
  });

  it("rejects a malformed uploadsPlaylistId", () => {
    expect(() => BodySchema.parse({ channelId: CHANNEL_ID, uploadsPlaylistId: "bogus" })).toThrow();
  });
});
