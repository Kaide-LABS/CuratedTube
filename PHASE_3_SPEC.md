# CuratedTube — PHASE_3_SPEC.md

**Artifact:** Phase 3 technical blueprint (build/QA-template structure). Derived from `CuratedTube_PRD.md §8` (Roadmap: *Phase 3 — State & Polish*) + §5 (Surfaces), `CuratedTube_context.md §5` (session limiting: ">30 min active in a rolling 4-hour window → prompt a break") and §9 (PWA / cross-device), built on the Phase 1 data layer + Phase 2 ranking now shipping on `main`.
**Companion docs:** `CuratedTube_PRD.md`, `CuratedTube_context.md`, `PHASE_1_SPEC.md`, `PHASE_2_SPEC.md`, `VALIDATION_REPORT.md`.

> This document *specifies* Phase 3. It does not build it. Phase 3 is **state + polish around the
> existing surfaces** — Watch Later, a focus-protecting session limiter, the PWA install path, and
> proper loading/error states. It adds **no new YouTube Data API quota** (Watch Later renders from an
> IndexedDB snapshot; session/PWA are client-only) and touches **none** of the ranking math, the tier
> model, the 24-cap, or any non-negotiable. Every new mechanic either *protects* focus (break prompt)
> or is *neutral* personal state (Watch Later) — nothing here optimizes for time-on-app.

---

## §0 — Phase Plan Header

- **Phase:** **Phase 3 of 4** — State & Polish.
- **Goal:** Ship the remaining personal-state and polish surfaces from PRD §8 without compromising the
  focus mandate: (1) **Watch Later** (IndexedDB-only, zero-quota, snapshot-rendered); (2) a
  **session limiter** that tracks *active playback* in a rolling 4h window and prompts a break past
  30 min (PRD §6 / context.md §5); (3) **PWA install** (web manifest + minimal offline shell +
  iOS "Add to Home Screen" helper, since `beforeinstallprompt` is unsupported on iOS); (4)
  **loading & error states** (route-level skeletons + error boundaries, embedding-fallback already
  shipped in Phase 1).
- **North star (unchanged):** keep the discovery, kill the rabbit hole. The session limiter is the
  *only* new behavioral mechanic and it exists to **reduce** time-on-app. Watch Later is a finite,
  user-curated list — not an algorithmic queue, not autoplay, not a recommendation surface.
- **Architecture note (carried from Phases 1–2):** all personal state stays in IndexedDB (D3); the
  YouTube key stays server-only; the home feed stays Tier 1∪2 / 15-9-0 / 24-capped. Phase 3 adds
  client modules + one Next.js metadata route (`manifest`) and **no new server data module**.

---

## §1 — Files Added / Modified

