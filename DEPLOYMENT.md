# HalalTube — Deployment & Block-YouTube Runbook

Phase 4 (Hardening) deployment guide. HalalTube is a single-user, server-rendered Next.js
(App Router) app. The only secret is the YouTube Data API key, which stays **server-side**.

---

## 1. Prerequisites

- A YouTube Data API v3 key (Google Cloud Console → APIs & Services → Credentials → *enable*
  "YouTube Data API v3"). The roster (`channels.json`) is already resolved and committed.
- A Vercel account connected to this GitHub repo.

## 2. Deploy to Vercel

1. **Import** the repo in Vercel. Framework is auto-detected as Next.js (`vercel.json` pins it).
2. **Environment Variables** (Project → Settings → Environment Variables), Production + Preview:
   - `YOUTUBE_API_KEY` = your key. **Server-only** — never prefix `NEXT_PUBLIC_`.
   - `CT_USE_UULF` = *(leave unset)* — default UULF-primary. Set to `false` only if the UULF
     prefix ever stops resolving globally (per-channel auto-fallback runs regardless).
   - `CT_SHOW_QUOTA` = *(leave unset)* — the dev quota badge stays hidden in production.
3. **Deploy.** Vercel runs `next build`; the home/channel/watch pages render **dynamically**
   (per-request) because their Data API reads use `cache: "no-store"` so the ETag/304 layer is the
   sole authority on quota spend; `/manifest.webmanifest` + icons are static, and the service worker
   (`/sw.js`) registers an offline shell. Quota stays low via the 0-unit RSS detection path + 304s.
4. **Verify** the deployed app: home Focus Feed renders (≤24, caught-up terminator), channel
   archives sort, a video plays (embed-restricted ones show the "Watch on YouTube" fallback),
   `/watch-later` renders from IndexedDB (0 quota), and the PWA install affordance appears.

### Security headers / CSP

Headers are defined once in [`next.config.mjs`](next.config.mjs) (`headers()`), so there is no
conflicting policy. The CSP permits ONLY the nocookie player (`frame-src
https://www.youtube-nocookie.com`) — `www.youtube.com` and `s.ytimg.com` are NOT in `script-src`,
`frame-src`, or `media-src` at all, since the player is self-hosted (see "Self-hosted player"
below) and never loads anything from those two hosts. It blocks framing of HalalTube itself
(`frame-ancestors 'none'`), and ships `nosniff`, `Referrer-Policy`, `HSTS`, and a locked-down
`Permissions-Policy`. `script-src`/`style-src` keep `'unsafe-inline'` because the App Router emits
inline hydration scripts without a nonce; a nonce-based tightening (request middleware) is a
candidate future hardening, intentionally out of scope for this deploy step.

### Self-hosted player (no www.youtube.com dependency)

The player is a raw `<iframe src="https://www.youtube-nocookie.com/embed/...">`, driven directly
by the undocumented postMessage "widget" protocol (`src/lib/youtubeWidget.ts`) — **not** the
official `https://www.youtube.com/iframe_api` bootstrap script. This means `www.youtube.com` can
be fully DNS/router-blocked (§4 below) without breaking playback, since HalalTube never loads a
script from it. `s.ytimg.com` (the old bootstrap script's own dependency) is gone for the same
reason.

**ACCEPTED RISK:** this protocol (the "listening" handshake, `onStateChange`/`infoDelivery` event
shapes, player-state integers) is undocumented and reverse-engineered from observed traffic — the
same risk class as the UULF playlist-prefix convention. It may change without notice.
`src/lib/youtubeWidget.ts` is the entire swappable event-source layer; if YouTube changes the wire
format, only that file (and its tests) should need to change.

**Embed-restricted fallback, updated:** a video that can't be embedded (owner-restricted,
region/age-locked) shows a "can't be embedded and isn't available under the current network
block" message. It does **not** offer a live "Watch on YouTube" link — with `www.youtube.com`
DNS-blocked, that link would point at a sinkholed domain. The raw watch URL is shown as inert,
selectable text only, for lookup on another, unblocked device.

