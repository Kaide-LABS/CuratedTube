# CuratedTube — Channel Roster Validation Report

**Scope of this report:** the 4 channels added in commit `feat: add 4 channels …`.
**Method:** channelIds were provided pre-verified (not re-resolved). `uploadsPlaylistId` derived
`UC → UULF` (long-form only). UULF verified via the **zero-quota RSS feed**
(`feeds/videos.xml?playlist_id=UULF…`) because no `YOUTUBE_API_KEY` is present in this environment;
this confirms the playlist exists and returns long-form items. `title` read from the channel RSS feed.

> **Quota used: 0 units.** No Data API calls (`playlistItems.list` / `channels.list`) were made —
> RSS substituted for playlist verification. `playlistItems.list` verification and full
> `channels.list` enrichment (avatar, subscriber count) remain pending an API key (see below).

---

## Additions (4)

| Handle | channelId | uploadsPlaylistId (UULF) | Category | Tier | UULF status | Title (RSS) |
|---|---|---|---|---|---|---|
| @DarFawaaid | UCo_RPqYFFTaTl_0Ojg-e8Bg | UULFo_RPqYFFTaTl_0Ojg-e8Bg | Islamic | 1 | ✅ 200, ≥8 long-form items | Dar al-Fawāid |
| @neurotrader888 | UCSh87zxGNu8q8iOInRK6E9w | UULFSh87zxGNu8q8iOInRK6E9w | Finance-Quant | 2 | ✅ 200, ≥15 long-form items | neurotrader |
| @JefBayless | UClClejjYjZyO38piuXhAFZw | UULFlClejjYjZyO38piuXhAFZw | Sports | 3 | ✅ 200, ≥15 long-form items | Jef |
| @actuallycarterpcs | UCi7wDE2ZTiR5QYYrUY5WhtA | UULFi7wDE2ZTiR5QYYrUY5WhtA | Coding-Tech | 3 | ✅ 200, ≥15 long-form items | CarterPCs |

> RSS returns at most 15 entries, so "≥15" means the feed was full — the playlist has at least that
> many long-form videos. None fell back to `UU`; no `/shorts/` filtering required.

## Flags

- **@actuallycarterpcs (SPECIAL — Shorts-first, "4× a day"):** the long-form **UULF feed is NOT
  sparse** — it returned a full page (≥15 long-form items), so UULF correctly isolates this
  channel's long-form output and excludes its Shorts at the data layer. **Not a removal candidate
  on UULF grounds.** It still carries `confirm: true` — **tier (currently 3) is pending human
  review**, unchanged by this verification. A precise long-form count needs `playlistItems.list`
  (pending key); RSS already proves it is well above "near-empty."
- **No UNRESOLVED entries** in this batch (all 4 channelIds were provided and verified).
- **No dead / renamed channels** detected (all RSS endpoints returned HTTP 200).
- **No UULF → UU fallbacks** used.
- **No Shorts-only / empty** channels in this batch.
- **No duplicates** introduced (handles/channelIds not already present in the roster).

## Pending (blocked on `YOUTUBE_API_KEY`)

- `avatarUrl` and `subscriberCount` for all 4 — require `channels.list?part=snippet,statistics`.
  **Not fabricated.** Run the enrichment step once a key is set:
  `YOUTUBE_API_KEY=… npm run resolve-channels` (enrich pass).
- `playlistItems.list` exact long-form item counts (RSS gives presence + a 15-item ceiling only).

## Roster meta

- `_meta.verifiedCount`: **27 → 31**.
- Total entries in `channels[]`: **88** (84 prior + 4 added).
