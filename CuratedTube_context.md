# CuratedTube — context.md

**Artifact type:** context.md (research-grounding doc; precedes PRD.md)
**Project:** CuratedTube — personal, single-user, focus-oriented scoped YouTube client
**Status:** Validated draft — passed red-team verification gate
**Provenance:** Gemini Deep Research pass, reconciled and corrected by Claude red-team. Not a prospect engagement — no `prospects/` filing, no 5-Pillar/anti-replication framing applies.

---

## 0. Provenance & Verification Status (read first)

This file is the Gemini research output **after** a verification pass. Status of each major claim:

| Section | Status |
|---|---|
| Data API quota model & costs | ✅ Verified against prior primary-source pass (Google quota docs) |
| Uploads-playlist convention (UULF/UU/UUSH) | ✅ Verified — **corrected** to standardize on UULF; caveat added |
| RSS zero-quota polling via `playlist_id=UULF…` | ✅ Verified |
| Handle resolution (yt-dlp, `forHandle`) | ✅ Plausible/standard — primary anchor still [VERIFY] |
| Component inventories (Home/Channel/Watch) | ✅ Sound design — preserved as-is |
| **Focus Feed ranking formulas** | ⚠️ **Reconstructed by Claude** — Gemini's originals did not survive the paste. Swap in if recovered. |
| Category-balancing multipliers | ⚠️ Reconstructed by Claude (values below) |
| iOS PWA storage limits | 🔲 UNRESOLVED — version-dependent; deferred to Phase 3 (not load-bearing) |
| IFrame Player API params & error codes | ✅ **Verified (2026-06-29)** against live reference — see §8 |

**Pass A (2026-06-29) closed all blocking [VERIFY] items** except iOS PWA storage (deferred, non-blocking). Quota/API costs anchored to primary Google docs (§11); ranking math ratification deferred to Phase 2 Pass B.

---

## 1. Executive Summary

CuratedTube is a single-user PWA that reproduces YouTube's *useful* surfaces — discovery feed, channel pages, watch page, sort/filter — restricted to ~20 whitelisted channels, with the addictive surfaces (Shorts, comments, autoplay chains, open recommendations, global search) removed at the architecture level.

Three decisive design choices:
1. **Data sourcing:** zero-quota RSS polling on the **UULF** (long-form-only) feed for upload detection, plus batched `playlistItems.list` + `videos.list` Data API enrichment for archives and stats. Never `search.list`.
2. **Discovery:** a self-built "Focus Feed" ranking over the 20 channels (recency + popularity + category balance + watch state), not YouTube's inaccessible recommender.
3. **Playback:** official IFrame Player API with distraction-suppressing parameters and an embedding-restriction fallback.

---

## 2. Surface & Information Architecture

### Home Discovery Feed
Primary landing page. Finite grid, **hard cap 24 items** (design decision, not platform-derived). No infinite scroll. Ends in a "caught up" blocker.

### Channel Page
Aggregates a single creator: banner, profile header, sort tabs (Latest / Popular / Oldest), video grid over the channel's UULF archive.

### Watch Page
Single-column on mobile, two-column on desktop. Player + metadata + a "more from this channel" rail replacing algorithmic recommendations.

### Subscriptions vs. Home (role split)
- **Home Discovery Feed** = ranked blend (Focus Feed algorithm), for "what's worth my time across my channels."
- **Subscriptions-style view** = pure newest-first across all channels, for "what's new since I last looked." (Decision pending — see §10 PRD open question: do we even need the ranked feed, or does newest-first + strong channel pages suffice?)

---

## 3. Component Inventory

### Home Discovery Surface
| Component | Tailwind (abbrev.) | Required Data | State |
|---|---|---|---|
| FocusFeedGrid | `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 max-w-7xl mx-auto px-4 py-6` | Array of sorted unified video objects | activeCategory, watchHistoryState |
| CategoryFilterBar | `flex space-x-2 pb-4 overflow-x-auto border-b border-zinc-800` | Distinct category tags (Automotive, Islamic, History, AI-Tech) | selectedCategory |
| VideoPreviewCard | `flex flex-col gap-2 group hover:scale-[1.01] transition-all cursor-pointer` | videoId, thumbnailUrl, title, channelTitle, channelAvatarUrl, viewCount, publishedAt, duration | isVisited (IndexedDB) |
| TimeBadge | `absolute bottom-2 right-2 bg-black/80 px-1.5 py-0.5 text-xs font-mono text-zinc-100 rounded` | ISO 8601 duration → H:MM:SS | None |
| CaughtUpBlocker | `col-span-full py-12 text-center bg-zinc-900/50 border border-zinc-800 rounded-xl` | Static message | None |

