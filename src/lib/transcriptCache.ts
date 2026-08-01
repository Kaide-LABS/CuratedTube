// Server-side transcript cache — mirrors etagCache.ts's own globalThis-stashed Map pattern
// (survives Next dev hot-reload; process-local and single-user).
//
// CACHING POLICY (fixed 2026-08-01 after a false-negative bug — see transcript.ts's module
// header for the full incident): a real transcript never changes once published, so a POSITIVE
// result caches with NO expiry. A CONFIRMED "no captions" result is cached too (there's no point
// re-fetching a permanently-empty answer on every open) but only for a BOUNDED TTL, not forever —
// insurance against our own diagnosis being wrong, or YouTube adding a track later. An
// "unavailable" result (fetch failed/timed out/came back malformed after retries — see
// transcript.ts's getTranscript) is NEVER cached at all: caching a failure as a negative is
// exactly the bug that made real ASR transcripts look permanently absent.
//
// Accepted limitation, same class as etagCache.ts: Cloud Run with `min-instances 0` can cold-
// start a fresh process (empty cache) at any time — this is an in-memory cache, not durable
// storage. That's fine here: a cache miss just re-fetches from the timedtext endpoint, it never
// produces wrong data, only a slower first hit after a cold start.
import "server-only";
import type { TranscriptResult } from "./transcript";

const MAX_ENTRIES = 2000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000; // 24h bound on a "confirmed no-captions" result

type CacheEntry = { result: TranscriptResult; cachedAt: number };

const g = globalThis as unknown as { __ctTranscript?: Map<string, CacheEntry> };

function store(): Map<string, CacheEntry> {
  if (!g.__ctTranscript) g.__ctTranscript = new Map<string, CacheEntry>();
  return g.__ctTranscript;
}

/** Cache key: videoId + the requested language (undefined language gets its own bucket). */
export function transcriptCacheKey(videoId: string, lang?: string): string {
  return lang ? `${videoId}:${lang}` : videoId;
}

/**
 * The cached result for `key`, or undefined on a miss OR an expired negative. A "no-captions"
 * entry older than NEGATIVE_TTL_MS is treated as a miss (and evicted) so a later fix, a retry, or
 * YouTube adding a track eventually gets a fresh answer instead of an indefinitely-stale "no".
 */
export function getCachedTranscript(key: string): TranscriptResult | undefined {
  const s = store();
  const entry = s.get(key);
  if (!entry) return undefined;
  if (entry.result.available === false && entry.result.reason === "no-captions") {
    if (Date.now() - entry.cachedAt > NEGATIVE_TTL_MS) {
      s.delete(key);
      return undefined;
    }
  }
  return entry.result;
}

/**
 * Cache a result. An "unavailable" (fetch failure/timeout/malformed-after-retries) result is
 * NEVER stored — see the policy note above; the caller should simply not persist it, but this
 * is enforced here too as a hard backstop so a future caller can't reintroduce the bug by
 * forgetting to check first.
 */
export function setCachedTranscript(key: string, result: TranscriptResult): void {
  if (result.available === false && result.reason === "unavailable") return;
  const s = store();
  if (!s.has(key) && s.size >= MAX_ENTRIES) {
    const oldest = s.keys().next().value;
    if (oldest !== undefined) s.delete(oldest);
  }
  s.set(key, { result, cachedAt: Date.now() });
}

/** Manual cache-bust for one (videoId, lang) entry — internal/support use (e.g. re-testing a
 * video after a fix), not necessarily surfaced anywhere in the UI. */
export function bustCachedTranscript(key: string): void {
  store().delete(key);
}

/** Test/diagnostic helper: clear the entire transcript cache. */
export function clearTranscriptCache(): void {
  store().clear();
}
