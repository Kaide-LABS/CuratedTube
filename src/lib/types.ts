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

// --- Focus Feed ranking (PHASE_2_SPEC §3) ---------------------------------
// Tunable weights/windows for the home ranker. Validated so a malformed override
// (e.g. a negative gravity) fails loudly rather than producing a silent NaN score.
export const RankingConfigSchema = z.object({
  model: z.enum(["s1", "s2"]).default("s1"), // S₁ gravity (default) | S₂ linear (flagged)
  // S₁ params
  popularityExponent: z.number().positive().default(0.8), // a (V^a, a<1 dampens mega-views)
  gravity: z.number().positive().default(1.5), // g ((T+2)^g)
  seenFactor: z.number().min(0).max(1).default(0.05), // P_seen for watched videos
  // S₂ params (read only when model === "s2")
  wPop: z.number().default(0.35),
  wFresh: z.number().default(0.4),
  wUnwatched: z.number().default(0.2),
  wSeen: z.number().default(0.3),
  decayKind: z.enum(["exp", "reciprocal"]).default("exp"), // exp(−λT) | 1/(1+T/τ)
  lambda: z.number().positive().default(0.0125), // per-hour; ~half-life 55h
  tau: z.number().positive().default(48), // hours
  // Exploration
  freshnessWindowHours: z.number().nonnegative().default(72), // < window => bypass seen-penalty + flat boost
  freshnessBoost: z.number().nonnegative().default(1.25),
  backCatalogueFraction: z.number().min(0).max(0.5).default(0.2), // share of slots reserved for >30d unwatched
  backCatalogueMinAgeDays: z.number().nonnegative().default(30),
  repetitionPenaltyPerShow: z.number().min(0).max(1).default(0.15), // multiplicative decay per prior impression
  repetitionFloor: z.number().min(0).max(1).default(0.4), // penalty never drops below this
});
export type RankingConfig = z.infer<typeof RankingConfigSchema>;

// --- ImpressionState (IndexedDB v2; anti-repetition signal — PHASE_2_SPEC §5) ---
export const ImpressionStateSchema = z.object({
  videoId: z.string(),
  shownCount: z.number().int().nonnegative(), // times surfaced on home but NOT clicked
  lastShownAt: z.string(), // ISO timestamp
});
export type ImpressionState = z.infer<typeof ImpressionStateSchema>;

// Everything the client-side ranker needs beyond the Video pool. `now` is captured once
// per render so the score order is stable within a paint (no mid-sort clock drift).
export type RankContext = {
  now: number;
  visited: Set<string>;
  impressions: Map<string, ImpressionState>;
  config: RankingConfig;
};

// --- Session limiter (IndexedDB v3; PHASE_3_SPEC.md §3/§5) ---------------------
// One active-playback segment. The rolling-window limiter sums these to decide when to
// prompt a break (PRD §6 / context.md §5). `endedAt` is kept fresh by a heartbeat while a
// video plays, so an abandoned tab cannot inflate active time (see PHASE_3_SPEC §6 critique).
export const SessionSegmentSchema = z.object({
  startedAt: z.string(), // ISO; keyPath in the `session` store
  endedAt: z.string().nullable(), // ISO; null only for an in-memory open segment
  activeMs: z.number().int().nonnegative(), // accumulated active ms for this segment
  videoId: z.string(),
});
export type SessionSegment = z.infer<typeof SessionSegmentSchema>;

// Session-limit policy (validated; one source of tunable defaults — session-config.ts).
export const SessionConfigSchema = z.object({
  activeLimitMinutes: z.number().positive().default(30), // PRD §6 / context.md §5
  rollingWindowHours: z.number().positive().default(4), // PRD §6 / context.md §5
  snoozeMinutes: z.number().positive().default(10), // re-prompt cadence after a dismiss
  pollSeconds: z.number().positive().default(30), // SessionGuard tick
  heartbeatSeconds: z.number().positive().default(15), // WatchPlayer active-segment heartbeat
});
export type SessionConfig = z.infer<typeof SessionConfigSchema>;

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

