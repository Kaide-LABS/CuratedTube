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
  isBrowsablePlaylist,
  isPlaylistMutable,
  nextOrderValue,
  nextQueueItem,
  playlistItemId,
  QUEUE_PLAYLIST_ID,
  resolveEnsuredQueue,
  resolveEnsuredWatchLater,
  sortPlaylists,
  swapOrder,
  WATCH_LATER_PLAYLIST_ID,
} from "./playlistsCore";
import type { Playlist, PlaylistItem } from "./types";

export { WATCH_LATER_PLAYLIST_ID, QUEUE_PLAYLIST_ID };

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

/**
 * All BROWSABLE playlists (Watch Later first, then user playlists newest-created-first). Ensures
 * Watch Later exists. Excludes the reserved queue — it's a play-order mechanism, not a saved
 * collection, and has its own dedicated /queue surface (see getQueueItems).
 */
export async function getPlaylists(): Promise<Playlist[]> {
  try {
    await ensureWatchLaterPlaylist();
    const all = await tx<Playlist[]>(PLAYLISTS_STORE, "readonly", (s) => s.getAll() as IDBRequest<Playlist[]>);
    return sortPlaylists(all.filter(isBrowsablePlaylist));
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

// ---------------------------------------------------------------------------
// Queue — the ONE reserved, ordered play-next list (fixed id "queue"). Reuses the same
// playlists/playlistItems stores as every other playlist; only the ordering (`order` field) and
// the dedicated ensure/reorder/advance functions below are queue-specific.
// ---------------------------------------------------------------------------

/** Idempotent: creates the fixed-id Queue system playlist if it doesn't exist yet. */
export async function ensureQueuePlaylist(): Promise<Playlist> {
  try {
    const existing = await tx<Playlist | undefined>(
      PLAYLISTS_STORE,
      "readonly",
      (s) => s.get(QUEUE_PLAYLIST_ID) as IDBRequest<Playlist | undefined>,
    );
    const resolved = resolveEnsuredQueue(existing, new Date().toISOString());
    if (!existing) await tx(PLAYLISTS_STORE, "readwrite", (s) => s.put(resolved));
    return resolved;
  } catch {
    return resolveEnsuredQueue(undefined, new Date().toISOString());
  }
}

/** The queue's items in PLAY ORDER (not addedAt — see playlistsCore.ts's swapOrder/nextQueueItem). */
export async function getQueueItems(): Promise<PlaylistItem[]> {
  try {
    await ensureQueuePlaylist();
    const all = await tx<PlaylistItem[]>(
      PLAYLIST_ITEMS_STORE,
      "readonly",
      (s) => s.getAll() as IDBRequest<PlaylistItem[]>,
    );
    return all
      .filter((it) => it.playlistId === QUEUE_PLAYLIST_ID)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  } catch {
    return [];
  }
}

/** Append a video to the end of the queue (or move it there if already queued — put() upserts). */
export async function enqueue(
  snapshot: Omit<PlaylistItem, "id" | "playlistId" | "addedAt" | "order">,
): Promise<void> {
  const current = await getQueueItems();
  await addToPlaylist(QUEUE_PLAYLIST_ID, { ...snapshot, order: nextOrderValue(current) });
}

export async function dequeue(videoId: string): Promise<void> {
  await removeFromPlaylist(QUEUE_PLAYLIST_ID, videoId);
}

/** Empties the queue entirely. Never touches any other playlist. */
export async function clearQueue(): Promise<void> {
  const items = await getQueueItems();
  try {
    await Promise.all(items.map((it) => tx(PLAYLIST_ITEMS_STORE, "readwrite", (s) => s.delete(it.id))));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** Move a queued item one slot up or down (no-op at either end — see playlistsCore's swapOrder). */
export async function reorderQueueItem(videoId: string, direction: "up" | "down"): Promise<void> {
  const current = await getQueueItems();
  const swapped = swapOrder(current, videoId, direction);
  const changed = swapped.filter((it, i) => it.order !== current[i]?.order);
  try {
    await Promise.all(changed.map((it) => tx(PLAYLIST_ITEMS_STORE, "readwrite", (s) => s.put(it))));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/**
 * The next item after `currentVideoId` in queue order, or null at the end. Backs the ONE
 * sanctioned auto-advance in the app: finishing a queued video advances to the next queued
 * item — user-built intent, never autoplay-of-recommendations, and never wraps or falls back to
 * anything outside the queue itself.
 */
export async function getNextQueueItem(currentVideoId: string): Promise<PlaylistItem | null> {
  const current = await getQueueItems();
  return nextQueueItem(current, currentVideoId);
}
