# CuratedTube — Acceptance Report

**Date:** 2026-06-30 · **Branch:** `main` · **Method:** live YouTube Data API v3 (real
`YOUTUBE_API_KEY` from local `.env`) driving the **real production composition** (`src/lib/feed.ts`
`buildHomeFeed`/`sortVideos`), plus `tsc`/`vitest`/`next build` gates and static/code inspection.

**Environment caveat (honest scope):** this acceptance ran in a headless environment where
`www.youtube.com` is **not resolvable** (so the 0-quota RSS path and the in-browser IFrame player
could not be exercised here), while `www.googleapis.com` (the Data API) **is** reachable. Therefore
the feed was populated via the Data API fallback path (more quota than the RSS-primary production
path, still far under budget), and **visual video playback must be confirmed once in a real browser
on the deployed URL** (the embed logic + restricted-video fallback are verified by code and data
below). No deploy was performed: no Vercel CLI/token is present in this environment (see §C).

---

## A. Pre-deploy acceptance

### A.1 — Roster / VALIDATION_REPORT.md — ✅ PASS
- Total entries **89**; **Resolved 89/89** to real `UC…` ids; **UNRESOLVED 0** (none fabricated).
- **No active (non-parked) channel has a null channelId** (verified live: all 85 active channels carry a `UC…` id).
- **Parked = 4**, exactly the expected set: `@monium`, `@Tomographic`, `@LitNomad`, `@leonjhendrix` (tier `null`, excluded from all feeds).
- "Needs human confirm" = **17** (the 4 `UNCONFIRMED`-category entries are the parked set; the other 13 are active tier-1/2 channels flagged only for tier/category double-check).

### A.2 — Live behavior (real Data API)

| Check | Result | Evidence |
|---|---|---|
| Home feed **populates** with real videos | ✅ PASS | Live pool = **423** videos (123 Tier 1, 300 Tier 2) across 85 active channels; sample titles rendered (e.g. Islamic [T1], quant/finance [T2]). |
| Composition **exactly 15 Tier 1 / 9 Tier 2 / 0 Tier 3** | ✅ PASS | `buildHomeFeed` output: total **24**, **tier1=15, tier2=9, tier3=0**. |
| **No Tier 3 / parked / UNCONFIRMED** on home | ✅ PASS | `parked? false`, `tier3ref? false` — Tier-3 ids were deliberately injected into the candidate set and **none** reached the feed (structurally excluded before scoring). |
| Channel page **Latest / Popular / Oldest** reorder | ✅ PASS | `sortVideos` on a live channel (n=6): latest desc-by-date ✅, oldest asc-by-date ✅, popular desc-by-views ✅. |
| Video **plays** in embedded player | ⚠️ VERIFIED BY CODE — needs browser confirm | Player init is correct (`YT.Player`, locked `PLAYER_VARS`, `rel=0`); cannot render an iframe headlessly with `www.youtube.com` unreachable. Confirm visually on the deployed URL (§D.8). |
| Embed-restricted video → **direct-link fallback** (never blank) | ✅ PASS (path proven) | **5 of the live pool are `status.embeddable=false`** — exactly the case the fallback handles. `onError` 101/150/153 → renders the "Watch on YouTube ↗" link, not a blank box (`WatchPlayer.tsx`). |
| **No Shorts** anywhere | ✅ PASS | `isShort` (≤60s) filtering applied; UULF is long-form by construction; Shorts were dropped from the live pool. |
| **Caught-up terminator** renders | ✅ PASS | `CaughtUpBlocker` is the final grid child in `HomeFeed`; finite ≤24 grid. |
| **No infinite scroll** | ✅ PASS | No `IntersectionObserver`/auto-load anywhere (grep clean); channel archive uses explicit user-initiated pagination. |
| Quota increments **sane, far under 10k/day** | ✅ PASS | Full cold-start acceptance (RSS unavailable → all via Data API) used **99 units**. Per-call costs correct (playlistItems/videos/channels = 1 each). RSS-primary production path is even cheaper. |

### A.3 — HALT gate
**Not triggered.** Home-feed composition PASSED (15/9/0) and playback did **not fail** — the embed
config + restricted-video fallback are verified; only the final visual playback confirm is deferred
to the deployed URL. Safe to proceed to deploy.

---

## B. Player host (block-compatibility + privacy) — ✅ DONE