**Host set:** the nocookie embed needs, at minimum, `www.youtube-nocookie.com` (the player
document) and `*.googlevideo.com` (actual media segments — the player UI loads but nothing plays
without this). Thumbnails/avatars are `*.ytimg.com` / `*.ggpht.com` / `yt3.googleusercontent.com`,
already unaffected by this change. **This list has not been independently confirmed against live
network traffic from a real network egress** — this environment's own network intercepts
connections to `youtube.com`/`youtube-nocookie.com` (an untrusted-certificate MITM was observed
when testing directly), so a from-scratch traffic capture with `www.youtube.com` DNS-blocked
could not be completed here. **Verify this yourself** before relying on it for a router/DNS
allowlist: open DevTools → Network (with "preserve log" and no request blocking) on `/watch/<id>`,
play a full video, and note every distinct host across the top frame AND the player iframe's own
requests. Widen the allowlist if anything unexpected shows up (past reports of extras like
`jnn-pa.googleapis.com`, `fonts.gstatic.com`, or `play.google.com` exist for some embed
configurations — none of these are assumed present or absent without you having actually seen
them in your own capture).

## 3. Quota & resilience (what hardening bought)

- **Conditional requests.** Every Data API read sends `If-None-Match`; an unchanged payload returns
  `304 Not Modified` at **0 units** and is served from the process-local, already-validated ETag
  cache (`src/lib/etagCache.ts`). The quota counter (`/api/quota`) tracks `savedUnits`.
- **UULF→UU fallback drill (D2).** If a channel's `UULF` (long-form) uploads playlist lists nothing,
  the data layer transparently re-lists the channel's full `UU` uploads playlist and filters Shorts
  client-side (`isShort`). This is **per channel** — one broken `UULF` never blanks the feed — and it
  **never** calls `search.list`.
- **Budget.** Cold-start ≈160 units once; daily maintenance ≈9–128 units (RSS-primary). The counter
  alerts at 80% of the 10,000/day budget. 304s can only lower the total.

> Note on ETags: YouTube Data API ETag/304 support has varied over time. The code is correct either
> way — when the API returns `200`, units are charged normally; `304`s are a pure saving. No behavior
> depends on 304s being available.

## 4. Block YouTube across your devices

Once HalalTube is live and pinned, remove the rabbit hole at the source:

- **Router / DNS:** block `www.youtube.com`, `youtube.com`, `m.youtube.com`,
  `youtubei.googleapis.com` at your router or via a DNS sink (Pi-hole / NextDNS) — **fully**, no
  allowlist exception needed for `www.youtube.com` itself. HalalTube's player is self-hosted
  against `www.youtube-nocookie.com` (see "Self-hosted player" above) and never loads anything
  from `www.youtube.com`. Allowlist `www.youtube-nocookie.com` and `*.googlevideo.com` (actual
  media playback); leave the browse domain (`youtube.com`'s `/feed`, `/shorts`, `/results`, and
  the whole domain besides those two exceptions) blocked.
- **iOS / Android:** Screen Time / Digital Wellbeing → block the YouTube app + `youtube.com` in the
  browser; add HalalTube to the Home Screen (PWA) as the sanctioned entry point.
- **Desktop:** a hosts-file entry blocking `www.youtube.com` outright now works cleanly (no
  embed-breaking side effect) — no need for a homepage/Shorts/search-only extension rule.

## 5. iOS PWA storage — [VERIFY] closed (PRD §10, non-blocking)

WebKit evicts a standalone PWA's IndexedDB after ~7 days of non-use. HalalTube's IndexedDB holds
only **convenience** state — watch history (visited de-emphasis), Watch Later, and session segments —
none of it a source of truth. The feed, channel archives, and watch data **re-derive from the Data
API** on open, so eviction costs at most some "visited" dimming and saved-later entries; nothing
breaks and no irreplaceable data is lost. No mitigation beyond this note is required; the item is
**resolved / non-blocking**.
