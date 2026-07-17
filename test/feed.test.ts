import { describe, it, expect } from "vitest";
import {
  buildHomeFeed,
  mergeAdditionVideos,
  sortVideos,
  DEFAULT_TIER_SLOTS,
  HOME_FEED_CAP,
} from "../src/lib/feed";
import { DEFAULT_RANKING_CONFIG } from "../src/lib/ranking-config";
import type { ImpressionState, RankContext, Tier, Video } from "../src/lib/types";

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

// --- Phase 2: ranked mode (PHASE_2_SPEC §8) -------------------------------
const NOW = Date.UTC(2026, 5, 30, 0, 0, 0);

function rv(over: Partial<Video> & { videoId: string; tier: Tier; hoursOld: number }): Video {
  const { hoursOld, ...rest } = over;
  return {
    channelId: "UCx",
    channelTitle: "c",
    channelAvatarUrl: "",
    title: rest.videoId,
    thumbnailUrl: "",
    durationSec: 600,
    viewCount: 1000,
    likeCount: 10,
    publishedAt: new Date(NOW - hoursOld * 3_600_000).toISOString(),
    category: "Islamic",
    ...rest,
  };
}

function ctxOf(over: {
  visited?: string[];
  impressions?: ImpressionState[];
  config?: Partial<typeof DEFAULT_RANKING_CONFIG>;
} = {}): RankContext {
  return {
    now: NOW,
    visited: new Set(over.visited ?? []),
    impressions: new Map((over.impressions ?? []).map((i) => [i.videoId, i])),
    config: { ...DEFAULT_RANKING_CONFIG, ...over.config },
  };
}

describe("buildHomeFeed — ranked mode (Phase 2)", () => {
  it("is byte-for-byte the Phase 1 newest-first result when ctx is omitted (back-compat)", () => {
    const pool = [...mkVideos(1, 30, "t1"), ...mkVideos(2, 30, "t2"), ...mkVideos(3, 30, "t3")];
    expect(buildHomeFeed(pool)).toEqual(buildHomeFeed(pool, DEFAULT_TIER_SLOTS, HOME_FEED_CAP));
  });

  it("still honors the 15/9/0 split and never surfaces Tier 3 under ranking", () => {
    const pool = [
      ...Array.from({ length: 30 }, (_, i) =>
        rv({ videoId: `a${i}`, tier: 1, hoursOld: 100 + i, viewCount: 1000 + i }),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        rv({ videoId: `b${i}`, tier: 2, hoursOld: 100 + i, viewCount: 1000 + i }),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        rv({ videoId: `c${i}`, tier: 3, hoursOld: 100 + i, viewCount: 9_000_000 }),
      ),
    ];
    const feed = buildHomeFeed(pool, DEFAULT_TIER_SLOTS, HOME_FEED_CAP, ctxOf());
    expect(feed).toHaveLength(24);
    expect(feed.filter((v) => v.tier === 1)).toHaveLength(15);
    expect(feed.filter((v) => v.tier === 2)).toHaveLength(9);
    expect(feed.some((v) => v.tier === 3)).toBe(false); // even with 9M views, Tier 3 never enters
  });

  it("orders the grid by score (more popular, same age => earlier)", () => {
    const pool = [
      rv({ videoId: "low", tier: 1, hoursOld: 200, viewCount: 100 }),
      rv({ videoId: "high", tier: 1, hoursOld: 200, viewCount: 1_000_000 }),
      rv({ videoId: "mid", tier: 1, hoursOld: 200, viewCount: 10_000 }),
    ];
    const feed = buildHomeFeed(pool, DEFAULT_TIER_SLOTS, HOME_FEED_CAP, ctxOf());
    expect(feed.map((v) => v.videoId)).toEqual(["high", "mid", "low"]);
  });

  it("demotes a heavily-shown (anti-repetition) video below an equal never-shown one", () => {
    const pool = [
      rv({ videoId: "shown", tier: 1, hoursOld: 300, viewCount: 1000 }),
      rv({ videoId: "fresh-to-eyes", tier: 1, hoursOld: 300, viewCount: 1000 }),
    ];
    const ctx = ctxOf({ impressions: [{ videoId: "shown", shownCount: 6, lastShownAt: "x" }] });
    const feed = buildHomeFeed(pool, DEFAULT_TIER_SLOTS, HOME_FEED_CAP, ctx);
    expect(feed[0].videoId).toBe("fresh-to-eyes");
  });

  it("reserves back-catalogue slots for old unwatched videos when they exist", () => {
    // 30 high-score recent + 6 low-score old(>30d) unwatched Tier-1 videos. tier1 budget 15,
    // reserve = round(15*0.2) = 3. The 3 reserved old gems must appear despite losing on score;
    // the other 3 old ones stay out because the recent backfill outranks them up to the 24-cap.
    const recent = Array.from({ length: 30 }, (_, i) =>
      rv({ videoId: `r${i}`, tier: 1, hoursOld: 10 + i, viewCount: 5000 }),
    );
    const old = Array.from({ length: 6 }, (_, i) =>
      rv({ videoId: `o${i}`, tier: 1, hoursOld: 24 * 40 + i, viewCount: 50 }),
    );
    const feed = buildHomeFeed([...recent, ...old], DEFAULT_TIER_SLOTS, HOME_FEED_CAP, ctxOf());
    const oldShown = feed.filter((v) => v.videoId.startsWith("o")).length;
    expect(oldShown).toBe(3); // exactly the reserve, despite their low score
  });
});

