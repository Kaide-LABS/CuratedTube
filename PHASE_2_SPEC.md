# CuratedTube — PHASE_2_SPEC.md

**Artifact:** Phase 2 technical blueprint (build/QA-template structure). Derived from `CuratedTube_PRD.md §6` (Focus Feed Spec) + §1 D1, `CuratedTube_context.md §5` (ranking math, ratified below), and the Phase 1 data layer now shipping on `main`.
**Companion docs:** `CuratedTube_PRD.md`, `CuratedTube_context.md`, `PHASE_1_SPEC.md`, `VALIDATION_REPORT.md`.

> This document *specifies* Phase 2. It does not build it. Phase 2 is **additive weighting on the
> Phase 1 feed component** (Decision D1): the same `buildHomeFeed`, now ranked instead of
> newest-first. The tier model, the 24-cap, and every non-negotiable from Phase 1 are preserved
> verbatim — ranking operates *inside* each tier's slot budget, never across it.

---

## §0 — Phase Plan Header

- **Phase:** **Phase 2 of 4** — Focus Feed Ranking.
- **Goal:** Replace the Phase 1 cold-start reduction (newest-first within tier slots) with the full
  Focus Feed ranking: gravity-decayed popularity (S₁), the watched-penalty (P_seen), a freshness
  window, per-tier category balancing, back-catalogue injection, and anti-repetition — all tunable,
  all additive, with the 15/9/0 tier split and the 24-item caught-up feed intact.
- **North star (unchanged):** keep the discovery, kill the rabbit hole. **No ranking term may have
  time-on-app as its primary effect.** Every signal here either surfaces *quality* (popularity,
  freshness) or *protects discovery* (category balance, anti-repetition, back-catalogue) — none
  reward longer sessions.
- **Architecture note (carried from Phase 1):** the server (`data.ts`) returns an enriched,
  newest-first **pool** (≤150) to the client; the client (`HomeFeed.tsx`) builds the 24-item view.
  Ranking signals P_seen and anti-repetition live in **IndexedDB (client-only)**, so the full
  ranker runs **client-side**, fed by the same pool. No new server data fetch is required.

---

## §0.5 — Citation Re-Verification Gate

**Status: PASSED** (Phase 1→2 boundary gate; executed 2026-06-30).

