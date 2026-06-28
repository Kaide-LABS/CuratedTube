// Unified Focus Feed builder — Phase 1 (PRD §6, §9.5).
//
// Phase 1 ships the COLD-START reduction of the full Focus Feed: category-balanced,
// newest-first, hard-capped at 24 with a caught-up state. No popularity/decay weighting
// yet (that is Phase 2, additive). No metric here optimizes for time-on-app.
//
// Category balance: C_cat = mean_channels_per_category / n_cat. Under-represented
// categories are guaranteed a fairer share of the 24 slots than raw upload volume would
// give them, so a 9-channel category can't structurally flood the grid (PRD §6).

import type { Category, ChannelConfig, Video } from "./types";
import { CATEGORIES } from "./types";

export const HOME_FEED_CAP = 24;

/** C_cat per category present in the config. Mean anchored to 1.0. */
export function computeCategoryWeights(channels: ChannelConfig[]): Map<Category, number> {
  const counts = new Map<Category, number>();
  for (const c of channels) counts.set(c.category, (counts.get(c.category) || 0) + 1);

  const present = [...counts.keys()];
  const total = channels.length;
  const mean = present.length > 0 ? total / present.length : 1;

  const weights = new Map<Category, number>();
  for (const cat of present) {
    const nCat = counts.get(cat) || 1;
    weights.set(cat, mean / nCat);
  }
  return weights;
}

function byNewest(a: Video, b: Video): number {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

/**
 * Allocate `cap` slots across categories proportionally to C_cat share, then fill each
 * with that category's newest videos, then present the union newest-first. Leftover slots
 * (a category had fewer videos than its allocation) are backfilled with the global newest.
 */
export function buildUnifiedFeed(
  videos: Video[],
  channels: ChannelConfig[],
  cap: number = HOME_FEED_CAP,
): Video[] {
  if (videos.length <= cap) return [...videos].sort(byNewest);

  const weights = computeCategoryWeights(channels);

  // Bucket videos by category, newest-first within each.
  const buckets = new Map<Category, Video[]>();
  for (const cat of CATEGORIES) buckets.set(cat, []);
  for (const v of videos) {
    if (!buckets.has(v.category)) buckets.set(v.category, []);
    buckets.get(v.category)!.push(v);
  }
  for (const list of buckets.values()) list.sort(byNewest);

  // Slot allocation proportional to C_cat among categories that actually have videos.
  const activeCats = [...buckets.entries()].filter(([, l]) => l.length > 0).map(([c]) => c);
  const weightSum = activeCats.reduce((s, c) => s + (weights.get(c) ?? 1), 0) || 1;

  const allocation = new Map<Category, number>();
  let allocated = 0;
  for (const cat of activeCats) {
    const share = (weights.get(cat) ?? 1) / weightSum;
    const slots = Math.min(Math.round(share * cap), buckets.get(cat)!.length);
    allocation.set(cat, slots);
    allocated += slots;
  }

  // Take the allocated newest-per-category.
  const chosen: Video[] = [];
  const used = new Set<string>();
  for (const cat of activeCats) {
    for (const v of buckets.get(cat)!.slice(0, allocation.get(cat) || 0)) {
      chosen.push(v);
      used.add(v.videoId);
    }
  }

  // Backfill any remaining slots from the global newest pool (rounding / short buckets).
  if (chosen.length < cap) {
    const rest = videos.filter((v) => !used.has(v.videoId)).sort(byNewest);
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
