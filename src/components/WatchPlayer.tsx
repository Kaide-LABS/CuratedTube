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
  type GuardianAction,
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
import { GuardianOverlay, type GuardianOverlayState } from "./WatchGuardianOverlays";

// Minimal typings for the IFrame Player API surface we use.
type YTPlayer = { destroy: () => void; pauseVideo: () => void; playVideo: () => void };
type YTPlayerEvent = { data: number };
type YTErrorEvent = { data: number };
declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement,
        opts: {
          host?: string;
          videoId: string;
          playerVars: Record<string, number | string>;
          events: {
            onReady?: () => void;
            onStateChange?: (e: YTPlayerEvent) => void;
            onError?: (e: YTErrorEvent) => void;
          };
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Locked distraction-suppressing params (Pass A, 2026-06-29). rel=0 keeps related videos
// in-channel only; iv_load_policy=3 hides annotations; playsinline=1 avoids forced iOS
// fullscreen. modestbranding is deprecated (Aug 2023, no effect) and is OMITTED per the
// locked set in CuratedTube_PRD.md §10 / CuratedTube_context.md §8.
//
// enablejsapi=1 (required for pauseVideo()/playVideo() and state-change events, which both the
// focus limiter below and the watch-time guardian depend on) is NOT listed here because it isn't
// a playerVars key you set yourself — the official IFrame Player API script (loaded via
// loadIframeApi() below and constructed with `new YT.Player(...)`) always adds it to the
// embedded iframe's URL automatically. A raw hand-built <iframe src="..."> would need it added
// manually; this component never builds one.
const PLAYER_VARS = {
  rel: 0,
  controls: 1,
  playsinline: 1,
  iv_load_policy: 3,
  disablekb: 0,
  fs: 1,
  color: "white",
} as const;

let apiLoading: Promise<void> | null = null;
function loadIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiLoading) return apiLoading;
  apiLoading = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiLoading;
}

