"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import type { Playlist, PlaylistItem } from "@/lib/types";
import {
  clearQueue,
  deletePlaylist,
  enqueue,
  getPlaylistItems,
  getPlaylists,
  QUEUE_PLAYLIST_ID,
  removeFromPlaylist,
  renamePlaylist,
} from "@/lib/playlists";
import { PlaylistItemCard } from "@/components/PlaylistItemCard";
import { CaughtUpBlocker } from "@/components/CaughtUpBlocker";

/** One playlist's snapshot items. Renders entirely from IndexedDB — zero API calls. */
export default function PlaylistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [playlist, setPlaylist] = useState<Playlist | null | undefined>(undefined);
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");

  const refresh = async (): Promise<void> => {
    const [all, its] = await Promise.all([getPlaylists(), getPlaylistItems(id)]);
    const found = all.find((p) => p.id === id) ?? null;
    setPlaylist(found);
    setName(found?.name ?? "");
    setItems(its);
  };

  useEffect(() => {
    void refresh();
  }, [id]);

  async function onRemove(videoId: string): Promise<void> {
    setItems((prev) => prev.filter((it) => it.videoId !== videoId));
    await removeFromPlaylist(id, videoId);
  }

  async function onRename(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await renamePlaylist(id, trimmed);
    setRenaming(false);
    await refresh();
  }

  async function onDelete(): Promise<void> {
    await deletePlaylist(id);
    window.location.href = "/playlists";
  }

  /** Optional nice-to-have: loads this playlist's items into the queue, in order, then opens it. */
  async function onPlayAll(): Promise<void> {
    if (items.length === 0) return;
    await clearQueue();
    for (const it of items) {
      await enqueue({
        videoId: it.videoId,
        title: it.title,
        thumbnailUrl: it.thumbnailUrl,
        channelId: it.channelId,
        channelTitle: it.channelTitle,
        durationSec: it.durationSec,
      });
    }
    router.push(`/watch/${items[0].videoId}?list=${QUEUE_PLAYLIST_ID}`);
  }

  if (playlist === undefined) {
    return <p className="px-4 py-16 text-center text-sm text-zinc-500">Loading…</p>;
  }
  if (playlist === null) {
    return (
      <div className="px-4 py-16 text-center">
        <p className="text-sm text-zinc-500">This playlist doesn&rsquo;t exist (any more).</p>
        <Link href="/playlists" className="mt-4 inline-block text-sm text-zinc-400 hover:text-zinc-200">
          ← Back to playlists
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="flex items-center justify-between pb-4">
        <div>
          {renaming ? (
            <form onSubmit={(e) => void onRename(e)} className="flex gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
              />
              <button type="submit" className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white">
                Save
              </button>
            </form>
          ) : (
            <h1 className="text-xl font-semibold text-zinc-100">{playlist.name}</h1>
          )}
        </div>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <button type="button" onClick={() => void onPlayAll()} className="text-sm text-zinc-500 hover:text-zinc-300">
              Play all
            </button>
          )}
          {!playlist.isSystem && !renaming && (
            <>
              <button type="button" onClick={() => setRenaming(true)} className="text-sm text-zinc-500 hover:text-zinc-300">
                Rename
              </button>
              <button type="button" onClick={() => void onDelete()} className="text-sm text-zinc-500 hover:text-zinc-300">
                Delete
              </button>
            </>
          )}
          <Link href="/playlists" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← All playlists
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500">Nothing saved here yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((it) => (
            <PlaylistItemCard key={it.id} item={it} playlistId={id} onRemove={() => void onRemove(it.videoId)} />
          ))}
          <CaughtUpBlocker count={items.length} />
        </div>
      )}
    </div>
  );
}
