# CuratedTube — PHASE_4_SPEC.md

**Artifact:** Phase 4 technical blueprint (build/QA-template structure). Derived from `CuratedTube_PRD.md §8` (Roadmap: *Phase 4 — Hardening*) + §7 (Quota Budget, locked) + §2/D2 (UULF→UU fallback) + §10 ([VERIFY]: IFrame/`forHandle` resolved; iOS storage open), built on the Phase 1 data layer + Phase 2 ranking + Phase 3 state/PWA now shipping on `main`.
**Companion docs:** `CuratedTube_PRD.md`, `CuratedTube_context.md`, `PHASE_1_SPEC.md`, `PHASE_2_SPEC.md`, `PHASE_3_SPEC.md`, `VALIDATION_REPORT.md`.

> This document *specifies* Phase 4. It does not build it. Phase 4 is **hardening + deploy** around the
> three shipped phases — it adds **no new surface**, **no new ranking term**, and **no new product
> behavior**. It (1) makes the quota counter *durable and conditional* (ETag / `If-None-Match` so
> unchanged payloads cost 0 units), (2) turns the latent **UULF→UU fallback** (D2) into a *drilled,
> tested, per-channel-automatic* path so an undocumented `UULF` break degrades instead of failing,
> and (3) **deploys** to Vercel with the YouTube key strictly server-side. Every non-negotiable
> (§2), the tier model (15-9-0 / Tier-3 excluded), the 24-cap + caught-up terminator, UULF-only
> listing, and the anti-distraction boundary are **preserved byte-for-byte**. Nothing here optimizes
> for time-on-app.

---

## §0 — Phase Plan Header

- **Phase:** **Phase 4 of 4** — Hardening (final).
- **Goal:** Ship the production-ready, quota-safe, fault-tolerant build from PRD §8 without touching
  any surface or invariant: (1) **Quota hardening** — ETag/`If-None-Match` conditional fetches so a
  304 costs 0 units, a process-survivable counter, and the 80%-of-10k/day alert surfaced (not just
  logged); (2) **UULF→UU fallback drill** (D2) — make `resolveUploadsPlaylistId`'s `UU` + client-side
  `/shorts/` filter path *automatic per channel* when `UULF` returns empty/Shorts-only, with a unit
  test proving long-form-only output; (3) **Deploy** — Vercel App-Router deployment, `YOUTUBE_API_KEY`
  server-only, env + header hardening, `next build` green in CI; (4) **Close the iOS-storage
  [VERIFY]** (PRD §10) — confirm/limit IndexedDB persistence under the iOS standalone PWA 7-day
  eviction and document the mitigation.
- **North star (unchanged):** keep the discovery, kill the rabbit hole. Phase 4 adds **zero**
  behavioral mechanics. The only new *runtime* code paths reduce quota (304s) or add resiliency
  (fallback) — never engagement.
- **Architecture note (carried from Phases 1–3):** the home feed stays Tier 1∪2 / 15-9-0 / 24-capped /
  caught-up; the key stays server-only; all personal state stays in IndexedDB (D3). Phase 4 modifies
  only the **server data layer** (`youtube.ts`/`quota.ts`/`channels.ts`/`data.ts`) and adds **deploy
  config** — no new component, no new client store, no new API surface beyond the existing
  `/api/quota`.

---

## §1 — Files Added / Modified