| File | Status | Purpose |
|---|---|---|
| `src/lib/watchLater.ts` | **add** | IndexedDB `watchLater` store ops: `addToWatchLater(video)`, `removeFromWatchLater(id)`, `isInWatchLater(id)`, `getWatchLater()`. Stores a **full `Video` snapshot + `addedAt`** so the Watch Later page renders with **0 quota**. Idempotent; degrades silently when storage is unavailable. |
| `src/lib/session.ts` | **add** | Session-limiter logic. **Pure, testable** core: `activeMsInWindow(segments, now, windowMs)`, `shouldPromptBreak(activeMs, cfg)`, `pruneSegments(segments, now, windowMs)`, `mergeSegment(...)`. Plus thin IDB ops: `recordActiveSegment(seg)`, `getSegments()`, `clearExpired(now)`. |
| `src/lib/session-config.ts` | **add** | Single source of session-limit defaults (`DEFAULT_SESSION_CONFIG`), validated by `SessionConfigSchema`. One place to tune the 30-min / 4-h policy. |
| `src/lib/watchState.ts` | **modify** | IndexedDB **v3**: add `watchLater` and `session` stores in `onupgradeneeded` (the single DB-schema source). **Export `openDB` and `tx`** so `watchLater.ts`/`session.ts` reuse one DB-open path. Migration additive + idempotent (every `createObjectStore` guarded by `contains`). No rewrite of `watchState`/`impressions`. |
| `src/lib/types.ts` | **modify** | Add `WatchLaterEntrySchema` (= `VideoSchema` + `addedAt`), `SessionSegmentSchema`, `SessionConfigSchema`, and inferred types (§3). |
| `src/components/WatchLaterButton.tsx` | **add** | Toggle (save / remove) used on the watch page and optionally on cards. Reads/writes `watchLater.ts`; reflects current membership; accessible (`aria-pressed`). |
| `src/components/BreakPrompt.tsx` | **add** | Modal shown when the rolling-window active time crosses the limit: a calm "you've been watching for a while — take a break" with a *dismiss* (snooze) and a *go home* action. No countdown-to-resume, no urgency cue. |
| `src/components/SessionGuard.tsx` | **add** | Client wrapper mounted once in `layout.tsx`. Polls the session window on an interval, renders `BreakPrompt` when `shouldPromptBreak` is true, snoozes on dismiss. Houses **no** playback logic itself (that lives in `WatchPlayer`). |
| `src/components/InstallPrompt.tsx` | **add** | PWA install affordance: captures `beforeinstallprompt` (Android/Chromium) for a one-tap install; on iOS/Safari (no `beforeinstallprompt`) shows the manual "Add to Home Screen" helper modal (PRD §9 / context.md §9). |
| `src/components/Skeleton.tsx` | **add** | Presentational skeleton blocks (card grid, watch, channel header) for the loading states. |
| `src/app/watch-later/page.tsx` | **add** | Watch Later surface: a client page that reads the `watchLater` store and renders a finite grid (reusing `VideoPreviewCard` + `CaughtUpBlocker`). Empty-state message. **No API call.** |
| `src/app/manifest.ts` | **add** | Next.js `MetadataRoute.Manifest` → `/manifest.webmanifest` (`display: standalone`, theme `#09090b`, icons, name/short_name). |
| `src/app/loading.tsx` | **add** | Home route loading skeleton. |
| `src/app/channel/[channelId]/loading.tsx` | **add** | Channel route loading skeleton. |
| `src/app/watch/[videoId]/loading.tsx` | **add** | Watch route loading skeleton. |
| `src/app/error.tsx` | **add** | Top-level client error boundary (reset button; never a blank screen). |
| `src/components/WatchPlayer.tsx` | **modify** | Wire `onStateChange` to record **active-playback segments** for the limiter (PLAYING starts a segment; PAUSED/ENDED/BUFFERING closes it). Reaffirm the invariant: **`onEnded` does nothing — no autoplay-next.** No change to `PLAYER_VARS`. |
| `src/components/VideoPreviewCard.tsx` | **modify (optional)** | Add a small hover/secondary Watch Later toggle. If included, it must not alter the existing visited de-emphasis, layout, or click target. |
| `src/app/layout.tsx` | **modify** | `metadata.manifest = "/manifest.webmanifest"`; mount `<SessionGuard />` + `<InstallPrompt />`; add a header link to `/watch-later`. Apple PWA meta (`apple-mobile-web-app-capable`, status-bar style) via `metadata`/`appleWebApp`. |
| `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png` | **add** | PWA / home-screen icons referenced by the manifest and Apple meta. |
| `src/sw.ts` → `public/sw.js` *(or `public/sw.js` direct)* | **add (minimal)** | Hand-written service worker: cache the app shell + static assets (cache-first for static, network-first for navigations). **Never caches Data API responses or the player.** Registered from `InstallPrompt`/a small client effect. |
| `test/session.test.ts` | **add** | Unit coverage for the pure session math: window summation, prune, merge, threshold crossing (acceptance §8). |
| `test/watchLater.test.ts` | **add (optional)** | Store round-trip under `fake-indexeddb`, if that dev dep is added; otherwise the store stays integration-verified (as in Phases 1–2). |
| `vitest.config.ts` | **modify** | Add `src/lib/session.ts` and `src/lib/session-config.ts` to the coverage `include`. |

