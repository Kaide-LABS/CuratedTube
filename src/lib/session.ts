// Focus session limiter — pure, deterministic core (Implements PHASE_3_SPEC.md §6).
//
// The limiter protects focus: it sums ACTIVE playback time in a rolling window and, past a
// threshold, the UI prompts a break (PRD §6 / context.md §5). This is the only new behavioral
// mechanic in Phase 3 and its sole effect is to REDUCE time-on-app — it never advances playback,
// never queues, never nudges toward more watching (the anti-distraction boundary, PHASE_3_SPEC §0).
//
// Every function here is referentially transparent: the caller passes `now`, so there are no
// clock reads, no I/O, no randomness — fully unit-testable and deterministic (mirrors the Phase 2
// ranker). The IndexedDB persistence of segments lives in `sessionStore.ts`, kept separate so this
// math stays pure and meaningfully coverage-gated.

import type { SessionConfig, SessionSegment } from "./types";

/** End instant of a segment in ms: its `endedAt`, or `now` if still open (endedAt === null). */
function segmentEnd(seg: SessionSegment, now: number): number {
  if (seg.endedAt === null) return now;
  const e = Date.parse(seg.endedAt);
  return Number.isFinite(e) ? e : now;
}

/**
 * Total active-playback milliseconds within the trailing `windowMs` ending at `now`.
 * Each segment contributes only the portion of [startedAt, end] that overlaps
 * [now - windowMs, now]; paused gaps are excluded because they are separate segments.
 */
export function activeMsInWindow(
  segments: SessionSegment[],
  now: number,
  windowMs: number,
): number {
  const cutoff = now - windowMs;
  let sum = 0;
  for (const seg of segments) {
    const start = Date.parse(seg.startedAt);
    if (!Number.isFinite(start)) continue;
    const end = segmentEnd(seg, now);
    const lo = Math.max(start, cutoff);
    const hi = Math.min(end, now);
    if (hi > lo) sum += hi - lo;
  }
  return sum;
}

/**
 * Drop segments that lie entirely before the trailing window, keeping the `session` store
 * bounded. A segment is retained if its end instant is at or after the window cutoff.
 */
export function pruneSegments(
  segments: SessionSegment[],
  now: number,
  windowMs: number,
): SessionSegment[] {
  const cutoff = now - windowMs;
  return segments.filter((seg) => segmentEnd(seg, now) >= cutoff);
}

/** True once active time in the window reaches the configured limit (exact at the threshold). */
export function shouldPromptBreak(activeMs: number, cfg: SessionConfig): boolean {
  return activeMs >= cfg.activeLimitMinutes * 60_000;
}

/**
 * Advance the in-memory open segment given the latest playback state.
 * - PLAYING with no open segment -> open a new one (activeMs 0, endedAt = now).
 * - PLAYING continuing            -> extend endedAt = now, activeMs = now - startedAt.
 * - not PLAYING                   -> close the segment (endedAt = now) and return it; if none
 *                                    was open, return null.
 * The returned segment (when non-null) is the value to persist via sessionStore.
 */
export function mergeSegment(
  open: SessionSegment | null,
  now: number,
  videoId: string,
  playing: boolean,
): SessionSegment | null {
  const iso = new Date(now).toISOString();
  if (playing) {
    if (!open) {
      return { startedAt: iso, endedAt: iso, activeMs: 0, videoId };
    }
    const start = Date.parse(open.startedAt);
    const activeMs = Number.isFinite(start) ? Math.max(0, now - start) : open.activeMs;
    return { ...open, endedAt: iso, activeMs };
  }
  if (!open) return null;
  const start = Date.parse(open.startedAt);
  const activeMs = Number.isFinite(start) ? Math.max(0, now - start) : open.activeMs;
  return { ...open, endedAt: iso, activeMs };
}
