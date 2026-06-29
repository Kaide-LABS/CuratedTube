# CuratedTube — PHASE_1_SPEC.md

**Artifact:** Phase 1 technical blueprint (build/QA-template structure). Derived from `CuratedTube_PRD.md §9` (Phase 1 Execution Spec), `CuratedTube_context.md`, and the canonical `channels.json` roster.
**Companion docs:** `CuratedTube_PRD.md` (build spec), `CuratedTube_context.md` (research grounding), `HANDOFF.md` (Phase 1 status).

> This document *specifies* Phase 1. It does not build it. Stage A (channel roster pipeline)
> runs ahead of the data-layer modules and produces the canonical config those modules consume.

---

## §0 — Phase Plan Header

- **Phase:** **Phase 1 of 4** — Data Foundation + Minimum Viable Surfaces.
- **Goal:** A working, distraction-free client whose data foundation rests on a *resolved, verified, tier-classified* channel roster. YouTube can be fully blocked on every device while every active channel's long-form uploads, sortable archives, and clean playback remain reachable through CuratedTube alone.
- **North star (governs every decision):** keep the discovery, kill the rabbit hole.
- **Stages (in order):**
  - **Stage A — Channel Roster Pipeline** (this doc's headline addition): seed `channels.json` → canonical `channels.json` + `VALIDATION_REPORT.md`.
  - **Stage B — Server Data Layer:** `getUploads` / `enrich` / `getChannelMeta` / ISO-8601 parser / RSS poller / quota counter.
  - **Stage C — Surfaces:** Home (tier-weighted), Channel page (Latest/Popular/Oldest), Watch (IFrame + onError fallback). *(Surfaces detailed in PRD §5; out of scope for the data-foundation pass.)*
- **Tier model (locked, from `channels.json._meta`):** home-feed slots **Tier 1 = 15 / Tier 2 = 9 / Tier 3 = 0** (total 24).
  - Tier 1 — Beneficial (Islamic): majority of the home feed.
  - Tier 2 — Educational: the in-between.
  - Tier 3 — Entertainment: **channel-page only, 0 home slots, never surfaced on home.**

---

## §1 — Files Added / Modified

### Stage A (channel roster pipeline)
| File | Status | Purpose |
|---|---|---|
| `channels.json` (repo root) | **modify → canonical** | Seed roster (object: `_meta` + `channels[]`) resolved into the build-ready config. `_meta` preserved verbatim. |
| `scripts/resolve-channels.mjs` | **modify/extend** | One-time resolver. Extend from `forHandle`-only to: yt-dlp-first resolution, UULF derivation + RSS verification, `channels.list` enrichment, tier parking, validation-report emission. |
| `VALIDATION_REPORT.md` | **add** | Human-readable resolution audit (see §6 / §8). |
| `src/config/channels.json` | **modify** | The app's consumed config. Either becomes a symlink/copy of the canonical root roster, or the loader is repointed (see §7). One source of truth. |

### Stage B (data layer — already scaffolded; reconciled to new schema)
| File | Status | Purpose |
|---|---|---|
| `src/lib/types.ts` | **modify** | Broaden `Category`; add `tier`, `parked`, `confirm` to `ChannelConfig`; introduce Zod schemas (§3). |
| `src/lib/channels.ts` | **modify** | Read `{_meta, channels}` shape; `resolveUploadsPlaylistId()`; expose active vs. parked vs. tier-filtered selectors. |
| `src/lib/youtube.ts` | present | `getUploads`, `enrich`, `getChannelMeta`, `parseISODuration`, `isShort`; server-only; never `search.list`. |
| `src/lib/rss.ts` | present | `pollUploads` (0-quota UULF Atom feed), `newVideoIds`. |
| `src/lib/feed.ts` | **modify** | Replace category-only balance with **tier-aware slot allocation** (15/9/0); keep newest-first + cap 24. |
| `src/lib/quota.ts` | present | Per-call-type unit counter; 80% alert. |
| `src/lib/data.ts` | **modify** | Home aggregation respects tiers/parked; channel + watch aggregators unchanged. |

---

## §2 — npm Dependencies

| Package | State | Use |
|---|---|---|
| `next`, `react`, `react-dom` | present | App Router runtime. |
| `fast-xml-parser` | present | Parse the UULF Atom RSS feed (Stage A verify + Stage B poller). |
| `tailwindcss`, `@tailwindcss/postcss` | present | Styling (Stage C). |
| `typescript`, `@types/*` | present | Types. |
| **`zod`** | **add** | Runtime validation of `channels.json`, `Video`, `WatchState` (§3). |
| **yt-dlp** (external binary, not npm) | **required for Stage A** | Zero-quota handle → channelId resolution. Invoked via `child_process`. Fallback: Data API `channels.list?forHandle` (1 unit). |

> Stage A resolution is **zero YouTube Data API quota** when yt-dlp succeeds. The Data API is only touched for the optional `forHandle` fallback and for enrichment (`channels.list`).

---

## §3 — Data Types / Zod Schemas

```ts
import { z } from "zod";

// --- ChannelConfig (canonical roster entry) ---
export const TierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]);

export const ChannelConfigSchema = z.object({
  handle: z.string(),                 // "@x" or legacy custom-url token ("coldfusion")
  channelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/).nullable(),
  uploadsPlaylistId: z.string().regex(/^(UULF|UU)[A-Za-z0-9_-]{22}$/).optional(),
  category: z.string(),               // broadened: Islamic, AI-ML, Finance-Quant, Math, … or "UNCONFIRMED"
  tier: TierSchema,                   // 1|2|3 active; null => parked
  // resolution / lifecycle flags
  resolve: z.boolean().optional(),    // true when channelId starts null
  parked: z.boolean().optional(),     // true when tier === null (excluded from active feed set)
  confirm: z.boolean().optional(),    // needs human tier/category confirmation
  note: z.string().optional(),
  // enrichment (channels.list snippet,statistics)
  title: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  subscriberCount: z.number().int().nonnegative().optional(),
});

export const RosterSchema = z.object({
  _meta: z.object({
    project: z.string(),
    homeFeedSlots: z.object({ tier1: z.number(), tier2: z.number(), tier3: z.number(), total: z.number() }),
    tiers: z.record(z.string()),
    uploadsPlaylistRule: z.string(),
    resolveRule: z.string(),
    verifiedCount: z.number(),
    notes: z.array(z.string()),
  }).passthrough(),                   // preserve _meta verbatim
  channels: z.array(ChannelConfigSchema),
});

// --- Video (data-layer output; PRD §4.4) ---
export const VideoSchema = z.object({
  videoId: z.string(),
  channelId: z.string(),
  channelTitle: z.string(),
  channelAvatarUrl: z.string(),
  title: z.string(),
  thumbnailUrl: z.string(),
  durationSec: z.number().int().nonnegative(),   // parsed from ISO 8601
  viewCount: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative(),
  publishedAt: z.string(),                        // ISO timestamp
  category: z.string(),
  tier: TierSchema,                               // carried from ChannelConfig for feed composition
});

// --- WatchState (IndexedDB; single-user, no backend — D3) ---
export const WatchStateSchema = z.object({
  videoId: z.string(),
  visited: z.boolean(),
  watchedSec: z.number().int().nonnegative(),
  lastSeenAt: z.string(),
});

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;
export type Roster = z.infer<typeof RosterSchema>;
export type Video = z.infer<typeof VideoSchema>;
export type WatchState = z.infer<typeof WatchStateSchema>;
```

---

## §4 — Server Module Signatures

### Stage A — roster pipeline (`scripts/resolve-channels.mjs`, run once / on roster change)
```ts
// Resolution (zero quota first)
resolveChannelId(handleOrCustomUrl: string): Promise<string | null>
  // yt-dlp --print channel_id <url>; fallback channels.list?forHandle (1 unit); null => UNRESOLVED.
  // "coldfusion" => resolve from https://www.youtube.com/coldfusion (legacy custom URL, NOT an @handle).

resolveUploadsPlaylistId(channelId: string, opts?: { useUULF?: boolean }): string
  // UC<suffix> -> UULF<suffix> (long-form) | UU<suffix> (fallback). Single swappable point (D2).

verifyUploadsPlaylist(uploadsPlaylistId: string): Promise<{ ok: boolean; itemCount: number; fellBackToUU: boolean }>
  // playlistItems.list (1 unit) OR 0-quota RSS (feeds/videos.xml?playlist_id=UULF…).
  // empty/404 UULF => retry UU + flag; both empty => shorts-only/empty flag.

enrichChannels(channelIds: string[]): Promise<Map<string, { title: string; avatarUrl: string; subscriberCount: number }>>
  // channels.list part=snippet,statistics, batch ≤50 (1 unit/batch).

writeCanonicalRoster(roster: Roster): void          // root channels.json, _meta preserved
writeValidationReport(audit: ValidationAudit): void  // VALIDATION_REPORT.md
```

### Stage B — data layer (existing signatures, kept)
```ts
// src/lib/youtube.ts  (server-only)
parseISODuration(iso: string): number                       // "PT1H2M3S" -> 3723
isShort(durationSec: number): boolean                        // UU-fallback Shorts filter (<=60s)
getUploads(uploadsPlaylistId: string, opts?: { maxPages?: number; pageSize?: number }): Promise<UploadRef[]>
enrich(videoIds: string[]): Promise<Video[]>                 // videos.list, batch 50, statistics+contentDetails
getChannelMeta(channelIds: string[]): Promise<ChannelMeta[]>// channels.list, batch 50
enrichWithAvatars(videoIds: string[]): Promise<Video[]>

// src/lib/rss.ts  (server-only, 0 quota)
pollUploads(uploadsPlaylistId: string): Promise<RssEntry[]>
newVideoIds(entries: RssEntry[], known: Set<string>): string[]

// src/lib/channels.ts
resolveUploadsPlaylistId(channelId, opts?): string
getChannels(): ChannelConfig[]                  // resolved + active (excludes parked)
getActiveByTier(tier: 1 | 2 | 3): ChannelConfig[]
getParked(): ChannelConfig[]

// src/lib/feed.ts
buildHomeFeed(videos: Video[], slots = { tier1: 15, tier2: 9, tier3: 0 }, cap = 24): Video[]
sortVideos(videos: Video[], mode: "latest" | "popular" | "oldest"): Video[]

// src/lib/quota.ts
recordQuota(type: "playlistItems.list" | "videos.list" | "channels.list", calls?: number): void
quotaSnapshot(): { total; byType; pct; alert }
```

---

## §5 — UI Surfaces (deferred)

Out of scope for the data-foundation pass. Behavior + acceptance live in `CuratedTube_PRD.md §5`
(Home / Channel / Watch). This section is reserved to keep the build/QA template numbering aligned;
Stage C implements it after Stages A and B are green.

---

## §6 — Implementation Logic Flow

### Stage A — Channel Roster Pipeline (runs FIRST)
```
load root channels.json  ──►  RosterSchema.parse()  (preserve _meta verbatim)
for each channel in channels[]:
  ├─ if channelId != null  → KEEP AS-IS  (27 already-verified IDs; never re-resolve)
  ├─ else if resolve == true:
  │     handle "coldfusion" → URL https://www.youtube.com/coldfusion       (legacy custom URL)
  │     handle "@x"         → URL https://www.youtube.com/@x
  │     channelId = resolveChannelId(url)        # yt-dlp (0 quota) → forHandle fallback (1 unit)
  │     if channelId == null → mark UNRESOLVED, DO NOT fabricate, continue
  ├─ uploadsPlaylistId = resolveUploadsPlaylistId(channelId)               # UC → UULF
  ├─ { ok, itemCount, fellBackToUU } = verifyUploadsPlaylist(uploadsPlaylistId)
  │     if !ok after UU fallback → flag shorts-only/empty; exclude from active set; report
  └─ tier == null → set parked = true            # park unclassified; exclude from active feed

enrich:
  batch channels.list(snippet,statistics) over all resolved channelIds  (≤50/call)
  attach title, avatarUrl, subscriberCount

emit:
  writeCanonicalRoster(roster)        # channelId, uploadsPlaylistId, category, tier, title, avatarUrl, subscriberCount, parked?, confirm?, note?
  writeValidationReport(audit)        # see §8
```

### Stage B — Data Layer (consumes canonical roster)
```
home request:
  channels = getActiveByTier(1) ∪ getActiveByTier(2)        # tier 3 excluded entirely
  per channel: pollUploads(UULF)  (0 quota)  → recent ids
    └─ RSS empty for a channel → fallback getUploads(maxPages:1)  (1 unit)
  ids = dedupe(all)
  videos = enrich(ids)  (videos.list, batch 50)  → join channel avatars (channels.list)
  feed = buildHomeFeed(videos, {tier1:15, tier2:9, tier3:0}, 24)   # tier-weighted slots, newest-first, cap 24
  → ends in CaughtUpBlocker; no infinite scroll

channel page:
  getChannelMeta([id]) + getUploads(UULF, paginate) → enrich → sortVideos(latest|popular|oldest)
  # tier 3 channels reachable HERE only

quota:
  every Data API call → recordQuota(type); /api/quota exposes the running tally; alert at 80%
```

### ISO-8601 duration parser
`/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/` → seconds. `PT0S`/missing → 0.

---

## §7 — Cross-Phase Integration

- **Stage A → Stage B:** the canonical `channels.json` is the single contract. Stage B reads `{_meta, channels}` (loader updated from the old bare-array shape). `src/config/channels.json` and root `channels.json` must be one source of truth (copy on build, or repoint the loader to the root file).
- **Tier model → feed composition:** `_meta.homeFeedSlots` (15/9/0) is consumed by `buildHomeFeed`. The current `feed.ts` category-balance is the *cold-start* approximation; tier-weighted slot allocation supersedes it for the home feed. Per-category balance may still apply *within* a tier's slot budget.
- **Parked channels:** `tier:null, parked:true` entries are resolved and stored but **excluded from all feed-composition logic** until a human assigns a tier (clears `parked`). They remain reachable by direct channel URL only after classification.
- **Phase 2 (ranking):** adds S1/S2 popularity-decay weighting *within* tier slots, seen-penalty, freshness window — additive to `buildHomeFeed`. Gated behind Pass B (ranking validation).
- **Phase 3/4:** watch-state durability (IndexedDB), PWA install, quota hardening, UULF→UU fallback drill, deploy.
- **`Category` type migration:** the closed 4-value union in `types.ts` broadens to the roster's category set (string-typed, validated against a known list in `RosterSchema`). Tier — not category — drives home composition; category drives the channel filter and per-tier balancing.

---

## §8 — Acceptance Criteria

**Stage A (roster pipeline):**
1. Every `resolve:true` entry is either **resolved to a real `UC…` channelId** or **reported as UNRESOLVED** in `VALIDATION_REPORT.md`. **No ID is ever fabricated.**
2. The **27 already-verified IDs are preserved byte-for-byte** (not re-resolved).
3. `coldfusion` is resolved from its legacy `/coldfusion` custom URL (not treated as an `@handle`).
4. Every **active** (non-parked) channel carries: `channelId`, a **UULF `uploadsPlaylistId` verified to return items** (or a flagged UU fallback), plus enriched `title`, `avatarUrl`, `subscriberCount`.
5. Every `tier:null` channel is **parked** (`parked:true`) and **excluded from the active feed set**.
6. `VALIDATION_REPORT.md` is written and reports: resolved count, UNRESOLVED/dead/renamed channels, UULF→UU fallbacks used, shorts-only/empty channels, parked channels, and duplicates.
7. Canonical `channels.json` validates against `RosterSchema`; `_meta` preserved verbatim.

**Stage B (data layer):**
8. `getUploads`, `enrich`, `getChannelMeta`, `parseISODuration`, and the RSS poller are implemented and smoke-tested against the canonical roster.
9. A per-call-type quota counter records `playlistItems.list` / `videos.list` / `channels.list` units and alerts at 80% of 10,000/day.
10. `buildHomeFeed` produces ≤24 items honoring the 15/9/0 tier split, newest-first, ending in a caught-up state.

---

## §9 — Non-Goals

- **No UI surfaces in Stage A.** Stage A stops at a proven, quota-instrumented config + data pipeline. Surfaces are Stage C / PRD §5.
- **Never call `search.list`** (100× quota — D4). All listing via `playlistItems.list` on the uploads playlist.
- **No Shorts ingestion.** UULF (long-form only) is the source; UU fallback applies a client-side `/shorts/` filter. Shorts-only channels are flagged and excluded, not silently included.
- **No Tier 3 channel in any feed-composition logic.** Tier 3 is resolved and reachable via its channel page only; it receives **0 home-feed slots** and must never be wired into the home feed.
- **No fabricated channel IDs**, no auth/multi-user, no cloud sync, no comments, no global search, no recommendation surface spanning channels, and no metric whose primary effect is increasing time-on-app.
