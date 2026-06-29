# CuratedTube — Channel Roster Validation Report

**Scope:** full canonical roster (root `channels.json`).
**Method:** `resolve:true` handles resolved yt-dlp-first (0 quota) with a `channels.list?forHandle`
fallback (1 unit); `uploadsPlaylistId` derived `UC → UULF` (long-form) and verified via the
zero-quota RSS feed (`feeds/videos.xml?playlist_id=…`), falling back to `UU` when UULF is empty.
Enrichment (`title`/`avatarUrl`/`subscriberCount`) via `channels.list?part=snippet,statistics`.
Already-verified `UC…` ids were preserved byte-for-byte (never re-resolved). **No id was ever fabricated.**

> **Approx. Data API quota used: 2 units.**

---

## Roster totals

| Metric | Count |
|---|---|
| Total entries | 89 |
| Resolved (real UC… id) | 89 |
| UNRESOLVED (resolution failed) | 0 |
| Tier 1 (Beneficial) | 21 |
| Tier 2 (Educational) | 50 |
| Tier 3 (Entertainment, channel-page only) | 14 |
| Parked (tier null) | 4 |
| UULF → UU fallbacks | 0 |
| Shorts-only / empty | 0 |
| Needs human confirm | 17 |

## UNRESOLVED (no id fabricated — fix the handle or remove)
_none_

## Parked (tier: null — resolved/stored but excluded from all feeds until classified)
- `@monium` (UCxULzGyhtIUotnMIM4G4-rw)
- `@Tomographic` (UCOt5hVyS2-nbcJ3_FP41Ajg)
- `@LitNomad` (UCjbUKFFbH0JYU94ONGDeM-A)
- `@leonjhendrix` (UCTvRcHO5jJ_JKcekLacLMuQ)

## Shorts-only / empty (excluded from active feed)
_none_

## UULF → UU fallbacks used
_none_

## Needs human confirmation (tier/category)
- `@muhasisay9712` — category "Islamic", tier 1
- `@VoicesForGaza` — category "Islamic/Cause", tier 1
- `@monium` — category "UNCONFIRMED", tier null
- `@memlabs-research` — category "AI-ML", tier 2
- `@SamuelBoschMIT` — category "AI-ML", tier 2
- `@borismeinardus` — category "AI-ML/Career", tier 2
- `@HybridCalisthenics` — category "Fitness", tier 2
- `@NoelDeyzel` — category "Fitness", tier 2
- `@SchoolOfScent` — category "Hobby-Fragrance", tier 2
- `@DocuDubery` — category "Documentary", tier 2
- `@Tomographic` — category "UNCONFIRMED", tier null
- `@LitNomad` — category "UNCONFIRMED", tier null
- `@zephfire_16` — category "Entertainment", tier 3
- `@Saintdon1` — category "Entertainment", tier 3
- `@ChrisKohlerNews` — category "Gaming-News", tier 3
- `@leonjhendrix` — category "UNCONFIRMED", tier null
- `@actuallycarterpcs` — category "Coding-Tech", tier 3

## Duplicates
_none_
