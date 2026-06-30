"use client";

import { useEffect, useRef, useState } from "react";
import { markVisited } from "@/lib/watchState";
import { recordActiveSegment } from "@/lib/sessionStore";
import { mergeSegment } from "@/lib/session";
import { DEFAULT_SESSION_CONFIG } from "@/lib/session-config";
import type { SessionSegment } from "@/lib/types";

// Minimal typings for the IFrame Player API surface we use.
type YTPlayer = { destroy: () => void };
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

// YouTube IFrame player state codes (only PLAYING is "active" for the session limiter).
const YT_PLAYING = 1;

export function WatchPlayer({ videoId }: { videoId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  // Focus-limiter bookkeeping: the currently-open active-playback segment + its heartbeat timer.
  // The heartbeat keeps the persisted segment's endedAt fresh so an abandoned tab cannot inflate
  // active time (PHASE_3_SPEC §6). None of this advances playback — it only records activity.
  const openSegRef = useRef<SessionSegment | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [errored, setErrored] = useState(false);

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

    // Close any open segment (paused/ended/unmount) and persist it. Never starts a new video.
    const closeSegment = (): void => {
      const seg = mergeSegment(openSegRef.current, Date.now(), videoId, false);
      openSegRef.current = null;
      stopHeartbeat();
      if (seg) void recordActiveSegment(seg);
    };

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
          // onError 101/150 (identical) + 153 => embedding restricted; show the link
          // fallback rather than a blank player (PRD §5.3).
          onError: (e) => {
            if (e.data === 101 || e.data === 150 || e.data === 153) setErrored(true);
          },
          // Focus limiter only: open/extend an active segment while PLAYING, close it otherwise.
          // ENDED (data === 0) closes the segment and does NOTHING else — there is NO autoplay
          // and NO next-video load (PRD §2 non-negotiable / PHASE_3_SPEC §9).
          onStateChange: (e) => {
            const playing = e.data === YT_PLAYING;
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
          },
        },
      });
    });

    return () => {
      cancelled = true;
      closeSegment();
      try {
        playerRef.current?.destroy();
      } catch {
        /* noop */
      }
      playerRef.current = null;
    };
  }, [videoId]);

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
    <div className="aspect-video w-full overflow-hidden rounded-xl bg-black shadow-2xl">
      {/* The API replaces this div with the player iframe. */}
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
