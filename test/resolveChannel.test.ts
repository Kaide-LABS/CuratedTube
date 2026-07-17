import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// youtube.ts is a server-only module; stub the marker for the node test environment.
vi.mock("server-only", () => ({}));

import { resolveChannelByHandle, resolveChannelByUsername, getChannelUploads } from "../src/lib/youtube";
import { resolveUploadsPlaylistId, isDuplicateChannelId, getChannels } from "../src/lib/channels";
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

function channelsListBody(id: string) {
  return {
    items: [
      {
        id,
        snippet: {
          title: "Some Channel",
          customUrl: "@somehandle",
          thumbnails: { high: { url: "https://example.com/avatar.jpg" } },
        },
        statistics: { subscriberCount: "1234", hiddenSubscriberCount: false },
      },
    ],
  };
}

describe("resolveChannelByHandle — channels.list?forHandle= (never search.list)", () => {
  it("resolves a channel and records exactly 1 channels.list unit", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      expect(u.pathname).toContain("/channels");
      expect(u.searchParams.get("forHandle")).toBe("@somehandle");
      return makeRes(channelsListBody(CHANNEL_ID));
    });
    vi.stubGlobal("fetch", fetchMock);

    const meta = await resolveChannelByHandle("@somehandle");
    expect(meta?.channelId).toBe(CHANNEL_ID);
    expect(meta?.title).toBe("Some Channel");
    expect(meta?.subscriberCount).toBe(1234);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledPaths = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledPaths.some((u) => u.includes("/search"))).toBe(false);
  });

  it("returns null when the handle has no match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => makeRes({ items: [] })),
    );
    expect(await resolveChannelByHandle("@nobody")).toBeNull();
  });
});

describe("resolveChannelByUsername — channels.list?forUsername= (legacy /user/ links)", () => {
  it("resolves a channel by legacy username", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = new URL(String(url));
      expect(u.searchParams.get("forUsername")).toBe("somename");
      return makeRes(channelsListBody(CHANNEL_ID));
    });
    vi.stubGlobal("fetch", fetchMock);

    const meta = await resolveChannelByUsername("somename");
    expect(meta?.channelId).toBe(CHANNEL_ID);
  });
});

describe("resolve flow — UULF verify + UU fallback + shorts-only detection", () => {
  it("falls back to UU and still reports the item count for the shortsOnly check", async () => {
    const uulf = resolveUploadsPlaylistId(CHANNEL_ID);
    const uu = resolveUploadsPlaylistId(CHANNEL_ID, { useUULF: false });
    const fetchMock = vi.fn(async (url: string | URL) => {
      const pid = new URL(String(url)).searchParams.get("playlistId");
      if (pid === uulf) return makeRes({ items: [] });
      if (pid === uu) return makeRes({
        items: [{ contentDetails: { videoId: "uu-0", videoPublishedAt: "2026-06-01T00:00:00Z" } }],
      });
      throw new Error(`unexpected playlistId ${pid}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { refs, usedUU } = await getChannelUploads(CHANNEL_ID, {
      primaryPlaylistId: uulf,
      maxPages: 1,
    });
    expect(usedUU).toBe(true);
    expect(refs).toHaveLength(1); // not shorts-only
  });

  it("reports zero long-form items (shortsOnly candidate) when both UULF and UU are empty", async () => {
    const fetchMock = vi.fn(async () => makeRes({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { refs, usedUU } = await getChannelUploads(CHANNEL_ID, { maxPages: 1 });
    expect(usedUU).toBe(true); // UU was the final playlist tried
    expect(refs).toHaveLength(0); // route.ts turns this into the SHORTS_ONLY warning
  });
});

describe("isDuplicateChannelId — dedupe against base roster + client-supplied additions", () => {
  it("flags a channel already in the baked roster", () => {
    const rosterChannelId = getChannels()[0]?.channelId;
    expect(rosterChannelId).toBeDefined();
    expect(isDuplicateChannelId(rosterChannelId as string, [])).toBe(true);
  });

  it("flags a channel already in the caller-supplied existing additions", () => {
    expect(isDuplicateChannelId(CHANNEL_ID, [CHANNEL_ID])).toBe(true);
  });

  it("does not flag a genuinely new channel", () => {
    expect(isDuplicateChannelId(CHANNEL_ID, ["UCsomeotherid0000000000"])).toBe(false);
  });
});
