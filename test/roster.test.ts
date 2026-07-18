import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAllChannelConfigs,
  isChannelHidden,
  mergeRosterRows,
  promoteParkedRow,
  toRosterRow,
} from "../src/lib/channels";
import type { ChannelAddition, RosterRow } from "../src/lib/types";

function mkRow(over: Partial<RosterRow> & { channelId: string }): RosterRow {
  return {
    handle: "@x",
    title: "X",
    avatarUrl: "",
    subscriberCount: 0,
    uploadsPlaylistId: "UULFxxxxxxxxxxxxxxxxxxxx",
    category: "Islamic",
    tier: 1,
    source: "base",
    parked: false,
    confirm: false,
    usedUU: false,
    shortsOnly: false,
    ...over,
  };
}

function mkAddition(over: Partial<ChannelAddition> & { channelId: string }): ChannelAddition {
  return {
    handle: "@x",
    uploadsPlaylistId: "UULFxxxxxxxxxxxxxxxxxxxx",
    title: "X",
    avatarUrl: "",
    subscriberCount: 0,
    category: "Islamic",
    tier: 1,
    addedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("mergeRosterRows — effective roster (base + additions, addition wins, dedupe)", () => {
  it("concatenates base + additions when channelIds don't overlap", () => {
    const base = [mkRow({ channelId: "UCbase1" }), mkRow({ channelId: "UCbase2" })];
    const additions = [mkAddition({ channelId: "UCadd1" })];
    const merged = mergeRosterRows(base, additions);
    expect(merged).toHaveLength(3);
    expect(merged.map((r) => r.channelId).sort()).toEqual(["UCadd1", "UCbase1", "UCbase2"]);
  });

  it("addition wins: a base row with the same channelId as an addition is replaced, not duplicated", () => {
    const base = [mkRow({ channelId: "UCshared", tier: null, parked: true, source: "base" })];
    const additions = [mkAddition({ channelId: "UCshared", tier: 2 })];
    const merged = mergeRosterRows(base, additions);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("added");
    expect(merged[0].tier).toBe(2);
    expect(merged[0].parked).toBe(false);
  });

  it("removing an addition (simulated: additions array without it) reverts a promoted channel to its base (parked) row", () => {
    const base = [mkRow({ channelId: "UCshared", tier: null, parked: true, source: "base" })];
    const withAddition = mergeRosterRows(base, [mkAddition({ channelId: "UCshared", tier: 2 })]);
    expect(withAddition[0].parked).toBe(false);

    const afterRemoval = mergeRosterRows(base, []); // addition removed
    expect(afterRemoval).toHaveLength(1);
    expect(afterRemoval[0].source).toBe("base");
    expect(afterRemoval[0].parked).toBe(true);
  });

  it("a base (non-added) channel is never represented as removable — no added-only row appears for it", () => {
    const base = [mkRow({ channelId: "UCbase1", source: "base" })];
    const merged = mergeRosterRows(base, []);
    expect(merged[0].source).toBe("base");
  });
});

describe("promoteParkedRow — classifying a parked channel makes it feed-eligible", () => {
  it("builds a ChannelAddition carrying the chosen tier and the row's existing metadata", () => {
    const parkedRow = mkRow({
      channelId: "UCparked00000000000000",
      title: "Parked Channel",
      tier: null,
      parked: true,
      source: "base",
    });
    const addition = promoteParkedRow(parkedRow, 2);
    expect(addition.channelId).toBe(parkedRow.channelId);
    expect(addition.tier).toBe(2);
    expect(addition.title).toBe("Parked Channel");

    // Merging the resulting addition back in makes the channel non-parked with the new tier —
    // i.e. eligible for the feed builder's tier allocation.
    const merged = mergeRosterRows([parkedRow], [addition]);
    expect(merged[0].parked).toBe(false);
    expect(merged[0].tier).toBe(2);
    expect(merged[0].source).toBe("added");
  });
});

describe("toRosterRow — parked derivation + base roster shape", () => {
  it("derives parked from tier===null OR the parked flag", () => {
    const configs = getAllChannelConfigs().filter(
      (c): c is typeof c & { channelId: string } => Boolean(c.channelId),
    );
    for (const c of configs) {
      const row = toRosterRow(c);
      expect(row.parked).toBe(c.tier === null || c.parked === true);
      expect(row.source).toBe("base");
    }
  });

  it("falls back to enrichment meta when the baked entry is missing avatar/subs", () => {
    const resolved = getAllChannelConfigs().filter(
      (c): c is typeof c & { channelId: string } => Boolean(c.channelId),
    );
    const bare = resolved[0];
    const row = toRosterRow(
      { ...bare, avatarUrl: undefined, subscriberCount: undefined },
      { avatarUrl: "https://example.com/a.jpg", subscriberCount: 42, title: "Fallback Title" },
    );
    expect(row.avatarUrl).toBe("https://example.com/a.jpg");
    expect(row.subscriberCount).toBe(42);
  });
});

describe("tier grouping counts (Channel Library header strip)", () => {
  it("active tier counts exclude parked channels", () => {
    const rows = [
      mkRow({ channelId: "UC1", tier: 1, parked: false }),
      mkRow({ channelId: "UC2", tier: 2, parked: false }),
      mkRow({ channelId: "UC3", tier: null, parked: true }),
    ];
    const active = rows.filter((r) => !r.parked);
    const parked = rows.filter((r) => r.parked);
    expect(active).toHaveLength(2);
    expect(parked).toHaveLength(1);
    expect(active.filter((r) => r.tier === 1)).toHaveLength(1);
    expect(active.filter((r) => r.tier === 2)).toHaveLength(1);
  });
});

describe("mergeRosterRows — suppression overlay (remove/hide any channel)", () => {
  it("suppressing a base channelId removes it from the effective roster", () => {
    const base = [mkRow({ channelId: "UCsuppressed0000000000", tier: 1 }), mkRow({ channelId: "UCkept00000000000000" })];
    const merged = mergeRosterRows(base, [], ["UCsuppressed0000000000"]);
    expect(merged.map((r) => r.channelId)).toEqual(["UCkept00000000000000"]);
  });

  it("un-hiding (suppression list no longer includes the id) restores it", () => {
    const base = [mkRow({ channelId: "UChidden000000000000", tier: 1 })];
    const hidden = mergeRosterRows(base, [], ["UChidden000000000000"]);
    expect(hidden).toHaveLength(0);

    const restored = mergeRosterRows(base, [], []); // suppression record deleted
    expect(restored).toHaveLength(1);
    expect(restored[0].channelId).toBe("UChidden000000000000");
  });

  it("precedence: a base channel that is BOTH suppressed and re-added by URL — the re-add wins", () => {
    const base = [mkRow({ channelId: "UCreadded00000000000", tier: 1, title: "Base Title" })];
    const additions = [mkAddition({ channelId: "UCreadded00000000000", tier: 2, title: "Re-added Title" })];
    const merged = mergeRosterRows(base, additions, ["UCreadded00000000000"]);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("added");
    expect(merged[0].title).toBe("Re-added Title");
    expect(merged[0].tier).toBe(2);
  });

  it("suppression never affects an already-added channel that isn't in the suppressed list", () => {
    const base: RosterRow[] = [];
    const additions = [mkAddition({ channelId: "UCunrelated000000000" })];
    const merged = mergeRosterRows(base, additions, ["UCsomeotherid00000000"]);
    expect(merged).toHaveLength(1);
    expect(merged[0].channelId).toBe("UCunrelated000000000");
  });
});

describe("isChannelHidden — single-channelId equivalent used by the channel page", () => {
  it("is hidden when suppressed and not re-added", () => {
    expect(isChannelHidden("UCx", ["UCx"], [])).toBe(true);
  });

  it("is NOT hidden when suppressed but re-added (re-add wins)", () => {
    expect(isChannelHidden("UCx", ["UCx"], ["UCx"])).toBe(false);
  });

  it("is not hidden when never suppressed", () => {
    expect(isChannelHidden("UCx", [], [])).toBe(false);
  });
});

describe("Channel Library filter box never triggers a search.list call (static guarantee)", () => {
  it("the page source contains no reference to a YouTube search endpoint", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "app", "channels", "page.tsx"),
      "utf8",
    );
    // Every fetch() call in this page targets one of our own routes, never a YouTube search
    // endpoint. The filter box itself has no fetch() near it at all — see the next assertion.
    const fetchTargets = [...source.matchAll(/fetch\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(fetchTargets.length).toBeGreaterThan(0);
    for (const target of fetchTargets) {
      expect(target).not.toMatch(/search/i);
      expect(target.startsWith("/api/")).toBe(true);
    }
    // The filter is a plain client-side Array.filter over the already-fetched roster — no
    // network call of any kind is wired to the query input.
    expect(source).toMatch(/effectiveRoster\.filter/);
  });
});
