"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PlaylistItem } from "@/lib/types";
import { QUEUE_PLAYLIST_ID, clearQueue, dequeue, getQueueItems, reorderQueueItem } from "@/lib/playlists";
import { TimeBadge } from "@/components/TimeBadge";

/** The queue: ordered play-next list. Reorder, remove, clear, and play — all pure IndexedDB. */
export default function QueuePage() {
  const [items, setItems] = useState<PlaylistItem[] | null>(null);

  const refresh = async (): Promise<void> => {
    setItems(await getQueueItems());
  };

  useEffect(() => {
    void refresh();
  }, []);

  async function onRemove(videoId: string): Promise<void> {
    await dequeue(videoId);
    await refresh();
  }

  async function onMove(videoId: string, direction: "up" | "down"): Promise<void> {
    await reorderQueueItem(videoId, direction);
    await refresh();
  }

  async function onClear(): Promise<void> {
    await clearQueue();
    await refresh();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Queue</h1>
        {items && items.length > 0 && (
          <button
            type="button"
            onClick={() => void onClear()}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Clear queue
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-zinc-400">
        Play in order — finishing one advances to the next queued video. Never autoplay of
        recommendations: this is only ever what you put here yourself.
      </p>

      {items === null ? (
        <p className="mt-8 text-sm text-zinc-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">Nothing queued yet. Use “Queue” on a video.</p>
      ) : (
        <ul className="mt-6 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-center gap-3 px-4 py-3">
              <Link
                href={`/watch/${it.videoId}?list=${QUEUE_PLAYLIST_ID}`}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <div className="relative aspect-video w-24 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  <TimeBadge durationSec={it.durationSec} />
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-medium text-zinc-100">{it.title}</p>
                  <p className="truncate text-xs text-zinc-500">{it.channelTitle}</p>
                </div>
              </Link>
              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void onMove(it.videoId, "up")}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => void onMove(it.videoId, "down")}
                  disabled={i === items.length - 1}
                  aria-label="Move down"
                  className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => void onRemove(it.videoId)}
                  className="rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
