# CuratedTube

A personal, single-user, focus-oriented scoped YouTube client.
**North star: keep the discovery, kill the rabbit hole.** Block YouTube everywhere; lose only the distraction.

CuratedTube reproduces YouTube's *useful* surfaces — a discovery feed, channel pages, a watch page, sort/filter — restricted to ~20 whitelisted channels, with the addictive surfaces (Shorts, comments, autoplay chains, open recommendations, global search) removed at the architecture level.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind v4** — server-side Data API calls keep the key server-only.
- **YouTube Data API v3** — `playlistItems.list` / `videos.list` / `channels.list` only. **Never `search.list`** (100× quota).
- **RSS** (`feeds/videos.xml?playlist_id=UULF…`) — zero-quota new-upload detection.
- **IFrame Player API** — distraction-suppressed playback with an embed-restriction fallback.
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

Edit `src/config/channels.json` — one entry per channel with `handle` and `category`
(`Automotive` | `Islamic` | `History` | `AI-Tech`). Then `npm run resolve-channels` looks up
each `@handle` via `channels.list?forHandle` and writes back `channelId` and the UULF uploads
playlist id. The seed list is a starting template — replace handles with your own.

> UULF (long-form only) is the primary uploads source (D2), behind one swappable resolver
> (`resolveUploadsPlaylistId`). If the undocumented UULF prefix ever stops resolving, set
> `USE_UULF = false` in `src/lib/channels.ts` (or run `resolve-channels --uu`) to fall back to
> UU full uploads with client-side Shorts filtering.

## What's enforced (non-negotiables)

No Shorts surface · no comments · no autoplay-next · no infinite scroll · no global search ·
finite 24-item home ending in a caught-up block · same-channel rail only on watch ·
no metric optimizes for time-on-app.

## Layout

```
src/lib/        types, channels resolver, youtube data module, rss poller, feed builder, quota, watch state
src/components/ feed/card/filter/player/quota UI
src/app/        Home (/), Channel (/channel/[id]), Watch (/watch/[id]), /api/quota
scripts/        resolve-channels.mjs (one-time handle -> id resolution)
```

See `CuratedTube_PRD.md` (build spec) and `CuratedTube_context.md` (research grounding).
Phase status and what's left: `HANDOFF.md`.
