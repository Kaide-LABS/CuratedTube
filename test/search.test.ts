import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filterByKeyword } from "../src/lib/search";
import type { Tier, Video } from "../src/lib/types";

function mkVideo(over: Partial<Video> & { videoId: string; title: string }): Video {
  return {
    channelId: "UCx",
    channelTitle: "Channel",
    channelAvatarUrl: "",
    thumbnailUrl: "",
    durationSec: 300,
    viewCount: 100,
    likeCount: 10,
    publishedAt: "2026-07-01T00:00:00Z",
    category: "Islamic",
    tier: 1 as Tier,
    ...over,
  };
}

describe("filterByKeyword — literal, case-insensitive title substring match", () => {
  const videos = [
    mkVideo({ videoId: "1", title: "Beginner's Guide to Tajweed" }),
    mkVideo({ videoId: "2", title: "Advanced Fiqh Rulings" }),
    mkVideo({ videoId: "3", title: "Your First Week Reciting" }),
  ];

  it("narrows the list to titles containing the term, case-insensitively", () => {
    expect(filterByKeyword(videos, "beginner").map((v) => v.videoId)).toEqual(["1"]);
    expect(filterByKeyword(videos, "BEGINNER").map((v) => v.videoId)).toEqual(["1"]);
  });

  it("empty query returns the full list unchanged", () => {
    expect(filterByKeyword(videos, "")).toEqual(videos);
    expect(filterByKeyword(videos, "   ")).toEqual(videos);
  });

  it("'-term' hides matches instead of including them", () => {
    const result = filterByKeyword(videos, "-beginner");
    expect(result.map((v) => v.videoId)).toEqual(["2", "3"]);
  });

  it("a bare '-' with nothing after it is a no-op (returns the list unchanged)", () => {
    expect(filterByKeyword(videos, "-")).toEqual(videos);
  });

  it("EXPLICIT LIMITATION: literal keyword matching does not catch meaning without the word", () => {
    // "Your First Week Reciting" is beginner-oriented in MEANING but doesn't contain the literal
    // word "beginner" — filterByKeyword correctly does NOT match it. This is the documented,
    // accepted limitation (semantic filtering is a separate future feature).
    const result = filterByKeyword(videos, "beginner");
    expect(result.some((v) => v.videoId === "3")).toBe(false);
  });

  it("no match returns an empty array without throwing", () => {
    expect(filterByKeyword(videos, "nonexistent-term-xyz")).toEqual([]);
  });
});

describe("keyword search never makes an API call (static guarantee)", () => {
  it("search.ts itself contains no fetch/network calls of any kind", () => {
    const source = readFileSync(join(__dirname, "..", "src", "lib", "search.ts"), "utf8");
    expect(source).not.toMatch(/fetch\(/);
  });

  it("ChannelArchive's search box is a plain client-side filter, not wired to any fetch", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "components", "ChannelArchive.tsx"),
      "utf8",
    );
    expect(source).toMatch(/filterByKeyword/);
    expect(source).not.toMatch(/fetch\(/);
  });

  it("HomeFeed's search box filters the already-loaded pool, not wired to any new fetch for search", () => {
    const source = readFileSync(join(__dirname, "..", "src", "components", "HomeFeed.tsx"), "utf8");
    expect(source).toMatch(/filterByKeyword/);
    // The only fetch() calls in HomeFeed are the pre-existing addition-videos round trip —
    // filterByKeyword itself never triggers one.
    const fetchCalls = [...source.matchAll(/fetch\(/g)].length;
    const additionFetchCalls = [...source.matchAll(/fetch\("\/api\/feed\/additions"/g)].length;
    expect(fetchCalls).toBe(additionFetchCalls);
  });
});
