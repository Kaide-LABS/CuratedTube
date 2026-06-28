// Channel config loader + the single swappable uploads-playlist resolver (PRD D2).
//
// Decision D2: UULF (long-form only — excludes Shorts/live at the data layer) is the
// PRIMARY source, behind ONE resolver. The UULF/UU/UUSH/UULV prefixes are undocumented
// by YouTube and may break without notice; isolating the prefix logic here makes the
// fallback (UU full uploads + client-side /shorts/ filtering) a one-line swap.

import rawChannels from "@/config/channels.json";
import type { Category, ChannelConfig } from "./types";

// Flip to false to fall back to UU (full uploads) if UULF ever stops resolving.
// When false, the data layer must additionally drop Shorts (see youtube.ts isShort()).
export const USE_UULF = true;

/**
 * Resolve a channel's uploads playlist id from its channel id (D2).
 * UC<suffix> -> UULF<suffix> (long-form) | UU<suffix> (full uploads fallback).
 *
 * If an explicit `uploadsPlaylistId` already lives in channels.json we trust it;
 * otherwise we derive it by prefix swap.
 */
export function resolveUploadsPlaylistId(
  channelId: string,
  opts: { useUULF?: boolean } = {},
): string {
  const useUULF = opts.useUULF ?? USE_UULF;
  if (!channelId.startsWith("UC")) {
    throw new Error(`Expected a UC… channel id, got "${channelId}"`);
  }
  const suffix = channelId.slice(2);
  return (useUULF ? "UULF" : "UU") + suffix;
}

function normalize(c: ChannelConfig): ChannelConfig {
  // Backfill uploadsPlaylistId if a channelId is present but the playlist is blank.
  const uploadsPlaylistId =
    c.uploadsPlaylistId && c.uploadsPlaylistId.length > 0
      ? c.uploadsPlaylistId
      : c.channelId
        ? resolveUploadsPlaylistId(c.channelId)
        : "";
  return { ...c, uploadsPlaylistId };
}

/** Channels that are fully resolved (have a channelId) — usable by the data layer. */
export function getChannels(): ChannelConfig[] {
  return (rawChannels as ChannelConfig[])
    .filter((c) => c.channelId && c.channelId.startsWith("UC"))
    .map(normalize);
}

/** Every configured channel, including ones still awaiting resolution. */
export function getAllConfigured(): ChannelConfig[] {
  return (rawChannels as ChannelConfig[]).map(normalize);
}

export function getChannelConfig(channelId: string): ChannelConfig | undefined {
  return getChannels().find((c) => c.channelId === channelId);
}

export function getCategoryOf(channelId: string): Category | undefined {
  return getChannelConfig(channelId)?.category;
}

/** True when no channel has been resolved yet (fresh clone, before resolve-channels). */
export function isUnconfigured(): boolean {
  return getChannels().length === 0;
}
