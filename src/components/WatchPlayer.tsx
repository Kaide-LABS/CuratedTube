"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { markVisited } from "@/lib/watchState";
import { recordActiveSegment } from "@/lib/sessionStore";
import { mergeSegment } from "@/lib/session";
import { DEFAULT_SESSION_CONFIG } from "@/lib/session-config";
import type { SessionSegment, WatchSession } from "@/lib/types";
import {
  buildChatGptCheckinUrl,
  buildWhatsAppLink,
  decideGuardianActions,
  localDateKey,
  tickActive,
  type GuardianClock,
  type InterruptThresholdMin,
} from "@/lib/watchGuardian";
import {
  broadcastSession,
  getGuardianSettings,
  getTodaySession,
  saveSession,
  subscribeGuardianBroadcast,
  addJournalEntry,
} from "@/lib/watchGuardianStore";
import {
  buildCommandMessage,
  buildEmbedUrl,
  buildListeningMessage,
  isTrustedWidgetOrigin,
  nextPauseAttemptOutcome,
  NOCOOKIE_ORIGIN,
  parseWidgetMessage,
  PLAYER_STATE,
} from "@/lib/youtubeWidget";
import { GuardianOverlay, type GuardianOverlayState } from "./WatchGuardianOverlays";

// Self-hosted player: a raw <iframe src="https://www.youtube-nocookie.com/embed/...">, driven
// entirely by the postMessage "widget" protocol (src/lib/youtubeWidget.ts) — NOT the official
// https://www.youtube.com/iframe_api bootstrap script. This is the whole point: HalalTube must
// keep working with www.youtube.com fully DNS/router-blocked (see README's block-YouTube
// runbook). ACCEPTED RISK: the widget protocol is undocumented/reverse-engineered and may change
// without notice — youtubeWidget.ts is the entire swappable event-source layer; nothing below
// touches the raw postMessage shape directly.
const HANDSHAKE_RETRY_MS = 300;
// ~30s of retrying before giving up on ever hearing back. Empirically necessary (not a guess):
// a first-attempt-only or short-timeout handshake measurably fails against a real nocookie embed
// — the iframe's contentWindow doesn't reflect the cross-origin navigation (and so won't accept
// a postMessage targeted at that origin) until the navigation actually commits, which is
// slower than a few hundred ms in practice. Harmless to keep retrying: each attempt is one small
// postMessage, and it stops the instant any real message comes back.
const HANDSHAKE_MAX_ATTEMPTS = 100;
const PAUSE_CONFIRM_TIMEOUT_MS = 1500;
const GUARDIAN_HEARTBEAT_MS = 15_000;