> **No change to `youtube.ts` / `rss.ts` / `data.ts` / `quota.ts` / `feed.ts` / `ranking.ts`.** Phase 3
> adds no server fetch and no ranking change. **Zero additional YouTube Data API quota.**

---

## §2 — npm Dependencies (additions)

| Package | State | Use |
|---|---|---|
| — | **none (runtime)** | PWA is a hand-written manifest (`app/manifest.ts`) + a minimal service worker; no `next-pwa`/Workbox. Watch Later & session limiter are pure logic + IndexedDB. |
| `fake-indexeddb` | **add (devDependency, optional)** | Only if `test/watchLater.test.ts` / a session-store test exercises the real IDB layer under vitest's node env. Not required if those stores stay integration-verified. |

> Keeping runtime deps at zero (consistent with Phases 1–2) avoids a Workbox build step and keeps the
> service worker auditable — important for the "no recommendation/engagement code sneaks in" mandate.

---

## §3 — Data Types / Zod Schemas (new for this phase)

```ts
import { z } from "zod";
import { VideoSchema } from "./types"; // already defined Phase 1

// --- Watch Later (IndexedDB; full snapshot so the page renders at 0 quota) ---
export const WatchLaterEntrySchema = VideoSchema.extend({
  addedAt: z.string(), // ISO timestamp the user saved it
});
export type WatchLaterEntry = z.infer<typeof WatchLaterEntrySchema>;

// --- Session limiter: an active-playback segment (rolling-window input) ---
export const SessionSegmentSchema = z.object({
  startedAt: z.string(),                 // ISO; keyPath in the `session` store
  endedAt: z.string().nullable(),        // null while a segment is open (currently playing)
  activeMs: z.number().int().nonnegative(), // accumulated active ms for this segment
  videoId: z.string(),
});
export type SessionSegment = z.infer<typeof SessionSegmentSchema>;

// --- Session-limit policy (validated; one source of tunable defaults) ---
export const SessionConfigSchema = z.object({
  activeLimitMinutes: z.number().positive().default(30),   // PRD §6 / context.md §5
  rollingWindowHours: z.number().positive().default(4),    // PRD §6 / context.md §5
  snoozeMinutes: z.number().positive().default(10),        // re-prompt cadence after a dismiss
  pollSeconds: z.number().positive().default(30),          // SessionGuard tick
});
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
```

> The `watchLater` snapshot is the only place a `Video` is persisted client-side; it is **read back
> for display only** and is not an external-API boundary. The Phase 1 `WatchStateSchema` and Phase 2
> `ImpressionStateSchema` are unchanged.

---

## §4 — Server Module / Route Signatures (new for this phase)

No new server *data* modules or API routes. Phase 3 is client state + one **metadata route**:

```ts
// src/app/manifest.ts — Next.js MetadataRoute (static, no quota, no key)
export default function manifest(): MetadataRoute.Manifest // name, short_name, display:"standalone",
                                                           // background/theme #09090b, icons[192,512]

// src/lib/watchLater.ts (client-only)
addToWatchLater(video: Video): Promise<void>          // put({ ...video, addedAt }) — idempotent
removeFromWatchLater(videoId: string): Promise<void>
isInWatchLater(videoId: string): Promise<boolean>
getWatchLater(): Promise<WatchLaterEntry[]>           // newest-saved first

// src/lib/session.ts (PURE core — the Phase 3 unit-test surface)
activeMsInWindow(segments: SessionSegment[], now: number, windowMs: number): number
pruneSegments(segments: SessionSegment[], now: number, windowMs: number): SessionSegment[]
shouldPromptBreak(activeMs: number, cfg: SessionConfig): boolean
mergeSegment(open: SessionSegment | null, now: number, videoId: string, playing: boolean): SessionSegment | null
// session IDB ops (thin)
recordActiveSegment(seg: SessionSegment): Promise<void> // put on keyPath startedAt
getSegments(): Promise<SessionSegment[]>
clearExpired(now: number): Promise<void>                // delete segments fully outside the window

// src/lib/watchState.ts (modified): export the shared DB primitives
export function openDB(): Promise<IDBDatabase>          // now DB_VERSION = 3
export function tx<T>(store, mode, fn): Promise<T>
```

