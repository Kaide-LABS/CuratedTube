// One-time channel resolver (PRD §9.2, §7).
//
// Reads src/config/channels.json, looks up each @handle via channels.list?forHandle
// (1 unit/call — verified supported 2026-06-29), and writes back channelId +
// uploadsPlaylistId. Uses the UULF (long-form) prefix by default per D2.
//
//   YOUTUBE_API_KEY=... node scripts/resolve-channels.mjs
//   YOUTUBE_API_KEY=... node scripts/resolve-channels.mjs --uu   # fall back to UU prefix
//
// Reads the key from the environment or from a local .env file.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(__dirname, "..", "src", "config", "channels.json");
const useUU = process.argv.includes("--uu");

function loadEnvKey() {
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;
  const envPath = join(__dirname, "..", ".env");
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
  console.error("YOUTUBE_API_KEY not set (env or .env). Aborting.");
  process.exit(1);
}

function uploadsFromChannelId(channelId) {
  const suffix = channelId.slice(2); // strip "UC"
  return (useUU ? "UU" : "UULF") + suffix;
}

async function resolveHandle(handle) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id,contentDetails");
  url.searchParams.set("forHandle", handle.replace(/^@/, ""));
  url.searchParams.set("key", KEY);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) return null;
  const channelId = item.id;
  // Prefer the API's own uploads playlist (UU…); derive UULF by prefix swap unless --uu.
  const apiUploads = item.contentDetails?.relatedPlaylists?.uploads || "";
  const uploadsPlaylistId =
    useUU && apiUploads ? apiUploads : uploadsFromChannelId(channelId);
  return { channelId, uploadsPlaylistId };
}

const channels = JSON.parse(readFileSync(CONFIG, "utf8"));
let resolved = 0;
let failed = 0;

for (const c of channels) {
  if (c.channelId && c.uploadsPlaylistId) {
    console.log(`= ${c.handle} already resolved`);
    resolved++;
    continue;
  }
  try {
    const r = await resolveHandle(c.handle);
    if (!r) {
      console.warn(`✗ ${c.handle} — no channel found (check the handle)`);
      failed++;
      continue;
    }
    c.channelId = r.channelId;
    c.uploadsPlaylistId = r.uploadsPlaylistId;
    resolved++;
    console.log(`✓ ${c.handle} -> ${c.channelId} / ${c.uploadsPlaylistId}`);
  } catch (err) {
    failed++;
    console.error(`✗ ${c.handle} — ${err.message}`);
  }
}

writeFileSync(CONFIG, JSON.stringify(channels, null, 2) + "\n");
console.log(
  `\nDone. ${resolved} resolved, ${failed} failed. Prefix: ${useUU ? "UU" : "UULF"}. ` +
    `Approx quota used: ${channels.length} units.`,
);
