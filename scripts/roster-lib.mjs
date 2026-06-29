// Pure, side-effect-free helpers for the channel roster pipeline (PHASE_1_SPEC §6).
// Isolated from network/yt-dlp/API I/O so they can be unit-tested deterministically.
// Imported by both resolve-channels.mjs (the runner) and the test suite.

/** UC<suffix> -> UULF<suffix> (long-form, D2) | UU<suffix> (full-uploads fallback). */
export function uploadsFromChannelId(channelId, useUU = false) {
  if (!channelId || !channelId.startsWith("UC")) {
    throw new Error(`Expected a UC… channel id, got "${channelId}"`);
  }
  const suffix = channelId.slice(2);
  return (useUU ? "UU" : "UULF") + suffix;
}

/**
 * Map a roster handle to its canonical YouTube channel URL.
 * "@x"        -> https://www.youtube.com/@x
 * "coldfusion" (legacy custom URL, NOT an @handle) -> https://www.youtube.com/coldfusion
 */
export function handleToChannelUrl(handle) {
  const h = String(handle).trim();
  if (h.startsWith("@")) return `https://www.youtube.com/${h}`;
  return `https://www.youtube.com/${h}`;
}

/** A channel is already resolved when it carries a real UC… id. Never re-resolve these. */
export function isAlreadyResolved(c) {
  return typeof c.channelId === "string" && /^UC[A-Za-z0-9_-]{22}$/.test(c.channelId);
}

/** Park any unclassified channel (tier === null) — excluded from all feed composition. */
export function applyParking(c) {
  if (c.tier === null) return { ...c, parked: true };
  return c;
}

/** Aggregate roster counts for the validation report. */
export function summarize(channels) {
  const counts = {
    total: channels.length,
    resolved: 0,
    unresolved: 0,
    parked: 0,
    shortsOnlyOrEmpty: 0,
    fellBackToUU: 0,
    needsConfirm: 0,
    byTier: { 1: 0, 2: 0, 3: 0, parked: 0 },
  };
  for (const c of channels) {
    if (isAlreadyResolved(c)) counts.resolved++;
    if (c.unresolved) counts.unresolved++;
    if (c.tier === null || c.parked) counts.parked++;
    if (c.shortsOnlyOrEmpty) counts.shortsOnlyOrEmpty++;
    if (c.fellBackToUU) counts.fellBackToUU++;
    if (c.confirm) counts.needsConfirm++;
    if (c.tier === 1) counts.byTier[1]++;
    else if (c.tier === 2) counts.byTier[2]++;
    else if (c.tier === 3) counts.byTier[3]++;
    else counts.byTier.parked++;
  }
  return counts;
}

/** Find duplicate handles or channelIds across the roster. */
export function findDuplicates(channels) {
  const seenHandle = new Map();
  const seenId = new Map();
  const dupes = [];
  for (const c of channels) {
    const handle = String(c.handle).toLowerCase();
    if (seenHandle.has(handle)) dupes.push({ kind: "handle", value: c.handle });
    else seenHandle.set(handle, true);
    if (c.channelId) {
      if (seenId.has(c.channelId)) dupes.push({ kind: "channelId", value: c.channelId });
      else seenId.set(c.channelId, true);
    }
  }
  return dupes;
}

/** Render the full-roster VALIDATION_REPORT.md (markdown string). */
export function buildValidationReport(channels, { quotaUsed = 0, enriched = false } = {}) {
  const s = summarize(channels);
  const dupes = findDuplicates(channels);
  const unresolved = channels.filter((c) => c.unresolved);
  const parked = channels.filter((c) => c.tier === null || c.parked);
  const shorts = channels.filter((c) => c.shortsOnlyOrEmpty);
  const uu = channels.filter((c) => c.fellBackToUU);
  const confirm = channels.filter((c) => c.confirm);

  const list = (arr, fmt) => (arr.length ? arr.map(fmt).join("\n") : "_none_");

  return `# CuratedTube — Channel Roster Validation Report

**Scope:** full canonical roster (root \`channels.json\`).
**Method:** \`resolve:true\` handles resolved yt-dlp-first (0 quota) with a \`channels.list?forHandle\`
fallback (1 unit); \`uploadsPlaylistId\` derived \`UC → UULF\` (long-form) and verified via the
zero-quota RSS feed (\`feeds/videos.xml?playlist_id=…\`), falling back to \`UU\` when UULF is empty.
${enriched ? "Enrichment (`title`/`avatarUrl`/`subscriberCount`) via `channels.list?part=snippet,statistics`." : "**Enrichment skipped** (no `--enrich`)."}
Already-verified \`UC…\` ids were preserved byte-for-byte (never re-resolved). **No id was ever fabricated.**

> **Approx. Data API quota used: ${quotaUsed} units.**

---

## Roster totals

| Metric | Count |
|---|---|
| Total entries | ${s.total} |
| Resolved (real UC… id) | ${s.resolved} |
| UNRESOLVED (resolution failed) | ${s.unresolved} |
| Tier 1 (Beneficial) | ${s.byTier[1]} |
| Tier 2 (Educational) | ${s.byTier[2]} |
| Tier 3 (Entertainment, channel-page only) | ${s.byTier[3]} |
| Parked (tier null) | ${s.byTier.parked} |
| UULF → UU fallbacks | ${s.fellBackToUU} |
| Shorts-only / empty | ${s.shortsOnlyOrEmpty} |
| Needs human confirm | ${s.needsConfirm} |

## UNRESOLVED (no id fabricated — fix the handle or remove)
${list(unresolved, (c) => `- \`${c.handle}\``)}

## Parked (tier: null — resolved/stored but excluded from all feeds until classified)
${list(parked, (c) => `- \`${c.handle}\`${c.channelId ? ` (${c.channelId})` : " (unresolved)"}`)}

## Shorts-only / empty (excluded from active feed)
${list(shorts, (c) => `- \`${c.handle}\``)}

## UULF → UU fallbacks used
${list(uu, (c) => `- \`${c.handle}\` (${c.uploadsPlaylistId})`)}

## Needs human confirmation (tier/category)
${list(confirm, (c) => `- \`${c.handle}\` — category "${c.category}", tier ${c.tier}`)}

## Duplicates
${dupes.length ? dupes.map((d) => `- ${d.kind}: \`${d.value}\``).join("\n") : "_none_"}
`;
}
