// One-time channel roster pipeline (PHASE_1_SPEC §4/§6/§8, PRD §7/§9.2).
//
// Operates on the CANONICAL root channels.json ({ _meta, channels }) — the single source
// of truth the app consumes. For every `resolve:true` entry it:
//   1. resolves channelId yt-dlp-first (0 quota), falling back to channels.list?forHandle (1 unit);
//      "coldfusion" is treated as a legacy custom URL, not an @handle. Failure => UNRESOLVED,
//      NO fabricated id.
//   2. derives uploadsPlaylistId UC -> UULF (long-form), verified via the 0-quota RSS feed,
//      falling back to UU when UULF is empty; both empty => shorts-only/empty flag.
//   3. parks any tier:null channel (excluded from all feed composition).
// Already-verified UC… ids are preserved byte-for-byte (never re-resolved).
// Then (unless --no-enrich) it enriches all resolved ids via channels.list (title/avatar/subs),
// rewrites the canonical roster, and emits the full VALIDATION_REPORT.md.
//
//   YOUTUBE_API_KEY=... node scripts/resolve-channels.mjs
//   ... --uu          force the UU uploads prefix
//   ... --no-enrich   skip the channels.list enrichment pass

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  uploadsFromChannelId,
  handleToChannelUrl,
  isAlreadyResolved,
  applyParking,
  buildValidationReport,
} from "./roster-lib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ROSTER_PATH = join(ROOT, "channels.json");
const REPORT_PATH = join(ROOT, "VALIDATION_REPORT.md");

const useUU = process.argv.includes("--uu");
const noEnrich = process.argv.includes("--no-enrich");
const YT_DLP = process.env.YT_DLP_PATH || "yt-dlp";

let quotaUsed = 0;

function loadEnvKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^\s*YOUTUBE_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

const KEY = loadEnvKey();
if (!KEY) {
  console.error("YOUTUBE_API_KEY not set (env or .env). Aborting — no IDs will be fabricated.");
  process.exit(1);
}

const UC_RE = /^UC[A-Za-z0-9_-]{22}$/;

