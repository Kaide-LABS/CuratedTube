# CuratedTube — Phase 1 Handoff

**Date:** 2026-06-29 · **Status:** Phase 1 built, typechecked, production build green.

## What shipped

**Pass A — stack currency audit (web-verified, primary sources).** All blocking `[VERIFY]`
items resolved and written back into `CuratedTube_PRD.md §10` and `CuratedTube_context.md §0/§8/§11`:

- **Quota costs** — `playlistItems.list`/`videos.list`/`channels.list` = 1 unit; `search.list` = 100 (never called). [Determine quota cost](https://developers.google.com/youtube/v3/determine_quota_cost)
- **`channels.list?forHandle`** — supported; `contentDetails` returns the uploads playlist. [channels.list](https://developers.google.com/youtube/v3/docs/channels/list)
- **IFrame** — `rel=0` now means *same-channel* related (not hidden); `modestbranding` deprecated (Aug 2023, no-op); `onError` 101/150 identical, 153 possible. Locked playerVars in `WatchPlayer.tsx`. [IFrame ref](https://developers.google.com/youtube/iframe_api_reference) · [params](https://developers.google.com/youtube/player_parameters)
- **Next.js (16 docs)** — `fetch` is *not* cached by default; we cache via `next.revalidate` (1800s) + React `cache()`. [Fetching data](https://nextjs.org/docs/app/getting-started/fetching-data)

**Phase 1 build.** Next.js 15 (App Router, TS) + Tailwind v4.

| Area | File(s) | Notes |
|---|---|---|
| Resolver (D2) | `src/lib/channels.ts`, `scripts/resolve-channels.mjs` | UULF primary, UU fallback in one place |
| Data module | `src/lib/youtube.ts` | `getUploads`, `enrich`, `getChannelMeta`, ISO-8601 parser; server-only; never `search.list` |
| RSS poller | `src/lib/rss.ts` | 0-quota upload detection; fails soft |
| Feed builder | `src/lib/feed.ts` | tier-weighted slots (15 Tier 1 / 9 Tier 2 / 0 Tier 3), newest-first, cap 24 |
| Quota counter | `src/lib/quota.ts`, `/api/quota`, `QuotaBadge` | per-call-type units, 80% alert |
| Aggregators | `src/lib/data.ts` | RSS-primary home, channel archive, watch (same-channel rail) |
| Watch state | `src/lib/watchState.ts` | IndexedDB visited set; de-emphasis |
| Surfaces | `src/app/*`, `src/components/*` | Home + filter, Channel (Latest/Popular/Oldest), Watch (IFrame + onError fallback) |

**Guardrails enforced:** no Shorts (UULF), no comments, no autoplay-next, no infinite scroll
(home ends in `CaughtUpBlocker`; channel uses explicit "Show more"), same-channel-only watch rail,
no global search, no time-on-app metric.

## Verified vs. not

- ✅ `tsc --noEmit` clean; `next build` green (4 routes); dev server boots; `/` renders the setup
  notice with no key; `/api/quota` returns a live snapshot.
- ⚠️ **Not exercised against the live API** — no `YOUTUBE_API_KEY` was available in this build
  environment. The data path (RSS → enrich → balance → render), channel archive, and IFrame
  playback compile and are wired but unverified end-to-end. First real run: add a key, run
  `npm run resolve-channels`, then `npm run dev`.

## Roster (canonical, resolved)

- **89 real channels** resolved into the root `channels.json` — Tier 1 (Islamic) ×21, Tier 2
  (Educational) ×50, Tier 3 (Entertainment) ×14, plus 4 parked (`tier:null`). All carry a real
  `UC…` channelId, a verified `UULF…` uploads playlist, and enriched title/avatar/subs. 0
  UNRESOLVED, 0 UULF→UU fallbacks, 0 duplicates, ~2 Data API units used. Audit: `VALIDATION_REPORT.md`.
- **17 channels flagged `confirm:true`** — they are tiered and active, but want a human tier/
  category check. The 4 parked entries (`@monium`, `@Tomographic`, `@LitNomad`, `@leonjhendrix`)
  stay out of every feed until classified.

## UNRESOLVED

- **iOS PWA storage limits** — left `UNRESOLVED` (version-dependent, non-blocking). Re-verify in
  Phase 3 before relying on offline durability.
- **UULF prefix risk** — undocumented; if it breaks, flip `USE_UULF=false` (one-line swap).

## Phase 2 (ranking) needs — run Pass B first

Phase 1 ships the cold-start reduction (newest-first + category balance). Phase 2 adds the full
Focus Feed weighting. Before building it:

1. **Pass B (gated):** use arxiv-mcp + paper-search to ratify or replace the reconstructed math
   in `context.md §5` (gravity/time-decay, seen-penalty, category-balanced selection, bandit-style
   exploration for a *small closed set*). If nothing applies, keep the reconstruction as-is.
2. Implement S1 (gravity-decayed popularity) / S2 (linear), `P_seen` penalty, 72h freshness
   window, ~20% back-catalogue injection, anti-repetition — all additive to `feed.ts`.
3. Session limiter (>30 min active in a rolling 4h window) + PWA install (incl. iOS helper modal).
