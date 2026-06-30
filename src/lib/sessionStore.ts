// Session-segment persistence — client-only IndexedDB (Implements PHASE_3_SPEC.md §6, store §5).
//
// Thin IndexedDB layer for the focus limiter; the rolling-window MATH is the pure, coverage-gated
// `session.ts`. Segments are keyed by `startedAt`, so a heartbeat re-`put` of the open segment
// just updates the same record (keeping `endedAt` fresh). All ops degrade silently when storage
// is unavailable, matching watchState.ts. Nothing here advances playback — it only records and
// reads activity so the UI can prompt a break (the anti-distraction boundary, PHASE_3_SPEC §0).
"use client";

import { openDB, tx } from "./watchState";
import { pruneSegments } from "./session";
import type { SessionSegment } from "./types";

const STORE = "session";

/** Persist (or update) an active-playback segment, keyed by its startedAt. */
export async function recordActiveSegment(seg: SessionSegment): Promise<void> {
  try {
    await tx(STORE, "readwrite", (s) => s.put(seg));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** All recorded segments (unordered; the caller computes the rolling-window total). */
export async function getSegments(): Promise<SessionSegment[]> {
  try {
    return await tx<SessionSegment[]>(
      STORE,
      "readonly",
      (s) => s.getAll() as IDBRequest<SessionSegment[]>,
    );
  } catch {
    return [];
  }
}

/**
 * Delete segments that lie entirely before the trailing `windowMs`, keeping the store bounded.
 * Uses the pure `pruneSegments` to decide what survives, then removes the rest by key.
 */
export async function clearExpired(now: number, windowMs: number): Promise<void> {
  try {
    const all = await getSegments();
    const keep = new Set(pruneSegments(all, now, windowMs).map((s) => s.startedAt));
    const stale = all.filter((s) => !keep.has(s.startedAt));
    await Promise.all(stale.map((s) => tx(STORE, "readwrite", (os) => os.delete(s.startedAt))));
  } catch {
    /* storage unavailable — degrade silently */
  }
}
