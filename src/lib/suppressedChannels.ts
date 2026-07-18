// Suppressed channels — client-only IndexedDB overlay that hides a BASE (channels.json) channel
// without ever touching the read-only baked roster (Cloud Run's filesystem is ephemeral, same
// reasoning as userChannels.ts). Reversible: deleting the record un-hides the channel. A user
// ADDITION is never suppressed — removing it is a hard delete (see userChannels.ts); there is
// nothing to un-hide back to. All ops degrade silently when storage is unavailable, matching the
// rest of this module family.
"use client";

import { tx } from "./watchState";
import type { SuppressedChannel } from "./types";

const STORE = "suppressedChannels";

/** Hide a base channel (reversible — see unsuppressChannel). Idempotent by channelId. */
export async function suppressChannel(channelId: string): Promise<void> {
  try {
    const record: SuppressedChannel = { channelId, suppressedAt: new Date().toISOString() };
    await tx(STORE, "readwrite", (s) => s.put(record));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** Un-hide a previously suppressed base channel. No-op if it wasn't suppressed. */
export async function unsuppressChannel(channelId: string): Promise<void> {
  try {
    await tx(STORE, "readwrite", (s) => s.delete(channelId));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

/** All currently suppressed base channels, newest-hidden first. */
export async function getSuppressedChannels(): Promise<SuppressedChannel[]> {
  try {
    const all = await tx<SuppressedChannel[]>(
      STORE,
      "readonly",
      (s) => s.getAll() as IDBRequest<SuppressedChannel[]>,
    );
    return all.sort((a, b) => b.suppressedAt.localeCompare(a.suppressedAt));
  } catch {
    return [];
  }
}
