// Session guard (Implements PHASE_3_SPEC.md §6). Mounted once in the root layout. Polls the
// rolling-window active-playback total and renders the BreakPrompt past the limit; dismissal
// snoozes. It houses NO playback logic (that lives in WatchPlayer) and the only timer it owns
// READS state to discourage over-use — it never advances playback (anti-distraction, §0).
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { activeMsInWindow, shouldPromptBreak } from "@/lib/session";
import { clearExpired, getSegments } from "@/lib/sessionStore";
import { DEFAULT_SESSION_CONFIG } from "@/lib/session-config";
import { BreakPrompt } from "./BreakPrompt";

const CFG = DEFAULT_SESSION_CONFIG;
const WINDOW_MS = CFG.rollingWindowHours * 3_600_000;

/** Background focus monitor: shows a break prompt when active watch time crosses the limit. */
export function SessionGuard() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [activeMinutes, setActiveMinutes] = useState(0);
  const snoozeUntilRef = useRef(0);

  useEffect(() => {
    let alive = true;

    const tick = async (): Promise<void> => {
      const now = Date.now();
      const segs = await getSegments();
      const activeMs = activeMsInWindow(segs, now, WINDOW_MS);
      if (!alive) return;
      if (shouldPromptBreak(activeMs, CFG) && now >= snoozeUntilRef.current) {
        setActiveMinutes(Math.round(activeMs / 60_000));
        setShow(true);
      }
      void clearExpired(now, WINDOW_MS);
    };

    void tick();
    const id = setInterval(() => void tick(), CFG.pollSeconds * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const onDismiss = useCallback(() => {
    snoozeUntilRef.current = Date.now() + CFG.snoozeMinutes * 60_000;
    setShow(false);
  }, []);

  const onGoHome = useCallback(() => {
    snoozeUntilRef.current = Date.now() + CFG.snoozeMinutes * 60_000;
    setShow(false);
    router.push("/");
  }, [router]);

  if (!show) return null;
  return <BreakPrompt minutes={activeMinutes} onDismiss={onDismiss} onGoHome={onGoHome} />;
}