| File | Status | Purpose |
|---|---|---|
| `src/lib/quota.ts` | **modify** | Add **conditional-request accounting**: a `recordConditional(type, hit304)` (a 304 records **0** units; a 200 records the normal cost) and an ETag-aware path so skipped payloads are provably free. Keep the in-memory rolling-24h counter; optionally persist `windowStart/total` to a gitignored `.quota.json` on the server so a restart mid-day does not under-report. Expose `quotaSnapshot()` unchanged in shape (additive fields only). |
| `src/lib/etagCache.ts` | **add** | Tiny server-side ETag store: `getETag(key)`, `setETag(key, etag)`, `getCachedBody(key)`, `setCachedBody(key, body)`. Process-local map (single-user); keyed by request URL. Lets `youtube.ts` send `If-None-Match` and reuse the last good body on a `304`. No secrets, server-only. |
| `src/lib/youtube.ts` | **modify** | (a) Route every `fetch` through an `apiFetch(url, type)` helper that attaches `If-None-Match` from `etagCache`, records quota via `recordConditional` (304 ⇒ 0 units), stores the new ETag + body on 200, and returns the cached body on 304. (b) **Per-channel UULF→UU auto-fallback**: when a `UULF` `playlistItems.list` returns **0 items** (or only Shorts after enrich), transparently retry with `resolveUploadsPlaylistId(channelId,{useUULF:false})` and apply `isShort` filtering, stamping the channel's `fellBackToUU`/`shortsOnlyOrEmpty` provenance. No `search.list`, ever. |
| `src/lib/channels.ts` | **modify** | Promote `USE_UULF` to read an env flag `process.env.CT_USE_UULF` (default `true`); export a pure `shouldFallbackToUU(uulfItemCount, longformCount)` predicate so the fallback decision is unit-testable. `resolveUploadsPlaylistId` signature unchanged. |
| `src/lib/data.ts` | **modify** | Thread the per-channel fallback through `getHomeFeed`/`getChannelArchive` so a single channel's `UULF` break degrades that channel to `UU`-filtered without failing the whole feed. No change to tier composition, the 24-cap, or ranking inputs. |
| `src/app/api/quota/route.ts` | **modify** | Return the additive snapshot fields (`alert`, `pct`, `conditionalHits`) so `QuotaBadge` can show the 80% alert state. Still server-only, no key, `cache: "no-store"`. |
| `src/components/QuotaBadge.tsx` | **modify (minimal)** | Reflect the `alert` flag (amber at ≥80%); no new behavior, no polling cadence change. Dev-affordance only — hidden in production if `process.env.NODE_ENV === "production"` unless `CT_SHOW_QUOTA=1`. |
| `vercel.json` | **add** | Vercel deploy config: security headers (`X-Content-Type-Options`, `Referrer-Policy`, a minimal CSP allowing `https://www.youtube.com` frames + `https://www.googleapis.com` connect), `framePolicy`, and the build/runtime region. **No** `YOUTUBE_API_KEY` value committed — only referenced as a dashboard env var. |
| `.env.example` | **modify** | Document `YOUTUBE_API_KEY` (server-only), `CT_USE_UULF`, `CT_SHOW_QUOTA` — values blank. Reaffirm: **never** prefix the key `NEXT_PUBLIC_`. |
| `next.config.mjs` | **modify (minimal)** | Add the same security headers via `async headers()` (defense-in-depth with `vercel.json`); confirm `images.remotePatterns` already covers `i.ytimg.com`/`yt3.ggpht.com` (Phase 1) — additive only. |
| `README.md` | **modify** | Add a **Deploy** section (Vercel steps, env vars, “block YouTube across devices” handoff) and a **Quota/Fallback** note. Documentation only. |
| `DEPLOYMENT.md` | **add** | Step-by-step Vercel deploy + custom-domain + “block youtube.com at the network/DNS layer and pin CuratedTube” runbook; the iOS-PWA storage caveat and its mitigation. |
| `test/quota.test.ts` | **modify** | Add cases: a 304 records **0** units; a 200 records the per-type cost; the rolling-window reset is unaffected; `quotaSnapshot` exposes the new fields. |
| `test/fallback.test.ts` | **add** | Unit-test `shouldFallbackToUU` (UULF-empty ⇒ true; UULF-has-longform ⇒ false; UULF Shorts-only ⇒ true) and `isShort` boundary (60s) — the D2 drill, fully deterministic (no network). |
| `test/etag.test.ts` | **add** | Round-trip `etagCache` (set/get ETag + body) and the `apiFetch` 304→cached-body path with a mocked `fetch` (200 then 304), asserting **0** quota on the 304. |
| `vitest.config.ts` | **modify** | Add `src/lib/etagCache.ts` to the coverage `include`; keep the ≥80% lines/functions/statements gate. |

> **No change to `feed.ts` / `ranking.ts` / `ranking-config.ts` / `session*.ts` / `watchLater.ts` /
> `watchState.ts` / any component’s behavior.** Phase 4 adds no ranking term, no session mechanic, no
> new store, and no new surface. The only runtime deltas are *fewer* quota units (304s) and *more*
> resilient listing (per-channel fallback).

