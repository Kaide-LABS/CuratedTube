// Watch Later store — client-only IndexedDB (Implements PHASE_3_SPEC.md §6, store §5).
//
// A user-curated, finite saved list — NOT a queue, NOT autoplay, NOT a recommendation surface
// (PHASE_3_SPEC §9). The full Video is snapshotted at save time, so the Watch Later page renders
// entirely from IndexedDB with ZERO added YouTube Data API quota. All ops are idempotent and
// degrade silently when storage is unavailable (private mode / SSR), matching watchState.ts.
"use client";

import { tx } from "./watchState";
import type { Video, WatchLaterEntry } from "./types";

const STORE = "watchLater";

/** Save (or re-save) a video to Watch Later with the current timestamp. Idempotent by videoId. */
export async function addToWatchLater(video: Video): Promise<void> {
  try {
    const entry: WatchLaterEntry = { ...video, addedAt: new Date().toISOString() };
    await tx(STORE, "readwrite", (s) => s.put(entry));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** Remove a video from Watch Later. No-op if it was not saved. */
export async function removeFromWatchLater(videoId: string): Promise<void> {
  try {
    await tx(STORE, "readwrite", (s) => s.delete(videoId));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** Whether a video is currently in Watch Later. */
export async function isInWatchLater(videoId: string): Promise<boolean> {
  try {
    const found = await tx<WatchLaterEntry | undefined>(
      STORE,
      "readonly",
      (s) => s.get(videoId) as IDBRequest<WatchLaterEntry | undefined>,
    );
    return found !== undefined;
  } catch {
    return false;
  }
}

/** All saved entries, newest-saved first. The list is finite — there is no pagination/auto-load. */
export async function getWatchLater(): Promise<WatchLaterEntry[]> {
  try {
    const all = await tx<WatchLaterEntry[]>(
      STORE,
      "readonly",
      (s) => s.getAll() as IDBRequest<WatchLaterEntry[]>,
    );
    return all.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  } catch {
    return [];
  }
}
