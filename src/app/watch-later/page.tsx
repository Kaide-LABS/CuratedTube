// Watch Later surface (Implements PHASE_3_SPEC.md §6; PRD §8). Renders the user's saved videos
// entirely from IndexedDB — ZERO YouTube Data API quota — as a finite grid ending in the caught-up
// block. It is a deliberate saved list, not a queue/autoplay/recommendation surface (§9).
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { WatchLaterEntry } from "@/lib/types";
import { getWatchLater, removeFromWatchLater } from "@/lib/watchLater";
import { getVisitedSet } from "@/lib/watchState";
import { VideoPreviewCard } from "@/components/VideoPreviewCard";
import { CaughtUpBlocker } from "@/components/CaughtUpBlocker";

/** Client page: loads saved entries + visited set from IndexedDB and renders the grid. */
export default function WatchLaterPage() {
  const [entries, setEntries] = useState<WatchLaterEntry[] | null>(null);
  const [visited, setVisited] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    Promise.all([getWatchLater(), getVisitedSet()]).then(([e, v]) => {
      if (!alive) return;
      setEntries(e);
      setVisited(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const remove = async (videoId: string): Promise<void> => {
    setEntries((prev) => (prev ? prev.filter((e) => e.videoId !== videoId) : prev));
    await removeFromWatchLater(videoId);
  };

  return (
    <div className="px-4 py-6">
      <div className="flex items-center justify-between pb-4">
        <h1 className="text-xl font-semibold text-zinc-100">Watch Later</h1>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Back to feed
        </Link>
      </div>

      {entries === null ? (
        <p className="py-16 text-center text-sm text-zinc-500">Loading your saved videos…</p>
      ) : entries.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500">
          Nothing saved yet. Use “Watch later” on a video to keep it here.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entries.map((v) => (
            <div key={v.videoId} className="flex flex-col gap-1">
              <VideoPreviewCard video={v} visited={visited.has(v.videoId)} />
              <button
                type="button"
                onClick={() => void remove(v.videoId)}
                className="self-start text-xs text-zinc-500 hover:text-zinc-300"
              >
                Remove
              </button>
            </div>
          ))}
          <CaughtUpBlocker count={entries.length} />
        </div>
      )}
    </div>
  );
}