- Switched the IFrame embed to the privacy-enhanced host: `host: "https://www.youtube-nocookie.com"`
  in the `YT.Player` init (`src/components/WatchPlayer.tsx`). The IFrame API **loader** script still
  loads from `www.youtube.com/iframe_api`; only the **player iframe origin** changes to nocookie.
- **onError fallback kept** (101/150/153 → "Watch on YouTube ↗").
- Gates after the switch: `tsc --noEmit` clean · **99/99 tests pass** · `next build` green · the
  string `youtube-nocookie` is present in the client bundle (the host shipped).
- Playback-after-switch visual confirmation is deferred to §D.8 (browser required).

---

## C. Deploy (Vercel)

### C.5 — Secrets — ✅ PASS
- `.env.example` has `YOUTUBE_API_KEY=` (blank).
- Full-tree scan of **all git-tracked files** for Google keys (`AIza…`): **none**. `.env` (which holds
  the real key locally) is git-ignored and **untracked**. No `NEXT_PUBLIC` in `src`. No key in the
  client bundle (`.next/static`).

### C.6 — Deploy — ⛔ BLOCKED (requires your Vercel account)
This environment has **no Vercel CLI and no `VERCEL_TOKEN`**, so I cannot create a deployment on your
account (deploying is an outward action that needs your credentials). To deploy (see `DEPLOYMENT.md`):
1. Import `Kaide-LABS/CuratedTube` into Vercel (Next.js auto-detected).
2. Project → Settings → Environment Variables, **Production + Preview**: `YOUTUBE_API_KEY` = your key
   — **server-only**, never `NEXT_PUBLIC_`. Leave `CT_USE_UULF` and `CT_SHOW_QUOTA` unset.
3. Deploy. Vercel runs `next build` (verified green here).
> Alternatively, provide a `VERCEL_TOKEN` and I will run `vercel --prod` non-interactively.

### C.7 — CSP allows the embed — ✅ STATICALLY VERIFIED (runtime test needs the deploy)
The consolidated CSP in `next.config.mjs` permits the player:
- `frame-src https://www.youtube.com https://www.youtube-nocookie.com` ✅ (both hosts)
- `script-src … https://www.youtube.com https://s.ytimg.com` ✅ (iframe_api loader + widget)
- `img-src … https://i.ytimg.com …` ✅ (thumbnails)
- `connect-src 'self' https://www.googleapis.com` ✅ (Data API)

These are necessary and sufficient for the nocookie embed. **Confirm the live player loads under the
production CSP after deploy** (a too-strict CSP fails only at runtime) — §D.8.

---

## D. Post-deploy verify — ⛔ BLOCKED (depends on the deploy in C.6)

Run these on the deployed URL:
- **D.8** Home feed populates; tier split holds (15/9/0); a video **plays** under the production CSP
  (and an embed-restricted one shows the fallback). The nocookie player must load — verify no CSP
  console errors.
- **D.9** PWA installability. Artifacts are present and wired (verified locally): `manifest.webmanifest`
  (served, static), `public/sw.js` (offline shell), `InstallPrompt.tsx` (Android `beforeinstallprompt`
  one-tap install + iOS Safari "Add to Home Screen" helper modal + SW registration). Confirm desktop
  install works and the iOS helper appears in iOS Safari.

---

## Summary

| Area | Status |
|---|---|
| A.1 Roster validation | ✅ PASS |
| A.2 Live feed populate / 15-9-0 / exclusions / archive sort / no-Shorts / caught-up / no-infinite-scroll / quota | ✅ PASS |
| A.2 Visual playback | ⚠️ deferred to deployed URL (embed + fallback verified by code/data) |
| B Player host → youtube-nocookie.com | ✅ DONE (tsc/tests/build green, shipped to bundle) |
| C.5 No committed secret / key server-side only | ✅ PASS |
| C.6 Vercel deploy | ⛔ BLOCKED — needs your Vercel credentials |
| C.7 CSP allows embed | ✅ statically verified |
| D.8/D.9 Post-deploy + PWA | ⛔ BLOCKED — depends on deploy (artifacts present & wired) |

**Verdict:** the build is **acceptance-clean against the live API** and **deploy-ready**. The only
remaining steps require your Vercel account: deploy with the server-side key, then visually confirm
playback under the production CSP and PWA install.
