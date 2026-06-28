# CuratedTube — PRD.md

**Artifact type:** PRD.md (build spec; derived from and validated against `context.md`)
**Project:** CuratedTube — personal, single-user, focus-oriented scoped YouTube client
**Status:** Committed — ready for Phase 1 build
**Companion:** `context.md` (research grounding; do not duplicate, reference)

---

## 1. Decision Log (locked)

| # | Decision | Rationale | Reversibility |
|---|---|---|---|
| D1 | **Home = Focus Feed, shipped in 2 stages.** Phase 1: newest-first across channels + category balancing. Phase 2: full popularity/decay weighting. | The ranking model reduces to newest-first at cold start, so Phase 1 is the same component un-tuned, not throwaway. Keeps requested FYP-style discovery while structurally excluding engagement-maximizing behavior (finite, no infinite scroll, transparent signals, no watch-time optimization). | Easy — Phase 2 is additive weighting on an existing component. |
| D2 | **UULF as primary uploads source, behind a swappable resolver.** Fallback: UU + client-side `/shorts/` filter. | UULF excludes Shorts/live at the data layer (matches north star). Prefix is undocumented and may break; isolating it in one resolver function makes the fallback a one-place swap. | Easy — single function `resolveUploadsPlaylistId()`. |
| D3 | **Single-user, no backend accounts.** All personal state (watch history, watch-later, session timers) in IndexedDB. | Personal tool; no multi-tenant, no auth surface. | N/A |
| D4 | **Never call `search.list`.** All listing via `playlistItems.list` on uploads playlist. | 100× quota cost; uploads-playlist pattern stays under daily quota trivially. | N/A |

---

## 2. North Star & Non-Negotiables

**North Star:** keep the discovery, kill the rabbit hole. Block YouTube everywhere; lose only the distraction.

**Non-negotiables (product requirements, not preferences):**
- No Shorts surface. No comments. No autoplay-next chains. No infinite scroll. No global YouTube search.
- Finite home feed (24 items) ending in a "caught up" state.
- No metric anywhere optimizes for time-on-app or session length.

---

## 3. Scope

**In:** Home Discovery Feed (Focus Feed), Channel pages (sort: Latest / Popular / Oldest over UULF archive), Watch page (IFrame player + metadata + "more from this channel" rail), category filtering (Automotive / Islamic / History / AI-Tech), local watch state, optional Watch Later, PWA install.

**Out:** Shorts, comments, live chat, global search, notifications/badges, trending, subscriptions to anything off-list, autoplay-next, algorithmic cross-channel recommendation rails.

---

## 4. Locked Architecture

### 4.1 Stack
- **Frontend:** Next.js (App Router) + Tailwind.
- **Data:** server-side Data API calls (keeps key server-side, avoids CORS), cached.
- **Player:** YouTube IFrame Player API.
- **State:** IndexedDB (watch history, watch-later, session timers, ETag cache).
- **Hosting:** Vercel free tier or Google Cloud Run.
- **Config:** `channels.json`.

### 4.2 Data layer (hybrid, quota-safe)
- **RSS (0 quota):** poll `feeds/videos.xml?playlist_id=<UULF>` per channel every 30 min for new-upload detection.
- **Data API (~1 unit/call):** on new IDs detected (or stats refresh) -> batched `videos.list` (50 IDs) + `playlistItems.list` for archives + `channels.list` for metadata.
- **Single resolver (D2):** `resolveUploadsPlaylistId(channelId) -> UULF<suffix>` with a config flag to fall back to `UU<suffix>` + Shorts filtering.

### 4.3 `channels.json` schema
```json
[
  {
    "handle": "@TheCarCareNut",
    "channelId": "UC...",
    "uploadsPlaylistId": "UULF...",
    "category": "Automotive"
  }
]
```

### 4.4 Core data objects
```ts
type Video = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  channelAvatarUrl: string;
  title: string;
  thumbnailUrl: string;
  durationSec: number;        // parsed from ISO 8601
  viewCount: number;
  likeCount: number;
  publishedAt: string;        // ISO timestamp
  category: Category;
};

type WatchState = {
  videoId: string;
  visited: boolean;
  watchedSec: number;
  lastSeenAt: string;
};
```

---

## 5. Surfaces — Behavior & Acceptance

Component inventories and Tailwind specs live in `context.md` section 3. This section defines *behavior* and *acceptance criteria*.

### 5.1 Home Discovery Feed
- Renders <= 24 cards from the Focus Feed ranking (Phase 1: newest-first + category balance).
- Category filter pills switch the active set; selection persists for the session.
- No infinite scroll, no "load more" on home. Grid ends in `CaughtUpBlocker`.
- Visited videos visually de-emphasized (IndexedDB read).
- **Accept:** loading 20 channels' fresh uploads, the feed shows a category-balanced, newest-first set <= 24 with the caught-up block at the end.

### 5.2 Channel Page
- Header (banner, avatar, title, handle, subs, description) from `channels.list`.
- Sort tabs: **Latest** (publishedAt desc) / **Popular** (viewCount desc) / **Oldest** (publishedAt asc) over the channel's UULF archive.
- Paginated through the archive via `playlistItems.list` cursor.
- **Accept:** each sort reorders correctly; "Popular" requires stats present (enrich before sort).

### 5.3 Watch Page
- IFrame player with distraction-suppressing params; `onError` (101/150) -> interception state with a direct YouTube link (never a blank player).
- Metadata panel (title, views, likes, date, collapsible description).
- `ChannelContextRail` = other videos from the same channel only.
- **Accept:** embed-restricted video shows the fallback link, not a blank box; no recommendation rail from other channels ever renders.

---

## 6. Focus Feed Spec

Authoritative math in `context.md` section 5 (reconstructed; ratify or replace).