---

## §2 — npm Dependencies (additions)

| Package | State | Use |
|---|---|---|
| — | **none (runtime)** | ETag caching is a hand-written process-local map; the fallback is pure logic; deploy is Vercel-native (no adapter). Runtime deps stay exactly as Phases 1–3 (`next`, `react`, `react-dom`, `zod`, `fast-xml-parser`). |
| — | **none (dev)** | The new tests use the existing `vitest` + a hand-rolled `fetch` mock (no MSW). `fake-indexeddb` remains unneeded (no IDB change this phase). |

> Zero new dependencies keeps the production surface auditable for the deploy (“no engagement/analytics
> SDK sneaks in”) and avoids a Vercel build-step regression.

---

## §3 — Data Types / Zod Schemas (new for this phase)

No new persisted shapes (no IndexedDB change). Phase 4 adds two **internal** server types (not external
boundaries, so no Zod parse needed) and one schema extension for the quota snapshot:

```ts
// src/lib/etagCache.ts — internal server cache entry (not validated; never client-visible)
type ETagEntry = { etag: string; body: unknown; storedAt: number };

// src/lib/quota.ts — additive snapshot fields (the API still returns a superset; clients ignore extras)
//   conditionalHits: number   // count of 304s served at 0 units this window
//   savedUnits: number        // units avoided via 304s (observability only)
```

> The YouTube Data API response itself remains validated by the **existing Phase 1 Zod schemas**
> (`YouTubePlaylistItemsResponseSchema`, `YouTubeVideosResponseSchema`, …) **after** the 200/304
> resolution — i.e. a 304’s reused body is the *previously Zod-validated* payload, so the deterministic
> validation boundary is never bypassed. No `as` cast is introduced on any fetch result.

---

## §4 — Server Module / Route Signatures (new for this phase)

```ts
// src/lib/etagCache.ts (server-only, process-local)
getETag(key: string): string | undefined
setETag(key: string, etag: string): void
getCachedBody<T>(key: string): T | undefined
setCachedBody(key: string, body: unknown): void

// src/lib/youtube.ts (modified) — the single conditional-fetch path
async function apiFetch<T>(url: string, type: QuotaCallType, schema: ZodType<T>): Promise<T>
//   - attaches If-None-Match from getETag(url)
//   - 200 -> recordConditional(type, false); setETag/ setCachedBody(schema.parse(json)); return parsed
//   - 304 -> recordConditional(type, true)  (0 units); return getCachedBody(url) (already validated)
//   - never calls search.list; throws on a non-2xx/304 after the existing retry/backoff

// src/lib/channels.ts (modified)
shouldFallbackToUU(uulfItemCount: number, longformCount: number): boolean // pure, unit-tested
// resolveUploadsPlaylistId(channelId, { useUULF? }) — unchanged

// src/lib/quota.ts (modified)
recordConditional(type: QuotaCallType, hit304: boolean): void  // 304 => +0; else COST[type]
quotaSnapshot(): QuotaState & { pct: number; alert: boolean; conditionalHits: number; savedUnits: number }

// src/app/api/quota/route.ts (modified) — GET, server-only, cache:"no-store"
export async function GET(): Promise<Response> // returns quotaSnapshot() JSON (no key, additive fields)
```

> **Fallback drill, function-level:** `getUploads(channelId)` first lists the `UULF` playlist; if
> `shouldFallbackToUU(items, longformAfterEnrich)` is true it re-lists the `UU` playlist and applies
> `isShort` filtering, stamping `fellBackToUU = true` (or `shortsOnlyOrEmpty = true` if `UU` is also
> empty). This is **per channel**, so one broken `UULF` never blanks the feed.

---

## §5 — IndexedDB Schema / Versioning

**No change. DB `curatedtube` stays at version 3** (Phase 3). Phase 4 touches no IndexedDB store; the
shared `openDB`/`tx` and the v3 migration (`watchState`/`impressions`/`watchLater`/`session`) are
untouched. The quota counter and ETag cache are **server-side** (never IndexedDB), consistent with
Phase 1’s “no quota counter in IndexedDB”.

---

## §6 — Implementation Logic Flow (function-by-function)

