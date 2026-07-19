"use client";

import { useState } from "react";
import type { Video } from "@/lib/types";
import type { Playlist } from "@/lib/types";
import {
  addToPlaylist,
  createPlaylist,
  getPlaylists,
  getPlaylistsContaining,
  removeFromPlaylist,
} from "@/lib/playlists";

/**
 * "Add to playlist" — a small button that opens a picker (existing playlists as toggles, plus
 * "New playlist"). Reused on every video card and the watch page. Every op here is pure
 * IndexedDB — free, offline, unlimited, zero YouTube Data API calls.
 */
export function AddToPlaylistButton({
  video,
  className,
}: {
  video: Video;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [containing, setContaining] = useState<Set<string>>(new Set());
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);

  async function openPicker(e: React.MouseEvent): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    setOpen(true);
    const [pls, has] = await Promise.all([getPlaylists(), getPlaylistsContaining(video.videoId)]);
    setPlaylists(pls);
    setContaining(has);
    setLoading(false);
  }

  function close(e?: React.MouseEvent): void {
    e?.preventDefault();
    e?.stopPropagation();
    setOpen(false);
    setNewName("");
  }

  const snapshot = {
    videoId: video.videoId,
    title: video.title,
    thumbnailUrl: video.thumbnailUrl,
    channelId: video.channelId,
    channelTitle: video.channelTitle,
    durationSec: video.durationSec,
  };

  async function toggle(playlistId: string): Promise<void> {
    if (containing.has(playlistId)) {
      setContaining((prev) => {
        const next = new Set(prev);
        next.delete(playlistId);
        return next;
      });
      await removeFromPlaylist(playlistId, video.videoId);
    } else {
      setContaining((prev) => new Set(prev).add(playlistId));
      await addToPlaylist(playlistId, snapshot);
    }
  }

  async function onCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const playlist = await createPlaylist(name);
    await addToPlaylist(playlist.id, snapshot);
    setPlaylists((prev) => [...prev, playlist]);
    setContaining((prev) => new Set(prev).add(playlist.id));
    setNewName("");
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => void openPicker(e)}
        aria-label="Add to playlist"
        title="Add to playlist"
        className={
          className ??
          "rounded-full border border-zinc-700 bg-zinc-950/80 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
        }
      >
        +
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => close(e)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-zinc-100">Add to playlist</h2>

            {loading ? (
              <p className="mt-4 text-sm text-zinc-500">Loading…</p>
            ) : (
              <div className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
                {playlists.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
                  >
                    <input
                      type="checkbox"
                      checked={containing.has(p.id)}
                      onChange={() => void toggle(p.id)}
                      className="h-4 w-4"
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}

            <form onSubmit={(e) => void onCreate(e)} className="mt-3 flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New playlist name"
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newName.trim()}
                className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create
              </button>
            </form>

            <button
              type="button"
              onClick={(e) => close(e)}
              className="mt-4 w-full rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}
