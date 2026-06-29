// Channel roster loader + the single swappable uploads-playlist resolver (PRD D2).
//
// SINGLE SOURCE OF TRUTH: the canonical roster lives at the repo-root `channels.json`
// ({ _meta, channels }). This loader reads it directly and validates it with RosterSchema
// at module load — there is no second copy under src/config to drift out of sync, and no
// `as` cast on the parsed JSON.
//
// Decision D2: UULF (long-form only — excludes Shorts/live at the data layer) is the
// PRIMARY uploads source, behind ONE resolver. The UULF/UU/UUSH/UULV prefixes are
// undocumented by YouTube and may break without notice; isolating the prefix logic here
// makes the fallback (UU full uploads + client-side /shorts/ filtering) a one-line swap.

import rawRoster from "../../channels.json";
import { RosterSchema, type ChannelConfig, type Category, type Tier } from "./types";

// Flip to false to fall back to UU (full uploads) if UULF ever stops resolving.
// When false, the data layer must additionally drop Shorts (see youtube.ts isShort()).
export const USE_UULF = true;

/**
 * Resolve a channel's uploads playlist id from its channel id (D2).
 * UC<suffix> -> UULF<suffix> (long-form) | UU<suffix> (full uploads fallback).
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

// Validate the canonical roster once, at module load. A malformed roster fails loudly
// here rather than surfacing as undefined behavior deeper in the data layer.
const ROSTER = RosterSchema.parse(rawRoster);

/** The locked home-feed tier slot budget, read from the canonical roster's _meta. */
export const HOME_FEED_SLOTS = ROSTER._meta.homeFeedSlots;

/**
 * An ACTIVE channel: resolved (real UC id) AND classified (tier 1|2|3, not parked). The
 * `channelId` and `uploadsPlaylistId` are guaranteed present, so the data layer needs no
 * non-null assertions when consuming them.
 */
export type ActiveChannel = ChannelConfig & { channelId: string; uploadsPlaylistId: string };

/** Narrow a roster entry to an ActiveChannel, or null if it is unresolved or parked. */
function toActive(c: ChannelConfig): ActiveChannel | null {
  if (!c.channelId?.startsWith("UC") || c.tier === null || c.parked === true) return null;
  const uploadsPlaylistId =
    c.uploadsPlaylistId && c.uploadsPlaylistId.length > 0
      ? c.uploadsPlaylistId
      : resolveUploadsPlaylistId(c.channelId);
  return { ...c, channelId: c.channelId, uploadsPlaylistId };
}

/** Active channels usable by the data layer (resolved + classified, parked excluded). */
export function getChannels(): ActiveChannel[] {
  return ROSTER.channels
    .map(toActive)
    .filter((c): c is ActiveChannel => c !== null);
}

/** Active channels in a single tier. Used by the home feed (tiers 1 ∪ 2 only). */
export function getActiveByTier(tier: 1 | 2 | 3): ActiveChannel[] {
  return getChannels().filter((c) => c.tier === tier);
}

/** Parked channels: tier === null (or parked flag). Resolved + stored, excluded from all feeds. */
export function getParked(): ChannelConfig[] {
  return ROSTER.channels.filter((c) => c.tier === null || c.parked === true);
}

/**
 * Config for a single resolved, non-parked channel (any tier 1|2|3) — so tier-3 channel
 * pages remain reachable by direct URL while parked channels stay hidden until classified.
 */
export function getChannelConfig(channelId: string): ActiveChannel | undefined {
  const found = ROSTER.channels.find((c) => c.channelId === channelId);
  return found ? (toActive(found) ?? undefined) : undefined;
}

export function getCategoryOf(channelId: string): Category | undefined {
  return getChannelConfig(channelId)?.category;
}

export function getTierOf(channelId: string): Tier | undefined {
  return getChannelConfig(channelId)?.tier;
}

/** True when no channel has been resolved + classified yet (fresh clone, before resolve-channels). */
export function isUnconfigured(): boolean {
  return getChannels().length === 0;
}
