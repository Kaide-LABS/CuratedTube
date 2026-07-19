// Watch Later toggle (Implements PHASE_3_SPEC.md §6). Used on the watch page. Watch Later is now
// the fixed-id "watch-later" SYSTEM playlist (playlists.ts) — this button just toggles that one
// playlist's membership; the general "Add to playlist" picker (AddToPlaylistButton) covers every
// other playlist. Saves a full snapshot so the Watch Later surface renders at zero quota. This is
// a deliberate, manual save — not a queue or autoplay affordance (PHASE_3_SPEC §9).
"use client";

import { useEffect, useState } from "react";
import type { Video } from "@/lib/types";
import { addToPlaylist, getPlaylistsContaining, removeFromPlaylist, WATCH_LATER_PLAYLIST_ID } from "@/lib/playlists";

/** Save/remove toggle for a single video, reflecting current Watch Later membership. */
export function WatchLaterButton({ video }: { video: Video }) {
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    getPlaylistsContaining(video.videoId).then((ids) => {
      if (!alive) return;
      setSaved(ids.has(WATCH_LATER_PLAYLIST_ID));
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [video.videoId]);

  const toggle = async (): Promise<void> => {
    if (saved) {
      setSaved(false);
      await removeFromPlaylist(WATCH_LATER_PLAYLIST_ID, video.videoId);
    } else {
      setSaved(true);
      await addToPlaylist(WATCH_LATER_PLAYLIST_ID, {
        videoId: video.videoId,
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
        channelId: video.channelId,
        channelTitle: video.channelTitle,
        durationSec: video.durationSec,
      });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={saved}
      disabled={!ready}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
        saved
          ? "border-zinc-100 bg-zinc-100 text-zinc-900 hover:bg-white"
          : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
      }`}
    >
      <span aria-hidden>{saved ? "✓" : "+"}</span>
      {saved ? "Saved for later" : "Watch later"}
    </button>
  );
}
