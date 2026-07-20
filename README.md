# HalalTube

A personal, single-user, focus-oriented scoped YouTube client.
**North star: keep the discovery, kill the rabbit hole.** Block YouTube everywhere; lose only the distraction.

HalalTube reproduces YouTube's *useful* surfaces — a discovery feed, channel pages, a watch page, sort/filter — restricted to ~20 whitelisted channels, with the addictive surfaces (Shorts, comments, autoplay chains, open recommendations, global search) removed at the architecture level.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind v4** — server-side Data API calls keep the key server-only.
- **YouTube Data API v3** — `playlistItems.list` / `videos.list` / `channels.list` only. **Never `search.list`** (100× quota).
- **RSS** (`feeds/videos.xml?playlist_id=UULF…`) — zero-quota new-upload detection.
- **Self-hosted nocookie player** — a raw `youtube-nocookie.com` embed driven directly by the
  postMessage widget protocol (`src/lib/youtubeWidget.ts`), not the official
  `www.youtube.com/iframe_api` script — so `www.youtube.com` can be fully DNS-blocked without
  breaking playback. Distraction-suppressed params + an embed-restriction fallback (see
  DEPLOYMENT.md §"Self-hosted player").
- **IndexedDB** — local watch state (single-user, no backend).

## Getting started

```bash
npm install
cp .env.example .env          # add YOUTUBE_API_KEY (server-only)
npm run resolve-channels      # fills channelId + uploadsPlaylistId (UULF) from handles
npm run dev
```

Without a key or resolved channels, the app boots and shows an in-app setup notice.

### Configure your channels

Edit the canonical `channels.json` at the repo root — an object of `{ _meta, channels[] }`
where each entry carries a `handle`, a free-form `category`, and a `tier` (`1` Beneficial /
`2` Educational / `3` Entertainment; `null` parks the channel out of all feeds). `tier` — not
category — drives home composition (15 Tier 1 / 9 Tier 2 / 0 Tier 3). Then `npm run
resolve-channels` resolves each unresolved `@handle` **yt-dlp-first (0 quota)** with a
`channels.list?forHandle` fallback, derives the UULF uploads playlist id, verifies it via the
zero-quota RSS feed, enriches title/avatar/subs, and emits `VALIDATION_REPORT.md`. Already-resolved
`UC…` ids are preserved byte-for-byte; no id is ever fabricated.

> UULF (long-form only) is the primary uploads source (D2), behind one swappable resolver
> (`resolveUploadsPlaylistId`). If the undocumented UULF prefix ever stops resolving, set
> `USE_UULF = false` in `src/lib/channels.ts` (or run `resolve-channels --uu`) to fall back to
> UU full uploads with client-side Shorts filtering.

## What's enforced (non-negotiables)

No Shorts surface · no comments · no autoplay-next · no infinite scroll · no global search ·
finite 24-item home ending in a caught-up block · same-channel rail only on watch ·
no metric optimizes for time-on-app.

## Watch-time guardian

A self-imposed discipline layer on the watch page: staged check-ins at 30/60/90/120 active
minutes and a non-negotiable 2.5-hour (150-minute) daily cap, both measured from real playback
time (timestamp deltas on player state changes, never `setInterval` tick-counting — a
backgrounded tab would undercount ticks). State lives in IndexedDB (`watchSession`, per local
calendar day), is monotonic across writes, and converges across tabs via `BroadcastChannel`. The
thresholds and the cap are **not** editable anywhere in the UI — self-binding is the point. The
only editable setting is the preset WhatsApp contact used by the check-in's "Message someone"
door (`/settings`).

**Accepted limitation:** this is client-side, IndexedDB-backed state. It can be cleared via
DevTools, a private window, or a fresh browser profile, and there is no server-side enforcement.
This is intentional — the guardian is self-binding discipline (a tool you point at yourself), not
SENTINEL-grade tamper-proof enforcement, and the code does not pretend otherwise or attempt any
anti-clear tricks. See `src/lib/watchGuardian.ts` for the full accounting/clock-guard logic.

## Deploy

Deploy to Vercel: import the repo (Next.js auto-detected), set `YOUTUBE_API_KEY` as a **server-side**
Environment Variable (never `NEXT_PUBLIC_`), and deploy. Optional: `CT_USE_UULF=false` forces the UU
fallback globally; `CT_SHOW_QUOTA=1` shows the dev quota badge in production. Security headers + CSP
are defined once in `next.config.mjs`. Full steps and the "block YouTube across your devices" runbook
are in [`DEPLOYMENT.md`](DEPLOYMENT.md).

### Quota & fallback (hardening)

- **Conditional requests:** Data API reads send `If-None-Match`; an unchanged payload returns `304` at
  **0 units**, served from an already-validated server-side ETag cache (`src/lib/etagCache.ts`).
- **UULF→UU fallback (D2):** if a channel's long-form `UULF` uploads playlist lists nothing, the data
  layer transparently re-lists the full `UU` playlist and filters Shorts client-side — **per channel**,
  so one broken playlist never blanks the feed. It never calls `search.list`.
- The counter (`/api/quota`) alerts at 80% of the 10,000/day budget and reports units saved via 304s.

## Layout

```
src/lib/        types, channels resolver, youtube data module, rss poller, feed builder, quota, watch state
src/components/ feed/card/filter/player/quota UI
src/app/        Home (/), Channel (/channel/[id]), Watch (/watch/[id]), /api/quota
scripts/        resolve-channels.mjs (one-time handle -> id resolution)
```

See `HalalTube_PRD.md` (build spec) and `HalalTube_context.md` (research grounding).
Phase status and what's left: `HANDOFF.md`.
