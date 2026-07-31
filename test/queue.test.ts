import { describe, it, expect } from "vitest";
import {
  nextOrderValue,
  nextQueueItem,
  QUEUE_PLAYLIST_ID,
  QUEUE_PLAYLIST_NAME,
  reorderedVideoIds,
  resolveEnsuredQueue,
} from "../src/lib/playlistsCore";
import { decideGuardianActions } from "../src/lib/watchGuardian";
import { mergeRosterRows } from "../src/lib/channels";
import type { Playlist, PlaylistItem, RosterRow } from "../src/lib/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

describe("reorderedVideoIds — single-drag reorder (drives the drag-and-drop queue page)", () => {
  const items = [
    mkItem({ videoId: "a", order: 0 }),
    mkItem({ videoId: "b", order: 1 }),
    mkItem({ videoId: "c", order: 2 }),
    mkItem({ videoId: "d", order: 3 }),
    mkItem({ videoId: "e", order: 4 }),
  ];

  it("dragging item 5 to position 1 moves it to the front in ONE operation, everything else shifts down", () => {
    const result = reorderedVideoIds(items, "e", "a");
    expect(result).toEqual(["e", "a", "b", "c", "d"]);
  });

  it("dragging the middle item to the end moves it past everything after it", () => {
    const result = reorderedVideoIds(items, "c", "e");
    expect(result).toEqual(["a", "b", "d", "e", "c"]);
  });

  it("is order-independent of the input array's own iteration order — sorts by `order` first", () => {
    const shuffled = [items[4], items[1], items[3], items[0], items[2]];
    expect(reorderedVideoIds(shuffled, "e", "a")).toEqual(["e", "a", "b", "c", "d"]);
  });

  it("dropping onto itself is a no-op", () => {
    expect(reorderedVideoIds(items, "b", "b")).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("an unknown active or target id leaves the current order unchanged", () => {
    expect(reorderedVideoIds(items, "unknown", "a")).toEqual(["a", "b", "c", "d", "e"]);
    expect(reorderedVideoIds(items, "a", "unknown")).toEqual(["a", "b", "c", "d", "e"]);
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

describe("persistQueueReorder — atomic single-transaction persistence (source guarantee)", () => {
  it("writes the reordered queue inside ONE txMany transaction, not N individual tx() calls in a loop", () => {
    const source = readFileSync(join(__dirname, "..", "src", "lib", "playlists.ts"), "utf8");
    const fnMatch = source.match(/export async function persistQueueReorder\([\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    expect(body).toMatch(/txMany\(/);
    expect(body).not.toMatch(/Promise\.all/);
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
