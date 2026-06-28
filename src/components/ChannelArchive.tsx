"use client";

import { useEffect, useMemo, useState } from "react";
import type { SortMode, Video } from "@/lib/types";
import { sortVideos } from "@/lib/feed";
import { getVisitedSet } from "@/lib/watchState";
import { VideoPreviewCard } from "./VideoPreviewCard";

const TABS: Array<{ key: SortMode; label: string }> = [
  { key: "latest", label: "Latest" },
  { key: "popular", label: "Popular" },
  { key: "oldest", label: "Oldest" },
];

const PAGE_SIZE = 24;

export function ChannelArchive({ videos }: { videos: Video[] }) {
  const [sort, setSort] = useState<SortMode>("latest");
  const [page, setPage] = useState(1);
  const [visited, setVisited] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    getVisitedSet().then((s) => alive && setVisited(s));
    return () => {
      alive = false;
    };
  }, []);

  const sorted = useMemo(() => sortVideos(videos, sort), [videos, sort]);
  const shown = sorted.slice(0, page * PAGE_SIZE);
  const hasMore = shown.length < sorted.length;

  return (
    <div>
      <div className="flex border-b border-zinc-800 text-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setSort(t.key);
              setPage(1);
            }}
            className={`-mb-px border-b-2 px-4 py-3 font-medium transition-colors ${
              sort === t.key
                ? "border-zinc-100 text-zinc-100"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {shown.map((v) => (
          <VideoPreviewCard
            key={v.videoId}
            video={v}
            visited={visited.has(v.videoId)}
            showAvatar={false}
          />
        ))}
      </div>

      {/* Explicit, user-initiated pagination — never infinite scroll (PRD §2). */}
      {hasMore && (
        <div className="flex justify-center pb-10">
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            className="rounded-full border border-zinc-700 bg-zinc-900 px-5 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Show more
          </button>
        </div>
      )}
    </div>
  );
}
