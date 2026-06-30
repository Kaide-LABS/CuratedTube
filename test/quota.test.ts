import { describe, it, expect, beforeEach } from "vitest";
import {
  recordQuota,
  recordConditional,
  quotaSnapshot,
  DAILY_QUOTA,
  ALERT_THRESHOLD,
} from "../src/lib/quota";

// quota.ts keeps a process-local counter on globalThis. Reset it before each test so the
// per-call-type accounting and the 80% alert threshold can be asserted deterministically.
const g = globalThis as unknown as { __ctQuota?: unknown };
beforeEach(() => {
  delete g.__ctQuota;
});

describe("recordQuota — per-call-type unit accounting (acceptance §9)", () => {
  it("charges 1 unit per call for each Data API method", () => {
    recordQuota("playlistItems.list");
    recordQuota("videos.list");
    recordQuota("channels.list");
    const s = quotaSnapshot();
    expect(s.total).toBe(3);
    expect(s.byType["playlistItems.list"]).toBe(1);
    expect(s.byType["videos.list"]).toBe(1);
    expect(s.byType["channels.list"]).toBe(1);
  });

  it("accumulates batched calls via the calls argument", () => {
    recordQuota("videos.list", 5);
    expect(quotaSnapshot().byType["videos.list"]).toBe(5);
    expect(quotaSnapshot().total).toBe(5);
  });
});

describe("quotaSnapshot — pct + 80% alert", () => {
  it("reports pct against the 10,000/day budget and no alert when low", () => {
    recordQuota("videos.list");
    const s = quotaSnapshot();
    expect(DAILY_QUOTA).toBe(10_000);
    expect(s.pct).toBeCloseTo(1 / DAILY_QUOTA, 10);
    expect(s.alert).toBe(false);
  });

  it("raises the alert once usage reaches the 80% threshold", () => {
    g.__ctQuota = {
      total: DAILY_QUOTA * ALERT_THRESHOLD - 1,
      byType: { "playlistItems.list": 0, "videos.list": DAILY_QUOTA * ALERT_THRESHOLD - 1, "channels.list": 0 },
      windowStart: 0, // far in the past is fine; rolling reset only matters past 24h
    };
    // Window roll: a windowStart of 0 (epoch) is >24h old, so the counter resets to fresh
    // on the next read. Record up to the threshold from a fresh window instead.
    delete g.__ctQuota;
    recordQuota("videos.list", DAILY_QUOTA * ALERT_THRESHOLD);
    const s = quotaSnapshot();
    expect(s.total).toBe(DAILY_QUOTA * ALERT_THRESHOLD);
    expect(s.pct).toBeGreaterThanOrEqual(ALERT_THRESHOLD);
    expect(s.alert).toBe(true);
  });
});

describe("recordConditional — 304 costs 0 units (acceptance §8.1)", () => {
  it("a 304 adds 0 units and increments conditionalHits + savedUnits", () => {
    recordConditional("playlistItems.list", true);
    const s = quotaSnapshot();
    expect(s.total).toBe(0);
    expect(s.byType["playlistItems.list"]).toBe(0);
    expect(s.conditionalHits).toBe(1);
    expect(s.savedUnits).toBe(1);
  });

  it("a non-304 (real 200) records the normal per-type cost", () => {
    recordConditional("videos.list", false);
    const s = quotaSnapshot();
    expect(s.total).toBe(1);
    expect(s.byType["videos.list"]).toBe(1);
    expect(s.conditionalHits).toBe(0);
    expect(s.savedUnits).toBe(0);
  });

  it("mixes 200s and 304s: only the 200s count toward the unit total", () => {
    recordConditional("videos.list", false); // +1
    recordConditional("videos.list", true); //  +0, saved 1
    recordConditional("videos.list", true); //  +0, saved 1
    const s = quotaSnapshot();
    expect(s.total).toBe(1);
    expect(s.conditionalHits).toBe(2);
    expect(s.savedUnits).toBe(2);
  });
});