---

## §5 — IndexedDB Schema / Versioning

**DB `curatedtube`, version 2 → 3.** Migration is additive and safe from a fresh state.

```
onupgradeneeded(oldVersion -> 3):
  if (!stores.contains("watchState"))  createObjectStore("watchState",  { keyPath: "videoId" })   // v1
  if (!stores.contains("impressions")) createObjectStore("impressions", { keyPath: "videoId" })   // v2
  if (!stores.contains("watchLater"))  createObjectStore("watchLater",  { keyPath: "videoId" })   // v3 NEW
  if (!stores.contains("session"))     createObjectStore("session",     { keyPath: "startedAt" }) // v3 NEW
```

- **`watchLater`** (v3, new): `{ ...Video, addedAt }` — user-curated saves; full snapshot → 0 quota
  to render. Keyed by `videoId` (re-saving is an idempotent `put`).
- **`session`** (v3, new): `{ startedAt, endedAt, activeMs, videoId }` — active-playback segments for
  the rolling-window limiter. Keyed by `startedAt`. `clearExpired` prunes segments fully older than
  the window so the store stays bounded.
- **Migration safety:** a fresh install opens at v3 and creates all four stores; a v1/v2 install gains
  only the missing stores (no rewrite of existing data, no destructive change). Every
  `createObjectStore` is guarded by a `contains` check, so re-running is a no-op and the bump is safe
  regardless of the user's starting version (1, 2, or 3).
- **No quota counter in IndexedDB** (it remains the server-side in-memory counter from Phase 1).

---

## §6 — Implementation Logic Flow (function-by-function)

### Watch Later (`watchLater.ts`)
```
addToWatchLater(v):    put({ ...v, addedAt: new Date().toISOString() }) into `watchLater`
removeFromWatchLater:  delete(videoId)
isInWatchLater:        (get(videoId)) !== undefined
getWatchLater:         getAll() -> sort by addedAt DESC   // newest saved first; finite list
```
> Snapshot-on-save means the Watch Later page never calls the Data API. A removed-from-YouTube video
> still shows its saved snapshot; clicking through to watch surfaces the Phase 1 embed fallback if it
> is gone — no blank player, no crash.

### Session limiter — pure core (`session.ts`)
```
activeMsInWindow(segments, now, windowMs):
  cutoff = now - windowMs
  sum = 0
  for s in segments:
    end   = s.endedAt ? Date.parse(s.endedAt) : now      # open segment counts up to now
    start = max(Date.parse(s.startedAt), cutoff)          # clip to the window
    if end > start: sum += min(end, now) - start
  return sum

pruneSegments(segments, now, windowMs):
  return segments.filter(s => (s.endedAt ? Date.parse(s.endedAt) : now) >= now - windowMs)

shouldPromptBreak(activeMs, cfg):
  return activeMs >= cfg.activeLimitMinutes * 60_000

mergeSegment(open, now, videoId, playing):
  # PLAYING with no open segment -> open one; PLAYING continuing -> extend activeMs/endedAt=null;
  # not playing -> close the open segment (endedAt=now) and return it for persistence; else null
```

### `WatchPlayer.tsx` (modified) — segment recording, still no autoplay
```
onStateChange(e):
  playing = (e.data === 1 /* PLAYING */)
  seg = mergeSegment(openSegRef.current, Date.now(), videoId, playing)
  openSegRef.current = playing ? seg : null
  if seg: void recordActiveSegment(seg)            # persist; SessionGuard reads it
onError: unchanged (101/150/153 -> link fallback)
# ENDED (e.data === 0): close the segment and DO NOTHING ELSE. No next-video load. (invariant)
PLAYER_VARS: unchanged (rel:0 same-channel, no autoplay param)
```

