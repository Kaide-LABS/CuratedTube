// YouTube channel URL parser (user-added-channels feature). Pure, side-effect-free, and
// usable both server- and test-side (no "server-only" — the resolve route imports this
// before it knows whether the input needs a network call at all).
//
// Accepted forms: /@handle, /channel/UC…, /c/name, /user/name, and a bare @handle with no
// surrounding URL. /channel/UC… carries the id directly (0 quota to resolve). Every other
// form needs exactly one channels.list call downstream — never search.list (D4, 100× cost).

export type ParsedChannelUrl =
  | { kind: "id"; channelId: string }
  | { kind: "handle"; handle: string } // includes the leading "@"
  | { kind: "username"; username: string };

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const BARE_HANDLE_RE = /^@[A-Za-z0-9._-]+$/;

/** Parse an accepted channel URL/handle form. Returns null when it cannot be recognized. */
export function parseChannelUrl(input: string): ParsedChannelUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (BARE_HANDLE_RE.test(trimmed)) return { kind: "handle", handle: trimmed };

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host !== "youtube.com" && host !== "youtu.be") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  if (parts[0].startsWith("@")) return { kind: "handle", handle: parts[0] };

  if (parts[0] === "channel" && parts[1]) {
    return CHANNEL_ID_RE.test(parts[1]) ? { kind: "id", channelId: parts[1] } : null;
  }

  // /c/name is a legacy custom-URL slug with no direct API lookup (channels.list has no
  // "forCustomUrl" param, and search.list is banned). Best-effort: treat the slug as a
  // handle candidate — most legacy /c/ channels also answer to the same string as @handle.
  if (parts[0] === "c" && parts[1]) return { kind: "handle", handle: `@${parts[1]}` };

  if (parts[0] === "user" && parts[1]) return { kind: "username", username: parts[1] };

  return null;
}
