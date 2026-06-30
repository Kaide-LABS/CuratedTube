import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// youtube.ts is a server-only module; stub the marker for the node test environment.
vi.mock("server-only", () => ({}));

import { shouldFallbackToUU, resolveUploadsPlaylistId } from "../src/lib/channels";
import { getChannelUploads, isShort } from "../src/lib/youtube";
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

describe("shouldFallbackToUU — pure predicate (acceptance §8.2)", () => {
  it("falls back when UULF lists nothing", () => {
    expect(shouldFallbackToUU(0, 0)).toBe(true);
  });
  it("falls back when UULF items yield no long-form", () => {
    expect(shouldFallbackToUU(12, 0)).toBe(true);
  });
  it("does NOT fall back when long-form exists", () => {
    expect(shouldFallbackToUU(12, 8)).toBe(false);
  });
});

describe("isShort — 60s boundary (acceptance §8.2)", () => {
  it("treats <=60s as a Short and >60s as long-form", () => {
    expect(isShort(60)).toBe(true);
    expect(isShort(61)).toBe(false);
    expect(isShort(0)).toBe(false); // unknown duration is not classified as a Short
  });
});

// playlistItems body with N items, ids prefixed by the playlist they came from.
function listBody(prefix: string, n: number) {
  return {
    items: Array.from({ length: n }, (_, i) => ({
      contentDetails: { videoId: `${prefix}-${i}`, videoPublishedAt: "2026-06-01T00:00:00Z" },
    })),
  };
}

function makeRes(body: unknown): Response {
  return {
    status: 200,
    ok: true,
    json: async () => body,
    text: async () => "",
    headers: { get: () => null }, // no ETag => no conditional caching in these cases
  } as unknown as Response;
}

const CHANNEL_ID = "UCabcdefghijklmnopqrstuv"; // UC + 22 chars

describe("getChannelUploads — UULF→UU per-channel fallback drill (acceptance §8.2)", () => {
  it("re-lists UU when UULF is empty and flags usedUU", async () => {
    const uulf = resolveUploadsPlaylistId(CHANNEL_ID); // UULF…
    const uu = resolveUploadsPlaylistId(CHANNEL_ID, { useUULF: false }); // UU…
    const fetchMock = vi.fn(async (url: string | URL) => {
      const pid = new URL(String(url)).searchParams.get("playlistId");
      if (pid === uulf) return makeRes(listBody("uulf", 0)); // UULF broken/empty
      if (pid === uu) return makeRes(listBody("uu", 3)); // UU has uploads
      throw new Error(`unexpected playlistId ${pid}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { refs, usedUU } = await getChannelUploads(CHANNEL_ID, { maxPages: 1 });
    expect(usedUU).toBe(true);
    expect(refs.map((r) => r.videoId)).toEqual(["uu-0", "uu-1", "uu-2"]);
    // It listed UULF first, then UU — and NEVER search.list.
    const calledPaths = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calledPaths.some((u) => u.includes("/playlistItems"))).toBe(true);
    expect(calledPaths.some((u) => u.includes("/search"))).toBe(false);
  });

  it("stays on UULF (no fallback) when it lists items", async () => {
    const uulf = resolveUploadsPlaylistId(CHANNEL_ID);
    const fetchMock = vi.fn(async (url: string | URL) => {
      const pid = new URL(String(url)).searchParams.get("playlistId");
      if (pid === uulf) return makeRes(listBody("uulf", 5));
      throw new Error(`should not list ${pid}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { refs, usedUU } = await getChannelUploads(CHANNEL_ID, { maxPages: 1 });
    expect(usedUU).toBe(false);
    expect(refs).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second (UU) listing
  });

  it("honors a supplied UULF primaryPlaylistId and still falls back per channel", async () => {
    const uu = resolveUploadsPlaylistId(CHANNEL_ID, { useUULF: false });
    const primary = "UULFsuppliedplaylistid00";
    const fetchMock = vi.fn(async (url: string | URL) => {
      const pid = new URL(String(url)).searchParams.get("playlistId");
      if (pid === primary) return makeRes(listBody("p", 0));
      if (pid === uu) return makeRes(listBody("uu", 2));
      throw new Error(`unexpected ${pid}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { refs, usedUU } = await getChannelUploads(CHANNEL_ID, {
      primaryPlaylistId: primary,
      maxPages: 1,
    });
    expect(usedUU).toBe(true);
    expect(refs).toHaveLength(2);
  });
});
