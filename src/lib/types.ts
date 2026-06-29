// Core data shapes + the runtime validation boundary (PHASE_1_SPEC §3, PRD §4.4).
//
// Single source of truth for the shapes used across the data layer and the surfaces.
// Every external boundary (the channels.json roster, the YouTube Data API responses,
// IndexedDB watch state) is validated with the Zod schemas below before use — no `as`
// casts on untrusted input. Types are inferred from the schemas so the static and the
// runtime contracts can never drift apart.

import { z } from "zod";

// --- Tier (PRD §2 tier model: 1 Beneficial / 2 Educational / 3 Entertainment; null => parked) ---
export const TierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]);
export type Tier = z.infer<typeof TierSchema>;

// Category is broadened from the old closed 4-value union to the roster's real category
// set (Islamic, AI-ML, Finance-Quant, Math, Coding-Tech, …, or "UNCONFIRMED"). Tier — not
// category — drives home composition; category drives the channel filter + per-tier balance.
export type Category = string;

// --- ChannelConfig (canonical roster entry) ---
export const ChannelConfigSchema = z.object({
  handle: z.string(), // "@x" or a legacy custom-url token ("coldfusion")
  channelId: z
    .string()
    .regex(/^UC[A-Za-z0-9_-]{22}$/)
    .nullable(), // null => still awaiting resolution
  uploadsPlaylistId: z
    .string()
    .regex(/^(UULF|UU)[A-Za-z0-9_-]{22}$/)
    .optional(),
  category: z.string(),
  tier: TierSchema, // 1|2|3 active; null => parked
  // resolution / lifecycle flags
  resolve: z.boolean().optional(), // true when channelId starts null
  parked: z.boolean().optional(), // true when tier === null (excluded from the active feed set)
  confirm: z.boolean().optional(), // needs a human tier/category confirmation
  unresolved: z.boolean().optional(), // resolution attempted and failed (no fabricated id)
  shortsOnlyOrEmpty: z.boolean().optional(), // UULF + UU both returned nothing
  fellBackToUU: z.boolean().optional(), // UULF empty, UU used instead
  note: z.string().optional(),
  // enrichment (channels.list snippet,statistics)
  title: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  subscriberCount: z.number().int().nonnegative().optional(),
});
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

export const RosterSchema = z.object({
  _meta: z
    .object({
      project: z.string(),
      homeFeedSlots: z.object({
        tier1: z.number(),
        tier2: z.number(),
        tier3: z.number(),
        total: z.number(),
      }),
      tiers: z.record(z.string()),
      uploadsPlaylistRule: z.string(),
      resolveRule: z.string(),
      verifiedCount: z.number(),
      notes: z.array(z.string()),
    })
    .passthrough(), // preserve _meta verbatim
  channels: z.array(ChannelConfigSchema),
});
export type Roster = z.infer<typeof RosterSchema>;

// --- Video (data-layer output; PRD §4.4) ---
export const VideoSchema = z.object({
  videoId: z.string(),
  channelId: z.string(),
  channelTitle: z.string(),
  channelAvatarUrl: z.string(),
  title: z.string(),
  thumbnailUrl: z.string(),
  durationSec: z.number().int().nonnegative(), // parsed from ISO 8601
  viewCount: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative(),
  publishedAt: z.string(), // ISO timestamp
  category: z.string(),
  tier: TierSchema, // carried from ChannelConfig for feed composition
});
export type Video = z.infer<typeof VideoSchema>;

// --- WatchState (IndexedDB; single-user, no backend — D3) ---
export const WatchStateSchema = z.object({
  videoId: z.string(),
  visited: z.boolean(),
  watchedSec: z.number().int().nonnegative(),
  lastSeenAt: z.string(),
});
export type WatchState = z.infer<typeof WatchStateSchema>;

// --- ChannelMeta (channels.list-derived header; internal, not an external boundary) ---
export type ChannelMeta = {
  channelId: string;
  title: string;
  handle: string;
  avatarUrl: string;
  bannerUrl: string | null;
  subscriberCount: number;
  hiddenSubscriberCount: boolean;
  description: string;
  category: Category;
  tier: Tier;
};

export type SortMode = "latest" | "popular" | "oldest";
