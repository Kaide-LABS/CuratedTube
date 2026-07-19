// Playlists — pure, deterministic core. Mirrors the session.ts/session-config.ts and
// watchGuardian.ts split: the I/O layer (playlists.ts) is a thin, degrade-silently IndexedDB
// wrapper; the actual decisions live here, unit-testable without any storage.

import type { Playlist } from "./types";

export const WATCH_LATER_PLAYLIST_ID = "watch-later";
export const WATCH_LATER_PLAYLIST_NAME = "Watch Later";

/** A playlist item's IndexedDB row id — also its store's keyPath, unique per (playlist, video). */
export function playlistItemId(playlistId: string, videoId: string): string {
  return `${playlistId}:${videoId}`;
}

/**
 * Idempotent resolution of the Watch Later system playlist: if a row already exists for the
 * fixed id, it is returned UNCHANGED (so a second/Nth call — or a second tab racing the first —
 * never stomps its original `createdAt`). Only fabricates a fresh row when none exists yet.
 *
 * Multi-tab race safety beyond this function's own idempotency: the id is a hardcoded constant,
 * never derived or randomized, so even if two tabs both observe "no existing row" and both
 * `put()` a freshly-created object, IndexedDB's keyPath semantics guarantee they land on the
 * SAME key — the store ends up with exactly one row for "watch-later" either way, never two.
 */
export function resolveEnsuredWatchLater(existing: Playlist | undefined, nowIso: string): Playlist {
  if (existing) return existing;
  return { id: WATCH_LATER_PLAYLIST_ID, name: WATCH_LATER_PLAYLIST_NAME, createdAt: nowIso, isSystem: true };
}

/** Watch Later (and any other isSystem playlist) is undeletable and unrenamable. */
export function isPlaylistMutable(playlist: Pick<Playlist, "isSystem">): boolean {
  return !playlist.isSystem;
}

/** Stable ordering: system playlists (Watch Later) first, then user playlists newest-first. */
export function sortPlaylists(playlists: Playlist[]): Playlist[] {
  return [...playlists].sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