### `SessionGuard.tsx` (mounted in layout)
```
on mount: register setInterval(cfg.pollSeconds) :
  segs   = await getSegments()
  active = activeMsInWindow(segs, Date.now(), cfg.rollingWindowHours*3_600_000)
  if shouldPromptBreak(active) AND not snoozed: setShowPrompt(true)
  void clearExpired(Date.now())                    # keep the store bounded
BreakPrompt actions: "Dismiss" -> snooze for cfg.snoozeMinutes; "Go home" -> router.push("/")
# The interval is the ONLY timer; it reads state, it never advances playback.
```

### PWA (`manifest.ts`, `InstallPrompt.tsx`, `sw.js`)
```
manifest.ts: { name:"CuratedTube", short_name:"CuratedTube", display:"standalone",
               background_color/theme_color:"#09090b", icons:[192,512] }
InstallPrompt:
  window 'beforeinstallprompt' -> capture event, show "Install" button -> prompt() on click
  iOS (no beforeinstallprompt, navigator.standalone === false): show "Add to Home Screen" helper modal
  on mount: if 'serviceWorker' in navigator -> register('/sw.js')   # progressive; failure is non-fatal
sw.js:
  install: precache app shell (/, /watch-later, offline fallback, static chunks)
  fetch:   navigations -> network-first w/ cached shell fallback; static -> cache-first
           NEVER intercept googleapis.com (Data API) or youtube.com (player/iframe)
```

### Loading & error states
```
app/loading.tsx, channel/.../loading.tsx, watch/.../loading.tsx:  render <Skeleton variant=...>
app/error.tsx:  'use client'; show a calm message + reset() button (no blank screen)
# Phase 1 embedding fallback (WatchPlayer onError) already covers the player error path.
```

---

## §7 — Cross-Phase Integration Requirements

- **Tier model & ranking untouched.** No change to `feed.ts`/`ranking.ts`/`data.ts`. The home feed
  stays Tier 1∪2 / 15-9-0 / 24-capped / caught-up. Watch Later is a **separate** finite surface and
  is **never** mixed into the home ranker or backfill.
- **Zero new quota.** Watch Later renders from the IndexedDB snapshot; session + PWA are client-only.
  `/api/quota` semantics and the daily budget are unaffected (0 added units). The cold-start /
  maintenance budget from PRD §7 is unchanged.
- **Server-side key preserved.** No Phase 3 code reads `process.env.YOUTUBE_API_KEY` on the client;
  `manifest.ts` and the service worker contain no secrets and never proxy the Data API.
- **IndexedDB migration is monotonic.** v1→v3 and v2→v3 both only *add* stores; `markVisited`,
  `getVisitedSet`, `recordImpressions`, `getImpressionMap` (Phases 1–2) keep working across the bump.
  The shared `openDB`/`tx` must remain the single DB-open path (no second `indexedDB.open` with a
  different version anywhere).
- **No autoplay regression.** The `WatchPlayer` `onStateChange` wiring records segments only; the
  ENDED branch must remain a no-op. A test/code review must confirm no `loadVideoById`/`playVideo`
  chaining was introduced.
- **Determinism in tests.** Session math takes `now` as a parameter (no internal clock reads), exactly
  like the Phase 2 ranker, so `session.test.ts` is fully deterministic.
- **Config single-source.** All session constants come from `DEFAULT_SESSION_CONFIG`
  (`session-config.ts`), validated by `SessionConfigSchema`; no magic numbers in `session.ts`.
- **Existing suites green.** All Phase 1 + Phase 2 tests (75) must still pass unmodified.

---

## §8 — Phase Acceptance Criteria

