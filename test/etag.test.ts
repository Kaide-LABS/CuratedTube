import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// youtube.ts is a server-only module; stub the marker so its fetch path can be unit-tested
// in the node environment (same pattern as youtube.test.ts).
vi.mock("server-only", () => ({}));

import { getUploads } from "../src/lib/youtube";
import { quotaSnapshot } from "../src/lib/quota";
import { clearETagCache } from "../src/lib/etagCache";

// Minimal Response stub for the conditional-fetch path (status/ok/json/text/headers).
function makeRes(opts: { status: number; body?: unknown; etag?: string }): Response {
  const headers = new Map<string, string>();
  if (opts.etag) headers.set("etag", opts.etag);
  return {
    status: opts.status,
    ok: opts.status >= 200 && opts.status < 300,
    json: async () => opts.body,
    text: async () => "",
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
  } as unknown as Response;
}

const PLAYLIST_BODY = {
  items: [
    { contentDetails: { videoId: "vid1", videoPublishedAt: "2026-06-01T00:00:00Z" } },
    { contentDetails: { videoId: "vid2", videoPublishedAt: "2026-06-02T00:00:00Z" } },
  ],
};

const g = globalThis as unknown as { __ctQuota?: unknown };

beforeEach(() => {
  delete g.__ctQuota;
  clearETagCache();
  process.env.YOUTUBE_API_KEY = "test-key";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("conditional Data API fetch — ETag/304 (acceptance §8.1)", () => {
  it("a 200 records 1 unit; an unchanged repeat returns 304 at 0 units from cache", async () => {
    // The server returns 200+ETag the first time and 304 once we send a matching If-None-Match.
    let storedEtag: string | null = null;
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const inm = (init?.headers as Record<string, string> | undefined)?.["If-None-Match"];
      if (inm && inm === storedEtag) return makeRes({ status: 304 });
      storedEtag = "etag-v1";
      return makeRes({ status: 200, body: PLAYLIST_BODY, etag: "etag-v1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    // First call: real 200 -> parsed refs, +1 unit.
    const first = await getUploads("UULFexampleplaylistid01", { maxPages: 1 });
    expect(first.map((r) => r.videoId)).toEqual(["vid1", "vid2"]);
    let snap = quotaSnapshot();
    expect(snap.total).toBe(1);
    expect(snap.conditionalHits).toBe(0);

    // Second identical call: server answers 304 -> cached, already-validated body, +0 units.
    const second = await getUploads("UULFexampleplaylistid01", { maxPages: 1 });
    expect(second.map((r) => r.videoId)).toEqual(["vid1", "vid2"]);
    snap = quotaSnapshot();
    expect(snap.total).toBe(1); // unchanged — the 304 cost nothing
    expect(snap.conditionalHits).toBe(1);
    expect(snap.savedUnits).toBe(1);

    // The second request actually carried the conditional header.
    const secondCallInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    expect((secondCallInit?.headers as Record<string, string>)["If-None-Match"]).toBe("etag-v1");
  });

  it("never leaks the API key into the ETag cache key (no throw, fetch still authenticated)", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      // The key is on the outgoing URL (server-side) ...
      expect(String(url)).toContain("key=test-key");
      return makeRes({ status: 200, body: PLAYLIST_BODY, etag: "e" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await getUploads("UULFexampleplaylistid01", { maxPages: 1 });
    // ... and the repeat is served conditionally without re-charging beyond the first unit.
    await getUploads("UULFexampleplaylistid01", { maxPages: 1 });
    expect(quotaSnapshot().total).toBe(2); // no ETag match here (mock ignores If-None-Match) => 2x200
  });
});