### Channel Surface
| Component | Tailwind (abbrev.) | Required Data | State |
|---|---|---|---|
| ChannelBanner | `w-full h-32 sm:h-48 md:h-64 bg-zinc-800 relative bg-cover bg-center` | bannerImageUrl | None |
| ChannelProfileHeader | `flex flex-col md:flex-row gap-4 items-start md:items-center px-4 py-6 border-b border-zinc-800` | title, customUrl, avatarUrl, subscriberCount, description | isDescriptionExpanded |
| SortOptionTabs | `flex border-b border-zinc-800 text-sm` | Tabs: Latest, Popular, Oldest | activeSortTab |
| ChannelVideoGrid | `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4` | Array of video objects | None |

### Watch Surface
| Component | Tailwind (abbrev.) | Required Data | State |
|---|---|---|---|
| WatchWorkspace | `flex flex-col lg:grid lg:grid-cols-3 gap-6 max-w-7xl mx-auto p-4` | Active video ID | playerErrorState |
| PlayerContainer | `lg:col-span-2 aspect-video w-full bg-black rounded-xl overflow-hidden shadow-2xl` | videoId, playerVars | playerPlaybackState |
| MetadataPanel | `py-4 border-b border-zinc-800` | title, viewCount, likeCount, publishedAt, description | isCollapsed |
| ChannelContextRail | `lg:col-span-1 flex flex-col gap-4` | Array of channel video objects | None |

---

## 4. Platform Recommendation Model (reference only)

Two-stage industrial funnel: **candidate generation** (retrieval, millions → hundreds) then **fine ranking** (multi-task: CTR, expected watch time, satisfaction signals). Freshness is a trained feature; new uploads get an early-CTR test boost with steep decay if engagement lags. We adapt the *mechanics* (freshness boost, decay, explicit negatives) — not the engine, which is inaccessible for channels we don't own.

---

## 5. Focus Feed Ranking Spec ⚠️ (Claude reconstruction — ratify against Gemini original)

> Gemini's formula definitions and multiplier values did not survive the paste. The following are defensible reconstructions consistent with the described framework. Replace if the originals are recovered.

**Signals available:** view count, like count, duration, publishedAt, category, local watch state (IndexedDB).

### Formula 1 — Gravity-Decayed Popularity (S₁), Hacker-News-adapted
```
S₁ = ( V^a / (T + 2)^g ) · C_cat · P_seen

V     = popularity proxy (viewCount, or viewCount + k·likeCount)
a     = popularity exponent, ~0.8 (dampens mega-view dominance)
T     = age in hours since publishedAt
g     = gravity, ~1.5 (steeper = favors fresh)
C_cat = category-balancing multiplier (see below)
P_seen= 1.0 if unwatched, ~0.05 if already watched
```

### Formula 2 — Linear Component Model (S₂)
```
S₂ = ( w_pop·norm(V) + w_fresh·decay(T) + w_unwatched·U − w_seen·seen ) · C_cat

norm(V)  = min-max or log-normalized views across the candidate pool
decay(T) = exp(−λT)  or  1/(1 + T/τ)
U        = 1 if unwatched else 0   (temporary discovery boost)
seen     = 1 if watched else 0
weights  = start { w_pop 0.35, w_fresh 0.40, w_unwatched 0.20, w_seen 0.30 }, tune empirically
```

### Category-Balancing Multiplier ⚠️ (reconstructed)
Distribution: Automotive 5, Islamic 9, History 4, AI-Tech 2 (total 20, 4 categories; mean 5/category).
Anchor the average category at 1.0 → `C_cat = 5 / n_cat`:

