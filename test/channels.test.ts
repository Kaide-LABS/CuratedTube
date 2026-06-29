import { describe, it, expect } from "vitest";
import {
  getChannels,
  getActiveByTier,
  getParked,
  getChannelConfig,
  getCategoryOf,
  getTierOf,
  resolveUploadsPlaylistId,
  isUnconfigured,
  HOME_FEED_SLOTS,
} from "../src/lib/channels";

describe("resolveUploadsPlaylistId (D2 single resolver)", () => {
  it("UC -> UULF by default", () => {
    expect(resolveUploadsPlaylistId("UCo_RPqYFFTaTl_0Ojg-e8Bg")).toBe("UULFo_RPqYFFTaTl_0Ojg-e8Bg");
  });
  it("UC -> UU when forced", () => {
    expect(resolveUploadsPlaylistId("UCo_RPqYFFTaTl_0Ojg-e8Bg", { useUULF: false })).toBe(
      "UUo_RPqYFFTaTl_0Ojg-e8Bg",
    );
  });
  it("throws on a non-UC id", () => {
    expect(() => resolveUploadsPlaylistId("bogus")).toThrow();
  });
});

describe("roster loader + tier selectors", () => {
  it("loads the canonical roster (app is NOT unconfigured)", () => {
    expect(isUnconfigured()).toBe(false);
    expect(getChannels().length).toBeGreaterThan(0);
  });

  it("getChannels excludes parked + unresolved entries", () => {
    for (const c of getChannels()) {
      expect(c.channelId?.startsWith("UC")).toBe(true);
      expect(c.tier).not.toBeNull();
      expect(c.parked).not.toBe(true);
    }
  });

  it("getActiveByTier returns only that tier", () => {
    for (const t of [1, 2, 3] as const) {
      for (const c of getActiveByTier(t)) expect(c.tier).toBe(t);
    }
  });

  it("getParked returns only tier:null / parked channels", () => {
    for (const c of getParked()) {
      expect(c.tier === null || c.parked === true).toBe(true);
    }
  });

  it("a verified Tier-1 channel resolves through getChannelConfig", () => {
    const cfg = getChannelConfig("UCo_RPqYFFTaTl_0Ojg-e8Bg"); // @DarFawaaid
    expect(cfg).toBeDefined();
    expect(getTierOf("UCo_RPqYFFTaTl_0Ojg-e8Bg")).toBe(1);
    expect(getCategoryOf("UCo_RPqYFFTaTl_0Ojg-e8Bg")).toBe("Islamic");
  });

  it("exposes the locked 15/9/0 home slot budget from _meta", () => {
    expect(HOME_FEED_SLOTS).toEqual({ tier1: 15, tier2: 9, tier3: 0, total: 24 });
  });
});