- **Phase 1 (ship):** `score = recency_rank * C_cat`. Newest-first within category-balanced slots. This is the cold-start reduction of the full model — same component, weights untuned.
- **Phase 2 (evolve):** introduce S1 (gravity-decayed popularity) or S2 (linear), the seen-penalty, freshness window, and back-catalogue injection. Tunable weights.
- **Category balance (both phases):** `C_cat = 5 / n_cat` -> Automotive 1.00, Islamic 0.56, History 1.25, AI-Tech 2.50.
- **Guardrails (both phases):** 24-item cap, no infinite scroll, caught-up state, session-limit prompt at >30 min active in a rolling 4h window.

---

## 7. Quota Budget (locked)

From `context.md` section 6 — confirmed within 10,000 units/day:
- **Cold-start archive:** ~160 units once.
- **Daily maintenance:** ~9–128 units/day (RSS-primary; API-only fallback ~120/day).
- ETag conditional requests to skip unchanged payloads.
- Instrument a unit counter; alert at 80% of daily quota.

---

## 8. Roadmap

### Phase 1 — Data Foundation + Minimum Viable Surfaces
Goal: a working, distraction-free client with newest-first home, channel pages, and clean playback.

### Phase 2 — Focus Feed Ranking
Full S1/S2 weighting, seen-penalty, exploration rules, ratified math.

### Phase 3 — State & Polish
Watch-later, session limiter, responsive pass, PWA install (incl. iOS helper modal), error/loading states.

### Phase 4 — Hardening
Quota instrumentation, UULF->UU fallback drill, deploy.

---

## 9. Phase 1 Execution Spec (step-by-step)

1. **Scaffold:** `create-next-app` (App Router, TS) + Tailwind. Add `.env` for `YOUTUBE_API_KEY` (server-only).
2. **Resolve channels (one-time):** for the 20 handles, get `channelId` via `channels.list?forHandle=` *(verify support)* or yt-dlp; derive `uploadsPlaylistId` through `resolveUploadsPlaylistId()` (UULF primary). Write `channels.json`.
3. **Data fetch module (server):**
   - `getUploads(uploadsPlaylistId)` -> `playlistItems.list` (paginate).
   - `enrich(videoIds[])` -> `videos.list` (batch 50; statistics + contentDetails).
   - `getChannelMeta(channelIds[])` -> `channels.list` (batch 50).
   - ISO-8601 duration parser -> `durationSec`.
4. **RSS poller:** `pollUploads(uploadsPlaylistId)` parsing the UULF Atom feed for new IDs (0 quota); diff against IndexedDB.
5. **Unified feed builder:** merge all channels -> apply `C_cat` balancing -> newest-first -> slice 24.
6. **Surfaces:** Home grid + CategoryFilterBar; Channel page with the three sort tabs; Watch page with IFrame player + `onError` fallback.
7. **Watch state:** IndexedDB read/write for `visited`; de-emphasize visited cards.
8. **Caught-up + no-infinite-scroll** enforced on home.
9. **Quota counter** logging units per call type.

**Phase 1 done when:** YouTube can be fully blocked on your devices and every channel's new long-form uploads, channel archives (sortable), and clean playback are reachable through CuratedTube alone — no Shorts, no recommendations, no rabbit hole.

---

## 10. [VERIFY] — Resolved in Pass A (2026-06-29, primary-source web audit)

Resolved against Google for Developers + Next.js primary docs:

- **IFrame `playerVars` / `rel` behavior — RESOLVED.** `rel=0` no longer hides related videos; it restricts them to the **same channel as the video just played** (behavior since 2018). `modestbranding` is **deprecated (Aug 2023), no effect**. Locked distraction-suppressing set: `rel:0, controls:1, playsinline:1, iv_load_policy:3, disablekb:1, fs:1, color:'white'`. `onError` codes: **101 and 150 are identical** ("owner disallows embedded playback"); **153** (missing HTTP Referer) also possible — all route to the YouTube-link fallback. Source: [IFrame API reference](https://developers.google.com/youtube/iframe_api_reference), [Player parameters](https://developers.google.com/youtube/player_parameters).
- **`channels.list?forHandle` — RESOLVED: supported.** Accepts `@handle` (with or without `@`); `part=contentDetails` returns `relatedPlaylists.uploads` (the `UU…` playlist id). 1 unit/call. yt-dlp/manual remain as zero-quota fallback. Source: [channels.list](https://developers.google.com/youtube/v3/docs/channels/list).
- **Quota costs — RESOLVED.** `playlistItems.list` = 1, `videos.list` = 1, `channels.list` = 1, **`search.list` = 100** (separate bucket; never called — D4). Source: [Determine quota cost](https://developers.google.com/youtube/v3/determine_quota_cost).
- **Next.js (App Router) data-fetch/caching — RESOLVED.** Current (Next 16): `fetch` is **NOT cached by default** and blocks render until complete. Cache explicitly via `fetch(url, { next: { revalidate: <sec> } })`; memoize per-request with React `cache()`. We fetch server-side (key stays server-only) in Server Components / route handlers with `next.revalidate` tuned to the RSS poll cadence. Source: [Fetching data](https://nextjs.org/docs/app/getting-started/fetching-data).
- **iOS PWA storage limits — UNRESOLVED.** Version-dependent; not load-bearing for Phase 1 (IndexedDB watch state is small). Re-verify in Phase 3 before relying on offline durability.
- **Ranking math (Phase 2)** — ratify/replace via Pass B before Phase 2; out of scope for Phase 1.

---

## 11. Non-Goals

Not building: multi-user/auth, cloud sync, comments, Shorts, search across YouTube, downloads, any recommendation surface spanning channels, or any feature whose primary effect is increasing time-on-app.
