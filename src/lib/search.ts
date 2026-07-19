// Keyword search — pure, client-side, in-memory string filtering over ALREADY-LOADED video
// rows. No search.list, no API calls of any kind, no quota: this only narrows data the page
// fetched to render itself in the first place (the home feed pool / a channel's loaded archive).
//
// EXPLICIT LIMITATION: this is literal keyword matching only. A query like "beginner" matches a
// title that contains the word "beginner" — it will NOT catch a beginner-oriented video titled
// "your first week" or "fundamentals for new fighters", because those titles don't contain the
// literal term. Meaning-based (semantic) filtering is a separate, future feature; this module
// makes no attempt to fake it with a hardcoded synonym/keyword list.

import type { Video } from "./types";

/**
 * Filter `videos` by a keyword query, case-insensitive substring match against the title.
 * A query prefixed with "-" HIDES matches instead (e.g. "-beginner" removes any title
 * containing "beginner"). An empty (or whitespace-only, or bare "-") query returns the list
 * unchanged.
 */
export function filterByKeyword(videos: Video[], query: string): Video[] {
  const trimmed = query.trim();
  if (!trimmed) return videos;

  const negative = trimmed.startsWith("-");
  const term = (negative ? trimmed.slice(1) : trimmed).trim().toLowerCase();
  if (!term) return videos;

  return videos.filter((v) => {
    const matches = v.title.toLowerCase().includes(term);
    return negative ? !matches : matches;
  });
}