/** yt-dlp resolution (0 quota). Returns a UC… id or null. */
function resolveViaYtDlp(handle) {
  const url = `${handleToChannelUrl(handle)}/videos`;
  try {
    const out = execSync(
      `${YT_DLP} --playlist-items 1 --print "%(channel_id)s" "${url}"`,
      { encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const id = out.split(/\r?\n/).map((l) => l.trim()).find((l) => UC_RE.test(l));
    return id || null;
  } catch {
    return null;
  }
}

/** channels.list?forHandle fallback (1 unit). Returns a UC… id or null. */
async function resolveViaForHandle(handle) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id");
  url.searchParams.set("forHandle", String(handle).replace(/^@/, ""));
  url.searchParams.set("key", KEY);
  try {
    const res = await fetch(url);
    quotaUsed += 1;
    if (!res.ok) return null;
    const data = await res.json();
    const id = data.items?.[0]?.id;
    return id && UC_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Verify an uploads playlist exists and returns long-form items via the 0-quota RSS feed. */
async function verifyViaRss(playlistId) {
  const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const xml = await res.text();
    return /<yt:videoId>/.test(xml);
  } catch {
    return false;
  }
}

function bestThumb(thumbs) {
  if (!thumbs) return undefined;
  const t = thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url;
  return t || undefined;
}

/** channels.list enrichment (title/avatar/subs), batched <=50. */
async function enrichBatch(ids) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("id", ids.join(","));
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("key", KEY);
  const res = await fetch(url);
  quotaUsed += 1;
  if (!res.ok) throw new Error(`channels.list ${res.status}`);
  const data = await res.json();
  const map = new Map();
  for (const c of data.items ?? []) {
    map.set(c.id, {
      title: c.snippet?.title,
      avatarUrl: bestThumb(c.snippet?.thumbnails),
      subscriberCount: c.statistics?.subscriberCount
        ? Number(c.statistics.subscriberCount)
        : undefined,
    });
  }
  return map;
}

/** Re-serialize a channel entry with a stable, readable key order. */
function ordered(c) {
  const o = {};
  o.handle = c.handle;
  o.channelId = c.channelId ?? null;
  if (c.uploadsPlaylistId) o.uploadsPlaylistId = c.uploadsPlaylistId;
  o.category = c.category;
  o.tier = c.tier ?? null;
  for (const k of ["resolve", "parked", "unresolved", "fellBackToUU", "shortsOnlyOrEmpty", "confirm"]) {
    if (c[k]) o[k] = c[k];
  }
  if (c.title) o.title = c.title;
  if (c.avatarUrl) o.avatarUrl = c.avatarUrl;
  if (typeof c.subscriberCount === "number") o.subscriberCount = c.subscriberCount;
  if (c.note) o.note = c.note;
  return o;
}

async function main() {
  const roster = JSON.parse(readFileSync(ROSTER_PATH, "utf8"));
  const channels = roster.channels;
  let resolved = 0;
  let failed = 0;

  // --- Stage A.1/2/3: resolve, derive + verify uploads, park ---
  for (const c of channels) {
    if (isAlreadyResolved(c)) {
      delete c.resolve;
    } else if (c.resolve) {
      let id = resolveViaYtDlp(c.handle);
      if (id) {
        console.log(`✓ ${c.handle} -> ${id} (yt-dlp)`);
      } else {
        id = await resolveViaForHandle(c.handle);
        if (id) console.log(`✓ ${c.handle} -> ${id} (forHandle)`);
      }
      if (!id) {
        c.unresolved = true;
        failed++;
        console.warn(`✗ ${c.handle} — UNRESOLVED (no id fabricated)`);
        Object.assign(c, applyParking(c));
        continue;
      }
      c.channelId = id;
      delete c.resolve;
      delete c.unresolved;
    }

    // Derive + verify the uploads playlist for any resolved channel lacking one.
    if (c.channelId && !c.uploadsPlaylistId) {
      let pid = uploadsFromChannelId(c.channelId, useUU);
      let ok = await verifyViaRss(pid);
      if (!ok && !useUU) {
        const uu = uploadsFromChannelId(c.channelId, true);
        if (await verifyViaRss(uu)) {
          pid = uu;
          c.fellBackToUU = true;
          console.warn(`  ↳ ${c.handle} UULF empty → UU fallback`);
          ok = true;
        }
      }
      c.uploadsPlaylistId = pid;
      if (!ok) {
        c.shortsOnlyOrEmpty = true;
        console.warn(`  ↳ ${c.handle} shorts-only/empty (UULF+UU returned nothing)`);
      }
    }

    if (isAlreadyResolved(c)) resolved++;
    Object.assign(c, applyParking(c));
  }

  // --- Stage A enrichment: channels.list title/avatar/subs over all resolved ids ---
  if (!noEnrich) {
    const ids = channels.filter(isAlreadyResolved).map((c) => c.channelId);
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const meta = await enrichBatch(batch);
      for (const c of channels) {
        const m = meta.get(c.channelId);
        if (m) {
          if (m.title) c.title = m.title;
          if (m.avatarUrl) c.avatarUrl = m.avatarUrl;
          if (typeof m.subscriberCount === "number") c.subscriberCount = m.subscriberCount;
        }
      }
    }
    console.log(`Enriched ${ids.length} resolved channels.`);
  }

  // --- Emit canonical roster (._meta preserved verbatim) + full report ---
  roster.channels = channels.map(ordered);
  writeFileSync(ROSTER_PATH, JSON.stringify(roster, null, 2) + "\n");
  writeFileSync(REPORT_PATH, buildValidationReport(channels, { quotaUsed, enriched: !noEnrich }));

  console.log(
    `\nDone. ${resolved} resolved, ${failed} unresolved. Prefix: ${useUU ? "UU" : "UULF"}. ` +
      `Approx quota used: ${quotaUsed} units. Report: VALIDATION_REPORT.md`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
