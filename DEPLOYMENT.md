# CuratedTube — Deployment & Block-YouTube Runbook

Phase 4 (Hardening) deployment guide. CuratedTube is a single-user, server-rendered Next.js
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
conflicting policy. The CSP permits the YouTube IFrame player (`frame-src https://www.youtube.com`)
and its API/asset hosts, blocks framing of CuratedTube itself (`frame-ancestors 'none'`), and ships
`nosniff`, `Referrer-Policy`, `HSTS`, and a locked-down `Permissions-Policy`. `script-src`/`style-src`
keep `'unsafe-inline'` because the App Router emits inline hydration scripts without a nonce; a
nonce-based tightening (request middleware) is a candidate future hardening, intentionally out of
scope for this deploy step.

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

Once CuratedTube is live and pinned, remove the rabbit hole at the source:

- **Router / DNS:** block `youtube.com`, `m.youtube.com`, `youtubei.googleapis.com` at your router
  or via a DNS sink (Pi-hole / NextDNS). CuratedTube’s **player iframe still works** because it loads
  from `www.youtube.com` *embedded* — if you sink the whole domain, allowlist `www.youtube.com` and
  `*.googlevideo.com` (playback), and block the `/feed`, `/shorts`, `/results` browse paths instead.
- **iOS / Android:** Screen Time / Digital Wellbeing → block the YouTube app + `youtube.com` in the
  browser; add CuratedTube to the Home Screen (PWA) as the sanctioned entry point.
- **Desktop:** a hosts-file entry or an extension that blocks the YouTube homepage/Shorts/search while
  leaving `/watch` embeds intact.

## 5. iOS PWA storage — [VERIFY] closed (PRD §10, non-blocking)

WebKit evicts a standalone PWA's IndexedDB after ~7 days of non-use. CuratedTube's IndexedDB holds
only **convenience** state — watch history (visited de-emphasis), Watch Later, and session segments —
none of it a source of truth. The feed, channel archives, and watch data **re-derive from the Data
API** on open, so eviction costs at most some "visited" dimming and saved-later entries; nothing
breaks and no irreplaceable data is lost. No mitigation beyond this note is required; the item is
**resolved / non-blocking**.
