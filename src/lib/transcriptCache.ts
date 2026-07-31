// Server-side, permanent-for-process-lifetime transcript cache — mirrors etagCache.ts's own
// globalThis-stashed Map pattern (survives Next dev hot-reload; process-local and single-user).
// Transcripts don't change once published, so entries never expire on their own; the only bound
// is MAX_ENTRIES, an eviction safety valve for a long-running process, not a freshness policy.
//
// Accepted limitation, same class as etagCache.ts: Cloud Run with `min-instances 0` can cold-
// start a fresh process (empty cache) at any time — this is an in-memory cache, not durable
// storage. That's fine here: a cache miss just re-fetches from the timedtext endpoint, it never
// produces wrong data, only a slower first hit after a cold start.
import "server-only";
import type { TranscriptResult } from "./transcript";

const MAX_ENTRIES = 2000;

const g = globalThis as unknown as { __ctTranscript?: Map<string, TranscriptResult> };

function store(): Map<string, TranscriptResult> {
  if (!g.__ctTranscript) g.__ctTranscript = new Map<string, TranscriptResult>();
  return g.__ctTranscript;
}

/** Cache key: videoId + the requested language (undefined language gets its own bucket). */
export function transcriptCacheKey(videoId: string, lang?: string): string {
  return lang ? `${videoId}:${lang}` : videoId;
}

export function getCachedTranscript(key: string): TranscriptResult | undefined {
  return store().get(key);
}

/** Caches BOTH outcomes — a real transcript AND a confirmed "no captions" result — since a
 * no-captions video will still have no captions on the next request; re-fetching would just
 * hammer the endpoint for a permanently negative answer. */
export function setCachedTranscript(key: string, result: TranscriptResult): void {
  const s = store();
  if (!s.has(key) && s.size >= MAX_ENTRIES) {
    const oldest = s.keys().next().value;
    if (oldest !== undefined) s.delete(oldest);
  }
  s.set(key, result);
}

/** Test/diagnostic helper: clear the entire transcript cache. */
export function clearTranscriptCache(): void {
  store().clear();
}
