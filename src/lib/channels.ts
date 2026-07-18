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
import {
  RosterSchema,
  type ChannelAddition,
  type ChannelConfig,
  type Category,
  type RosterRow,
  type Tier,
} from "./types";

// Flip to false to fall back to UU (full uploads) if UULF ever stops resolving.
// When false, the data layer must additionally drop Shorts (see youtube.ts isShort()).
// Driven by env so the fallback can be forced in production without a code change
// (CT_USE_UULF="false" => global UU mode); defaults to true (UULF-primary, D2).
export const USE_UULF: boolean = process.env.CT_USE_UULF !== "false";

/**
 * Pure predicate for the per-channel UULF→UU fallback drill (Implements PHASE_4_SPEC.md §4/§6).
 * A UULF uploads playlist that lists nothing — or whose listed items yield no long-form video —
 * is treated as broken/empty, so the data layer transparently re-lists the channel's full `UU`
 * uploads playlist and filters Shorts client-side (D2). Deterministic and side-effect-free so the
 * fallback decision is unit-testable without any network.
 */
export function shouldFallbackToUU(uulfItemCount: number, longformCount: number): boolean {
  return uulfItemCount === 0 || longformCount === 0;
}

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

/** Every raw roster entry (resolved or not, active or parked) — the Channel Library's source. */
export function getAllChannelConfigs(): ChannelConfig[] {
  return ROSTER.channels;
}

/** A resolved channel's uploads playlist id, honoring a stored value before deriving one. */
function uploadsPlaylistIdOf(c: ChannelConfig & { channelId: string }): string {
  return c.uploadsPlaylistId && c.uploadsPlaylistId.length > 0
    ? c.uploadsPlaylistId
    : resolveUploadsPlaylistId(c.channelId);
}

/**
 * Convert a resolved base-roster entry into a {@link RosterRow} (Channel Library). `meta` fills
 * in title/avatar/subscriberCount when the baked roster is missing them (unresolved enrichment,
 * backfilled server-side — see data.ts's getBaseRosterRows).
 */
export function toRosterRow(
  c: ChannelConfig & { channelId: string },
  meta?: { title?: string; avatarUrl?: string; subscriberCount?: number },
): RosterRow {
  return {
    channelId: c.channelId,
    handle: c.handle,
    title: c.title || meta?.title || "",
    avatarUrl: c.avatarUrl || meta?.avatarUrl || "",
    subscriberCount: c.subscriberCount ?? meta?.subscriberCount ?? 0,
    uploadsPlaylistId: uploadsPlaylistIdOf(c),
    category: c.category,
    tier: c.tier,
    source: "base",
    parked: c.tier === null || c.parked === true,
    confirm: c.confirm === true,
    usedUU: c.fellBackToUU === true,
    shortsOnly: c.shortsOnlyOrEmpty === true,
  };
}

function rosterRowFromAddition(a: ChannelAddition): RosterRow {
  return {
    channelId: a.channelId,
    handle: a.handle,
    title: a.title,
    avatarUrl: a.avatarUrl,
    subscriberCount: a.subscriberCount,
    uploadsPlaylistId: a.uploadsPlaylistId,
    category: a.category,
    tier: a.tier,
    source: "added",
    parked: false, // an addition always carries an explicit active tier — never parked
    confirm: false,
    usedUU: a.usedUU ?? false,
    shortsOnly: a.shortsOnly ?? false,
  };
}

/**
 * Merge base roster rows with user additions (Channel Library / same "addition wins" rule as
 * {@link "./feed".mergeAdditionVideos}). Any base row whose channelId was also user-added is
 * replaced by the addition's row (freshest tier/category — this is also how a parked base
 * channel gets "promoted": see {@link promoteParkedRow}). Pure — no I/O, unit-testable.
 */
export function mergeRosterRows(baseRows: RosterRow[], additions: ChannelAddition[]): RosterRow[] {
  const additionRows = additions.map(rosterRowFromAddition);
  const additionIds = new Set(additionRows.map((r) => r.channelId));
  const filteredBase = baseRows.filter((r) => !additionIds.has(r.channelId));
  return [...additionRows, ...filteredBase];
}

/**
 * Classify a parked (or unclassified) base-roster row by converting it into a {@link
 * ChannelAddition} with the chosen tier. Saved into the same IndexedDB `userChannels` store as
 * any other addition, so it rides the exact "addition wins" merge above straight into the
 * feed — no separate override mechanism, no channels.json write (impossible on Cloud Run's
 * ephemeral filesystem anyway).
 */
export function promoteParkedRow(row: RosterRow, tier: 1 | 2 | 3): ChannelAddition {
  return {
    channelId: row.channelId,
    handle: row.handle,
    uploadsPlaylistId: row.uploadsPlaylistId,
    title: row.title,
    avatarUrl: row.avatarUrl,
    subscriberCount: row.subscriberCount,
    category: row.category,
    tier,
    addedAt: new Date().toISOString(),
    usedUU: row.usedUU,
    shortsOnly: row.shortsOnly,
  };
}

/**
 * Duplicate check for the add-channels-by-URL resolve candidate: true when `channelId` is
 * already in the baked roster (any tier, including parked) OR in the caller-supplied set of
 * existing user additions. Pure predicate — the caller supplies `existingIds` since user
 * additions live in the browser's IndexedDB, invisible to this server-side module.
 */
export function isDuplicateChannelId(channelId: string, existingIds: Iterable<string>): boolean {
  if (ROSTER.channels.some((c) => c.channelId === channelId)) return true;
  for (const id of existingIds) if (id === channelId) return true;
  return false;
}