| Category | Channels (n_cat) | C_cat |
|---|---|---|
| Automotive | 5 | 1.00 |
| Islamic | 9 | 0.56 |
| History | 4 | 1.25 |
| AI-Tech | 2 | 2.50 |

This boosts under-represented categories and damps over-represented ones so the 9-channel Islamic set doesn't structurally flood the grid.

### Exploration vs. Exploitation (reconstructed three rules)
1. **Freshness window:** videos < 72h old bypass the seen-penalty and get a flat boost so new uploads always surface.
2. **Back-catalogue injection:** reserve ~20% of the 24 slots for high-S₁ *unwatched* videos older than 30 days, so the feed isn't only new uploads.
3. **Anti-repetition:** a video shown but not clicked across N sessions gets a decaying display penalty so the same items don't ossify at the top.

### Cold Start & Guardrails
- **Cold start:** no watch history → all P_seen = 1.0; rank by S₁ + category balance on published stats alone.
- **Hard cap:** 24 cards, no infinite scroll, no pagination on Home.
- **Caught-up state:** CaughtUpBlocker at grid end.
- **Session limiting (design choice):** track active playback in IndexedDB; if active viewing > 30 min in a rolling 4-hour window, prompt a break and disable any autoplay.

---

## 6. Data Sourcing & Quota Mapping ✅

### Feature → Source → Quota
| Feature | Source endpoint | `part` | Cost | Batch |
|---|---|---|---|---|
| New-upload detection | `playlistItems.list` on **UULF**+`[channelIdSuffix]` | `snippet` | 1 unit | 50/call |
| Full channel archive | `playlistItems.list` (paginated) | `snippet,contentDetails` | 1 unit/page | 50/page |
| Video stats (views, likes, duration) | `videos.list` | `statistics,contentDetails` | 1 unit | 50 IDs/call |
| Channel metadata (subs, avatar, banner) | `channels.list` | `snippet,statistics,brandingSettings` | 1 unit | 50 IDs/call |
| **Zero-quota upload polling** | RSS: `youtube.com/feeds/videos.xml?playlist_id=UULF…` | XML parse | **0 units** | per-channel |

> **Correction applied:** standardized on **UULF** (long-form only — excludes Shorts/live at the data layer, matching the no-Shorts requirement). **Caveat [RISK]:** UULF/UUSH/UULV prefixes are **undocumented by YouTube and may break without notice.** Fallback = **UU** (full uploads) with client-side `/shorts/` filtering.

### Daily Quota Budget
- **Cold-start archive (run once):** ~200 videos × 20 channels. `playlistItems.list` ~4 pages × 20 = ~80 units; `videos.list` on ~4,000 IDs in 50-batches = ~80 units. **≈160 units total.**
- **Daily maintenance:** RSS detects uploads (0 units); 1 batched `videos.list` for new IDs (~1 unit); stats refresh of ~100 recent videos every 6h (4×/day, 2 batches each ≈ 8 units). **≈9–128 units/day** — far under 10,000.
- **API-only fallback** (if RSS fails): `playlistItems.list maxResults=3` × 20 channels every 4h = 120 units/day.
- **Optimization:** ETag conditional requests to skip unchanged payloads.

---

## 7. Handle → Channel ID → Uploads Playlist Runbook

1. **Manual (0 quota):** open channel → View Source → copy the `UC…` ID. Derive uploads playlist by prefix swap (UC→UULF preferred / UU fallback).
2. **Scripted (0 quota):** `yt-dlp` to extract channel IDs from the @handle URLs in bulk. [VERIFY exact flag]
3. **API (low quota):** `channels.list?forHandle=@handle&part=id,contentDetails` → returns channel ID + uploads playlist. 1 unit/call. [VERIFY `forHandle` current support]

Store results in `channels.json`: `{ handle, channelId, uploadsPlaylistId (UULF), category }`.

---

## 8. IFrame Player API & Playback ✅ (verified 2026-06-29)

Embed via the official YouTube IFrame Player API, initialized through a React hook managing player vars, state, and `onError`.

