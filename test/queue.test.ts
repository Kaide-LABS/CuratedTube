import { describe, it, expect } from "vitest";
import {
  nextOrderValue,
  nextQueueItem,
  QUEUE_PLAYLIST_ID,
  QUEUE_PLAYLIST_NAME,
  resolveEnsuredQueue,
  swapOrder,
} from "../src/lib/playlistsCore";
import { decideGuardianActions } from "../src/lib/watchGuardian";
import { mergeRosterRows } from "../src/lib/channels";
import type { Playlist, PlaylistItem, RosterRow } from "../src/lib/types";

function mkItem(over: Partial<PlaylistItem> & { videoId: string; order: number }): PlaylistItem {
  return {
    id: `queue:${over.videoId}`,
    playlistId: QUEUE_PLAYLIST_ID,
    title: "T",
    thumbnailUrl: "",
    channelId: "UCx",
    channelTitle: "C",
    durationSec: 300,
    addedAt: "2026-07-20T00:00:00Z",
    ...over,
  };
}

describe("resolveEnsuredQueue — idempotent creation (same fixed-id pattern as Watch Later)", () => {
  it("fabricates a fresh row with the FIXED id when none exists yet", () => {
    const result = resolveEnsuredQueue(undefined, "2026-07-20T00:00:00.000Z");
    expect(result).toEqual({
      id: QUEUE_PLAYLIST_ID,
      name: QUEUE_PLAYLIST_NAME,
      createdAt: "2026-07-20T00:00:00.000Z",
      isSystem: true,
      isQueue: true,
    });
  });

  it("returns an existing row UNCHANGED (double-init)", () => {
    const existing: Playlist = {
      id: QUEUE_PLAYLIST_ID,
      name: QUEUE_PLAYLIST_NAME,
      createdAt: "2026-01-01T00:00:00Z",
      isSystem: true,
      isQueue: true,
    };
    expect(resolveEnsuredQueue(existing, "2026-07-20T00:00:00Z")).toBe(existing);
  });

  it("two-tab race: both resolve to the same fixed id — never two rows", () => {
    const tabA = resolveEnsuredQueue(undefined, "2026-07-20T00:00:00.000Z");
    const tabB = resolveEnsuredQueue(undefined, "2026-07-20T00:00:00.010Z");
    expect(tabA.id).toBe(tabB.id);
    expect(tabA.id).toBe(QUEUE_PLAYLIST_ID);
  });
});

describe("nextOrderValue — append order", () => {
  it("is 0 for an empty queue", () => {
    expect(nextOrderValue([])).toBe(0);
  });
  it("is one past the current max", () => {
    expect(nextOrderValue([{ order: 0 }, { order: 1 }, { order: 4 }])).toBe(5);
  });
  it("treats an unset order as -1 for the purpose of computing the next value", () => {
    expect(nextOrderValue([{ order: undefined }])).toBe(0);
  });
});

describe("swapOrder — reorder (add/append/reorder/remove/clear semantics)", () => {
  const items = [
    mkItem({ videoId: "a", order: 0 }),
    mkItem({ videoId: "b", order: 1 }),
    mkItem({ videoId: "c", order: 2 }),
  ];

  it("moving the middle item up swaps it with its predecessor", () => {
    const result = swapOrder(items, "b", "up");
    const byId = Object.fromEntries(result.map((it) => [it.videoId, it.order]));
    expect(byId.a).toBe(1);
    expect(byId.b).toBe(0);
    expect(byId.c).toBe(2);
  });

  it("moving the middle item down swaps it with its successor", () => {
    const result = swapOrder(items, "b", "down");
    const byId = Object.fromEntries(result.map((it) => [it.videoId, it.order]));
    expect(byId.a).toBe(0);
    expect(byId.b).toBe(2);
    expect(byId.c).toBe(1);
  });

  it("is a no-op at the top boundary", () => {
    expect(swapOrder(items, "a", "up")).toBe(items);
  });

  it("is a no-op at the bottom boundary", () => {
    expect(swapOrder(items, "c", "down")).toBe(items);
  });
});

describe("nextQueueItem — ordered playback advance", () => {
  const items = [
    mkItem({ videoId: "a", order: 0 }),
    mkItem({ videoId: "b", order: 1 }),
    mkItem({ videoId: "c", order: 2 }),
  ];

  it("returns the item immediately after the current one, regardless of array order", () => {
    const shuffled = [items[2], items[0], items[1]];
    expect(nextQueueItem(shuffled, "a")?.videoId).toBe("b");
    expect(nextQueueItem(shuffled, "b")?.videoId).toBe("c");
  });

  it("returns null at the end of the queue — no wrap-around, no fallback", () => {
    expect(nextQueueItem(items, "c")).toBeNull();
  });

  it("returns null if the current video isn't in the queue at all", () => {
    expect(nextQueueItem(items, "unknown")).toBeNull();
  });
});

describe("queue playback is NOT a cap bypass — same guardian decision function applies", () => {
  it("decideGuardianActions locks regardless of what's playing (queue or otherwise)", () => {
    const actions = decideGuardianActions({
      activeSeconds: 150 * 60,
      interruptsShown: [30, 60, 90, 120],
      capReached: false,
      isFullscreen: false,
    });
    expect(actions.map((a) => a.type)).toEqual(["pause", "showLocked"]);
    // WatchPlayer's mount-time capped check (shared, unmodified by the queue feature) then
    // refuses to even create the player on the next mount — see WatchPlayer.tsx's guardianReady
    // gate, reused identically by PlaylistWatchView for queue playback.
  });
});

describe("queue provenance — an out-of-roster (suppressed) queued item still plays; rail hidden", () => {
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

  it("a suppressed channel's queued item is absent from the effective roster — rail hides, but this never gates playback (playback is provenance-based, not roster-based)", () => {
    const base = [mkRow({ channelId: "UCsuppressed0000000000" })];
    const effective = mergeRosterRows(base, [], ["UCsuppressed0000000000"]);
    expect(effective.find((r) => r.channelId === "UCsuppressed0000000000")).toBeUndefined();
  });
});
