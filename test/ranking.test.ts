import { describe, it, expect } from "vitest";
import {
  ageHours,
  decay,
  seenFactor,
  freshnessBoost,
  repetitionPenalty,
  categoryMultipliers,
  scoreS1,
  scoreVideo,
} from "../src/lib/ranking";
import { DEFAULT_RANKING_CONFIG } from "../src/lib/ranking-config";
import type { ImpressionState, RankContext, RankingConfig, Tier, Video } from "../src/lib/types";

const NOW = Date.UTC(2026, 5, 30, 0, 0, 0); // fixed clock for deterministic ages

function mkVideo(over: Partial<Video> & { hoursOld: number }): Video {
  const { hoursOld, ...rest } = over;
  return {
    videoId: rest.videoId ?? "v",
    channelId: "UCx",
    channelTitle: "c",
    channelAvatarUrl: "",
    title: "t",
    thumbnailUrl: "",
    durationSec: 600,
    viewCount: 1000,
    likeCount: 10,
    publishedAt: new Date(NOW - hoursOld * 3_600_000).toISOString(),
    category: "Islamic",
    tier: 1 as Tier,
    ...rest,
  };
}

function mkCtx(over: {
  visited?: string[];
  impressions?: ImpressionState[];
  config?: Partial<RankingConfig>;
}): RankContext {
  return {
    now: NOW,
    visited: new Set(over.visited ?? []),
    impressions: new Map((over.impressions ?? []).map((i) => [i.videoId, i])),
    config: { ...DEFAULT_RANKING_CONFIG, ...over.config },
  };
}

describe("ageHours", () => {
  it("computes whole-hour ages relative to ctx.now", () => {
    expect(ageHours(mkVideo({ hoursOld: 10 }), NOW)).toBeCloseTo(10, 6);
  });
  it("clamps future timestamps to 0", () => {
    expect(ageHours(mkVideo({ hoursOld: -5 }), NOW)).toBe(0);
  });
  it("sinks unparseable dates (treated as ancient)", () => {
    expect(ageHours(mkVideo({ hoursOld: 0, publishedAt: "" }), NOW)).toBeGreaterThan(1e6);
  });
});

describe("decay", () => {
  it("exp decay is 1 at t=0 and strictly decreasing", () => {
    const ctx = mkCtx({ config: { decayKind: "exp" } });
    expect(decay(0, ctx)).toBeCloseTo(1, 6);
    expect(decay(100, ctx)).toBeLessThan(decay(10, ctx));
  });
  it("reciprocal decay is 1 at t=0 and 0.5 at t=tau", () => {
    const ctx = mkCtx({ config: { decayKind: "reciprocal", tau: 48 } });
    expect(decay(0, ctx)).toBe(1);
    expect(decay(48, ctx)).toBeCloseTo(0.5, 6);
  });
});

describe("seenFactor (P_seen) — acceptance §8.3/§8.4", () => {
  it("damps a WATCHED video that is OLDER than the freshness window", () => {
    const ctx = mkCtx({ visited: ["v"], config: { freshnessWindowHours: 72, seenFactor: 0.05 } });
    expect(seenFactor("v", ctx, 100)).toBe(0.05);
  });
  it("does NOT damp an unwatched old video", () => {
    const ctx = mkCtx({ config: { freshnessWindowHours: 72 } });
    expect(seenFactor("v", ctx, 100)).toBe(1);
  });
  it("a FRESH watched video bypasses the penalty entirely", () => {
    const ctx = mkCtx({ visited: ["v"], config: { freshnessWindowHours: 72 } });
    expect(seenFactor("v", ctx, 10)).toBe(1);
  });
});

describe("freshnessBoost", () => {
  it("boosts inside the window and is neutral outside", () => {
    const ctx = mkCtx({ config: { freshnessWindowHours: 72, freshnessBoost: 1.25 } });
    expect(freshnessBoost(10, ctx)).toBe(1.25);
    expect(freshnessBoost(100, ctx)).toBe(1);
  });
});