export function WatchPlayer({
  videoId,
  onEnded,
}: {
  videoId: string;
  /**
   * Fires when the video ends naturally. ONLY ever wired up for queue playback (see
   * PlaylistWatchView) to advance to the next user-queued item — the ONE sanctioned auto-advance
   * in the app, and only within an explicit, user-built queue. Never used for autoplay-of-
   * recommendations; every other caller of WatchPlayer omits this prop and nothing advances.
   */
  onEnded?: () => void;
}) {
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const [embedSrc, setEmbedSrc] = useState<string | null>(null);
  const [playerMounted, setPlayerMounted] = useState(true);
  const [errored, setErrored] = useState(false);

  // Focus-limiter bookkeeping: the currently-open active-playback segment + its heartbeat timer.
  // The heartbeat keeps the persisted segment's endedAt fresh so an abandoned tab cannot inflate
  // active time (PHASE_3_SPEC §6). None of this advances playback — it only records activity.
  const openSegRef = useRef<SessionSegment | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Watch-time guardian bookkeeping (self-binding 2.5h/day cap + 30/60/90/120 interrupts).
  // A wholly separate mechanic from the focus limiter above: that one is a soft, snoozable,
  // rolling-4h-window nudge; this one is a hard, non-snoozable, per-calendar-day cap. See
  // watchGuardian.ts for the accepted-limitation note (client-side, not tamper-proof).
  const guardianClockRef = useRef<GuardianClock>({ activeSec: 0, openStartedAtMs: null });
  const interruptsShownRef = useRef<InterruptThresholdMin[]>([]);
  const capReachedRef = useRef(false);
  const todayKeyRef = useRef<string>(localDateKey(Date.now()));
  const isPlayingRef = useRef(false);
  const guardianHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [guardianReady, setGuardianReady] = useState(false);
  const [overlay, setOverlay] = useState<GuardianOverlayState>({ kind: "none" });
  const [whatsappNumber, setWhatsappNumber] = useState("");

  // Force-pause verification (per PART 2): resolved by the message handler when a PAUSED state
  // event actually arrives. A "pause" the guardian can't confirm must never be trusted — see
  // pauseAndConfirm below.
  const pendingPauseResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const handshakeIdRef = useRef(0);
  const handshakeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handshakeAckedRef = useRef(false);

  // Resolve today's session (clock-guard reconciled) + settings BEFORE the player is allowed to
  // exist, so an already-capped day never even renders the iframe (the "guard at player
  // creation" invariant).
  useEffect(() => {
    let alive = true;
    const now = Date.now();
    Promise.all([getTodaySession(now), getGuardianSettings()]).then(([session, settings]) => {
      if (!alive) return;
      guardianClockRef.current = { activeSec: session.activeSeconds, openStartedAtMs: null };
      interruptsShownRef.current = session.interruptsShown;
      capReachedRef.current = session.capReached;
      todayKeyRef.current = session.date;
      setWhatsappNumber(settings.whatsappNumber);
      if (session.capReached) {
        setPlayerMounted(false);
        setOverlay({ kind: "locked" });
      }
      setGuardianReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Adopt another tab's progress (multi-tab safety): merge, never regress, and reflect a cap
  // reached in another tab immediately — a second tab shouldn't be able to keep playing past it.
  useEffect(() => {
    return subscribeGuardianBroadcast((incoming) => {
      if (incoming.date !== todayKeyRef.current) return;
      guardianClockRef.current = {
        ...guardianClockRef.current,
        activeSec: Math.max(guardianClockRef.current.activeSec, incoming.activeSeconds),
      };
      interruptsShownRef.current = [...new Set([...interruptsShownRef.current, ...incoming.interruptsShown])];
      if (incoming.capReached && !capReachedRef.current) {
        capReachedRef.current = true;
        setPlayerMounted(false); // deterministic — element removal, not a command
        setOverlay({ kind: "locked" });
      }
    });
  }, []);

  // Compute the embed src from the REAL runtime origin (never hardcoded — localhost in dev, the
  // run.app host in prod). Also resets all PER-VIDEO state (handshake, pause-confirmation,
  // playing flag) without touching the daily guardian state (clock/interruptsShown/capReached),
  // which must persist across a video change within the same day.
  useEffect(() => {
    if (!guardianReady || capReachedRef.current) return;
    handshakeIdRef.current += 1;
    handshakeAckedRef.current = false;
    pendingPauseResolveRef.current = null;
    isPlayingRef.current = false;
    setErrored(false);
    setEmbedSrc(buildEmbedUrl(videoId, window.location.origin));
  }, [videoId, guardianReady]);

  useEffect(() => {
    let cancelled = false;
    // Record the visit immediately on open (PRD §9.7 de-emphasis signal).
    markVisited(videoId);

    const stopHeartbeat = (): void => {
      if (heartbeatRef.current !== null) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
    const stopGuardianHeartbeat = (): void => {
      if (guardianHeartbeatRef.current !== null) {
        clearInterval(guardianHeartbeatRef.current);
        guardianHeartbeatRef.current = null;
      }
    };
    const stopHandshakeRetry = (): void => {
      if (handshakeTimerRef.current !== null) {
        clearInterval(handshakeTimerRef.current);
        handshakeTimerRef.current = null;
      }
    };

    // Close any open segment (paused/ended/unmount) and persist it. Never starts a new video.
    const closeSegment = (): void => {
      const seg = mergeSegment(openSegRef.current, Date.now(), videoId, false);
      openSegRef.current = null;
      stopHeartbeat();
      if (seg) void recordActiveSegment(seg);
    };

    // A video that fails to embed (owner-restricted, region/age-locked, or removed) can navigate
    // its OWN iframe document to a different origin (an error interstitial, or about:blank) —
    // our postMessage calls keep targeting NOCOOKIE_ORIGIN regardless, which the browser then
    // refuses to deliver (a console "target origin does not match" notice). That mismatch must
    // never escape as an uncaught exception: every send is wrapped, and a detached/foreign iframe
    // node is never touched.
    const postToPlayer = (msg: unknown): void => {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.isConnected) return;
      const win = iframe.contentWindow;
      if (!win) return;
      try {
        win.postMessage(JSON.stringify(msg), NOCOOKIE_ORIGIN);
      } catch {
        /* noop — a failed postMessage (incl. origin mismatch) just means this attempt is lost;
           callers retry/escalate, and the handshake timeout below catches the "never came back"
           case rather than retrying forever against a page that will never answer. */
      }
    };

    // A restricted/unavailable video routes here — the SAME fallback UI as an explicit onError
    // message, and the deterministic iframe removal the cap/interrupt paths already use. Guarded
    // by `errored` so repeated triggers (multiple onError messages, a timeout firing after an
    // error already landed) are idempotent — no repeated state churn, no re-render loop.
    const failToEmbedFallback = (): void => {
      stopHandshakeRetry();
      setErrored((already) => {
        if (!already) setPlayerMounted(false);
        return true;
      });
    };

    // The "listening" handshake — without it, the widget never posts back a single event. Sent
    // immediately and retried on an interval (the exact timing of the widget's internal readiness
    // relative to the iframe's native `load` event is not guaranteed) until we've heard ANY
    // message back, or we give up after HANDSHAKE_MAX_ATTEMPTS. Giving up is distinct from an
    // explicit onError: some restricted/removed videos never post ANY widget event at all (the
    // iframe just shows YouTube's own static "video unavailable" placeholder) — silence for the
    // whole retry window is itself a failure-to-load signal and must also route to the fallback,
    // not retry forever.
    const startHandshake = (): void => {
      stopHandshakeRetry();
      let attempts = 0;
      const send = (): void => {
        attempts += 1;
        postToPlayer(buildListeningMessage(handshakeIdRef.current));
        if (attempts >= HANDSHAKE_MAX_ATTEMPTS) {
          stopHandshakeRetry();
          if (!handshakeAckedRef.current) failToEmbedFallback();
        }
      };
      send();
      handshakeTimerRef.current = setInterval(send, HANDSHAKE_RETRY_MS);
    };

    // Force-pause verification (PART 2): send pauseVideo, wait for a PAUSED state event within
    // PAUSE_CONFIRM_TIMEOUT_MS. Unconfirmed -> retry once -> still unconfirmed -> tell the caller
    // to unmount. Never resolves "confirmed" without an actual PAUSED event.
    const attemptPause = (): Promise<boolean> => {
      return new Promise((resolve) => {
        pendingPauseResolveRef.current = resolve;
        postToPlayer(buildCommandMessage("pauseVideo"));
        setTimeout(() => {
          if (pendingPauseResolveRef.current === resolve) {
            pendingPauseResolveRef.current = null;
            resolve(false);
          }
        }, PAUSE_CONFIRM_TIMEOUT_MS);
      });
    };
    const pauseAndConfirm = async (): Promise<boolean> => {
      let attempt = 0;
      for (;;) {
        attempt += 1;
        const confirmed = await attemptPause();
        const outcome = nextPauseAttemptOutcome(confirmed, attempt);
        if (outcome === "confirmed") return true;
        if (outcome === "escalate") return false;
        // "retry" — loop again.
      }
    };

    // Advance the guardian clock, persist (monotonic), broadcast to other tabs. Mandatory
    // ordering: exitFullscreen BEFORE the overlay; the cap is enforced by UNMOUNTING the iframe
    // (deterministic — never trusts a postMessage command); an interrupt sends pauseVideo and
    // only shows the interstitial once a PAUSED event actually confirms it, escalating to
    // unmount if it never does. Never resumes playback itself — every resume is an explicit
    // button handler below.
    const checkGuardian = async (now: number, playing: boolean): Promise<void> => {
      const todayKey = localDateKey(now);
      if (todayKey !== todayKeyRef.current) {
        // Midnight rollover mid-session: start the new day's clock fresh; playback itself is
        // untouched (only the accounting resets).
        guardianClockRef.current = { activeSec: 0, openStartedAtMs: playing ? now : null };
        interruptsShownRef.current = [];
        capReachedRef.current = false;
        todayKeyRef.current = todayKey;
      } else {
        guardianClockRef.current = tickActive(guardianClockRef.current, now, playing);
      }

      const activeSeconds = Math.floor(guardianClockRef.current.activeSec);
      const actions = decideGuardianActions({
        activeSeconds,
        interruptsShown: interruptsShownRef.current,
        capReached: capReachedRef.current,
        isFullscreen: typeof document !== "undefined" && Boolean(document.fullscreenElement),
      });

      for (const action of actions) {
        if (action.type === "exitFullscreen") {
          try {
            await document.exitFullscreen();
          } catch {
            /* best effort — some browsers reject exitFullscreen outside a user gesture */
          }
        } else if (action.type === "showLocked") {
          // The 2.5h cap: element removal, not a command. Deterministic regardless of whether
          // the iframe would have honored a pause message.
          setPlayerMounted(false);
          capReachedRef.current = true;
          setOverlay({ kind: "locked" });
        } else if (action.type === "showInterrupt") {
          const confirmed = await pauseAndConfirm();
          if (!confirmed) setPlayerMounted(false); // never show the interstitial over a maybe-still-playing video
          interruptsShownRef.current = [...interruptsShownRef.current, action.minutes];
          setOverlay({ kind: "interrupt1", minutes: action.minutes });
        }
        // action.type === "pause" (standalone) never appears without a showInterrupt/showLocked
        // right after it (see decideGuardianActions) — handled inline above, not here.
      }

      const toSave: WatchSession = {
        date: todayKeyRef.current,
        activeSeconds,
        interruptsShown: interruptsShownRef.current,
        capReached: capReachedRef.current,
      };
      const saved = await saveSession(toSave);
      broadcastSession(saved);
      // Adopt the monotonic-merged truth back in case another tab was ahead of this one.
      guardianClockRef.current = { ...guardianClockRef.current, activeSec: saved.activeSeconds };
      interruptsShownRef.current = saved.interruptsShown;
      capReachedRef.current = saved.capReached;
    };

    const handleStateChange = (state: number): void => {
      const playing = state === PLAYER_STATE.PLAYING;
      isPlayingRef.current = playing;

      // Focus limiter (unchanged): open/extend an active segment while PLAYING, close it
      // otherwise. ENDED closes the segment and does NOTHING else — there is NO autoplay and NO
      // next-video load (PRD §2 non-negotiable / PHASE_3_SPEC §9) except the one sanctioned
      // queue-advance via onEnded, wired up only by PlaylistWatchView.
      if (playing) {
        openSegRef.current = mergeSegment(openSegRef.current, Date.now(), videoId, true);
        if (openSegRef.current) void recordActiveSegment(openSegRef.current);
        if (heartbeatRef.current === null) {
          heartbeatRef.current = setInterval(() => {
            if (!openSegRef.current) return;
            openSegRef.current = mergeSegment(openSegRef.current, Date.now(), videoId, true);
            if (openSegRef.current) void recordActiveSegment(openSegRef.current);
          }, DEFAULT_SESSION_CONFIG.heartbeatSeconds * 1000);
        }
      } else {
        closeSegment();
      }

      // Resolve a pending force-pause verification the instant a real PAUSED event arrives.
      if (state === PLAYER_STATE.PAUSED && pendingPauseResolveRef.current) {
        const resolve = pendingPauseResolveRef.current;
        pendingPauseResolveRef.current = null;
        resolve(true);
      }

      // Guardian: check on every state change, and only heartbeat-checkpoint while playing
      // (mirrors the focus limiter's own heartbeat gating just above).
      void checkGuardian(Date.now(), playing);
      if (playing) {
        if (guardianHeartbeatRef.current === null) {
          guardianHeartbeatRef.current = setInterval(() => {
            void checkGuardian(Date.now(), true);
          }, GUARDIAN_HEARTBEAT_MS);
        }
      } else {
        stopGuardianHeartbeat();
      }

      if (state === PLAYER_STATE.ENDED) onEndedRef.current?.();
    };

    const onMessage = (event: MessageEvent): void => {
      if (!isTrustedWidgetOrigin(event.origin)) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const widgetEvent = parseWidgetMessage(event.data);
      if (widgetEvent.type === "unknown") return;

      // Any real message proves the channel is alive — stop retry-handshaking.
      if (!handshakeAckedRef.current) {
        handshakeAckedRef.current = true;
        stopHandshakeRetry();
      }

      if (widgetEvent.type === "error") {
        // Error info codes 2 (invalid id) / 5 (HTML5 error) / 100 (removed/private) / 101 & 150
        // (embedding disallowed by owner) — all route to the same interception fallback; the
        // player never distinguishes further than "this video isn't watchable here."
        failToEmbedFallback();
        return;
      }
      if (widgetEvent.type === "stateChange") {
        handleStateChange(widgetEvent.state);
      }
    };
    window.addEventListener("message", onMessage);

    const onVisibilityOrHide = (): void => {
      void checkGuardian(Date.now(), isPlayingRef.current);
    };
    document.addEventListener("visibilitychange", onVisibilityOrHide);
    window.addEventListener("pagehide", onVisibilityOrHide);

    if (playerMounted && embedSrc) startHandshake();

    return () => {
      cancelled = true;
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibilityOrHide);
      window.removeEventListener("pagehide", onVisibilityOrHide);
      stopHandshakeRetry();
      closeSegment();
      stopGuardianHeartbeat();
      void checkGuardian(Date.now(), false);
    };
  }, [videoId, embedSrc, playerMounted]);

  // --- Guardian overlay action handlers — every resume path is an explicit user choice here. ---

  function onDoneForNow(): void {
    setOverlay({ kind: "none" });
    router.push("/");
  }

  function onProceedToCheckin(): void {
    setOverlay((prev) => (prev.kind === "interrupt1" ? { kind: "checkin", minutes: prev.minutes } : prev));
  }

  function onStepAway(): void {
    setPlayerMounted(false);
    setOverlay({ kind: "steppedAway" });
  }

  function onMessageSomeone(): void {
    if (!whatsappNumber) return;
    try {
      window.open(buildWhatsAppLink(whatsappNumber), "_blank", "noopener,noreferrer");
    } catch {
      /* the AI/messaging doors are optional and powerless — a failure to open changes nothing */
    }
  }

  function onGoToJournal(): void {
    setOverlay((prev) => (prev.kind === "checkin" ? { kind: "journal", minutes: prev.minutes, saved: false } : prev));
  }

  function onSaveJournal(text: string): void {
    if (!text.trim()) return;
    const now = new Date();
    void addJournalEntry({ date: localDateKey(now.getTime()), text: text.trim(), createdAt: now.toISOString() });
    setOverlay((prev) => (prev.kind === "journal" ? { ...prev, saved: true } : prev));
  }

  function onTalkToAI(): void {
    try {
      window.open(buildChatGptCheckinUrl(), "_blank", "noopener,noreferrer");
    } catch {
      /* optional and powerless — see invariants; the guardian behaves identically either way */
    }
  }

  function onResume(): void {
    // Re-mounting a fresh iframe (rather than trying to command a possibly-torn-down one back to
    // life) is the deterministic choice here too — a new embed always starts from a known state.
    setErrored(false);
    setPlayerMounted(true);
    setEmbedSrc(buildEmbedUrl(videoId, window.location.origin));
    setOverlay({ kind: "none" });
  }

  function onBackToFeed(): void {
    router.push("/");
  }

  if (errored) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-zinc-900 p-6 text-center">
        <p className="text-sm text-zinc-300">
          This video can&rsquo;t be embedded and isn&rsquo;t available under the current network
          block (the owner restricted external playback, and youtube.com itself is blocked on
          this network).
        </p>
        {/* Not a live link — youtube.com is DNS-blocked on this network, so a clickable "Watch on
            YouTube" button would just point at a sinkholed domain. Shown as inert text only so
            the same video can be found manually on another, unblocked device. */}
        <p className="select-all rounded-lg bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-500">
          https://www.youtube.com/watch?v={videoId}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl">
        {playerMounted && embedSrc && (
          <iframe
            ref={iframeRef}
            key={embedSrc}
            src={embedSrc}
            title="HalalTube player"
            className="h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        )}
      </div>
      <GuardianOverlay
        state={overlay}
        whatsappNumber={whatsappNumber}
        onDoneForNow={onDoneForNow}
        onProceedToCheckin={onProceedToCheckin}
        onStepAway={onStepAway}
        onMessageSomeone={onMessageSomeone}
        onGoToJournal={onGoToJournal}
        onSaveJournal={onSaveJournal}
        onTalkToAI={onTalkToAI}
        onResume={onResume}
        onBackToFeed={onBackToFeed}
      />
    </>
  );
}