// --- User channel additions (IndexedDB overlay on the baked channels.json roster) ---------
// Persisted client-side only (never written back to channels.json — Cloud Run's filesystem
// is ephemeral). Tier is REQUIRED and restricted to 1|2|3 (no null/parked): the user must pick
// an active tier explicitly before an addition can be saved, unlike a roster entry awaiting
// classification. Shaped so it migrates cleanly to a per-user DB row later (no single-user
// coupling beyond the IndexedDB store itself living in this browser).
export const ChannelAdditionSchema = z.object({
  channelId: z
    .string()
    .regex(/^UC[A-Za-z0-9_-]{22}$/),
  handle: z.string(),
  uploadsPlaylistId: z
    .string()
    .regex(/^(UULF|UU)[A-Za-z0-9_-]{22}$/),
  title: z.string(),
  avatarUrl: z.string(),
  subscriberCount: z.number().int().nonnegative(),
  category: z.string(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  addedAt: z.string(), // ISO timestamp the user saved it
  // Carried over from the resolve candidate's warnings so the Channel Library can show the
  // same chips post-save without re-resolving. Absent on records saved before this field
  // existed; treated as false wherever read (mergeRosterRows / promoteParkedRow).
  usedUU: z.boolean().optional(),
  shortsOnly: z.boolean().optional(),
});
export type ChannelAddition = z.infer<typeof ChannelAdditionSchema>;

// --- Resolve-candidate (POST /api/channels/resolve response; nothing persisted server-side) ---
export const ChannelCandidateSchema = z.object({
  channelId: z.string(),
  handle: z.string(),
  title: z.string(),
  avatarUrl: z.string(),
  subscriberCount: z.number().int().nonnegative(),
  uploadsPlaylistId: z.string(),
  longformCount: z.number().int().nonnegative(),
  warnings: z.object({
    duplicate: z.boolean(),
    shortsOnly: z.boolean(),
    usedUU: z.boolean(),
  }),
});
export type ChannelCandidate = z.infer<typeof ChannelCandidateSchema>;

// --- Roster row (Channel Library / GET /api/channels/roster response) --------------------
// One row per browsable channel — base roster (channels.json) or a user addition, normalized
// to a common shape. `tier` stays nullable (unlike ChannelAddition) because a parked BASE
// channel has no tier yet; `parked` is derived so the UI never has to re-derive it from tier.
export const RosterRowSchema = z.object({
  channelId: z.string(),
  handle: z.string(),
  title: z.string(),
  avatarUrl: z.string(),
  subscriberCount: z.number().int().nonnegative(),
  uploadsPlaylistId: z.string(),
  category: z.string(),
  tier: TierSchema,
  source: z.enum(["base", "added"]),
  parked: z.boolean(),
  confirm: z.boolean(),
  usedUU: z.boolean(),
  shortsOnly: z.boolean(),
});
export type RosterRow = z.infer<typeof RosterRowSchema>;

// --- Suppressed channel (IndexedDB overlay — hides a BASE channel without touching channels.json) ---
// Reversible: deleting the record un-hides the channel. Only ever applies to base-roster
// channelIds — a user addition is hard-deleted on removal, never suppressed (there'd be nothing
// left to un-hide back to).
export const SuppressedChannelSchema = z.object({
  channelId: z
    .string()
    .regex(/^UC[A-Za-z0-9_-]{22}$/),
  suppressedAt: z.string(), // ISO timestamp the user hid it
});
export type SuppressedChannel = z.infer<typeof SuppressedChannelSchema>;

// --- Watch-time guardian (IndexedDB; self-binding 2h/day active-playback cap) -------------
// ACCEPTED LIMITATION: this is client-side, IndexedDB-backed state. It can be cleared via
// DevTools, a private window, or a fresh browser profile — there is no server-side enforcement
// and no attempt to prevent that. This is self-binding discipline (a tool you point at
// yourself), not SENTINEL-grade tamper-proof enforcement, and the code never pretends otherwise.
//
// One record per local calendar day (`date`, keyed YYYY-MM-DD). `activeSeconds` is real
// timestamp-delta playback time (never setInterval tick-counting — see watchGuardian.ts),
// monotonic across writes/tabs. `interruptsShown` records which of the 30/60/90-minute
// thresholds have already fired today (each fires at most once). `capReached` latches true at
// 120 active minutes and stays true for the rest of the day regardless of further playback.
// interruptsShown accepts 30/60/90/120 (the current threshold set, cap raised to 150min). A
// record written before that change only ever contains 30/60/90 — those parse unchanged (a
// subset of an already-permissive union), so there is no migration that can crash on old data.
export const WatchSessionSchema = z.object({
  date: z.string(), // local YYYY-MM-DD
  activeSeconds: z.number().int().nonnegative(),
  interruptsShown: z.array(z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)])),
  capReached: z.boolean(),
});
export type WatchSession = z.infer<typeof WatchSessionSchema>;

// --- Journal entry (IndexedDB; private, local-only "write it down" check-in note) ---------
export const JournalEntrySchema = z.object({
  date: z.string(), // local YYYY-MM-DD, the day it was written
  text: z.string(),
  createdAt: z.string(), // ISO timestamp; also the store's keyPath (unique per entry)
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

// --- Guardian settings (IndexedDB; single row) --------------------------------------------
// The ONLY user-editable guardian setting. The 2h cap and the 30/60/90 thresholds are NOT
// editable from the UI — self-binding is the point (PRD invariant).
export const GuardianSettingsSchema = z.object({
  id: z.literal("default"),
  whatsappNumber: z.string(), // digits only, international format (no leading "+" or spaces)
});
export type GuardianSettings = z.infer<typeof GuardianSettingsSchema>;

// --- Playlists (IndexedDB; snapshot-on-save, zero quota to render) ------------------------
// A playlist is just a named bucket; `isSystem` marks the one fixed "Watch Later" row (id
// "watch-later") as undeletable/unrenamable. Per-browser/local, same limitation as watch state
// and channel additions — shaped to migrate to a per-user DB row at the account rewrite.
// `isQueue` marks the one reserved, ordered play-next queue (fixed id "queue", isSystem:true,
// isQueue:true) — optional so existing Playlist rows (Watch Later, user playlists) written
// before this field existed still parse unchanged (absent -> not a queue).
export const PlaylistSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  isSystem: z.boolean(),
  isQueue: z.boolean().optional(),
});
export type Playlist = z.infer<typeof PlaylistSchema>;

// A full metadata SNAPSHOT taken at add-time — rendering a playlist never re-resolves saved
// videos (zero API calls). Accepted limitation: a snapshot's title/thumbnail won't update if
// the source video is later renamed/re-thumbnailed. `order` is only meaningful for the queue
// (ordered play-next); ordinary playlist items leave it unset and sort by addedAt instead.
export const PlaylistItemSchema = z.object({
  id: z.string(), // `${playlistId}:${videoId}` — unique row id, also this store's keyPath
  playlistId: z.string(),
  videoId: z.string(),
  title: z.string(),
  thumbnailUrl: z.string(),
  channelId: z.string(),
  channelTitle: z.string(),
  durationSec: z.number().int().nonnegative(),
  addedAt: z.string(),
  order: z.number().int().nonnegative().optional(),
});
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>;
