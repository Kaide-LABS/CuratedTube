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

import type { Video } from "./types";

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
 * Build the home feed honoring the tier slot split (default 15/9/0), newest-first, capped.
 *
 * Tier 3 always contributes 0 (its slot is 0 and backfill excludes it), so an Entertainment
 * video can never reach home. If a tier has fewer videos than its budget, leftover slots are
 * backfilled with the newest remaining Tier 1/2 videos so the grid still fills toward `cap`.
 */
export function buildHomeFeed(
  videos: Video[],
  slots: TierSlots = DEFAULT_TIER_SLOTS,
  cap: number = HOME_FEED_CAP,
): Video[] {
  const chosen: Video[] = [
    ...newestOfTier(videos, 1, slots.tier1),
    ...newestOfTier(videos, 2, slots.tier2),
    ...newestOfTier(videos, 3, slots.tier3),
  ];

  // Backfill remaining slots from the newest unused ACTIVE-tier (1|2) videos — never Tier 3.
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
