// Unified Focus Feed builder — Phase 1 (PHASE_1_SPEC §4/§6, PRD §6).
//
// Phase 1 ships the COLD-START reduction of the full Focus Feed: a tier-weighted,
// newest-first home grid hard-capped at 24 with a caught-up state. No popularity/decay
// weighting yet (that is Phase 2, additive). No metric here optimizes for time-on-app.
//
// TIER MODEL (locked, PRD §2): the home feed allocates exactly Tier 1 = 15 / Tier 2 = 9 /
// Tier 3 = 0 of its 24 slots. Tier 3 (Entertainment) receives ZERO home slots and is never
// surfaced on home — it is reachable via its channel page only. Backfill, when a tier is
// short, draws only from the other ACTIVE tiers (1 and 2); Tier 3 is excluded structurally.

import type { RankContext, Video } from "./types";
import { ageHours, categoryMultipliers, scoreVideo } from "./ranking";

export const HOME_FEED_CAP = 24;

export type TierSlots = { tier1: number; tier2: number; tier3: number };
export const DEFAULT_TIER_SLOTS: TierSlots = { tier1: 15, tier2: 9, tier3: 0 };

function byNewest(a: Video, b: Video): number {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

function newestOfTier(videos: Video[], tier: 1 | 2 | 3, limit: number): Video[] {
  if (limit <= 0) return [];
  return videos
    .filter((v) => v.tier === tier)
    .sort(byNewest)
    .slice(0, limit);
}

/**
 * Build the home feed honoring the tier slot split (default 15/9/0), capped at `cap`.
 *
 * - **Phase 1 (ctx omitted):** newest-first within each tier's budget — the cold-start ranker.
 * - **Phase 2 (ctx provided):** the full Focus Feed ranking (PHASE_2_SPEC §6) — S₁/S₂ scoring,
 *   P_seen, freshness window, per-tier category balance, back-catalogue injection, and
 *   anti-repetition — applied *inside* each tier's budget.
 *
 * In BOTH modes the tier model is supreme: Tier 3 (and parked) videos are never scored, never
 * slotted, and never backfilled — an Entertainment video can never reach home. Ranking only
 * reorders within the 15/9 active budget; it can never change the split or surface Tier 3.
 */
export function buildHomeFeed(
  videos: Video[],
  slots: TierSlots = DEFAULT_TIER_SLOTS,
  cap: number = HOME_FEED_CAP,
  ctx?: RankContext,
): Video[] {
  if (!ctx) return buildNewestFirst(videos, slots, cap);
  return buildRanked(videos, slots, cap, ctx);
}

/** Phase 1 path: newest-first within tier budgets, newest backfill (Tiers 1|2 only), cap. */
function buildNewestFirst(videos: Video[], slots: TierSlots, cap: number): Video[] {
  const chosen: Video[] = [
    ...newestOfTier(videos, 1, slots.tier1),
    ...newestOfTier(videos, 2, slots.tier2),
    ...newestOfTier(videos, 3, slots.tier3),
  ];

  if (chosen.length < cap) {
    const used = new Set(chosen.map((v) => v.videoId));
    const rest = videos
      .filter((v) => (v.tier === 1 || v.tier === 2) && !used.has(v.videoId))
      .sort(byNewest);
    for (const v of rest) {
      if (chosen.length >= cap) break;
      chosen.push(v);
      used.add(v.videoId);
    }
  }

  return chosen.sort(byNewest).slice(0, cap);
}

/**
 * Phase 2 path: score every ACTIVE (Tier 1|2) video, allocate per tier with a back-catalogue
 * reserve, backfill by score, and order the grid by score. Tier 3 is excluded before scoring,
 * so the ranker can never grant it a slot.
 */
function buildRanked(videos: Video[], slots: TierSlots, cap: number, ctx: RankContext): Video[] {
  const active = videos.filter((v) => v.tier === 1 || v.tier === 2);

  // Score every active video once (category multipliers computed per tier so balancing stays
  // inside a tier's budget). S₂ needs the per-tier max view count for log-normalization.
  const scoreById = new Map<string, number>();
  for (const tier of [1, 2] as const) {
    const cand = active.filter((v) => v.tier === tier);
    const cMap = categoryMultipliers(cand);
    const maxView = cand.reduce((m, v) => Math.max(m, v.viewCount), 0);
    for (const v of cand) {
      scoreById.set(v.videoId, scoreVideo(v, ctx, cMap.get(v.category) ?? 1, maxView));
    }
  }
  const scoreOf = (v: Video): number => scoreById.get(v.videoId) ?? 0;
  const byScore = (a: Video, b: Video): number => scoreOf(b) - scoreOf(a) || byNewest(a, b);

  const cfg = ctx.config;
  const minBackAgeHrs = cfg.backCatalogueMinAgeDays * 24;
  const chosen: Video[] = [];
  const used = new Set<string>();

  for (const tier of [1, 2] as const) {
    const budget = tier === 1 ? slots.tier1 : slots.tier2;
    if (budget <= 0) continue;
    const ranked = active.filter((v) => v.tier === tier).sort(byScore);

    // Back-catalogue: high-score UNWATCHED videos older than the min age. Reserve only as many
    // slots as there are real candidates, so the reserve never displaces a higher-score pick
    // with a recency-backfilled blank when no old gems exist.
    const backPool = ranked.filter(
      (v) => !ctx.visited.has(v.videoId) && ageHours(v, ctx.now) > minBackAgeHrs,
    );
    const reserve = Math.min(Math.round(budget * cfg.backCatalogueFraction), backPool.length);
    const back = backPool.slice(0, reserve);
    const backIds = new Set(back.map((v) => v.videoId));
    const main = ranked.filter((v) => !backIds.has(v.videoId)).slice(0, budget - reserve);

    for (const v of [...main, ...back]) {
      if (!used.has(v.videoId)) {
        chosen.push(v);
        used.add(v.videoId);
      }
    }
  }

  // Backfill toward cap from the highest-score unused ACTIVE videos — never Tier 3.
  if (chosen.length < cap) {
    const rest = active.filter((v) => !used.has(v.videoId)).sort(byScore);
    for (const v of rest) {
      if (chosen.length >= cap) break;
      chosen.push(v);
      used.add(v.videoId);
    }
  }

  // Final grid order is by score (a re-sort by newest here would negate the ranker).
  return chosen.sort(byScore).slice(0, cap);
}

/**
 * Merge user-added-channel videos into the base pool (user channels feature). "Addition wins":
 * any base-pool video whose channel was also user-added is dropped in favor of the addition's
 * (freshly tagged tier/category) copy, then the two sets are deduped by videoId. Pure so the
 * 15/9/0 tier allocation with additions present is unit-testable without any network.
 */
export function mergeAdditionVideos(basePool: Video[], additionVideos: Video[]): Video[] {
  const additionChannelIds = new Set(additionVideos.map((v) => v.channelId));
  const filteredBase = basePool.filter((v) => !additionChannelIds.has(v.channelId));
  const seen = new Set<string>();
  const merged: Video[] = [];
  for (const v of [...additionVideos, ...filteredBase]) {
    if (seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    merged.push(v);
  }
  return merged;
}

/** Channel-archive sort (PRD §5.2). */
export function sortVideos(videos: Video[], mode: "latest" | "popular" | "oldest"): Video[] {
  const v = [...videos];
  switch (mode) {
    case "popular":
      return v.sort((a, b) => b.viewCount - a.viewCount);
    case "oldest":
      return v.sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
    case "latest":
    default:
      return v.sort(byNewest);
  }
}
