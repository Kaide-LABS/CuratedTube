// Watch-time guardian — pure, deterministic core. A self-imposed watch-time discipline layer:
// staged interrupts at 30/60/90 active minutes, a non-negotiable 120-minute (2h) daily cap.
//
// ACCEPTED LIMITATION (also in types.ts and README): this is client-side, IndexedDB-backed
// state. It can be cleared via DevTools, a private window, or a fresh profile. There is no
// server-side enforcement and this module makes no attempt to build one — it is self-binding
// discipline (a tool you point at yourself), not SENTINEL-grade tamper-proof enforcement.
//
// TIME ACCOUNTING: activeSeconds is accumulated from TIMESTAMP DELTAS (Date.now() at every
// player state change), never from counting setInterval ticks — a backgrounded/throttled tab
// would undercount tick-based timing, but a timestamp delta measures real elapsed wall-clock
// time regardless of how late the check actually runs. Every function here is referentially
// transparent (the caller passes `now`) — no clock reads, no I/O, no randomness, mirroring the
// existing session.ts (rolling-window focus limiter) and ranking.ts (Phase 2 ranker) posture.

import type { WatchSession } from "./types";

export const INTERRUPT_THRESHOLDS_MIN = [30, 60, 90] as const;
export type InterruptThresholdMin = (typeof INTERRUPT_THRESHOLDS_MIN)[number];
export const CAP_MINUTES = 120;

/** Local calendar date key (YYYY-MM-DD) for `now`, in the browser's local timezone. */
export function localDateKey(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A fresh, empty session for `date`. */
export function freshWatchSession(date: string): WatchSession {
  return { date, activeSeconds: 0, interruptsShown: [], capReached: false };
}

/**
 * Reconcile a stored session against today's local date key.
 * - No stored session -> fresh session for today.
 * - Stored date === today -> unchanged (same day, nothing to do).
 * - Stored date < today -> normal midnight rollover -> fresh session for today (no carry-over).
 * - Stored date > today -> CLOCK GUARD: the stored date is AHEAD of today's real local date,
 *   meaning the system clock was rolled back (or run forward then back) since the last write.
 *   Treated as tamper: the stored session (including capReached) is kept AS-IS, unreset — it
 *   only resets once today's local date genuinely reaches or passes the stored date. Mirrors
 *   the SENTINEL no-refund principle, best-effort and client-side only.
 */
export function reconcileSessionForToday(
  stored: WatchSession | undefined,
  todayKey: string,
): WatchSession {
  if (!stored) return freshWatchSession(todayKey);
  if (stored.date === todayKey) return stored;
  if (stored.date > todayKey) return stored; // clock guard — no reset
  return freshWatchSession(todayKey); // rollover
}

/** Monotonic merge of two activeSeconds readings — never regresses (multi-tab safety). */
export function mergeMonotonic(a: number, b: number): number {
  return Math.max(a, b);
}

/**
 * Merge two same-day session readings (e.g. this tab's in-memory state vs. a BroadcastChannel
 * message from another tab, or vs. what's currently in IndexedDB) into their least-surprising
 * union: the higher activeSeconds, the union of interruptsShown, capReached OR'd. A different
 * date always wins outright over the other (whichever is chronologically later) — this should
 * only occur transiently right at a midnight rollover.
 */
export function mergeSessions(a: WatchSession, b: WatchSession): WatchSession {
  if (a.date !== b.date) return a.date > b.date ? a : b;
  return {
    date: a.date,
    activeSeconds: mergeMonotonic(a.activeSeconds, b.activeSeconds),
    interruptsShown: [...new Set([...a.interruptsShown, ...b.interruptsShown])].sort(
      (x, y) => x - y,
    ),
    capReached: a.capReached || b.capReached,
  };
}

/** In-memory running clock: an accumulated total plus an optional currently-open interval. */
export type GuardianClock = { activeSec: number; openStartedAtMs: number | null };

/**
 * Advance the running clock by a timestamp delta. Called at every player state change
 * (playing/paused/ended/buffering) AND on a heartbeat while playing (which just closes and
 * re-opens the interval, banking the delta since the last checkpoint — never double-counted).
 *
 * - playing, no open interval  -> open one at `now` (no elapsed time yet).
 * - playing, interval open     -> bank now-openStartedAtMs into activeSec, then re-open at `now`.
 * - not playing, interval open -> bank now-openStartedAtMs into activeSec, close the interval.
 * - not playing, none open     -> unchanged (already paused/ended; nothing to bank).
 */
export function tickActive(clock: GuardianClock, now: number, playing: boolean): GuardianClock {
  if (playing) {
    if (clock.openStartedAtMs === null) return { ...clock, openStartedAtMs: now };
    const elapsedSec = Math.max(0, now - clock.openStartedAtMs) / 1000;
    return { activeSec: clock.activeSec + elapsedSec, openStartedAtMs: now };
  }
  if (clock.openStartedAtMs === null) return clock;
  const elapsedSec = Math.max(0, now - clock.openStartedAtMs) / 1000;
  return { activeSec: clock.activeSec + elapsedSec, openStartedAtMs: null };
}

/** The first 30/60/90-min threshold crossed by `activeSeconds` that hasn't fired yet today. */
export function nextUnshownThreshold(
  activeSeconds: number,
  interruptsShown: number[],
): InterruptThresholdMin | null {
  for (const m of INTERRUPT_THRESHOLDS_MIN) {
    if (activeSeconds >= m * 60 && !interruptsShown.includes(m)) return m;
  }
  return null;
}

/** True once today's active playback reaches the non-negotiable 120-minute cap. */
export function hasReachedCap(activeSeconds: number): boolean {
  return activeSeconds >= CAP_MINUTES * 60;
}

// ---------------------------------------------------------------------------
// Guardian decision function — pure, so the mandatory ordering (exitFullscreen precedes the
// overlay; force-pause; no auto-resume) is unit-testable without a browser. WatchPlayer executes
// the returned actions in order; it never resumes playback except from an explicit user choice
// handler, which this function has no path to produce.
// ---------------------------------------------------------------------------
export type GuardianAction =
  | { type: "exitFullscreen" }
  | { type: "pause" }
  | { type: "showInterrupt"; minutes: InterruptThresholdMin }
  | { type: "showLocked" };

export function decideGuardianActions(params: {
  activeSeconds: number;
  interruptsShown: number[];
  capReached: boolean;
  isFullscreen: boolean;
}): GuardianAction[] {
  const capping = !params.capReached && hasReachedCap(params.activeSeconds);
  const threshold = capping ? null : nextUnshownThreshold(params.activeSeconds, params.interruptsShown);
  if (!capping && threshold === null) return [];

  const actions: GuardianAction[] = [];
  if (params.isFullscreen) actions.push({ type: "exitFullscreen" });
  actions.push({ type: "pause" });
  actions.push(capping ? { type: "showLocked" } : { type: "showInterrupt", minutes: threshold as InterruptThresholdMin });
  return actions;
}

/** wa.me deep link from a preset contact number (digits only, international format). */
export function buildWhatsAppLink(rawNumber: string): string {
  const digits = rawNumber.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

/** ChatGPT web's `?q=` prefill URL — the only known-working non-interactive check-in target. */
export function buildChatGptCheckinUrl(): string {
  const prompt = "I've been watching videos to avoid some stress. Can you check in with me?";
  return `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
}
