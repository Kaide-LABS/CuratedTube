// Client-only personal state in IndexedDB (PRD D3, §9.7; PHASE_2_SPEC §5, PHASE_3_SPEC §5).
// Single-user, no backend. v1 stored watch state (visited videos) to de-emphasize watched cards.
// v2 added an `impressions` store (anti-repetition signal for the Phase 2 ranker). v3 added the
// `watchLater` and `session` stores (Phase 3). v4 added `userChannels` (add-channels-by-URL
// overlay). v5 added `suppressedChannels` (hide-any-channel overlay). v6 added `watchSession`,
// `journalEntries`, and `guardianSettings` (watch-time guardian). v7 adds `playlists` and
// `playlistItems` (the generalized playlists feature; "Watch Later" is now the system playlist
// with fixed id "watch-later" — see playlists.ts. watchLater.ts, the old dedicated module, has
// been deleted; the v3 `watchLater` store it used is unused by app code from v7 onward but is
// left declared/untouched, matching this module's additive-only, never-delete-a-store migration
// policy). This module owns the SINGLE DB-open path and the full schema; sessionStore.ts,
// userChannels.ts, suppressedChannels.ts, watchGuardianStore.ts, and playlists.ts reuse the
// exported `openDB`/`tx`. Every migration is additive and idempotent from a fresh state (v1
// through v7).
"use client";

import type { ImpressionState, WatchState } from "./types";

const DB_NAME = "curatedtube";
const DB_VERSION = 7; // v6 -> v7: add `playlists`/`playlistItems` (all prior stores preserved)
const WATCH_STORE = "watchState";
const IMPRESSION_STORE = "impressions";
const WATCH_LATER_STORE = "watchLater";
const SESSION_STORE = "session";
const USER_CHANNELS_STORE = "userChannels";
const SUPPRESSED_CHANNELS_STORE = "suppressedChannels";
const WATCH_SESSION_STORE = "watchSession";
const JOURNAL_ENTRIES_STORE = "journalEntries";
const GUARDIAN_SETTINGS_STORE = "guardianSettings";
const PLAYLISTS_STORE = "playlists";
const PLAYLIST_ITEMS_STORE = "playlistItems";

/**
 * Open (and migrate) the shared `curatedtube` IndexedDB. The single DB-open path for every
 * store; sessionStore.ts and playlists.ts import this rather than calling `indexedDB.open`
 * with a different version. Rejects when IndexedDB is unavailable (SSR / private mode).
 */
