# CuratedTube — BUILD COMPLETE

**All 4 phases built and approved.** CuratedTube is a personal, single-user, focus-oriented
scoped YouTube client — *keep the discovery, kill the rabbit hole.* This document closes the
build: every phase shipped on `main`, every non-negotiable preserved, the final hardening phase
reviewed and approved.

---

## Phase ledger

| Phase | Scope | Implementation | Review approved |
|---|---|---|---|
| 1 | Data layer — roster pipeline, `channels.json`, UULF resolution, Zod boundary, quota counter | `feat: Phase 1 implementation` | `chore: Phase 1 review approved` |
| 2 | Focus Feed ranking — tier 15-9-0, S₁/S₂, 24-cap, caught-up terminator | `feat: Phase 2 implementation` | `chore: Phase 2 review approved` |
| 3 | State & polish — IndexedDB (watch state / impressions / Watch Later / session), PWA/SW, same-channel rail | `feat: Phase 3 implementation` | `chore: Phase 3 review approved` |
| 4 | Hardening — ETag/304 conditional quota, UULF→UU per-channel fallback (D2), deploy config, iOS-storage close-out | `feat: Phase 4 implementation` | `chore: Phase 4 review approved` (`59ebb26`) |

---

## Phase 4 — final acceptance results (PHASE_4_SPEC.md §8)

All criteria verified locally during review:

1. **Conditional quota — PASS.** `apiFetch` records the per-type cost on a `200`+`ETag` and **0 units**
   on a `304`, returning the cached, already-Zod-validated body; `quotaSnapshot().savedUnits` reflects the
   avoided cost. Verified by `test/etag.test.ts` + `test/quota.test.ts`.
2. **Fallback drill (D2) — PASS.** `shouldFallbackToUU` returns true for UULF-empty/Shorts-only, false when
   long-form exists; a channel whose `UULF` lists 0 items transparently re-lists `UU` and returns long-form
   only (`isShort`-filtered), flagging `usedUU`; one channel's break never blanks the feed. **No `search.list`**
   anywhere (grep-verified — only negation comments). Verified by `test/fallback.test.ts`.
3. **No invariant regression — PASS.** Diff touches only the server data layer + deploy/test/doc files. Home
   composition (tier 15-9-0), the 24-cap, the caught-up terminator, the same-channel rail, `PLAYER_VARS`, the
   session limiter, and Watch Later are unchanged (`feed.ts`/`ranking*.ts`/`session*.ts`/`watch*.ts` not in diff).
4. **Key never client-side — PASS.** A production `next build` client bundle contains no `YOUTUBE_API_KEY`,
   no `NEXT_PUBLIC_*` key, and no API host string (grep of `.next/static` = clean). The key is read only in
   the `server-only` `youtube.ts`.
5. **Headers/CSP — PASS.** Security headers + CSP defined once in `next.config.mjs` (single, non-conflicting
   policy): `frame-src https://www.youtube.com` for the IFrame player, `connect-src https://www.googleapis.com`
   for the Data API, plus `nosniff`, `Referrer-Policy`, `HSTS`, locked `Permissions-Policy`, `frame-ancestors
   'none'`. Nothing engagement/analytics-related is allowed.
6. **Deploy green — PASS.** `next build` passes; 9 routes emit correctly (home/channel/watch render
   dynamically via the `no-store` + ETag/304 model; manifest/icons static; `/api/quota` dynamic; SW offline
   shell). Vercel config in `vercel.json` + runbook in `DEPLOYMENT.md`.
7. **iOS storage [VERIFY] closed — PASS.** `DEPLOYMENT.md §5` documents WebKit's ~7-day standalone-PWA
   IndexedDB eviction and the "personal state is convenience; feed/archives re-derive from the Data API"
   mitigation; marked resolved / non-blocking (PRD §10).
8. **Gates — PASS.** `tsc --noEmit` clean; full suite **99 tests** green (87 prior + 12 new); new-code
   coverage ≥ 80% (`etagCache.ts` 87.5%, `quota.ts` 96%, `channels.ts` 98%; branch 92.7% > 70% gate);
   `next build` green; secret scan clean (no secrets in diff or bundle).

### Review patches applied during Phase 4 (`fix: ffbecff`)

The `no-store` refactor had left contradictory ISR artifacts behind. Corrected for a coherent
production codebase (route table / build / tests unchanged):

- `src/lib/youtube.ts` — header comment rewritten to describe the `no-store` + ETag/304 model.
- `src/app/page.tsx`, `src/app/channel/[channelId]/page.tsx`, `src/app/watch/[videoId]/page.tsx` —
  dead `export const revalidate = 1800` replaced with explicit `export const dynamic = "force-dynamic"`.
- `DEPLOYMENT.md` — "ISR (30-min revalidate)" corrected to per-request dynamic rendering.

---

## Non-negotiables (PRD §2) — preserved across all 4 phases

No Shorts surface · no comments · no autoplay-next · no infinite-scroll/auto-load · no global
search box · no cross-channel recommendations (same-channel rail only) · finite ≤24-item home
feed ending in a caught-up terminator · tier 15-9-0 with Tier 3 and `tier: null` excluded from
the feed · UULF-only listing (sole sanctioned non-UULF path is the documented `UU` + `isShort`
fallback) · `search.list` never called · YouTube key strictly server-side · deterministic Zod
validation boundary on every external response · IndexedDB device-local, no accounts/sync · no
metric optimizes for time-on-app.

---

## Completion metadata

- **Repository:** `Kaide-LABS/CuratedTube` (branch `main`).
- **Completion commit SHA:** the `docs: CuratedTube build complete — 4 phases shipped` commit on
  `main` (parent = Phase 4 approval `59ebb26`; fix patch `ffbecff`).
- **Deployment URL:** not yet deployed — the build is deploy-ready. Follow `DEPLOYMENT.md`: import
  the repo into Vercel, set `YOUTUBE_API_KEY` as a server-side env var, deploy. Vercel assigns the
  production URL on first deploy.
- **Nia index ID:** N/A — the Nia GitHub App is not installed on this private repo
  (`repos.sh index` returned "GitHub App installation required for private repositories"), so this
  review was performed with local tooling (`tsc`, `vitest --coverage`, `next build`, grep/secret
  scans). Install the Nia GitHub App on `Kaide-LABS/CuratedTube` to enable indexed exploration.
- **Phase 1→2 citation re-verification gate:** **PASSED** (see `PHASE_2_SPEC.md §0.5`, executed
  2026-06-30) — the Focus Feed ranking math (gravity/time-decay, category-balanced selection,
  exploration for small closed sets) was ratified against the literature.

---

## Handoff

CuratedTube is **ready to deploy**. Deploy to Vercel per `DEPLOYMENT.md`, pin the PWA to your Home
Screen / desktop, then **block YouTube across your devices** (router/DNS sink, Screen Time / Digital
Wellbeing, hosts file) while allowlisting `www.youtube.com` embeds + `*.googlevideo.com` playback so
the CuratedTube player keeps working. The discovery stays; the rabbit hole is gone.
