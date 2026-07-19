import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isPlaylistMutable,
  playlistItemId,
  resolveEnsuredWatchLater,
  sortPlaylists,
  WATCH_LATER_PLAYLIST_ID,
  WATCH_LATER_PLAYLIST_NAME,
} from "../src/lib/playlistsCore";
import { mergeRosterRows } from "../src/lib/channels";
import type { Playlist, RosterRow } from "../src/lib/types";

describe("playlistItemId", () => {
  it("builds a stable, unique id per (playlist, video) pair", () => {
    expect(playlistItemId("p1", "v1")).toBe("p1:v1");
    expect(playlistItemId("p1", "v2")).not.toBe(playlistItemId("p1", "v1"));
    expect(playlistItemId("p2", "v1")).not.toBe(playlistItemId("p1", "v1"));
  });
});

describe("resolveEnsuredWatchLater — idempotent Watch Later creation, multi-tab race safe", () => {
  it("fabricates a fresh row with the FIXED id when none exists yet", () => {
    const result = resolveEnsuredWatchLater(undefined, "2026-07-20T00:00:00.000Z");
    expect(result).toEqual({
      id: WATCH_LATER_PLAYLIST_ID,
      name: WATCH_LATER_PLAYLIST_NAME,
      createdAt: "2026-07-20T00:00:00.000Z",
      isSystem: true,
    });
  });

  it("returns an existing row UNCHANGED — a second call never stomps createdAt (double-init)", () => {
    const existing: Playlist = {
      id: WATCH_LATER_PLAYLIST_ID,
      name: WATCH_LATER_PLAYLIST_NAME,
      createdAt: "2026-01-01T00:00:00.000Z",
      isSystem: true,
    };
    const result = resolveEnsuredWatchLater(existing, "2026-07-20T00:00:00.000Z");
    expect(result).toBe(existing);
    expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("two-tab race: both tabs observing 'no existing row' resolve to the SAME id — the store can never end up with two", () => {
    const tabA = resolveEnsuredWatchLater(undefined, "2026-07-20T00:00:00.000Z");
    const tabB = resolveEnsuredWatchLater(undefined, "2026-07-20T00:00:00.010Z");
    expect(tabA.id).toBe(tabB.id);
    expect(tabA.id).toBe(WATCH_LATER_PLAYLIST_ID);
    // Whichever `put()` lands last, IndexedDB's keyPath semantics mean exactly one row survives
    // for this key — never two, since the id was never derived/randomized per call.
  });
});

describe("isPlaylistMutable — Watch Later (and any system playlist) is undeletable/unrenamable", () => {
  it("a system playlist is not mutable", () => {
    expect(isPlaylistMutable({ isSystem: true })).toBe(false);
  });
  it("a user playlist is mutable", () => {
    expect(isPlaylistMutable({ isSystem: false })).toBe(true);
  });
});

describe("sortPlaylists — Watch Later first, then user playlists newest-first", () => {
  it("orders system playlists before user playlists regardless of createdAt", () => {
    const user: Playlist = { id: "u1", name: "Mine", createdAt: "2030-01-01T00:00:00Z", isSystem: false };
    const system: Playlist = { id: WATCH_LATER_PLAYLIST_ID, name: "Watch Later", createdAt: "2020-01-01T00:00:00Z", isSystem: true };
    expect(sortPlaylists([user, system]).map((p) => p.id)).toEqual([WATCH_LATER_PLAYLIST_ID, "u1"]);
  });

  it("orders user playlists newest-created-first", () => {
    const older: Playlist = { id: "a", name: "A", createdAt: "2026-01-01T00:00:00Z", isSystem: false };
    const newer: Playlist = { id: "b", name: "B", createdAt: "2026-06-01T00:00:00Z", isSystem: false };
    expect(sortPlaylists([older, newer]).map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("playlist provenance vs the roster guard — rail visibility", () => {
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

  it("a playlist item's channel that is suppressed (and not re-added) is absent from the effective roster — the rail must hide", () => {
    const base = [mkRow({ channelId: "UCsuppressed0000000000" })];
    const effective = mergeRosterRows(base, [], ["UCsuppressed0000000000"]);
    const row = effective.find((r) => r.channelId === "UCsuppressed0000000000");
    expect(row).toBeUndefined(); // PlaylistWatchView's rail-fetch guard: no row -> no fetch, rail stays empty
  });

  it("an in-roster channel is present — the rail may show", () => {
    const base = [mkRow({ channelId: "UCinroster000000000000" })];
    const effective = mergeRosterRows(base, [], []);
    const row = effective.find((r) => r.channelId === "UCinroster000000000000");
    expect(row).toBeDefined();
    expect(row?.uploadsPlaylistId).toBeTruthy(); // what the rail fetch needs to proceed
  });
});

describe("playing from a playlist is NOT a cap bypass (static guarantee)", () => {
  it("PlaylistWatchView renders the exact same WatchPlayer component used everywhere else", () => {
    const source = readFileSync(
      join(__dirname, "..", "src", "components", "PlaylistWatchView.tsx"),
      "utf8",
    );
    // Reuses the shared WatchPlayer (and therefore its mount-time capped check, staged
    // interrupts, and heartbeat) rather than re-implementing or bypassing any of it.
    expect(source).toMatch(/import\s*\{\s*WatchPlayer\s*\}\s*from\s*"\.\/WatchPlayer"/);
    expect(source).toMatch(/<WatchPlayer\s+videoId={videoId}/);
  });
});
