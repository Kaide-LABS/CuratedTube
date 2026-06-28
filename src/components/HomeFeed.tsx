"use client";

import { useEffect, useMemo, useState } from "react";
import type { Video } from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { getChannels } from "@/lib/channels";
import { buildUnifiedFeed, sortVideos, HOME_FEED_CAP } from "@/lib/feed";
import { getVisitedSet } from "@/lib/watchState";
import { CategoryFilterBar, type CategoryOption } from "./CategoryFilterBar";
import { VideoPreviewCard } from "./VideoPreviewCard";
import { CaughtUpBlocker } from "./CaughtUpBlocker";

const STORAGE_KEY = "ct:home:category";

export function HomeFeed({ pool }: { pool: Video[] }) {
  const channels = useMemo(() => getChannels(), []);
  const options = useMemo<CategoryOption[]>(() => {
    const present = CATEGORIES.filter((c) => pool.some((v) => v.category === c));
    return ["All", ...present];
  }, [pool]);

  const [selected, setSelected] = useState<CategoryOption>("All");
  const [visited, setVisited] = useState<Set<string>>(new Set());

  // Restore the session's category selection.
  useEffect(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY) as CategoryOption | null;
    if (saved) setSelected(saved);
  }, []);

  // Persist selection for the session.
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, selected);
  }, [selected]);

  // Read visited ids from IndexedDB to de-emphasize watched cards.
  useEffect(() => {
    let alive = true;
    getVisitedSet().then((s) => {
      if (alive) setVisited(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  // "All" -> category-balanced 24. A specific category -> its newest 24.
  const view = useMemo(() => {
    if (selected === "All") return buildUnifiedFeed(pool, channels, HOME_FEED_CAP);
    return sortVideos(
      pool.filter((v) => v.category === selected),
      "latest",
    ).slice(0, HOME_FEED_CAP);
  }, [pool, channels, selected]);

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
