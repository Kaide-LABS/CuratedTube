// Server-side ETag cache for conditional Data API requests (Implements PHASE_4_SPEC.md §4/§6).
//
// Lets youtube.ts send `If-None-Match` and reuse the last good, already-Zod-validated body
// when the YouTube Data API answers `304 Not Modified` — so an unchanged payload costs 0
// quota units (PRD §7: "ETag conditional requests to skip unchanged payloads"). Process-local
// and single-user: the cache is stashed on globalThis so it survives Next dev hot-reload, and
// the ETag + cached body are written together, so they are always consistent (a 304 can only
// arrive when we still hold the matching body). NEVER client-visible — this is a server module.
import "server-only";

/** One cached response: the validator-passed body plus the ETag the API last returned for it. */
type ETagEntry = { etag: string; body: unknown; storedAt: number };

// Bound the map so a long-running server can't grow it without limit. The Data API surface we
// hit is tiny (uploads playlists + video/channel batches), so this ceiling is never approached
// in practice; it is a safety valve, evicting the oldest entry when exceeded.
const MAX_ENTRIES = 500;

const g = globalThis as unknown as { __ctETag?: Map<string, ETagEntry> };

function store(): Map<string, ETagEntry> {
  if (!g.__ctETag) g.__ctETag = new Map<string, ETagEntry>();
  return g.__ctETag;
}

/** The ETag previously returned for `key`, or undefined if we have never cached it. */
export function getETag(key: string): string | undefined {
  return store().get(key)?.etag;
}

/** The cached, already-validated body for `key`, or undefined on a miss. */
export function getCachedBody<T>(key: string): T | undefined {
  return store().get(key)?.body as T | undefined;
}

/**
 * Cache a fresh ETag together with its validated body. ETag and body are always set in one
 * call so a later 304 (matched on the ETag) is guaranteed to find the corresponding body.
 * Evicts the oldest entry if the map is at capacity.
 */
export function setCached(key: string, etag: string, body: unknown): void {
  const s = store();
  if (!s.has(key) && s.size >= MAX_ENTRIES) {
    const oldest = s.keys().next().value;
    if (oldest !== undefined) s.delete(oldest);
  }
  s.set(key, { etag, body, storedAt: Date.now() });
}

/** Test/diagnostic helper: clear the entire ETag cache. */
export function clearETagCache(): void {
  store().clear();
}
