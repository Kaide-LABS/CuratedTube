"use client";

import { useEffect, useRef, useState } from "react";
import { markVisited } from "@/lib/watchState";

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
// in-channel only; modestbranding is deprecated and omitted; iv_load_policy=3 hides
// annotations; playsinline=1 avoids forced iOS fullscreen.
const PLAYER_VARS = {
  rel: 0,
  controls: 1,
  playsinline: 1,
  iv_load_policy: 3,
  disablekb: 0,
  fs: 1,
  color: "white",
  modestbranding: 1, // harmless no-op; kept for older clients
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

export function WatchPlayer({ videoId }: { videoId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Record the visit immediately on open (PRD §9.7 de-emphasis signal).
    markVisited(videoId);

    loadIframeApi().then(() => {
      if (cancelled || !hostRef.current || !window.YT?.Player) return;
      playerRef.current = new window.YT.Player(hostRef.current, {
        videoId,
        playerVars: { ...PLAYER_VARS },
        events: {
          // onError 101/150 (identical) + 153 => embedding restricted; show the link
          // fallback rather than a blank player (PRD §5.3).
          onError: (e) => {
            if (e.data === 101 || e.data === 150 || e.data === 153) setErrored(true);
          },
        },
      });
    });

    return () => {
      cancelled = true;
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
