// Client-only watch state in IndexedDB (PRD D3, §9.7). Single-user, no backend.
// Stores which videos have been visited so the home feed can de-emphasize them.
"use client";

import type { WatchState } from "./types";

const DB_NAME = "curatedtube";
const DB_VERSION = 1;
const STORE = "watchState";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "videoId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE, mode).objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

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
    await tx("readwrite", (s) => s.put(next));
  } catch {
    /* storage unavailable (e.g. private mode) — degrade silently */
  }
}

export async function getWatchState(videoId: string): Promise<WatchState | undefined> {
  try {
    return await tx<WatchState | undefined>("readonly", (s) => s.get(videoId) as IDBRequest<WatchState | undefined>);
  } catch {
    return undefined;
  }
}

/** All visited video ids, as a Set for O(1) lookup in the feed. */
export async function getVisitedSet(): Promise<Set<string>> {
  try {
    const all = await tx<WatchState[]>("readonly", (s) => s.getAll() as IDBRequest<WatchState[]>);
    return new Set(all.filter((w) => w.visited).map((w) => w.videoId));
  } catch {
    return new Set();
  }
}
