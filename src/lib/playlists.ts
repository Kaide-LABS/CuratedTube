// Playlists — client-only IndexedDB I/O (snapshot-on-save, add-to-playlist feature). A playlist
// is just a named bucket of video snapshots taken AT ADD TIME: rendering a playlist never
// re-resolves saved videos, so opening one makes ZERO YouTube Data API calls (and costs zero
// quota). Accepted limitation: a snapshot's title/thumbnail won't update if the source video is
// later renamed/re-thumbnailed. Per-browser/local, same limitation as watchState.ts's other
// stores — shaped to migrate to a per-user DB row at the account rewrite.
//
// The actual decisions (idempotent Watch Later creation, system-playlist mutability, ordering)
// live in the pure, unit-tested playlistsCore.ts; this module is a thin, degrade-silently I/O
// layer on top, mirroring the session.ts/sessionStore.ts and watchGuardian.ts/
// watchGuardianStore.ts split.
"use client";

import { tx } from "./watchState";
import {
  isPlaylistMutable,
  playlistItemId,
  resolveEnsuredWatchLater,
  sortPlaylists,
  WATCH_LATER_PLAYLIST_ID,
} from "./playlistsCore";
import type { Playlist, PlaylistItem } from "./types";

export { WATCH_LATER_PLAYLIST_ID };

const PLAYLISTS_STORE = "playlists";
const PLAYLIST_ITEMS_STORE = "playlistItems";

/** Idempotent: creates the fixed-id Watch Later system playlist if it doesn't exist yet. */
export async function ensureWatchLaterPlaylist(): Promise<Playlist> {
  try {
    const existing = await tx<Playlist | undefined>(
      PLAYLISTS_STORE,
      "readonly",
      (s) => s.get(WATCH_LATER_PLAYLIST_ID) as IDBRequest<Playlist | undefined>,
    );
    const resolved = resolveEnsuredWatchLater(existing, new Date().toISOString());
    if (!existing) await tx(PLAYLISTS_STORE, "readwrite", (s) => s.put(resolved));
    return resolved;
  } catch {
    return resolveEnsuredWatchLater(undefined, new Date().toISOString());
  }
}

/** Create a new user playlist with a generated id. */
export async function createPlaylist(name: string): Promise<Playlist> {
  const playlist: Playlist = {
    id: typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name,
    createdAt: new Date().toISOString(),
    isSystem: false,
  };
  try {
    await tx(PLAYLISTS_STORE, "readwrite", (s) => s.put(playlist));
  } catch {
    /* storage unavailable — degrade silently */
  }
  return playlist;
}

/** No-op for the system playlist (Watch Later is unrenamable). */
export async function renamePlaylist(id: string, name: string): Promise<void> {
  try {
    const existing = await tx<Playlist | undefined>(
      PLAYLISTS_STORE,
      "readonly",
      (s) => s.get(id) as IDBRequest<Playlist | undefined>,
    );
    if (!existing || !isPlaylistMutable(existing)) return;
    await tx(PLAYLISTS_STORE, "readwrite", (s) => s.put({ ...existing, name }));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** No-op for the system playlist (Watch Later is undeletable). Also deletes its items. */
export async function deletePlaylist(id: string): Promise<void> {
  try {
    const existing = await tx<Playlist | undefined>(
      PLAYLISTS_STORE,
      "readonly",
      (s) => s.get(id) as IDBRequest<Playlist | undefined>,
    );
    if (!existing || !isPlaylistMutable(existing)) return;
    const items = await getPlaylistItems(id);
    await Promise.all(items.map((it) => tx(PLAYLIST_ITEMS_STORE, "readwrite", (s) => s.delete(it.id))));
    await tx(PLAYLISTS_STORE, "readwrite", (s) => s.delete(id));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** All playlists (Watch Later first, then user playlists newest-created-first). Ensures Watch Later exists. */
export async function getPlaylists(): Promise<Playlist[]> {
  try {
    await ensureWatchLaterPlaylist();
    const all = await tx<Playlist[]>(PLAYLISTS_STORE, "readonly", (s) => s.getAll() as IDBRequest<Playlist[]>);
    return sortPlaylists(all);
  } catch {
    return [];
  }
}

export async function getPlaylistItems(playlistId: string): Promise<PlaylistItem[]> {
  try {
    const all = await tx<PlaylistItem[]>(
      PLAYLIST_ITEMS_STORE,
      "readonly",
      (s) => s.getAll() as IDBRequest<PlaylistItem[]>,
    );
    return all.filter((it) => it.playlistId === playlistId).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  } catch {
    return [];
  }
}

export async function getPlaylistItem(playlistId: string, videoId: string): Promise<PlaylistItem | undefined> {
  try {
    return await tx<PlaylistItem | undefined>(
      PLAYLIST_ITEMS_STORE,
      "readonly",
      (s) => s.get(playlistItemId(playlistId, videoId)) as IDBRequest<PlaylistItem | undefined>,
    );
  } catch {
    return undefined;
  }
}

/** Snapshot a video into a playlist. Toggle semantics live in the caller (addToPlaylist/removeFromPlaylist). */
export async function addToPlaylist(
  playlistId: string,
  snapshot: Omit<PlaylistItem, "id" | "playlistId" | "addedAt">,
): Promise<void> {
  try {
    const item: PlaylistItem = {
      ...snapshot,
      id: playlistItemId(playlistId, snapshot.videoId),
      playlistId,
      addedAt: new Date().toISOString(),
    };
    await tx(PLAYLIST_ITEMS_STORE, "readwrite", (s) => s.put(item));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

export async function removeFromPlaylist(playlistId: string, videoId: string): Promise<void> {
  try {
    await tx(PLAYLIST_ITEMS_STORE, "readwrite", (s) => s.delete(playlistItemId(playlistId, videoId)));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** Every playlist id that currently contains `videoId` — drives the "Add to playlist" picker's checkmarks. */
export async function getPlaylistsContaining(videoId: string): Promise<Set<string>> {
  try {
    const all = await tx<PlaylistItem[]>(
      PLAYLIST_ITEMS_STORE,
      "readonly",
      (s) => s.getAll() as IDBRequest<PlaylistItem[]>,
    );
    return new Set(all.filter((it) => it.videoId === videoId).map((it) => it.playlistId));
  } catch {
    return new Set();
  }
}
