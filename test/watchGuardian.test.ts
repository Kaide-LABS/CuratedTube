import { describe, it, expect } from "vitest";
import {
  buildChatGptCheckinUrl,
  buildWhatsAppLink,
  CAP_MINUTES,
  decideGuardianActions,
  freshWatchSession,
  hasReachedCap,
  localDateKey,
  mergeMonotonic,
  mergeSessions,
  nextUnshownThreshold,
  reconcileSessionForToday,
  tickActive,
  type GuardianClock,
} from "../src/lib/watchGuardian";
import type { WatchSession } from "../src/lib/types";

describe("tickActive — timestamp-delta accounting (never setInterval tick-counting)", () => {
  it("play 10s -> pause 30s -> play 5s = 15s counted", () => {
    let clock: GuardianClock = { activeSec: 0, openStartedAtMs: null };
    let t = 0;

    clock = tickActive(clock, t, true); // start playing at t=0
    expect(clock).toEqual({ activeSec: 0, openStartedAtMs: 0 });

    t = 10_000;
    clock = tickActive(clock, t, false); // pause at t=10s -> banks 10s
    expect(clock.activeSec).toBe(10);
    expect(clock.openStartedAtMs).toBeNull();

    t = 40_000; // 30s later, still paused — nothing happens without a play event
    // (no call here — the heartbeat only runs while playing, per spec)

    clock = tickActive(clock, t, true); // resume at t=40s
    expect(clock.activeSec).toBe(10); // unchanged — no elapsed time while paused
    expect(clock.openStartedAtMs).toBe(40_000);

    t = 45_000;
    clock = tickActive(clock, t, false); // pause/end at t=45s -> banks another 5s
    expect(clock.activeSec).toBe(15);
  });

  it("a delayed (throttled) checkpoint still computes the correct real elapsed time", () => {
    // Simulates a backgrounded tab where the 15s heartbeat is throttled and actually fires late
    // (e.g. at t=47s instead of t=15s) — the delta is still the REAL elapsed wall-clock time,
    // not an undercounted tick total, because accounting is timestamp-based.
    let clock: GuardianClock = { activeSec: 0, openStartedAtMs: null };
    clock = tickActive(clock, 0, true);
    clock = tickActive(clock, 47_000, true); // heartbeat fires late, playing continues
    expect(clock.activeSec).toBe(47);
    expect(clock.openStartedAtMs).toBe(47_000); // re-opened at the checkpoint, no double count
  });

  it("repeated playing checkpoints never double-count (close-and-reopen semantics)", () => {
    let clock: GuardianClock = { activeSec: 0, openStartedAtMs: null };
    clock = tickActive(clock, 0, true);
    clock = tickActive(clock, 15_000, true); // heartbeat #1
    clock = tickActive(clock, 30_000, true); // heartbeat #2
    clock = tickActive(clock, 45_000, false); // pause
    expect(clock.activeSec).toBe(45);
  });

  it("not-playing with no open interval is a no-op", () => {
    const clock: GuardianClock = { activeSec: 12, openStartedAtMs: null };
    expect(tickActive(clock, 99_999, false)).toEqual(clock);
  });
});

describe("mergeMonotonic — multi-tab safety, never regresses", () => {
  it("a stale lower write never reduces the stored value", () => {
    expect(mergeMonotonic(100, 40)).toBe(100);
  });
  it("two writers converge on the max", () => {
    expect(mergeMonotonic(40, 100)).toBe(100);
    expect(mergeMonotonic(100, 100)).toBe(100);
  });
});

describe("mergeSessions — same-day union merge for BroadcastChannel convergence", () => {
  it("takes the max activeSeconds, unions interruptsShown, ORs capReached", () => {
    const a: WatchSession = { date: "2026-07-19", activeSeconds: 1800, interruptsShown: [30], capReached: false };
    const b: WatchSession = { date: "2026-07-19", activeSeconds: 3600, interruptsShown: [60], capReached: false };
    const merged = mergeSessions(a, b);
    expect(merged.activeSeconds).toBe(3600);
    expect(merged.interruptsShown).toEqual([30, 60]);
    expect(merged.capReached).toBe(false);
  });

  it("capReached is sticky: either side having it true wins", () => {
    const a: WatchSession = { date: "2026-07-19", activeSeconds: 7200, interruptsShown: [30, 60, 90], capReached: true };
    const b: WatchSession = { date: "2026-07-19", activeSeconds: 7100, interruptsShown: [30, 60, 90], capReached: false };
    expect(mergeSessions(a, b).capReached).toBe(true);
    expect(mergeSessions(b, a).capReached).toBe(true);
  });

  it("a different date always wins outright over the other", () => {
    const older: WatchSession = { date: "2026-07-18", activeSeconds: 7000, interruptsShown: [], capReached: true };
    const newer: WatchSession = { date: "2026-07-19", activeSeconds: 10, interruptsShown: [], capReached: false };
    expect(mergeSessions(older, newer)).toEqual(newer);
    expect(mergeSessions(newer, older)).toEqual(newer);
  });
});

describe("localDateKey", () => {
  it("formats as local YYYY-MM-DD", () => {
    const d = new Date(2026, 6, 19, 23, 59); // July is month index 6
    expect(localDateKey(d.getTime())).toBe("2026-07-19");
  });
});

