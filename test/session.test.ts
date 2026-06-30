import { describe, it, expect } from "vitest";
import {
  activeMsInWindow,
  pruneSegments,
  shouldPromptBreak,
  mergeSegment,
} from "../src/lib/session";
import { DEFAULT_SESSION_CONFIG } from "../src/lib/session-config";
import type { SessionConfig, SessionSegment } from "../src/lib/types";

const NOW = Date.UTC(2026, 5, 30, 12, 0, 0);
const HOUR = 3_600_000;
const MIN = 60_000;
const WINDOW = 4 * HOUR;

function seg(
  over: Partial<SessionSegment> & { startMinAgo: number; durMin: number },
): SessionSegment {
  const { startMinAgo, durMin, ...rest } = over;
  const start = NOW - startMinAgo * MIN;
  return {
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + durMin * MIN).toISOString(),
    activeMs: durMin * MIN,
    videoId: rest.videoId ?? "v",
    ...rest,
  };
}

function cfg(over: Partial<SessionConfig> = {}): SessionConfig {
  return { ...DEFAULT_SESSION_CONFIG, ...over };
}

describe("activeMsInWindow — acceptance §8.3", () => {
  it("sums closed segments fully inside the window", () => {
    const segs = [seg({ startMinAgo: 60, durMin: 10 }), seg({ startMinAgo: 30, durMin: 5 })];
    expect(activeMsInWindow(segs, NOW, WINDOW)).toBe(15 * MIN);
  });

  it("clips a segment that began before the window to the window edge", () => {
    // started 5h ago, ran 2h => only the last hour (since the 4h cutoff) counts.
    const segs = [seg({ startMinAgo: 5 * 60, durMin: 2 * 60 })];
    expect(activeMsInWindow(segs, NOW, WINDOW)).toBe(1 * HOUR);
  });

  it("counts an OPEN segment (endedAt null) up to now", () => {
    const open: SessionSegment = {
      startedAt: new Date(NOW - 20 * MIN).toISOString(),
      endedAt: null,
      activeMs: 0,
      videoId: "v",
    };
    expect(activeMsInWindow([open], NOW, WINDOW)).toBe(20 * MIN);
  });

  it("excludes a segment entirely before the window and skips unparseable starts", () => {
    const old = seg({ startMinAgo: 10 * 60, durMin: 5 });
    const bad: SessionSegment = {
      startedAt: "not-a-date",
      endedAt: null,
      activeMs: 0,
      videoId: "v",
    };
    expect(activeMsInWindow([old, bad], NOW, WINDOW)).toBe(0);
  });
});

describe("pruneSegments", () => {
  it("keeps in-window segments and drops fully-expired ones", () => {
    const keep = seg({ startMinAgo: 60, durMin: 10, videoId: "keep" });
    const drop = seg({ startMinAgo: 10 * 60, durMin: 10, videoId: "drop" });
    const out = pruneSegments([keep, drop], NOW, WINDOW);
    expect(out.map((s) => s.videoId)).toEqual(["keep"]);
  });

  it("retains an open segment", () => {
    const open: SessionSegment = {
      startedAt: new Date(NOW - 10 * MIN).toISOString(),
      endedAt: null,
      activeMs: 0,
      videoId: "v",
    };
    expect(pruneSegments([open], NOW, WINDOW)).toHaveLength(1);
  });
});

describe("shouldPromptBreak — acceptance §8.3/§8.4", () => {
  it("is false below, true exactly at, and true above the limit", () => {
    const c = cfg({ activeLimitMinutes: 30 });
    expect(shouldPromptBreak(29 * MIN, c)).toBe(false);
    expect(shouldPromptBreak(30 * MIN, c)).toBe(true);
    expect(shouldPromptBreak(45 * MIN, c)).toBe(true);
  });
});

describe("mergeSegment", () => {
  it("opens a new segment when playing with none open", () => {
    const s = mergeSegment(null, NOW, "v", true);
    expect(s).not.toBeNull();
    expect(s?.activeMs).toBe(0);
    expect(s?.endedAt).toBe(new Date(NOW).toISOString());
    expect(s?.videoId).toBe("v");
  });

  it("extends an open segment while playing continues", () => {
    const open = mergeSegment(null, NOW - 5 * MIN, "v", true)!;
    const s = mergeSegment(open, NOW, "v", true);
    expect(s?.startedAt).toBe(open.startedAt);
    expect(s?.activeMs).toBe(5 * MIN);
  });

  it("closes the open segment when playback stops", () => {
    const open = mergeSegment(null, NOW - 8 * MIN, "v", true)!;
    const s = mergeSegment(open, NOW, "v", false);
    expect(s?.endedAt).toBe(new Date(NOW).toISOString());
    expect(s?.activeMs).toBe(8 * MIN);
  });

  it("returns null when stopping with nothing open", () => {
    expect(mergeSegment(null, NOW, "v", false)).toBeNull();
  });

  it("falls back to the existing activeMs when startedAt is unparseable", () => {
    const broken: SessionSegment = { startedAt: "x", endedAt: null, activeMs: 1234, videoId: "v" };
    expect(mergeSegment(broken, NOW, "v", true)?.activeMs).toBe(1234);
    expect(mergeSegment(broken, NOW, "v", false)?.activeMs).toBe(1234);
  });
});
