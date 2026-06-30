// Focus Feed ranking math — Phase 2 (PHASE_2_SPEC.md §4/§6, context.md §5 ratified in §0.5).
//
// Pure, deterministic, side-effect-free: every function is a referentially-transparent map
// from (video, context) to a number. No I/O, no clock reads (the caller passes ctx.now), no
// randomness — so the whole ranker is exhaustively unit-testable and produces a stable order
// within a render. This module computes QUALITY/DISCOVERY signals only; nothing here rewards
// longer sessions (the anti-distraction boundary — PHASE_2_SPEC §0).
//
// Default model is S₁, the Hacker-News gravity formula adapted to a closed channel set:
//   S₁ = (V^a / (T+2)^g) · C_cat · P_seen · freshness · anti-repetition
// where (T+2)^g is the literal HN gravity denominator and V^a (a<1) dampens mega-view dominance.

import type { RankContext, Video } from "./types";

/** Age of a video in hours relative to ctx.now. Unparseable dates sink (treated as ancient). */
export function ageHours(video: Video, now: number): number {
  const t = Date.parse(video.publishedAt);
  if (!Number.isFinite(t)) return Number.MAX_SAFE_INTEGER / 3_600_000;
  return Math.max(0, (now - t) / 3_600_000);
}

/** Time-decay term for S₂: exp(−λT) or 1/(1+T/τ), both in (0,1]. */
export function decay(ageHrs: number, ctx: RankContext): number {
  const cfg = ctx.config;
  return cfg.decayKind === "exp"
    ? Math.exp(-cfg.lambda * ageHrs)
    : 1 / (1 + ageHrs / cfg.tau);
}

/**
 * P_seen: a watched video OLDER than the freshness window is heavily damped (~0.05); a video
 * inside the freshness window bypasses the penalty entirely so new uploads always surface.
 */
export function seenFactor(videoId: string, ctx: RankContext, ageHrs: number): number {
  if (ageHrs < ctx.config.freshnessWindowHours) return 1;
  return ctx.visited.has(videoId) ? ctx.config.seenFactor : 1;
}

/** Flat multiplicative boost for videos newer than the freshness window; else 1.0. */
export function freshnessBoost(ageHrs: number, ctx: RankContext): number {
  return ageHrs < ctx.config.freshnessWindowHours ? ctx.config.freshnessBoost : 1;
}

/**
 * Anti-repetition: a video shown on home but not clicked is demoted by (1−p)^shownCount,
 * floored so it never vanishes outright. A clicked video becomes `visited` and is governed
 * by P_seen instead, so this penalty only shapes the still-unwatched backlog.
 */
export function repetitionPenalty(videoId: string, ctx: RankContext): number {
  const shown = ctx.impressions.get(videoId)?.shownCount ?? 0;
  if (shown <= 0) return 1;
  const cfg = ctx.config;
  return Math.max(cfg.repetitionFloor, (1 - cfg.repetitionPenaltyPerShow) ** shown);
}

/**
 * Per-category balancing multiplier over a candidate set: C_cat = meanPerCategory / nCat,
 * anchored so the mean category is 1.0 — under-represented categories are boosted, over-
 * represented ones damped, so a single category cannot flood a tier's slots. Computed per
 * tier by the feed builder (PHASE_2_SPEC §6); supersedes context.md §5's static 4-category
 * table, which predated the tier roster. The anchor-to-mean rule is identical.
 */
export function categoryMultipliers(videos: Video[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of videos) counts.set(v.category, (counts.get(v.category) ?? 0) + 1);
  const out = new Map<string, number>();
  const nCat = counts.size;
  if (nCat === 0) return out;
  const meanPerCat = videos.length / nCat;
  for (const [cat, n] of counts) out.set(cat, meanPerCat / n);
  return out;
}

/** S₁ — gravity-decayed popularity (default ranker). */
export function scoreS1(video: Video, ctx: RankContext, cCat: number): number {
  const T = ageHours(video, ctx.now);
  const V = Math.max(0, video.viewCount);
  const base = V ** ctx.config.popularityExponent / (T + 2) ** ctx.config.gravity;
  return (
    base *
    cCat *
    seenFactor(video.videoId, ctx, T) *
    freshnessBoost(T, ctx) *
    repetitionPenalty(video.videoId, ctx)
  );
}

/** S₂ — linear component blend (flagged alternative; needs the pool's max view count). */
export function scoreS2(video: Video, ctx: RankContext, cCat: number, poolMaxView: number): number {
  const cfg = ctx.config;
  const T = ageHours(video, ctx.now);
  const normV =
    poolMaxView > 0 ? Math.log1p(Math.max(0, video.viewCount)) / Math.log1p(poolMaxView) : 0;
  const fresh = decay(T, ctx);
  const seen = ctx.visited.has(video.videoId) ? 1 : 0;
  const unwatched = 1 - seen;
  const lin = cfg.wPop * normV + cfg.wFresh * fresh + cfg.wUnwatched * unwatched - cfg.wSeen * seen;
  return Math.max(0, lin) * cCat * repetitionPenalty(video.videoId, ctx);
}

/** Dispatch on the configured model. `poolMaxView` is only read by S₂. */
export function scoreVideo(
  video: Video,
  ctx: RankContext,
  cCat: number,
  poolMaxView: number = video.viewCount,
): number {
  return ctx.config.model === "s2"
    ? scoreS2(video, ctx, cCat, poolMaxView)
    : scoreS1(video, ctx, cCat);
}
