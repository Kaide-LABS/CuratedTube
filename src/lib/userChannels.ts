// User channel additions — client-only IndexedDB overlay on the baked channels.json roster
// (add-channels-by-URL feature). The baked roster is read-only in production (Cloud Run's
// filesystem is ephemeral — a write would not survive a cold start or a second instance), so
// user additions live entirely in this browser's IndexedDB, never written back to the file.
// All ops are idempotent and degrade silently when storage is unavailable, matching the rest
// of this module family (playlists.ts, suppressedChannels.ts, etc).
"use client";

import { tx } from "./watchState";
import type { ChannelAddition } from "./types";

const STORE = "userChannels";

/** Save (or update) a user channel addition, keyed by channelId. */
export async function addUserChannel(addition: ChannelAddition): Promise<void> {
  try {
    await tx(STORE, "readwrite", (s) => s.put(addition));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** Remove a user channel addition. Never touches the baked roster. No-op if not present. */
export async function removeUserChannel(channelId: string): Promise<void> {
  try {
    await tx(STORE, "readwrite", (s) => s.delete(channelId));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** All user channel additions, newest-added first. */
export async function getUserChannels(): Promise<ChannelAddition[]> {
  try {
    const all = await tx<ChannelAddition[]>(
      STORE,
      "readonly",
      (s) => s.getAll() as IDBRequest<ChannelAddition[]>,
    );
    return all.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  } catch {
    return [];
  }
}