### Conditional fetch + quota (`youtube.ts` `apiFetch`, `quota.ts`)
```
apiFetch(url, type, schema):
  etag = getETag(url)
  res  = fetch(url, { headers: etag ? {"If-None-Match": etag} : {}, next:{revalidate} })  # existing backoff wraps this
  if res.status === 304:
      recordConditional(type, true)                 # +0 units
      return getCachedBody(url)  ?? (cache miss -> re-fetch without If-None-Match, then 200 path)
  if res.ok:
      json   = await res.json()
      parsed = schema.parse(json)                   # SAME Zod boundary as Phase 1 (no `as`)
      setETag(url, res.headers.get("ETag"))         # only if present
      setCachedBody(url, parsed)
      recordConditional(type, false)                # +COST[type]
      return parsed
  throw  # non-2xx/304 after retries (existing behavior)

recordConditional(type, hit304):
  if hit304: conditionalHits++; savedUnits += COST[type]; log "[quota] 304 (type) -> +0"
  else:      recordQuota(type, 1)                   # unchanged accounting + 80% alert
```

### UULF→UU per-channel fallback (`channels.ts`, `youtube.ts`)
```
shouldFallbackToUU(uulfItemCount, longformCount):
  return uulfItemCount === 0 || longformCount === 0   # UULF empty, or nothing long-form survived

getUploads(channelId):
  uulfId = resolveUploadsPlaylistId(channelId)                 # UULF…
  items  = playlistItems.list(uulfId)  via apiFetch
  videos = enrich(items)                                       # videos.list via apiFetch
  long   = videos.filter(v => !isShort(v.durationSec))
  if shouldFallbackToUU(items.length, long.length):
      uuId   = resolveUploadsPlaylistId(channelId, {useUULF:false})   # UU…
      items2 = playlistItems.list(uuId) via apiFetch
      long   = enrich(items2).filter(v => !isShort(v.durationSec))    # client-side Shorts filter
      stamp  fellBackToUU = true (or shortsOnlyOrEmpty if long still empty)
  return long
  # NEVER search.list. The fallback is UU + isShort only (D2). Tier-3/parked channels excluded upstream.
```

### Deploy / env hardening (`vercel.json`, `next.config.mjs`, `.env.example`)
```
env:  YOUTUBE_API_KEY set ONLY as a Vercel server env var (no NEXT_PUBLIC_, never in client bundle)
      CT_USE_UULF (default true), CT_SHOW_QUOTA (default unset -> badge hidden in prod)
headers (vercel.json + next.config headers()):
      X-Content-Type-Options: nosniff
      Referrer-Policy: strict-origin-when-cross-origin
      Content-Security-Policy: frame-src https://www.youtube.com; connect-src 'self' https://www.googleapis.com;
                               (img/style per existing remotePatterns) — no inline-eval beyond Next’s needs
build: `next build` green; static home/channel prerender + dynamic watch (unchanged from Phase 3 route table)
```

### iOS-PWA storage [VERIFY] close-out (`DEPLOYMENT.md`)
```
Confirm: iOS standalone PWAs evict IndexedDB after ~7 days of non-use (WebKit). Mitigation documented:
  - personal state (watch history, Watch Later, session) is convenience, not source of truth;
  - the feed + archives re-derive from the Data API on open (0 risk of data loss that matters);
  - no action needed beyond documenting; NOT a blocker (matches PRD §10 [VERIFY] “noted, non-blocking”).
```

---

## §7 — Cross-Phase Integration Requirements

- **Every invariant from Phases 1–3 preserved.** Home stays Tier 1∪2 / 15-9-0 / 24-capped / caught-up;
  Tier-3 + `tier:null` excluded; no Shorts/comments/search/autoplay/infinite-scroll/notifications;
  same-channel rail only; `PLAYER_VARS` byte-for-byte; session limiter + Watch Later unchanged.
- **UULF-only listing, fallback documented.** Listing is `playlistItems.list` on `UULF`; the **only**
  sanctioned non-UULF path is the documented `UU` + `isShort` fallback (D2). **No `search.list`
  anywhere** — a grep of the diff must return zero `search.list`.
- **Validation boundary intact.** The 304 path returns a body that was **already** `schema.parse`-d on
  its prior 200; no fetch result is ever consumed via `as`/`any`. New external data still parses through
  the existing Phase 1 Zod schemas.
