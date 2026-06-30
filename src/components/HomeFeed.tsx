"use client";

import { useEffect, useMemo, useState } from "react";
import type { ImpressionState, RankContext, Video } from "@/lib/types";
import { buildHomeFeed, sortVideos, HOME_FEED_CAP } from "@/lib/feed";
import { DEFAULT_RANKING_CONFIG } from "@/lib/ranking-config";
import { getImpressionMap, getWatchSignals, recordImpressions } from "@/lib/watchState";
import { CategoryFilterBar, type CategoryOption } from "./CategoryFilterBar";
import { VideoPreviewCard } from "./VideoPreviewCard";
import { CaughtUpBlocker } from "./CaughtUpBlocker";

const STORAGE_KEY = "ct:home:category";

/**
 * Home Focus Feed (PHASE_2_SPEC §6). The "All" view is the full Phase 2 ranking — S₁ gravity
 * popularity, P_seen, freshness window, per-tier category balance, back-catalogue injection,
 * and anti-repetition — built from IndexedDB watch + impression signals. A specific category
 * stays newest-first. Either way the grid is finite (≤24) and ends in the caught-up block.
 */
export function HomeFeed({ pool }: { pool: Video[] }) {
  // Distinct categories present in the (Tier 1∪2) pool, for the filter pills.
  const options = useMemo<CategoryOption[]>(() => {
    const present = [...new Set(pool.map((v) => v.category))].filter(Boolean).sort();
    return ["All", ...present];
  }, [pool]);

  const [selected, setSelected] = useState<CategoryOption>("All");
  const [visited, setVisited] = useState<Set<string>>(new Set());
  const [impressions, setImpressions] = useState<Map<string, ImpressionState>>(new Map());
  // Ranking depends on the current time (video ages) and on client-only IndexedDB signals, so
  // it must run AFTER mount: the server prerender and first client render both show the
  // deterministic newest-first view (no hydration mismatch), then it upgrades to the ranked view.
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(0);

  // Restore the session's category selection.
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY) as CategoryOption | null;
    if (saved) setSelected(saved);
  }, []);

  // Persist selection for the session.
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, selected);
  }, [selected]);

  // Mark mounted + capture the client clock, then load the ranking signals (visited set for
  // P_seen, impressions for anti-repetition).
  useEffect(() => {
    let alive = true;
    setMounted(true);
    setNow(Date.now());
    Promise.all([getWatchSignals(), getImpressionMap()]).then(([w, imp]) => {
      if (!alive) return;
      setVisited(w.visited);
      setImpressions(imp);
    });
    return () => {
      alive = false;
    };
  }, []);

  const ctx = useMemo<RankContext>(
    () => ({ now, visited, impressions, config: DEFAULT_RANKING_CONFIG }),
    [now, visited, impressions],
  );

  // "All" -> ranked tier-weighted 24 (15 Tier 1 / 9 Tier 2 / 0 Tier 3) once mounted; before
  // mount it is the deterministic newest-first build. A specific category -> newest 24.
  const view = useMemo(() => {
    if (selected !== "All") {
      return sortVideos(
        pool.filter((v) => v.category === selected),
        "latest",
      ).slice(0, HOME_FEED_CAP);
    }
    return mounted
      ? buildHomeFeed(pool, undefined, HOME_FEED_CAP, ctx)
      : buildHomeFeed(pool, undefined, HOME_FEED_CAP);
  }, [pool, selected, mounted, ctx]);

  // Anti-repetition: record an impression for the ranked videos actually shown (idempotent per
  // session). Only the "All" view feeds the cross-session penalty; category browsing does not.
  useEffect(() => {
    if (!mounted || selected !== "All" || view.length === 0) return;
    void recordImpressions(view.map((v) => v.videoId));
  }, [mounted, selected, view]);

  return (
    <div className="px-4 py-6">
      <CategoryFilterBar options={options} selected={selected} onSelect={setSelected} />
      <div className="grid grid-cols-1 gap-5 pt-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {view.map((v) => (
          <VideoPreviewCard key={v.videoId} video={v} visited={visited.has(v.videoId)} />
        ))}
        <CaughtUpBlocker count={view.length} />
      </div>
    </div>
  );
}