describe("reconcileSessionForToday — midnight rollover + clock guard", () => {
  it("no stored session -> fresh session for today", () => {
    expect(reconcileSessionForToday(undefined, "2026-07-19")).toEqual(freshWatchSession("2026-07-19"));
  });

  it("same date -> unchanged", () => {
    const stored: WatchSession = { date: "2026-07-19", activeSeconds: 500, interruptsShown: [30], capReached: false };
    expect(reconcileSessionForToday(stored, "2026-07-19")).toBe(stored);
  });

  it("stored date in the past -> normal rollover, fresh session, no carry-over", () => {
    const stored: WatchSession = { date: "2026-07-18", activeSeconds: 7200, interruptsShown: [30, 60, 90], capReached: true };
    expect(reconcileSessionForToday(stored, "2026-07-19")).toEqual(freshWatchSession("2026-07-19"));
  });

  it("CLOCK GUARD: stored date AHEAD of today -> tamper, keep capReached and do not reset", () => {
    const stored: WatchSession = { date: "2026-07-20", activeSeconds: 7200, interruptsShown: [30, 60, 90], capReached: true };
    expect(reconcileSessionForToday(stored, "2026-07-19")).toBe(stored);
  });
});

describe("nextUnshownThreshold — fires once per threshold, in order", () => {
  it("returns the first crossed threshold not yet shown", () => {
    expect(nextUnshownThreshold(30 * 60, [])).toBe(30);
    expect(nextUnshownThreshold(65 * 60, [30])).toBe(60);
    expect(nextUnshownThreshold(95 * 60, [30, 60])).toBe(90);
  });

  it("returns null once all crossed thresholds have already fired", () => {
    expect(nextUnshownThreshold(100 * 60, [30, 60, 90])).toBeNull();
  });

  it("returns null below the first threshold", () => {
    expect(nextUnshownThreshold(10 * 60, [])).toBeNull();
  });
});

describe("hasReachedCap", () => {
  it("is exact at the 120-minute boundary", () => {
    expect(hasReachedCap(CAP_MINUTES * 60 - 1)).toBe(false);
    expect(hasReachedCap(CAP_MINUTES * 60)).toBe(true);
  });
});

describe("decideGuardianActions — mandatory ordering, no implicit resume", () => {
  it("does nothing below any threshold", () => {
    expect(decideGuardianActions({ activeSeconds: 5, interruptsShown: [], capReached: false, isFullscreen: false })).toEqual([]);
  });

  it("crossing a threshold: pause then show the interrupt, no exitFullscreen when not fullscreen", () => {
    const actions = decideGuardianActions({
      activeSeconds: 30 * 60,
      interruptsShown: [],
      capReached: false,
      isFullscreen: false,
    });
    expect(actions).toEqual([{ type: "pause" }, { type: "showInterrupt", minutes: 30 }]);
  });

  it("exitFullscreen ALWAYS precedes pause and the overlay when fullscreen is active", () => {
    const actions = decideGuardianActions({
      activeSeconds: 30 * 60,
      interruptsShown: [],
      capReached: false,
      isFullscreen: true,
    });
    expect(actions.map((a) => a.type)).toEqual(["exitFullscreen", "pause", "showInterrupt"]);
  });

  it("reaching the cap takes priority over a still-unshown threshold and locks instead", () => {
    const actions = decideGuardianActions({
      activeSeconds: CAP_MINUTES * 60,
      interruptsShown: [30, 60], // 90 not yet shown, but cap wins
      capReached: false,
      isFullscreen: true,
    });
    expect(actions.map((a) => a.type)).toEqual(["exitFullscreen", "pause", "showLocked"]);
  });

  it("once capReached is already true, no further actions fire (already locked)", () => {
    expect(
      decideGuardianActions({ activeSeconds: CAP_MINUTES * 60 + 500, interruptsShown: [30, 60, 90], capReached: true, isFullscreen: false }),
    ).toEqual([]);
  });

  it("never produces a resume-type action — every resume is an explicit user choice outside this function", () => {
    // The GuardianAction union (exitFullscreen | pause | showInterrupt | showLocked) has no
    // resume/playVideo member at all — enforced by the type system, not just at runtime — so
    // there is no code path through this function that could ever hand back a "keep playing"
    // instruction. Confirm every action actually produced also stays within that known set.
    const allowed = new Set(["exitFullscreen", "pause", "showInterrupt", "showLocked"]);
    const allPossible: string[] = [
      decideGuardianActions({ activeSeconds: 0, interruptsShown: [], capReached: false, isFullscreen: false }),
      decideGuardianActions({ activeSeconds: 30 * 60, interruptsShown: [], capReached: false, isFullscreen: true }),
      decideGuardianActions({ activeSeconds: CAP_MINUTES * 60, interruptsShown: [30, 60, 90], capReached: false, isFullscreen: true }),
    ].flat().map((a) => a.type);
    expect(allPossible.length).toBeGreaterThan(0);
    expect(allPossible.every((t) => allowed.has(t))).toBe(true);
  });
});

describe("buildWhatsAppLink — digits-only, international format", () => {
  it("strips everything but digits", () => {
    expect(buildWhatsAppLink("+1 (555) 123-4567")).toBe("https://wa.me/15551234567");
  });
  it("passes through an already-digits-only number unchanged", () => {
    expect(buildWhatsAppLink("447911123456")).toBe("https://wa.me/447911123456");
  });
});

describe("buildChatGptCheckinUrl — the AI door is optional and powerless", () => {
  it("builds the known-working ?q= prefill URL, percent-encoded", () => {
    const url = buildChatGptCheckinUrl();
    expect(url.startsWith("https://chatgpt.com/?q=")).toBe(true);
    const q = new URL(url).searchParams.get("q");
    expect(q).toBe("I've been watching videos to avoid some stress. Can you check in with me?");
  });
});