describe("repetitionPenalty (anti-repetition) — acceptance §8.7", () => {
  it("is neutral when never shown", () => {
    expect(repetitionPenalty("v", mkCtx({}))).toBe(1);
  });
  it("decays by (1-p)^shownCount", () => {
    const ctx = mkCtx({
      impressions: [{ videoId: "v", shownCount: 2, lastShownAt: "x" }],
      config: { repetitionPenaltyPerShow: 0.15, repetitionFloor: 0 },
    });
    expect(repetitionPenalty("v", ctx)).toBeCloseTo(0.85 * 0.85, 6);
  });
  it("never drops below the floor", () => {
    const ctx = mkCtx({
      impressions: [{ videoId: "v", shownCount: 50, lastShownAt: "x" }],
      config: { repetitionPenaltyPerShow: 0.5, repetitionFloor: 0.4 },
    });
    expect(repetitionPenalty("v", ctx)).toBe(0.4);
  });
});

describe("categoryMultipliers (C_cat) — acceptance §8.5", () => {
  it("anchors the mean category to 1.0 and damps the over-represented one", () => {
    const vids = [
      mkVideo({ videoId: "a", category: "A", hoursOld: 1 }),
      mkVideo({ videoId: "b", category: "A", hoursOld: 1 }),
      mkVideo({ videoId: "c", category: "A", hoursOld: 1 }),
      mkVideo({ videoId: "d", category: "B", hoursOld: 1 }),
    ];
    const m = categoryMultipliers(vids);
    expect(m.get("A")).toBeCloseTo(2 / 3, 6); // over-represented -> damped (<1)
    expect(m.get("B")).toBeCloseTo(2, 6); // under-represented -> boosted (>1)
    // count-weighted mean of C_cat == 1.0
    const weighted = (3 * (m.get("A") as number) + 1 * (m.get("B") as number)) / 4;
    expect(weighted).toBeCloseTo(1, 6);
  });
  it("returns an empty map for no videos", () => {
    expect(categoryMultipliers([]).size).toBe(0);
  });
});

describe("scoreS1 — gravity popularity with P_seen", () => {
  it("ranks an unwatched video above an identical watched one (outside freshness window)", () => {
    const old = { hoursOld: 200, viewCount: 5000, videoId: "u" };
    const unwatched = scoreS1(mkVideo(old), mkCtx({}), 1);
    const watched = scoreS1(
      mkVideo({ ...old, videoId: "w" }),
      mkCtx({ visited: ["w"], config: { seenFactor: 0.05 } }),
      1,
    );
    expect(unwatched).toBeGreaterThan(watched);
    expect(watched / unwatched).toBeCloseTo(0.05, 6);
  });
  it("ranks a fresher video above an older one at equal popularity", () => {
    const fresh = scoreS1(mkVideo({ hoursOld: 80, viewCount: 1000, videoId: "f" }), mkCtx({}), 1);
    const stale = scoreS1(mkVideo({ hoursOld: 800, viewCount: 1000, videoId: "s" }), mkCtx({}), 1);
    expect(fresh).toBeGreaterThan(stale);
  });
  it("does not penalize a fresh watched video (freshness bypass)", () => {
    const v = mkVideo({ hoursOld: 10, viewCount: 1000, videoId: "x" });
    const seen = scoreS1(v, mkCtx({ visited: ["x"] }), 1);
    const unseen = scoreS1(v, mkCtx({}), 1);
    expect(seen).toBeCloseTo(unseen, 6);
  });
});

describe("scoreVideo dispatch", () => {
  it("uses S₂ when configured and stays finite/non-negative", () => {
    const v = mkVideo({ hoursOld: 50, viewCount: 1000 });
    const s = scoreVideo(v, mkCtx({ config: { model: "s2" } }), 1, 10000);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});
