import { describe, it, expect } from "vitest";
import {
  RosterSchema,
  ChannelConfigSchema,
  VideoSchema,
  WatchStateSchema,
} from "../src/lib/types";
import rawRoster from "../channels.json";

describe("RosterSchema — the roster validation boundary", () => {
  it("parses the canonical root channels.json", () => {
    const r = RosterSchema.parse(rawRoster);
    expect(r._meta.homeFeedSlots).toEqual({ tier1: 15, tier2: 9, tier3: 0, total: 24 });
    expect(r.channels.length).toBeGreaterThan(0);
  });

  it("every channel has a valid tier (1|2|3|null) and a category", () => {
    const r = RosterSchema.parse(rawRoster);
    for (const c of r.channels) {
      expect([1, 2, 3, null]).toContain(c.tier);
      expect(typeof c.category).toBe("string");
    }
  });
});

describe("ChannelConfigSchema", () => {
  it("accepts a resolved entry", () => {
    expect(() =>
      ChannelConfigSchema.parse({
        handle: "@x",
        channelId: "UCo_RPqYFFTaTl_0Ojg-e8Bg",
        category: "Islamic",
        tier: 1,
      }),
    ).not.toThrow();
  });

  it("accepts a null (unresolved) channelId", () => {
    const c = ChannelConfigSchema.parse({ handle: "@x", channelId: null, category: "x", tier: 2 });
    expect(c.channelId).toBeNull();
  });

  it("rejects a malformed channelId (no fabricated/garbage ids)", () => {
    expect(() =>
      ChannelConfigSchema.parse({ handle: "@x", channelId: "NOTREAL", category: "x", tier: 1 }),
    ).toThrow();
  });

  it("rejects an out-of-range tier", () => {
    expect(() =>
      ChannelConfigSchema.parse({ handle: "@x", channelId: null, category: "x", tier: 4 }),
    ).toThrow();
  });

  it("rejects an uploadsPlaylistId with a wrong prefix", () => {
    expect(() =>
      ChannelConfigSchema.parse({
        handle: "@x",
        channelId: null,
        category: "x",
        tier: 1,
        uploadsPlaylistId: "PLxxxxxxxxxxxxxxxxxxxxxx",
      }),
    ).toThrow();
  });
});

describe("VideoSchema", () => {
  const base = {
    videoId: "v",
    channelId: "UCx",
    channelTitle: "t",
    channelAvatarUrl: "",
    title: "title",
    thumbnailUrl: "",
    durationSec: 100,
    viewCount: 5,
    likeCount: 1,
    publishedAt: "2026-01-01T00:00:00Z",
    category: "Islamic",
    tier: 1 as const,
  };
  it("accepts a well-formed video carrying its tier", () => {
    expect(VideoSchema.parse(base).tier).toBe(1);
  });
  it("rejects a negative viewCount", () => {
    expect(() => VideoSchema.parse({ ...base, viewCount: -1 })).toThrow();
  });
  it("rejects a non-integer durationSec", () => {
    expect(() => VideoSchema.parse({ ...base, durationSec: 1.5 })).toThrow();
  });
});

describe("WatchStateSchema", () => {
  it("accepts a valid watch state", () => {
    expect(() =>
      WatchStateSchema.parse({
        videoId: "v",
        visited: true,
        watchedSec: 30,
        lastSeenAt: "2026-01-01T00:00:00Z",
      }),
    ).not.toThrow();
  });
});