**Locked playerVars (Pass A):**
| Param | Value | Effect |
|---|---|---|
| `rel` | `0` | Related videos limited to the **same channel** (since 2018 `rel=0` no longer hides them — confirmed). Acceptable: stays in-channel, no cross-channel rabbit hole. |
| `playsinline` | `1` | Inline playback on iOS (no forced fullscreen redirect). |
| `iv_load_policy` | `3` | Hide video annotations. |
| `disablekb` | `0` | Keep keyboard controls (accessibility). |
| `controls` | `1` | Standard controls. |
| `fs` | `1` | Allow fullscreen. |
| `color` | `white` | Neutral progress bar. |
| ~~`modestbranding`~~ | — | **Deprecated Aug 2023, no effect — omitted.** |

**Embedding restrictions:** some content (Vevo/labels) blocks external embedding and fires `onError` codes **101 and 150 (identical)**; **153** (missing Referer) also possible. All fire → render an interception state with a direct link to watch on YouTube rather than a blank player.

> Verified against [IFrame API reference](https://developers.google.com/youtube/iframe_api_reference) and [Player parameters](https://developers.google.com/youtube/player_parameters), 2026-06-29.

---

## 9. ToS / Compliance, Prior Art, PWA

### Compliance
Official Data API reads + IFrame embeds are the permitted paths. Prohibited: scraping, downloading, circumventing the player. Respect API caching/storage rules. Primary source: YouTube API Services Developer Policies.

### Prior Art (lessons, not dependencies)
| Project | Sourcing | Borrow |
|---|---|---|
| FreeTube | local RSS + wrappers | IndexedDB-local subs/watch history, no cloud profile |
| Invidious | HTML scraping | handle↔ID mapping patterns (not the scraping itself) |
| Piped | NewPipe Extractor backend | clean watch-page layout, proxy separation |
| Unhook | DOM/CSS overrides on real YouTube | hard layout constraints, hiding recommendation surfaces |

### PWA / Cross-Device
Next.js PWA with a web app manifest (`display: standalone`). Android/Chrome + Windows: native install, persistent storage. **iOS/Safari: manual "Add to Home Screen"; storage limits [VERIFY] — the commonly cited 50MB cap / 7-day eviction is version-dependent and likely outdated.** Provide an iOS install-helper modal since `beforeinstallprompt` is unsupported there.

---

## 10. Open Questions → PRD

1. **Ranked Focus Feed vs. newest-first?** Does the self-built ranking earn its complexity, or do *newest-first across channels + strong channel pages* deliver 90% of the value with less rabbit-hole risk?
2. Ratify or replace the reconstructed ranking math (§5).
3. UULF reliance: accept the undocumented-prefix risk, or build UU+filter from day one?
4. Confirm iOS storage behavior (affects offline/watch-state durability).

---

## 11. Sources

**Primary (authoritative — anchored 2026-06-29 in Pass A):**
- YouTube Data API v3 — Determine Quota Cost — https://developers.google.com/youtube/v3/determine_quota_cost ✅ (playlistItems/videos/channels.list = 1 unit; search.list = 100)
- channels.list (forHandle + contentDetails.relatedPlaylists.uploads) — https://developers.google.com/youtube/v3/docs/channels/list ✅
- playlistItems.list — https://developers.google.com/youtube/v3/docs/playlistItems/list ✅
- videos.list — https://developers.google.com/youtube/v3/docs/videos/list ✅
- YouTube IFrame Player API reference — https://developers.google.com/youtube/iframe_api_reference ✅ (onError 101/150/153)
- YouTube IFrame Player parameters — https://developers.google.com/youtube/player_parameters ✅ (rel=0 same-channel; modestbranding deprecated)
- Next.js App Router — Fetching data / caching — https://nextjs.org/docs/app/getting-started/fetching-data ✅ (fetch uncached by default; `next.revalidate`)
- YouTube API Services Developer Policies — https://developers.google.com/youtube/terms/developer-policies ✅

**Secondary (used for the uploads-playlist convention — undocumented by YouTube):**
- UULF/UUSH/UULV behavior + RSS `playlist_id` compatibility — multiple community sources (RSS feed-reader writeups, tool generators). Treat as empirically true but unstable.

**Weak / replace:**
- PWA capability + media-addiction sources in the original Gemini list are tangential; not load-bearing for the build.