// YouTube IFrame player state codes (only PLAYING is "active" for the focus limiter + guardian).
const YT_PLAYING = 1;
const YT_ENDED = 0;
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
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);
  // Focus-limiter bookkeeping: the currently-open active-playback segment + its heartbeat timer.
  // The heartbeat keeps the persisted segment's endedAt fresh so an abandoned tab cannot inflate
  // active time (PHASE_3_SPEC §6). None of this advances playback — it only records activity.
  const openSegRef = useRef<SessionSegment | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [errored, setErrored] = useState(false);

  // --- Watch-time guardian bookkeeping (self-binding 2h/day cap + 30/60/90 staged interrupts).
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

  // Resolve today's session (clock-guard reconciled) + settings BEFORE the player is allowed to
  // exist, so an already-capped day never even loads the IFrame API (the "guard at player
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
      if (session.capReached) setOverlay({ kind: "locked" });
      setGuardianReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Adopt another tab's progress (multi-tab safety): merge, never regress, and reflect a cap
  // reached in another tab immediately (a second tab shouldn't be able to keep playing past it).
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
        try {
          playerRef.current?.pauseVideo();
        } catch {
          /* noop */
        }
        setOverlay({ kind: "locked" });
      }
    });
  }, []);

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

    // Close any open segment (paused/ended/unmount) and persist it. Never starts a new video.
    const closeSegment = (): void => {
      const seg = mergeSegment(openSegRef.current, Date.now(), videoId, false);
      openSegRef.current = null;
      stopHeartbeat();
      if (seg) void recordActiveSegment(seg);
    };

    // Advance the guardian clock, persist (monotonic), broadcast to other tabs, and — the
    // mandatory ordering — exitFullscreen BEFORE the overlay, force-pause, THEN show it. Never
    // resumes playback itself; every resume path is an explicit button handler below.
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
      const actions: GuardianAction[] = decideGuardianActions({
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
        } else if (action.type === "pause") {
          try {
            playerRef.current?.pauseVideo();
          } catch {
            /* noop */
          }
        } else if (action.type === "showInterrupt") {
          interruptsShownRef.current = [...interruptsShownRef.current, action.minutes];
          setOverlay({ kind: "interrupt1", minutes: action.minutes });
        } else if (action.type === "showLocked") {
          capReachedRef.current = true;
          setOverlay({ kind: "locked" });
        }
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

    const onVisibilityOrHide = (): void => {
      void checkGuardian(Date.now(), isPlayingRef.current);
    };
    document.addEventListener("visibilitychange", onVisibilityOrHide);
    window.addEventListener("pagehide", onVisibilityOrHide);

    // Never even loads the IFrame API for an already-capped day (guard at player creation).
    if (!guardianReady || capReachedRef.current) {
      return () => {
        cancelled = true;
        document.removeEventListener("visibilitychange", onVisibilityOrHide);
        window.removeEventListener("pagehide", onVisibilityOrHide);
      };
    }

    loadIframeApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT?.Player) return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        // Privacy-enhanced embed host: youtube-nocookie.com sets no tracking cookies until the
        // user plays, and is friendlier to network/DNS blocks of youtube.com proper (the CSP
        // frame-src allows it — see next.config.mjs). The IFrame API loader script still comes
        // from www.youtube.com; only the player iframe origin changes.
        host: "https://www.youtube-nocookie.com",
        videoId,
        playerVars: { ...PLAYER_VARS },
        events: {
          // Any player error (2 invalid id, 5 HTML5 failure, 100 removed/private, 101/150/153
          // embedding restricted) => show the "Watch on YouTube" link instead of leaving YouTube's
          // own cryptic error screen ("An error occurred… Playback ID …") in the iframe (PRD §5.3:
          // never a blank/dead player). The direct link always works even when embedded playback
          // fails (owner-disabled embedding, region/age lock, or a browser blocker of googlevideo).
          onError: () => {
            setErrored(true);
          },
          onStateChange: (e) => {
            const playing = e.data === YT_PLAYING;
            isPlayingRef.current = playing;

            // Focus limiter (unchanged): open/extend an active segment while PLAYING, close it
            // otherwise. ENDED (data === 0) closes the segment and does NOTHING else — there is
            // NO autoplay and NO next-video load (PRD §2 non-negotiable / PHASE_3_SPEC §9).
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

            // Queue-advance (see the onEnded prop doc above): fires only for a caller that
            // opted in, only on a natural ENDED transition — never on pause/buffering, never
            // wired up outside queue playback.
            if (e.data === YT_ENDED) onEndedRef.current?.();
          },
        },
      });
    });

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityOrHide);
      window.removeEventListener("pagehide", onVisibilityOrHide);
      closeSegment();
      stopGuardianHeartbeat();
      void checkGuardian(Date.now(), false);
      try {
        playerRef.current?.destroy();
      } catch {
        /* noop */
      }
      playerRef.current = null;
    };
  }, [videoId, guardianReady]);

  // --- Guardian overlay action handlers — every resume path is an explicit user choice here. ---

  function onDoneForNow(): void {
    setOverlay({ kind: "none" });
    router.push("/");
  }

  function onProceedToCheckin(): void {
    setOverlay((prev) => (prev.kind === "interrupt1" ? { kind: "checkin", minutes: prev.minutes } : prev));
  }

  function destroyPlayer(): void {
    try {
      playerRef.current?.pauseVideo();
      playerRef.current?.destroy();
    } catch {
      /* noop */
    }
    playerRef.current = null;
  }

  function onStepAway(): void {
    destroyPlayer();
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
    setOverlay({ kind: "none" });
    try {
      playerRef.current?.playVideo();
    } catch {
      /* noop */
    }
  }

  function onBackToFeed(): void {
    router.push("/");
  }

  if (errored) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-zinc-900 p-6 text-center">
        <p className="text-sm text-zinc-300">
          This video can&rsquo;t be embedded (the owner restricted external playback).
        </p>
        <a
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
        >
          Watch on YouTube ↗
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl">
        {/* The API replaces this div with the player iframe. */}
        <div ref={hostRef} className="h-full w-full" />
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
