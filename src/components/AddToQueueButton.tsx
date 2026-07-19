"use client";

import { useEffect, useState } from "react";
import type { Video } from "@/lib/types";
import { dequeue, enqueue, getPlaylistsContaining, QUEUE_PLAYLIST_ID } from "@/lib/playlists";

/**
 * "Add to queue" — beside "Add to playlist", but a direct one-click toggle (no picker): the
 * queue is the one reserved, ordered play-next list. Pure IndexedDB, zero API calls.
 */
export function AddToQueueButton({ video, className }: { video: Video; className?: string }) {
  const [queued, setQueued] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    getPlaylistsContaining(video.videoId).then((ids) => {
      if (!alive) return;
      setQueued(ids.has(QUEUE_PLAYLIST_ID));
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [video.videoId]);

  async function toggle(e: React.MouseEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (queued) {
      setQueued(false);
      await dequeue(video.videoId);
    } else {
      setQueued(true);
      await enqueue({
        videoId: video.videoId,
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
        channelId: video.channelId,
        channelTitle: video.channelTitle,
        durationSec: video.durationSec,
      });
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => void toggle(e)}
      disabled={!ready}
      aria-pressed={queued}
      aria-label={queued ? "Remove from queue" : "Add to queue"}
      title={queued ? "Remove from queue" : "Add to queue"}
      className={
        className ??
        `rounded-full border px-2 py-1 text-xs disabled:opacity-50 ${
          queued
            ? "border-zinc-100 bg-zinc-100 text-zinc-900"
            : "border-zinc-700 bg-zinc-950/80 text-zinc-200 hover:bg-zinc-800"
        }`
      }
    >
      {queued ? "✓ Queued" : "Queue"}
    </button>
  );
}