The only load-bearing external citations in the build are the Focus Feed ranking formulas in
`CuratedTube_context.md §5`, which were *reconstructed by Claude* ("Gemini's originals did not
survive the paste"). This gate re-verified that the reconstructed methods are supported — not
contradicted — by the literature before committing them to a build spec.

**Query trail (arXiv API + canonical industry sources):**

| # | Method under test | Query | Representative evidence |
|---|---|---|---|
| 1 | Gravity / time-decay popularity (Formula 1 denominator) | "Hacker News ranking gravity (votes-1)/(age+2)^1.8" | **Score = (P−1)/(T+2)^G, G≈1.8** — canonical HN formula. Salihefendic, *How Hacker News ranking works* (Medium); Shirriff, *How Hacker News ranking really works* (righto.com, 2013). |
| 2 | Recency / exponential decay (Formula 2 `decay(T)`) | `all:recency AND all:decay AND all:recommendation` | arXiv 2606.03718 *MARS: Multi-rate Aggregation of Recency Signals* (2026); arXiv 1808.00076 *News Session-Based Recommendations* (2018). |
| 3 | Category-balanced / calibrated selection (`C_cat`) | `all:calibrated AND all:recommendation`; `all:diversity AND all:re-ranking AND all:recommendation` | arXiv 2408.02156 *Calibration-Disentangled Learning & Relevance-Prioritized Reranking* (2024); arXiv 2004.06390 *Personalized Re-ranking for Improving Diversity* (2020). Proportional category representation = Steck-style calibrated recommendation. |
| 4 | Exploration for a small closed set (freshness/back-catalogue/anti-repetition) | `all:exploration AND all:bandit AND all:recommendation`; `all:freshness AND all:"cold start"` | arXiv 2304.02572 *Evaluating Online Bandit Exploration in Large-Scale Recommender System* (2023); arXiv 2001.07853 *Incentivising Exploration … Contextual Bandits* (2020); arXiv 2108.09141 *RL to Optimize Lifetime Value in Cold-Start* (2021). |

**Ratified formulas (carried into this spec unchanged in form):**
- **Formula 1 — S₁ (gravity-decayed popularity).** `S₁ = (V^a / (T+2)^g) · C_cat · P_seen`. The
  `(T+2)^g` denominator is the literal Hacker News gravity term; `V^a` with `a<1` matches HN's
  "votes raised to a power less than one." **RATIFIED.**
- **Formula 2 — S₂ (linear component).** `S₂ = (w_pop·norm(V) + w_fresh·decay(T) + w_unwatched·U − w_seen·seen) · C_cat`,
  `decay(T) = exp(−λT)` or `1/(1+T/τ)`. **RATIFIED** as a standard linear utility blend.
- **Category multiplier — `C_cat`.** Anchor the mean category to 1.0; boost under-represented
  categories, damp over-represented ones. **RATIFIED**; recomputed dynamically per active tier
  (see §6) rather than the static 4-category table in §5 (which predates the tier roster).
- **Exploration rules.** Freshness window, back-catalogue injection, anti-repetition. **RATIFIED**
  as exploration-vs-exploitation mechanics.

**Caveat (non-blocking):** the *specific constants* (`a=0.8`, `g=1.5`, `w_pop=0.35`, `λ`, `τ`, the
0.05 seen factor, the 72h/30d windows) are **heuristic** — not pinned to any single paper, and
flagged "tune empirically" in §5 itself. They ship as documented defaults and are the empirical
starting point, not a citation. **S₁ is the Phase 2 default ranker; S₂ is provided behind a flag.**

> **PASS rationale:** every method family is supported by current literature and the canonical HN
> formula; nothing contradicts §5. Per the gate protocol, the build proceeds with the ratified math.

---

## §1 — Files Added / Modified

| File | Status | Purpose |
|---|---|---|
| `src/lib/ranking.ts` | **add** | Pure, deterministic ranking math: `scoreS1`, `scoreS2`, `categoryMultipliers`, `freshnessBoost`, `seenFactor`, `repetitionPenalty`, `decay`. No I/O — fully unit-testable. |
| `src/lib/feed.ts` | **modify** | `buildHomeFeed` gains an optional `RankContext` (watch + impression signals + config). Ranking replaces newest-first *within each tier's slot budget*; the 15/9/0 split, 24-cap, and backfill rules are unchanged. `sortVideos` unchanged. |
| `src/lib/watchState.ts` | **modify** | IndexedDB **v2**: add an `impressions` store (anti-repetition). New `recordImpressions(ids)`, `getImpressionMap()`, and `getWatchSignals()` (visited + watchedSec joined). Migration is additive and idempotent (see §5). |
| `src/lib/types.ts` | **modify** | Add `RankingConfigSchema`, `ImpressionStateSchema`, and the `RankContext` type (§3). |
| `src/components/HomeFeed.tsx` | **modify** | Read watch + impression signals from IndexedDB, call the ranked `buildHomeFeed`, and `recordImpressions` for the videos actually shown (drives anti-repetition next session). Category pills + caught-up unchanged. |
| `src/lib/ranking-config.ts` | **add** | The single source of default weights/windows (`DEFAULT_RANKING_CONFIG`), validated by `RankingConfigSchema`. One place to tune. |
| `test/ranking.test.ts` | **add** | Unit coverage for every pure ranking function + the invariants (seen videos rank below unwatched at equal popularity; fresher ranks higher at equal popularity; Tier 3 never scored into home). |
| `test/feed.test.ts` | **modify** | Extend with ranked-mode cases (S₁ ordering, back-catalogue reservation, anti-repetition demotion) alongside the existing newest-first cases. |
| `test/watchState`* | **add** (optional) | If a fake-IndexedDB harness is added, cover the v2 migration; otherwise the store logic stays integration-verified (as in Phase 1). |

> **No change to `youtube.ts` / `rss.ts` / `data.ts` / `quota.ts`.** Phase 2 consumes the existing
> enriched pool. **Zero additional YouTube Data API quota.**

---

## §2 — npm Dependencies (additions)

| Package | State | Use |
|---|---|---|
| — | **none** | Ranking is pure arithmetic over the existing `Video` pool + IndexedDB signals. No new runtime deps. |
| `fake-indexeddb` | **add (devDependency, optional)** | Only if §1's `test/watchState` coverage of the v2 migration is implemented; lets the IndexedDB layer run under vitest's node env. Not required if the store stays integration-verified. |

---

## §3 — Data Types / Zod Schemas (new for this phase)

```ts
import { z } from "zod";

// --- Ranking configuration (validated; one source of tunable defaults) ---
export const RankingConfigSchema = z.object({
  model: z.enum(["s1", "s2"]).default("s1"),     // S₁ gravity (default) | S₂ linear (flagged)
  // S₁ params
  popularityExponent: z.number().positive().default(0.8),   // a  (V^a, a<1 dampens mega-views)
  gravity: z.number().positive().default(1.5),              // g  ((T+2)^g)
  seenFactor: z.number().min(0).max(1).default(0.05),       // P_seen for watched videos
  // S₂ params (only read when model === "s2")
  wPop: z.number().default(0.35),
  wFresh: z.number().default(0.40),
  wUnwatched: z.number().default(0.20),
  wSeen: z.number().default(0.30),
  decayKind: z.enum(["exp", "reciprocal"]).default("exp"),  // exp(−λT) | 1/(1+T/τ)
  lambda: z.number().positive().default(0.0125),            // per-hour; ~half-life 55h
  tau: z.number().positive().default(48),                   // hours
  // Exploration
  freshnessWindowHours: z.number().nonnegative().default(72),   // < window => bypass seen-penalty + flat boost
  freshnessBoost: z.number().nonnegative().default(1.25),
  backCatalogueFraction: z.number().min(0).max(0.5).default(0.20), // share of slots reserved for >30d unwatched
  backCatalogueMinAgeDays: z.number().nonnegative().default(30),
  repetitionPenaltyPerShow: z.number().min(0).max(1).default(0.15), // multiplicative decay per prior impression
  repetitionFloor: z.number().min(0).max(1).default(0.4),          // penalty never drops below this
});
export type RankingConfig = z.infer<typeof RankingConfigSchema>;

// --- Impression state (IndexedDB v2; anti-repetition signal) ---
export const ImpressionStateSchema = z.object({
  videoId: z.string(),
  shownCount: z.number().int().nonnegative(),  // times surfaced on home but NOT clicked
  lastShownAt: z.string(),                     // ISO timestamp
});
export type ImpressionState = z.infer<typeof ImpressionStateSchema>;

// --- RankContext: everything the client ranker needs beyond the Video pool ---
export type RankContext = {
  now: number;                       // Date.now() captured once per render (stable sort)
  visited: Set<string>;              // videoId -> watched (P_seen)
  impressions: Map<string, ImpressionState>;
  config: RankingConfig;
};
```

> `WatchStateSchema` (Phase 1) is unchanged; `watchedSec`/`visited` already supply P_seen. The new
> `impressions` store is **separate** from `watchState` so a watched video and a merely-shown video
> never collide on one keyPath.

---

## §4 — Server Module / Route Signatures (new for this phase)

No new server modules or routes. Phase 2 is a **client-side ranking layer**; the existing
`getHomeFeed` (server) and `/api/quota` are untouched. New **pure** signatures (`src/lib/ranking.ts`):

```ts
// All pure, deterministic, side-effect-free — the Phase 2 validation surface for unit tests.
decay(ageHours: number, cfg: RankingConfig): number              // exp(−λT) | 1/(1+T/τ) in [0,1]
seenFactor(videoId: string, ctx: RankContext, ageHours: number): number
  // cfg.seenFactor if watched AND older than the freshness window; else 1.0 (fresh bypasses penalty)
freshnessBoost(ageHours: number, cfg: RankingConfig): number     // cfg.freshnessBoost if < window else 1.0
repetitionPenalty(videoId: string, ctx: RankContext): number     // (1−p)^shownCount, floored at cfg.repetitionFloor
categoryMultipliers(videos: Video[]): Map<string, number>        // C_cat = meanPerCategory / nCat, anchored to 1.0
scoreS1(v: Video, ctx: RankContext, cCat: number): number        // (V^a/(T+2)^g)·C_cat·P_seen·fresh·rep
scoreS2(v: Video, ctx: RankContext, cCat: number): number        // linear blend · C_cat · rep
scoreVideo(v: Video, ctx: RankContext, cCat: number): number     // dispatch on cfg.model

// src/lib/feed.ts (modified signature — back-compatible: omit ctx => Phase 1 newest-first)
buildHomeFeed(videos: Video[], slots?: TierSlots, cap?: number, ctx?: RankContext): Video[]

// src/lib/watchState.ts (new client-only)
recordImpressions(videoIds: string[]): Promise<void>   // increment shownCount, set lastShownAt; idempotent per render via a session guard
getImpressionMap(): Promise<Map<string, ImpressionState>>
getWatchSignals(): Promise<{ visited: Set<string> }>   // convenience join used by HomeFeed
```

---

## §5 — IndexedDB Schema / Versioning

**DB `curatedtube`, version 1 → 2.** Migration is additive and safe from a fresh state.

```
onupgradeneeded(oldVersion -> 2):
  if (!stores.contains("watchState"))  createObjectStore("watchState",  { keyPath: "videoId" })  // v1, unchanged
  if (!stores.contains("impressions")) createObjectStore("impressions", { keyPath: "videoId" })  // v2, NEW
```

- **`watchState`** (v1, unchanged): `{ videoId, visited, watchedSec, lastSeenAt }` — supplies P_seen.
- **`impressions`** (v2, new): `{ videoId, shownCount, lastShownAt }` — anti-repetition. Written by
  `recordImpressions` for videos that were *shown on home but not opened*. A click (`markVisited`)
  moves a video into the watched set, where P_seen takes over and the impression penalty is moot.
- **Migration safety:** a fresh install opens at v2 and creates both stores; a v1 install gains only
  `impressions` (no data rewrite, no destructive change). `onupgradeneeded` guards every
  `createObjectStore` with a `contains` check, so re-running is a no-op.
- **No quota counter in IndexedDB** (it stays the server-side in-memory counter from Phase 1).

---

## §6 — Implementation Logic Flow (function-by-function)

### `categoryMultipliers(videos)` — per-tier category balance (`C_cat`)
```
group the candidate videos by category
nCat        = number of distinct categories in the group
meanPerCat  = videos.length / nCat
for each category c:  C_cat[c] = meanPerCat / count(c)      # mean category -> 1.0
return Map<category, C_cat>
```
> Computed **per tier**, over that tier's candidate videos, *before* slotting — so balancing happens
> *inside* a tier's budget and never moves a video across tiers. This supersedes §5's static
> 4-category table (which predated the 89-channel tier roster); the anchor-to-mean rule is identical.

### `decay(ageHours, cfg)`
```
exp:        return Math.exp(-cfg.lambda * ageHours)
reciprocal: return 1 / (1 + ageHours / cfg.tau)
```

### `seenFactor(id, ctx, ageHours)` — P_seen with the freshness bypass
```
if ageHours < cfg.freshnessWindowHours: return 1.0           # fresh uploads always surface
return ctx.visited.has(id) ? cfg.seenFactor : 1.0            # watched & old => heavy damp (~0.05)
```

### `freshnessBoost(ageHours, cfg)`
```
return ageHours < cfg.freshnessWindowHours ? cfg.freshnessBoost : 1.0
```

### `repetitionPenalty(id, ctx)` — anti-repetition
```
shown = ctx.impressions.get(id)?.shownCount ?? 0
return Math.max(cfg.repetitionFloor, (1 - cfg.repetitionPenaltyPerShow) ** shown)
```

### `scoreS1(v, ctx, cCat)` — default ranker
```
T = max(0, (ctx.now - Date.parse(v.publishedAt)) / 3_600_000)   # age hours
V = v.viewCount                                                 # popularity proxy
base = (V ** cfg.popularityExponent) / ((T + 2) ** cfg.gravity) # Hacker-News gravity
return base * cCat * seenFactor(v.videoId,ctx,T) * freshnessBoost(T,cfg) * repetitionPenalty(v.videoId,ctx)
```

### `scoreS2(v, ctx, cCat)` — flagged alternative
```
normV = log1p(V) / log1p(maxV in pool)        # log-normalized popularity
fresh = decay(T, cfg)
U     = ctx.visited.has(id) ? 0 : 1
seen  = ctx.visited.has(id) ? 1 : 0
lin   = wPop*normV + wFresh*fresh + wUnwatched*U - wSeen*seen
return Math.max(0, lin) * cCat * repetitionPenalty(id, ctx)
```

### `buildHomeFeed(videos, slots=15/9/0, cap=24, ctx?)` — ranked composition
```
if ctx is undefined: return Phase-1 newest-first path (UNCHANGED — back-compatible)

for each ACTIVE tier t in [1, 2]:                 # Tier 3 is NEVER scored (0 slots, excluded)
  cand   = videos.filter(tier === t)
  cMap   = categoryMultipliers(cand)
  scored = cand.map(v => ({ v, s: scoreVideo(v, ctx, cMap.get(v.category) ?? 1) }))
            .sort(byScoreDesc, tiebreak: newest)
  budget = slots["tier"+t]
  reserve = round(budget * cfg.backCatalogueFraction)            # ~20% for back-catalogue
  picks  = top (budget - reserve) by score
  back   = highest-score UNWATCHED videos with ageDays > cfg.backCatalogueMinAge,
           not already picked, up to `reserve`                   # exploration: old gems
  chosenForTier = picks ++ back (dedupe)
chosen = chosenForTier(1) ++ chosenForTier(2)

backfill chosen toward `cap` from the newest unused Tier 1|2 videos   # never Tier 3 (Phase 1 rule)
return chosen, capped at `cap`
```
> **Tier invariant preserved:** Tier 3 is filtered out before any scoring; backfill excludes it.
> The ranker only *reorders within* the 15/9 active budget — it can never grant Tier 3 a slot.

### `HomeFeed.tsx` flow
```
on mount:
  [{visited}, impressions] = await Promise.all([getWatchSignals(), getImpressionMap()])
  ctx = { now: Date.now(), visited, impressions, config: DEFAULT_RANKING_CONFIG }
view = selected==="All" ? buildHomeFeed(pool, DEFAULT_TIER_SLOTS, 24, ctx)
                        : sortVideos(pool.filter(category===selected), "latest").slice(0,24)
after first paint of an "All" view:
  recordImpressions(view.map(v => v.videoId))      # once per render; a clicked card becomes visited, not a repeat impression
```

---

## §7 — Cross-Phase Integration Requirements

- **Tier model is supreme over ranking.** `buildHomeFeed` still allocates 15 Tier 1 / 9 Tier 2 / 0
  Tier 3 and backfills only from active tiers. Ranking reorders *within* a tier budget; it must never
  change the tier split or surface a Tier 3 video. The Phase 1 `feed.test.ts` tier invariants must
  still pass unmodified.
- **Back-compatibility.** `buildHomeFeed(pool)` with no `ctx` returns the exact Phase 1 newest-first
  result. Channel pages (`sortVideos`) and the watch rail are untouched.
- **Zero new quota.** Phase 2 adds no YouTube Data API calls; the quota counter and budget are
  unaffected. `/api/quota` semantics unchanged.
- **IndexedDB migration.** v1 installs upgrade to v2 by *adding* the `impressions` store only — no
  rewrite of `watchState`. The Phase 1 `markVisited`/`getVisitedSet` keep working through the bump.
- **Server pool sizing.** The ranker needs enough candidates to rank and to find >30d back-catalogue
  items; `data.ts` `HOME_POOL_CAP` (150) and `RSS_PER_CHANNEL` (12) stay, but the back-catalogue
  reserve degrades gracefully to "fewer than reserve" when the pool lacks old unwatched items
  (slots backfill from active tiers — never Tier 3).
- **Config single-source.** All weights/windows come from `DEFAULT_RANKING_CONFIG`
  (`ranking-config.ts`), validated by `RankingConfigSchema`. No magic numbers inside `ranking.ts`.
- **Determinism.** `ctx.now` is captured once per render so the score order is stable within a paint
  (no mid-sort clock drift).

---

## §8 — Phase Acceptance Criteria

1. **S₁ default ranker** ranks the home "All" view by `(V^a/(T+2)^g)·C_cat·P_seen·fresh·rep`; with
   `ctx` omitted, `buildHomeFeed` is byte-for-byte the Phase 1 newest-first result (back-compat test).
2. **Tier split intact:** ranked output still honors 15/9/0, never surfaces Tier 3, and backfills
   only from Tiers 1–2 — all existing `feed.test.ts` tier invariants pass unchanged.
3. **P_seen:** at equal popularity and age (outside the freshness window), an unwatched video ranks
   strictly above a watched one (factor ≈ `seenFactor`).
4. **Freshness window:** a video newer than `freshnessWindowHours` bypasses the seen-penalty and
   receives `freshnessBoost`; verified by a unit test crossing the window boundary.
5. **Category balance:** within a tier, `C_cat = meanPerCat/nCat` is applied so an over-represented
   category cannot monopolize the tier's slots; a single-category flood is demonstrably damped.
6. **Back-catalogue injection:** ~`backCatalogueFraction` of each active tier's slots are reserved
   for high-score unwatched videos older than `backCatalogueMinAgeDays`, and gracefully yields to
   backfill when none exist.
7. **Anti-repetition:** a video with prior `shownCount > 0` (shown, not clicked) is demoted by
   `(1−p)^shownCount` (floored), and a clicked video — now in `watchState` — is governed by P_seen,
   not the impression penalty.
8. **IndexedDB v2** migrates additively from v1 (adds `impressions`, preserves `watchState`),
   idempotent from a fresh state; `recordImpressions`/`getImpressionMap` round-trip.
9. **Guardrails unchanged:** ≤24 items, no infinite scroll, caught-up terminator, no autoplay, no
   cross-channel rail, no new time-on-app metric. Quota unaffected (0 new units).
10. **Gates:** `tsc --noEmit` clean; `ranking.ts` unit coverage ≥ 80% (all functions pure); full
    suite green; `next build` green.

---

## §9 — Explicit Non-Goals

- **No new YouTube Data API usage.** Ranking is computed over the Phase 1 pool; 0 added quota.
- **No server-side ranking.** P_seen and impressions are client-only (IndexedDB), so the ranker is
  client-side. No personal signal leaves the device; no backend, no accounts (D3).
- **No Tier 3 in the home ranker.** Tier 3 is filtered before scoring and excluded from backfill —
  it remains channel-page-only. Parked (`tier:null`) channels stay excluded entirely.
- **No infinite scroll / no "load more" on home.** The ranked feed is still finite at 24 and ends in
  `CaughtUpBlocker`. Ranking changes order, never quantity.
- **No engagement mechanics.** No autoplay-next, no cross-channel recommendation rail, no
  notifications/badges/trending, no session-length optimization. The session limiter and watch-later
  are **Phase 3** (PRD §8), not here.
- **No ML model / training / external recommender.** The ranker is transparent arithmetic over
  public stats + local watch state — auditable, not a black box.
- **Constants are not re-derived from papers.** The ratified *methods* are load-bearing; the specific
  weights ship as documented empirical defaults (§0.5 caveat) and are tuned by changing
  `DEFAULT_RANKING_CONFIG`, not by adding citations.
