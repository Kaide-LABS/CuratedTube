"use client";

import { useEffect, useMemo, useState } from "react";
import type { ImpressionState, RankContext, Video } from "@/lib/types";
import { VideoSchema } from "@/lib/types";
import { buildHomeFeed, mergeAdditionVideos, sortVideos, HOME_FEED_CAP } from "@/lib/feed";
import { DEFAULT_RANKING_CONFIG } from "@/lib/ranking-config";
import { getImpressionMap, getWatchSignals, recordImpressions } from "@/lib/watchState";
import { getUserChannels } from "@/lib/userChannels";
import { z } from "zod";
import { CategoryFilterBar, type CategoryOption } from "./CategoryFilterBar";
import { VideoPreviewCard } from "./VideoPreviewCard";
import { CaughtUpBlocker } from "./CaughtUpBlocker";

const STORAGE_KEY = "ct:home:category";
const AdditionVideosResponseSchema = z.object({ videos: z.array(VideoSchema) });

/**
 * Home Focus Feed (PHASE_2_SPEC §6). The "All" view is the full Phase 2 ranking — S₁ gravity
 * popularity, P_seen, freshness window, per-tier category balance, back-catalogue injection,
 * and anti-repetition — built from IndexedDB watch + impression signals. A specific category
 * stays newest-first. Either way the grid is finite (≤24) and ends in the caught-up block.
 */
export function HomeFeed({ pool }: { pool: Video[] }) {
  const [additionVideos, setAdditionVideos] = useState<Video[]>([]);
  // The effective pool = base (server-rendered) + user channel additions (IndexedDB overlay,
  // client-only — the server can't see it on the initial render). Merged AFTER mount for the
  // same hydration-mismatch reason as the ranking signals below.
  const effectivePool = useMemo(
    () => mergeAdditionVideos(pool, additionVideos),
    [pool, additionVideos],
  );

  // Distinct categories present in the effective pool, for the filter pills.
  const options = useMemo<CategoryOption[]>(() => {
    const present = [...new Set(effectivePool.map((v) => v.category))].filter(Boolean).sort();
    return ["All", ...present];
  }, [effectivePool]);

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

  // User channel additions (IndexedDB overlay): read the client's additions, POST them to the
  // server for the same RSS/Data-API build the base feed uses (the API key never reaches the
  // client), then merge the returned videos into the pool. Skips the round trip entirely when
  // there are no additions.
  useEffect(() => {
    let alive = true;
    getUserChannels().then(async (additions) => {
      if (!alive || additions.length === 0) return;
      try {
        const res = await fetch("/api/feed/additions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ additions }),
        });
        if (!res.ok) return;
        const parsed = AdditionVideosResponseSchema.parse(await res.json());
        if (alive) setAdditionVideos(parsed.videos);
      } catch {
        /* addition videos are additive; a failed fetch just leaves the base pool as-is */
      }
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
        effectivePool.filter((v) => v.category === selected),
        "latest",
      ).slice(0, HOME_FEED_CAP);
    }
    return mounted
      ? buildHomeFeed(effectivePool, undefined, HOME_FEED_CAP, ctx)
      : buildHomeFeed(effectivePool, undefined, HOME_FEED_CAP);
  }, [effectivePool, selected, mounted, ctx]);

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
