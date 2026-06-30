// Client-only personal state in IndexedDB (PRD D3, §9.7; PHASE_2_SPEC §5). Single-user, no
// backend. v1 stored watch state (visited videos) to de-emphasize watched cards. v2 adds an
// `impressions` store: which videos were SHOWN on home but not clicked — the anti-repetition
// signal for the Phase 2 ranker. The migration is additive and idempotent from a fresh state.
"use client";

import type { ImpressionState, WatchState } from "./types";

const DB_NAME = "curatedtube";
const DB_VERSION = 2; // v1 -> v2: add the `impressions` store (watchState preserved)
const WATCH_STORE = "watchState";
const IMPRESSION_STORE = "impressions";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Additive migration: every createObjectStore is guarded so upgrading a v1 db only ADDS
    // `impressions` (no rewrite of watchState) and a fresh db creates both. Re-running is a no-op.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(WATCH_STORE)) {
        db.createObjectStore(WATCH_STORE, { keyPath: "videoId" });
      }
      if (!db.objectStoreNames.contains(IMPRESSION_STORE)) {
        db.createObjectStore(IMPRESSION_STORE, { keyPath: "videoId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
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
