import { describe, it, expect, beforeEach } from "vitest";
import {
  recordQuota,
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
