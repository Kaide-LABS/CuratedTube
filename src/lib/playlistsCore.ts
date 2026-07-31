// Playlists — pure, deterministic core. Mirrors the session.ts/session-config.ts and
// watchGuardian.ts split: the I/O layer (playlists.ts) is a thin, degrade-silently IndexedDB
// wrapper; the actual decisions live here, unit-testable without any storage.

import type { Playlist, PlaylistItem } from "./types";

export const WATCH_LATER_PLAYLIST_ID = "watch-later";
export const WATCH_LATER_PLAYLIST_NAME = "Watch Later";
export const QUEUE_PLAYLIST_ID = "queue";
export const QUEUE_PLAYLIST_NAME = "Queue";

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

/**
 * The reserved queue is a play-order mechanism, not a saved collection — it's excluded from the
 * generic "Add to playlist" picker / library list (isBrowsablePlaylist), reachable only via its
 * own dedicated /queue surface and the separate "Add to queue" action.
 */
export function isBrowsablePlaylist(playlist: Pick<Playlist, "isQueue">): boolean {
  return !playlist.isQueue;
}

/** Stable ordering: system playlists (Watch Later) first, then user playlists newest-first. */
export function sortPlaylists(playlists: Playlist[]): Playlist[] {
  return [...playlists].sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/**
 * Idempotent resolution of the reserved Queue system playlist — same construction as
 * {@link resolveEnsuredWatchLater} (fixed id, returned unchanged if it already exists, race-safe
 * by construction since the id is never derived/randomized).
 */
export function resolveEnsuredQueue(existing: Playlist | undefined, nowIso: string): Playlist {
  if (existing) return existing;
  return { id: QUEUE_PLAYLIST_ID, name: QUEUE_PLAYLIST_NAME, createdAt: nowIso, isSystem: true, isQueue: true };
}

/** The next append-order value for the queue: one past the current max (0 for an empty queue). */
export function nextOrderValue(items: Pick<PlaylistItem, "order">[]): number {
  return items.reduce((max, it) => Math.max(max, it.order ?? -1), -1) + 1;
}

/**
 * Compute the full reordered video-id list for a single drag-and-drop move: `activeVideoId`
 * relocated to sit where `overVideoId` currently is, everything else shifted accordingly — the
 * same semantics as `@dnd-kit/sortable`'s `arrayMove`, expressed purely over the domain's own
 * `order` field so it's testable without dnd-kit or IndexedDB. Returns the CURRENT order
 * unchanged if either id isn't found (drag onto/from something already removed).
 */
export function reorderedVideoIds(
  items: Pick<PlaylistItem, "videoId" | "order">[],
  activeVideoId: string,
  overVideoId: string,
): string[] {
  const sorted = [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((it) => it.videoId);
  const from = sorted.indexOf(activeVideoId);
  const to = sorted.indexOf(overVideoId);
  if (from === -1 || to === -1 || from === to) return sorted;
  sorted.splice(from, 1);
  sorted.splice(to, 0, activeVideoId);
  return sorted;
}

/**
 * The queue item immediately after `currentVideoId` in order, or null if `currentVideoId` is
 * last (or not found) — end of a user-built queue means playback simply stops, never falls back
 * to autoplay/recommendations.
 */
export function nextQueueItem(items: PlaylistItem[], currentVideoId: string): PlaylistItem | null {
  const sorted = [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = sorted.findIndex((it) => it.videoId === currentVideoId);
  if (idx === -1 || idx === sorted.length - 1) return null;
  return sorted[idx + 1];
}