- **Server-only key, hardened for prod.** `YOUTUBE_API_KEY` is read only in server modules; the deploy
  config must keep it out of the client bundle (no `NEXT_PUBLIC_`); CI/build must fail if a
  `NEXT_PUBLIC_*` key is introduced.
- **Quota math still ≤ 10k/day, now lower.** Conditional requests can only *reduce* units (304 ⇒ 0).
  The cold-start (~160) and daily-maintenance (~9–128) envelopes from PRD §7 are unchanged ceilings;
  the 80% alert path is preserved and surfaced.
- **Existing suites green + grown.** All Phase 1+2+3 tests (87) pass unmodified; the new quota/fallback/
  etag tests are additive. Coverage gate stays ≥80% (lines/functions/statements).
- **No IndexedDB migration.** DB stays v3; `openDB`/`tx` remain the single DB-open path.

---

## §8 — Phase Acceptance Criteria

1. **Conditional quota:** with a mocked `fetch` returning `200`+`ETag` then `304`, `apiFetch` records the
   per-type cost on the 200 and **0 units** on the 304, returning the cached, **already-validated** body;
   `quotaSnapshot().savedUnits` reflects the avoided cost. Verified by `test/etag.test.ts` + `test/quota.test.ts`.
2. **Fallback drill (D2):** `shouldFallbackToUU` returns true for UULF-empty and UULF-Shorts-only, false
   when long-form exists; a channel whose `UULF` lists 0 items transparently re-lists `UU` and returns
   **long-form-only** (Shorts filtered by `isShort`), stamping `fellBackToUU`. The whole feed never blanks
   because one channel fell back. **No `search.list`** is introduced (grep-verified). Verified by `test/fallback.test.ts`.
3. **No invariant regression:** the diff changes only the server data layer + deploy/test/doc files; home
   composition, the 24-cap, caught-up terminator, tier 15-9-0, same-channel rail, `PLAYER_VARS`, session
   limiter, and Watch Later are byte-for-byte unchanged (diff-verified).
4. **Key never client-side:** a production `next build` bundle contains **no** `YOUTUBE_API_KEY` and no
   `NEXT_PUBLIC_*` API key (grep the `.next` client chunks); `vercel.json`/`next.config.mjs` carry no secret.
5. **Headers/CSP:** the deployed responses send the documented security headers; the CSP permits the
   YouTube IFrame (`frame-src https://www.youtube.com`) and Data API (`connect-src https://www.googleapis.com`)
   and nothing engagement/analytics-related; the player and feed still work behind it.
6. **Deploy green:** `next build` passes in CI; the app deploys to Vercel; the deployed home renders the
   Focus Feed, channel archives sort, watch plays with the embed fallback, `/manifest.webmanifest` serves,
   the service worker registers, and `/watch-later` renders from IndexedDB at **0 quota**.
7. **iOS storage [VERIFY] closed:** `DEPLOYMENT.md` documents the ~7-day WebKit eviction and the
   “personal state is convenience, feed re-derives from API” mitigation; marked resolved/non-blocking.
8. **Gates:** `tsc --noEmit` clean; full suite (Phase 1+2+3+4) green; new-code coverage ≥ 80%;
   `next build` green; secret scan clean.

---

## §9 — Explicit Non-Goals

- **No new surface or behavior.** No new page, component behavior, ranking term, or session mechanic.
  Watch Later, the session limiter, and the home ranker are frozen.
- **No `search.list`, ever.** The fallback is `UU` + `isShort` only; nothing in Phase 4 introduces a
  YouTube search call, a cross-channel recommendation, or any Tier-3 leakage.
- **No durable multi-user accounting.** The quota counter stays single-process / single-user (optional
  `.quota.json` is a convenience to survive a restart, not a database). No analytics, no telemetry SDK.
- **No engagement/analytics on deploy.** No Vercel Analytics/Speed-Insights script, no third-party
  tag, no notification/push/background-sync (the SW stays an offline shell from Phase 3).
- **No IndexedDB change / no sync.** DB stays v3; still device-local, no accounts, no cloud sync.
- **No ranking or tier retune.** The 15-9-0 budget, the S₁/S₂ weights, and the 24-cap are untouched —
  Phase 4 is resiliency and deploy, not product change.
