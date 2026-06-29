import { describe, it, expect } from "vitest";
import { buildHomeFeed, sortVideos, DEFAULT_TIER_SLOTS, HOME_FEED_CAP } from "../src/lib/feed";
import type { Tier, Video } from "../src/lib/types";

// Deterministic Video factory. Newer index => older publish date so order is predictable.
function mkVideos(tier: Tier, n: number, prefix: string): Video[] {
  return Array.from({ length: n }, (_, i) => ({
    videoId: `${prefix}-${i}`,
    channelId: `UC${prefix}`,
    channelTitle: prefix,
    channelAvatarUrl: "",
    title: `${prefix} ${i}`,
    thumbnailUrl: "",
    durationSec: 600,
    viewCount: 1000 - i,
    likeCount: 10,
    // Tier 1 are the newest, then tier 2, then tier 3 — so "newest-first" would
    // naturally favor tier 1 first, letting us assert the tier split independently.
    publishedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n - i)).toISOString(),
    category: prefix,
    tier,
  }));
}

describe("buildHomeFeed — tier model (15/9/0)", () => {
  it("allocates exactly 15 Tier 1 + 9 Tier 2 and ZERO Tier 3 when all tiers are abundant", () => {
    const pool = [
      ...mkVideos(1, 30, "t1"),
      ...mkVideos(2, 30, "t2"),
      ...mkVideos(3, 30, "t3"),
    ];
    const feed = buildHomeFeed(pool);
    expect(feed).toHaveLength(24);
    expect(feed.filter((v) => v.tier === 1)).toHaveLength(15);
    expect(feed.filter((v) => v.tier === 2)).toHaveLength(9);
    expect(feed.filter((v) => v.tier === 3)).toHaveLength(0);
  });

  it("never surfaces a Tier 3 video on home, even if Tier 3 is the only abundant tier", () => {
    const pool = [...mkVideos(1, 2, "t1"), ...mkVideos(2, 2, "t2"), ...mkVideos(3, 100, "t3")];
    const feed = buildHomeFeed(pool);
    expect(feed.some((v) => v.tier === 3)).toBe(false);
    // Only the 4 active-tier videos are eligible; backfill must not pull Tier 3.
    expect(feed).toHaveLength(4);
  });

  it("backfills a short tier from the OTHER active tier (never Tier 3), capped at 24", () => {
    const pool = [...mkVideos(1, 5, "t1"), ...mkVideos(2, 40, "t2"), ...mkVideos(3, 40, "t3")];
    const feed = buildHomeFeed(pool);
    expect(feed).toHaveLength(24);
    expect(feed.filter((v) => v.tier === 1)).toHaveLength(5); // all available T1
    expect(feed.filter((v) => v.tier === 2)).toHaveLength(19); // 9 + 10 backfill
    expect(feed.every((v) => v.tier !== 3)).toBe(true);
  });

  it("respects a custom slot budget and never exceeds the cap", () => {
    const pool = [...mkVideos(1, 20, "t1"), ...mkVideos(2, 20, "t2")];
    const feed = buildHomeFeed(pool, { tier1: 4, tier2: 4, tier3: 0 }, 8);
    expect(feed).toHaveLength(8);
    expect(feed.filter((v) => v.tier === 1)).toHaveLength(4);
    expect(feed.filter((v) => v.tier === 2)).toHaveLength(4);
  });

  it("returns newest-first order", () => {
    const feed = buildHomeFeed([...mkVideos(1, 20, "t1"), ...mkVideos(2, 20, "t2")]);
    for (let i = 1; i < feed.length; i++) {
      expect(new Date(feed[i - 1].publishedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(feed[i].publishedAt).getTime(),
      );
    }
  });

  it("exposes the locked default slot budget", () => {
    expect(DEFAULT_TIER_SLOTS).toEqual({ tier1: 15, tier2: 9, tier3: 0 });
    expect(HOME_FEED_CAP).toBe(24);
  });
});

describe("sortVideos", () => {
  const v = [...mkVideos(2, 5, "s")];
  it("popular sorts by viewCount desc", () => {
    const out = sortVideos(v, "popular");
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].viewCount).toBeGreaterThanOrEqual(out[i].viewCount);
    }
  });
  it("oldest sorts by publishedAt asc", () => {
    const out = sortVideos(v, "oldest");
    for (let i = 1; i < out.length; i++) {
      expect(new Date(out[i - 1].publishedAt).getTime()).toBeLessThanOrEqual(
        new Date(out[i].publishedAt).getTime(),
      );
    }
  });
  it("latest sorts by publishedAt desc and does not mutate input", () => {
    const copy = [...v];
    const out = sortVideos(v, "latest");
    expect(v).toEqual(copy);
    expect(new Date(out[0].publishedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(out[out.length - 1].publishedAt).getTime(),
    );
  });
});
