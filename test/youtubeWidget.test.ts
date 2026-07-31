import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCommandMessage,
  buildEmbedUrl,
  buildListeningMessage,
  isTrustedWidgetOrigin,
  nextPauseAttemptOutcome,
  NOCOOKIE_ORIGIN,
  parseWidgetMessage,
  PLAYER_STATE,
} from "../src/lib/youtubeWidget";

describe("buildEmbedUrl — self-hosted nocookie embed", () => {
  it("targets youtube-nocookie.com with enablejsapi=1 and the runtime origin", () => {
    const url = buildEmbedUrl("abc123", "https://halaltube-example.run.app");
    expect(url.startsWith("https://www.youtube-nocookie.com/embed/abc123?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("enablejsapi")).toBe("1");
    expect(params.get("origin")).toBe("https://halaltube-example.run.app");
  });

  it("uses whatever origin is passed — never a hardcoded one (localhost vs run.app)", () => {
    const localUrl = buildEmbedUrl("abc123", "http://localhost:3000");
    expect(new URL(localUrl).searchParams.get("origin")).toBe("http://localhost:3000");
  });

  it("preserves the locked distraction-suppressing params", () => {
    const params = new URL(buildEmbedUrl("x", "https://example.com")).searchParams;
    expect(params.get("rel")).toBe("0");
    expect(params.get("iv_load_policy")).toBe("3");
    expect(params.get("playsinline")).toBe("1");
    expect(params.get("fs")).toBe("1");
  });
});

describe("handshake + command message builders", () => {
  it("buildListeningMessage carries the widget channel + a listener id", () => {
    expect(buildListeningMessage(3)).toEqual({ event: "listening", id: 3, channel: "widget" });
  });

  it("buildCommandMessage defaults args to an empty array", () => {
    expect(buildCommandMessage("pauseVideo")).toEqual({ event: "command", func: "pauseVideo", args: [] });
    expect(buildCommandMessage("seekTo", [30, true])).toEqual({
      event: "command",
      func: "seekTo",
      args: [30, true],
    });
  });
});

describe("parseWidgetMessage — both observed inbound shapes, never throws", () => {
  it("parses the onStateChange shape (as a JSON string, matching real postMessage payloads)", () => {
    expect(parseWidgetMessage(JSON.stringify({ event: "onStateChange", info: 1 }))).toEqual({
      type: "stateChange",
      state: 1,
    });
  });

  it("parses the infoDelivery/{playerState} shape", () => {
    expect(parseWidgetMessage(JSON.stringify({ event: "infoDelivery", info: { playerState: 2 } }))).toEqual({
      type: "stateChange",
      state: 2,
    });
  });

  it("parses the rarer infoDelivery/bare-number shape", () => {
    expect(parseWidgetMessage(JSON.stringify({ event: "infoDelivery", info: 3 }))).toEqual({
      type: "stateChange",
      state: 3,
    });
  });

  it("parses onError", () => {
    expect(parseWidgetMessage(JSON.stringify({ event: "onError", info: 101 }))).toEqual({
      type: "error",
      code: 101,
    });
  });

  it("parses onReady", () => {
    expect(parseWidgetMessage(JSON.stringify({ event: "onReady" }))).toEqual({ type: "ready" });
  });

  it("accepts a pre-parsed object too (not just JSON strings)", () => {
    expect(parseWidgetMessage({ event: "onStateChange", info: 0 })).toEqual({ type: "stateChange", state: 0 });
  });

  it("never throws on garbage input — returns unknown", () => {
    expect(parseWidgetMessage("not json at all {{{")).toEqual({ type: "unknown" });
    expect(parseWidgetMessage(null)).toEqual({ type: "unknown" });
    expect(parseWidgetMessage(42)).toEqual({ type: "unknown" });
    expect(parseWidgetMessage(JSON.stringify({ event: "somethingElse" }))).toEqual({ type: "unknown" });
    expect(parseWidgetMessage(JSON.stringify({ event: "infoDelivery", info: { notPlayerState: 1 } }))).toEqual({
      type: "unknown",
    });
  });
});

describe("isTrustedWidgetOrigin — strict origin validation", () => {
  it("accepts only the exact nocookie origin", () => {
    expect(isTrustedWidgetOrigin(NOCOOKIE_ORIGIN)).toBe(true);
  });
  it("rejects the cookie-ful youtube.com origin", () => {
    expect(isTrustedWidgetOrigin("https://www.youtube.com")).toBe(false);
  });
  it("rejects a spoofed lookalike origin", () => {
    expect(isTrustedWidgetOrigin("https://www.youtube-nocookie.com.evil.example")).toBe(false);
    expect(isTrustedWidgetOrigin("http://www.youtube-nocookie.com")).toBe(false); // http, not https
  });
});

describe("PLAYER_STATE — the state map guardian accrual keys off", () => {
  it("matches the real YouTube IFrame player state integers", () => {
    expect(PLAYER_STATE).toEqual({ UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 });
  });
});

describe("nextPauseAttemptOutcome — force-pause verification decision table", () => {
  it("confirmed on the first attempt stops immediately", () => {
    expect(nextPauseAttemptOutcome(true, 1)).toBe("confirmed");
  });

  it("unconfirmed with attempts remaining retries", () => {
    expect(nextPauseAttemptOutcome(false, 1, 2)).toBe("retry");
  });

  it("unconfirmed at the attempt ceiling escalates to unmount", () => {
    expect(nextPauseAttemptOutcome(false, 2, 2)).toBe("escalate");
  });

  it("never shows confirmed when the pause was not actually confirmed, regardless of attempt count", () => {
    expect(nextPauseAttemptOutcome(false, 0, 2)).not.toBe("confirmed");
    expect(nextPauseAttemptOutcome(false, 5, 2)).not.toBe("confirmed");
  });
});

describe("self-hosted player — zero iframe_api / youtube.com references (source guarantee)", () => {
  it("WatchPlayer.tsx never loads the official www.youtube.com/iframe_api bootstrap script", () => {
    const source = readFileSync(join(__dirname, "..", "src", "components", "WatchPlayer.tsx"), "utf8");
    // No <script> tag construction, no src assignment, and no official JS API global — only a
    // documentation comment is allowed to mention the string "iframe_api" (explaining what this
    // file deliberately does NOT depend on any more).
    expect(source).not.toMatch(/tag\.src\s*=/);
    expect(source).not.toMatch(/createElement\("script"\)/);
    expect(source).not.toMatch(/window\.YT\b/);
    expect(source).not.toMatch(/onYouTubeIframeAPIReady/);
    expect(source).toMatch(/youtube-nocookie\.com/);
    // The embed-restricted fallback intentionally keeps the youtube.com watch URL as inert TEXT
    // (not a link, not a fetch target) for use on another, unblocked device — that's expected.
    expect(source).toMatch(/youtube\.com\/watch\?v=/);
  });

  it("the per-video reset effect never touches the DAILY guardian refs (clock/interruptsShown/capReached/todayKey)", () => {
    const source = readFileSync(join(__dirname, "..", "src", "components", "WatchPlayer.tsx"), "utf8");
    // The effect that recomputes embedSrc per videoId (per-video reset) resets only per-video
    // bookkeeping (handshake id/ack, pending pause confirmation, isPlayingRef, errored) — a new
    // video must never reset the day's accrued activeSeconds, shown thresholds, or cap latch.
    const perVideoEffectMatch = source.match(
      /useEffect\(\(\) => \{\s*if \(!guardianReady \|\| capReachedRef\.current\) return;[\s\S]*?\}, \[videoId, guardianReady\]\);/,
    );
    expect(perVideoEffectMatch).not.toBeNull();
    const body = perVideoEffectMatch![0];
    expect(body).not.toMatch(/guardianClockRef\.current\s*=/);
    expect(body).not.toMatch(/interruptsShownRef\.current\s*=/);
    expect(body).not.toMatch(/capReachedRef\.current\s*=\s*(?!.*\.current\))/); // no reassignment other than the guard read
    expect(body).not.toMatch(/todayKeyRef\.current\s*=/);
    // It DOES reset the per-video-only state:
    expect(body).toMatch(/handshakeIdRef\.current\s*\+=\s*1/);
    expect(body).toMatch(/handshakeAckedRef\.current\s*=\s*false/);
    expect(body).toMatch(/pendingPauseResolveRef\.current\s*=\s*null/);
  });
});

describe("self-hosted player — embed-failure fallback (origin-mismatch / removeChild fix)", () => {
  const source = readFileSync(join(__dirname, "..", "src", "components", "WatchPlayer.tsx"), "utf8");

  it("every contentWindow.postMessage call is guarded by an isConnected check and wrapped in try/catch", () => {
    // A restricted/removed video can navigate its OWN iframe document to a different origin —
    // postToPlayer must never touch a detached node and must never let a send throw uncaught.
    const postToPlayerMatch = source.match(/const postToPlayer = \(msg: unknown\): void => \{[\s\S]*?\n    \};/);
    expect(postToPlayerMatch).not.toBeNull();
    const body = postToPlayerMatch![0];
    expect(body).toMatch(/iframe\.isConnected/);
    expect(body).toMatch(/try\s*\{/);
    expect(body).toMatch(/catch/);
    // There is exactly one place in the component that calls contentWindow.postMessage — every
    // handshake/command send goes through it, so this one guard covers all sends.
    expect(source.match(/win\.postMessage\(/g)?.length ?? 0).toBe(1);
  });

  it("a handshake that never hears back (no error, no state event) routes to the SAME fallback as an explicit onError", () => {
    // failToEmbedFallback is the single entry point for "this video failed to embed" — both the
    // onError message handler and the handshake-timeout path must call it, not duplicate logic.
    const calls = source.match(/failToEmbedFallback\(\)/g) ?? [];
    // Declared, called on handshake timeout, and called on onError.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/if \(!handshakeAckedRef\.current\) failToEmbedFallback\(\)/);
  });

  it("the fallback is idempotent — guarded so a repeated trigger doesn't re-run the unmount side effect", () => {
    const fallbackMatch = source.match(/const failToEmbedFallback = \(\): void => \{[\s\S]*?\n    \};/);
    expect(fallbackMatch).not.toBeNull();
    const body = fallbackMatch![0];
    expect(body).toMatch(/setErrored\(\(already\) => \{/);
    expect(body).toMatch(/if \(!already\) setPlayerMounted\(false\)/);
  });

  it("no manual DOM removal anywhere in the player — the iframe has exactly one owner (React reconciliation via key={embedSrc})", () => {
    expect(source).not.toMatch(/removeChild/);
    expect(source).not.toMatch(/\.remove\(\)/);
    expect(source).not.toMatch(/appendChild/);
    expect(source).toMatch(/key=\{embedSrc\}/);
  });

  it("cap-unmount, interrupt-escalate, and error-fallback all converge on the same setPlayerMounted(false) removal path", () => {
    expect(source.match(/setPlayerMounted\(false\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