describe("mergeAdditionVideos — user channel additions overlay (add-channels-by-URL)", () => {
  it("concatenates addition videos with the base pool, deduped by videoId", () => {
    const base = mkVideos(1, 3, "base");
    const additions = mkVideos(2, 2, "add");
    const merged = mergeAdditionVideos(base, additions);
    expect(merged).toHaveLength(5);
    expect(merged.map((v) => v.videoId).sort()).toEqual(
      [...base, ...additions].map((v) => v.videoId).sort(),
    );
  });

  it("addition wins: a base video from a channel the user also added is dropped in favor of the addition copy", () => {
    const sharedChannelId = "UCshared";
    const baseVideo = { ...mkVideos(1, 1, "x")[0], channelId: sharedChannelId, videoId: "shared-vid" };
    const additionVideo = { ...mkVideos(2, 1, "y")[0], channelId: sharedChannelId, videoId: "shared-vid" };
    const merged = mergeAdditionVideos([baseVideo], [additionVideo]);
    expect(merged).toHaveLength(1);
    expect(merged[0].tier).toBe(2); // the addition's tier, not the base video's
  });

  it("with no additions, returns the base pool unchanged", () => {
    const base = mkVideos(1, 4, "base");
    expect(mergeAdditionVideos(base, [])).toEqual(base);
  });
});

describe("buildHomeFeed with user channel additions present", () => {
  it("still allocates exactly 15/9/0 when Tier-1/2 additions are merged into an abundant base pool", () => {
    const base = [...mkVideos(1, 20, "b1"), ...mkVideos(2, 20, "b2")];
    const additions = [...mkVideos(1, 5, "a1"), ...mkVideos(2, 5, "a2")];
    const merged = mergeAdditionVideos(base, additions);
    const feed = buildHomeFeed(merged);
    expect(feed).toHaveLength(24);
    expect(feed.filter((v) => v.tier === 1)).toHaveLength(15);
    expect(feed.filter((v) => v.tier === 2)).toHaveLength(9);
    expect(feed.filter((v) => v.tier === 3)).toHaveLength(0);
  });

  it("a Tier-3 addition gets ZERO home slots, same as baked Tier 3", () => {
    const base = [...mkVideos(1, 2, "b1"), ...mkVideos(2, 2, "b2")];
    const tier3Addition = mkVideos(3, 50, "a3"); // abundant, but tier 3
    const merged = mergeAdditionVideos(base, tier3Addition);
    const feed = buildHomeFeed(merged);
    expect(feed.some((v) => v.tier === 3)).toBe(false);
    expect(feed).toHaveLength(4); // only the 4 active-tier base videos are eligible
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
