"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Playlist } from "@/lib/types";
import { createPlaylist, getPlaylistItems, getPlaylists } from "@/lib/playlists";

/** Playlists library: every playlist (Watch Later first) with its item count. */
export default function PlaylistsPage() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");

  const refresh = async (): Promise<void> => {
    const pls = await getPlaylists();
    setPlaylists(pls);
    const entries = await Promise.all(pls.map(async (p) => [p.id, (await getPlaylistItems(p.id)).length] as const));
    setCounts(Object.fromEntries(entries));
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await createPlaylist(name);
    setNewName("");
    await refresh();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-xl font-semibold text-zinc-100">Playlists</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Saved snapshots — opening a playlist never re-fetches anything, so it costs zero quota.
      </p>

      <form onSubmit={(e) => void onCreate(e)} className="mt-6 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New playlist name"
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!newName.trim()}
          className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Create
        </button>
      </form>

      {loading ? (
        <p className="mt-8 text-sm text-zinc-500">Loading…</p>
      ) : (
        <ul className="mt-6 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {playlists.map((p) => (
            <li key={p.id}>
              <Link
                href={`/playlists/${p.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-900"
              >
                <span className="text-sm text-zinc-100">{p.name}</span>
                <span className="text-xs text-zinc-500">{counts[p.id] ?? 0} videos</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