export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Additive migration: every createObjectStore is guarded by a `contains` check, so a v1 or v2
    // db gains only the missing stores (no rewrite of existing data) and a fresh db creates all
    // four. Re-running any upgrade is a no-op, so the bump is safe from any starting version.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(WATCH_STORE)) {
        db.createObjectStore(WATCH_STORE, { keyPath: "videoId" });
      }
      if (!db.objectStoreNames.contains(IMPRESSION_STORE)) {
        db.createObjectStore(IMPRESSION_STORE, { keyPath: "videoId" });
      }
      if (!db.objectStoreNames.contains(WATCH_LATER_STORE)) {
        db.createObjectStore(WATCH_LATER_STORE, { keyPath: "videoId" });
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "startedAt" });
      }
      if (!db.objectStoreNames.contains(USER_CHANNELS_STORE)) {
        db.createObjectStore(USER_CHANNELS_STORE, { keyPath: "channelId" });
      }
      if (!db.objectStoreNames.contains(SUPPRESSED_CHANNELS_STORE)) {
        db.createObjectStore(SUPPRESSED_CHANNELS_STORE, { keyPath: "channelId" });
      }
      if (!db.objectStoreNames.contains(WATCH_SESSION_STORE)) {
        db.createObjectStore(WATCH_SESSION_STORE, { keyPath: "date" });
      }
      if (!db.objectStoreNames.contains(JOURNAL_ENTRIES_STORE)) {
        db.createObjectStore(JOURNAL_ENTRIES_STORE, { keyPath: "createdAt" });
      }
      if (!db.objectStoreNames.contains(GUARDIAN_SETTINGS_STORE)) {
        db.createObjectStore(GUARDIAN_SETTINGS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PLAYLISTS_STORE)) {
        db.createObjectStore(PLAYLISTS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PLAYLIST_ITEMS_STORE)) {
        db.createObjectStore(PLAYLIST_ITEMS_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Run one IndexedDB request inside a transaction on `store`, resolving its result. */
export function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const os = db.transaction(store, mode).objectStore(store);
        const req = fn(os);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// --- Watch state (v1; P_seen source) --------------------------------------

/** Mark a video visited (idempotent merge of watchedSec). */
export async function markVisited(videoId: string, watchedSec = 0): Promise<void> {
  try {
    const existing = await getWatchState(videoId);
    const next: WatchState = {
      videoId,
      visited: true,
      watchedSec: Math.max(existing?.watchedSec ?? 0, watchedSec),
      lastSeenAt: new Date().toISOString(),
    };
    await tx(WATCH_STORE, "readwrite", (s) => s.put(next));
  } catch {
    /* storage unavailable (e.g. private mode) — degrade silently */
  }
}

export async function getWatchState(videoId: string): Promise<WatchState | undefined> {
  try {
    return await tx<WatchState | undefined>(
      WATCH_STORE,
      "readonly",
      (s) => s.get(videoId) as IDBRequest<WatchState | undefined>,
    );
  } catch {
    return undefined;
  }
}

/** All visited video ids, as a Set for O(1) lookup in the feed. */
export async function getVisitedSet(): Promise<Set<string>> {
  try {
    const all = await tx<WatchState[]>(
      WATCH_STORE,
      "readonly",
      (s) => s.getAll() as IDBRequest<WatchState[]>,
    );
    return new Set(all.filter((w) => w.visited).map((w) => w.videoId));
  } catch {
    return new Set();
  }
}

/** Convenience join used by the home ranker (currently just the visited set; P_seen input). */
export async function getWatchSignals(): Promise<{ visited: Set<string> }> {
  return { visited: await getVisitedSet() };
}

// --- Impressions (v2; anti-repetition source) -----------------------------

// Guard so a single browser session counts each video's impression at most once, even across
// re-renders (category toggles). Anti-repetition is a cross-SESSION signal, not per-paint.
const countedThisSession = new Set<string>();

/**
 * Record that videos were shown on home but not (yet) clicked: increments shownCount and
 * stamps lastShownAt. Idempotent within a session via an in-memory guard; degrades silently
 * if storage is unavailable. A clicked video later moves into watchState, where P_seen — not
 * this penalty — governs it.
 */
export async function recordImpressions(videoIds: string[]): Promise<void> {
  const fresh = videoIds.filter((id) => id && !countedThisSession.has(id));
  if (fresh.length === 0) return;
  try {
    const now = new Date().toISOString();
    await Promise.all(
      fresh.map(async (videoId) => {
        const existing = await getImpression(videoId);
        const next: ImpressionState = {
          videoId,
          shownCount: (existing?.shownCount ?? 0) + 1,
          lastShownAt: now,
        };
        await tx(IMPRESSION_STORE, "readwrite", (s) => s.put(next));
        countedThisSession.add(videoId);
      }),
    );
  } catch {
    /* storage unavailable — degrade silently */
  }
}

async function getImpression(videoId: string): Promise<ImpressionState | undefined> {
  try {
    return await tx<ImpressionState | undefined>(
      IMPRESSION_STORE,
      "readonly",
      (s) => s.get(videoId) as IDBRequest<ImpressionState | undefined>,
    );
  } catch {
    return undefined;
  }
}

/** All impression records keyed by videoId, for the ranker's anti-repetition penalty. */
export async function getImpressionMap(): Promise<Map<string, ImpressionState>> {
  try {
    const all = await tx<ImpressionState[]>(
      IMPRESSION_STORE,
      "readonly",
      (s) => s.getAll() as IDBRequest<ImpressionState[]>,
    );
    return new Map(all.map((i) => [i.videoId, i]));
  } catch {
    return new Map();
  }
}
