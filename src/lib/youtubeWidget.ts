// Self-hosted YouTube nocookie player protocol — pure, deterministic. Replaces the official
// https://www.youtube.com/iframe_api bootstrap script with a raw <iframe> embed of
// youtube-nocookie.com plus the underlying postMessage "widget" protocol directly, so HalalTube
// works with www.youtube.com (and s.ytimg.com) fully DNS/router-blocked — the whole point of the
// app being "block YouTube everywhere, keep only this."
//
// ACCEPTED RISK: this postMessage protocol (the "listening" handshake, event shapes, state
// integers) is UNDOCUMENTED and reverse-engineered from observed traffic — the same risk class
// as the UULF playlist-prefix convention (see channels.ts). It may change without notice. This
// file is the ENTIRE swappable event-source layer: WatchPlayer.tsx and the guardian core
// (watchGuardian.ts) only ever consume the plain `WidgetEvent` shape below, never the raw
// postMessage payload directly — if YouTube changes the wire format, only this file (and its
// tests) should need to change.

export const NOCOOKIE_ORIGIN = "https://www.youtube-nocookie.com";

// The underlying YouTube player's own state integers — unchanged whether delivered via the
// official JS API or the raw widget protocol. Only PLAYING counts as "active" for the guardian
// and the focus limiter; BUFFERING (a seek/scrub/rebuffer) is explicitly NOT playing, so a
// mid-video seek can neither lose nor double-count active time.
export const PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/**
 * Build the nocookie embed URL. `origin` MUST be computed from the page's real
 * `window.location.origin` at runtime (localhost in dev, the run.app host in prod) — the widget
 * protocol validates the embedding page's origin and silently refuses to postMessage back
 * otherwise, so a hardcoded origin would make the player permanently mute (no events, ever).
 * Params match the previously-locked distraction-suppressing set (Pass A, 2026-06-29).
 */
export function buildEmbedUrl(videoId: string, origin: string): string {
  const params = new URLSearchParams({
    enablejsapi: "1",
    origin,
    rel: "0",
    controls: "1",
    playsinline: "1",
    iv_load_policy: "3",
    disablekb: "0",
    fs: "1",
    color: "white",
  });
  return `${NOCOOKIE_ORIGIN}/embed/${videoId}?${params.toString()}`;
}

/**
 * The "listening" handshake. Without sending this, the widget never posts back a single event —
 * not a documented requirement anywhere, but an empirically tested one (a player that never
 * receives it is a player the guardian silently never sees play). `id` only needs to be present
 * in the message, not globally unique; a small per-mount counter is enough.
 */
export function buildListeningMessage(id: number): { event: "listening"; id: number; channel: "widget" } {
  return { event: "listening", id, channel: "widget" };
}

export function buildCommandMessage(
  func: string,
  args: unknown[] = [],
): { event: "command"; func: string; args: unknown[] } {
  return { event: "command", func, args };
}

export type WidgetEvent =
  | { type: "stateChange"; state: number }
  | { type: "error"; code: number }
  | { type: "ready" }
  | { type: "unknown" };

/**
 * Parse an inbound widget message. Handles BOTH observed shapes — `{event:"onStateChange",
 * info:<int>}` and `{event:"infoDelivery", info:{playerState:<int>}}` (and the rarer bare-number
 * `infoDelivery` variant) — since real traffic uses both, sometimes for the exact same
 * transition. Never throws: an unparseable or unrecognized payload becomes `{type:"unknown"}`
 * rather than crashing the message listener (a hostile/unrelated postMessage on the page must
 * never take the player down).
 */
export function parseWidgetMessage(data: unknown): WidgetEvent {
  try {
    const parsed: unknown = typeof data === "string" ? JSON.parse(data) : data;
    if (!parsed || typeof parsed !== "object") return { type: "unknown" };
    const obj = parsed as Record<string, unknown>;

    if (obj.event === "onError" && typeof obj.info === "number") {
      return { type: "error", code: obj.info };
    }
    if (obj.event === "onReady") return { type: "ready" };
    if (obj.event === "onStateChange" && typeof obj.info === "number") {
      return { type: "stateChange", state: obj.info };
    }
    if (obj.event === "infoDelivery") {
      const info = obj.info;
      if (typeof info === "number") return { type: "stateChange", state: info };
      if (info && typeof info === "object" && typeof (info as Record<string, unknown>).playerState === "number") {
        return { type: "stateChange", state: (info as Record<string, unknown>).playerState as number };
      }
    }
    return { type: "unknown" };
  } catch {
    return { type: "unknown" };
  }
}

/** Strict origin check — act only on messages actually from the nocookie embed. */
export function isTrustedWidgetOrigin(origin: string): boolean {
  return origin === NOCOOKIE_ORIGIN;
}

// ---------------------------------------------------------------------------
// Force-pause verification — pure decision core (the actual wait-with-timeout is inherently
// async/DOM-bound and lives in WatchPlayer.tsx; this is the part of it that's a plain decision
// table, so it's unit-testable without a browser).
// ---------------------------------------------------------------------------
export type PauseAttemptOutcome = "confirmed" | "retry" | "escalate";

/**
 * Given whether the just-attempted pause was confirmed (a PAUSED state event arrived within the
 * timeout) and how many attempts have been made so far, decide what happens next:
 * - confirmed  -> stop, proceed (show the interstitial; the video is actually paused).
 * - retry      -> send pauseVideo again and wait once more.
 * - escalate   -> give up on the command; the caller must unmount the iframe instead. Never show
 *   an interstitial over a video that might still be playing.
 */
export function nextPauseAttemptOutcome(
  confirmed: boolean,
  attemptsSoFar: number,
  maxAttempts = 2,
): PauseAttemptOutcome {
  if (confirmed) return "confirmed";
  if (attemptsSoFar < maxAttempts) return "retry";
  return "escalate";
}