1. **Watch Later round-trip:** `addToWatchLater(v)` then `getWatchLater()` returns `v` with `addedAt`,
   newest-first; `removeFromWatchLater` removes it; `isInWatchLater` reflects state. The
   `/watch-later` page renders the saved grid (finite, ends in `CaughtUpBlocker`) and makes **no Data
   API call** (verified: no network to `googleapis.com` on that route).
2. **Zero quota:** loading `/watch-later` and using the session limiter add **0** units to the quota
   counter; `youtube.ts`/`data.ts`/`quota.ts` are untouched in the diff.
3. **Session math:** `activeMsInWindow` correctly sums active playback clipped to the rolling window
   (including an open, still-playing segment up to `now`); `pruneSegments` drops fully-expired
   segments; `shouldPromptBreak` flips exactly at `activeLimitMinutes`. All verified by unit tests
   crossing the boundary; `session.ts` coverage ≥ 80%.
4. **Break prompt:** after >30 min active playback in a rolling 4h window, `BreakPrompt` renders;
   "Dismiss" snoozes for `snoozeMinutes`; "Go home" navigates to `/`. The prompt has **no** resume
   countdown, urgency cue, or streak/engagement copy.
5. **No autoplay:** the player never advances to another video on ENDED; `PLAYER_VARS` is byte-for-byte
   the Phase 1 set; the same-channel rail and embed fallback are unchanged.
6. **IndexedDB v3** migrates additively from v1 **and** v2 (adds `watchLater` + `session`, preserves
   `watchState` + `impressions`), idempotent from a fresh state; the shared `openDB`/`tx` is the only
   DB-open path.
7. **PWA installable:** `/manifest.webmanifest` is served with `display:"standalone"`, valid icons,
   and theme color; Android/Chromium shows the install affordance via `beforeinstallprompt`; iOS shows
   the "Add to Home Screen" helper. The service worker registers, caches the app shell, and **never**
   intercepts Data API or player requests. (iOS storage limits remain the PRD §10 [VERIFY] item —
   noted, non-blocking.)
8. **Loading & error states:** each route shows a skeleton while its server data resolves; an uncaught
   render error shows `error.tsx` with a working reset — never a blank screen.
9. **Responsive pass:** Home / Channel / Watch / Watch-Later are usable at mobile (1-col), tablet, and
   desktop breakpoints; the sticky header, grids, and modals reflow without overflow or clipped tap
   targets.
10. **Guardrails unchanged:** home still ≤24 with the caught-up terminator, no infinite scroll, no
    cross-channel rail, no Shorts/comments/search/notifications/trending. No metric optimizes for
    time-on-app (the only new behavioral mechanic *reduces* it).
11. **Gates:** `tsc --noEmit` clean; `session.ts` unit coverage ≥ 80%; full suite (Phase 1 + 2 + 3)
    green; `next build` green.

---

## §9 — Explicit Non-Goals

- **No autoplay / no queue.** Watch Later is a saved list the user opens deliberately — not an
  auto-advancing playlist, not a "play all," not a recommendation queue.
- **No new YouTube Data API usage.** Watch Later renders from the IndexedDB snapshot; session and PWA
  are client-only. 0 added quota. (Quota *instrumentation hardening* and the UULF→UU fallback drill
  are **Phase 4**, PRD §8.)
- **No engagement mechanics.** The session limiter only *discourages* over-use; there are no streaks,
  no "you watched X today" gamification, no notifications/badges/trending, no cross-channel rail.
- **No accounts / no sync.** Watch Later and session history are device-local IndexedDB (D3). No login,
  no cloud profile, no multi-device merge.
- **No background sync / push.** The service worker is an offline **shell cache only** — it does not
  pre-fetch feeds, does not run periodic sync, and does not register push notifications.
- **No Tier-3 leakage.** Nothing in Phase 3 surfaces Entertainment/parked channels on home; Watch
  Later contains only what the user explicitly saved (which can only come from Tier 1∪2 home/channel
  surfaces and same-channel rails — never an algorithmic injection).
- **No deploy.** Production deployment, env hardening, and the quota fallback drill are **Phase 4**.
