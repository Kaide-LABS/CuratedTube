// Break prompt modal (Implements PHASE_3_SPEC.md §6). Shown when active playback crosses the
// rolling-window limit (PRD §6 / context.md §5). Its sole purpose is to REDUCE time-on-app: a
// calm nudge with a dismiss (snooze) and a go-home action. No resume countdown, no streaks, no
// urgency cue — that would invert the north star (the anti-distraction boundary, PHASE_3_SPEC §0).
"use client";

/** Calm, focus-protecting break modal. `onDismiss` snoozes; `onGoHome` leaves the watch flow. */
export function BreakPrompt({
  minutes,
  onDismiss,
  onGoHome,
}: {
  minutes: number;
  onDismiss: () => void;
  onGoHome: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="break-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-center shadow-2xl">
        <h2 id="break-title" className="text-lg font-semibold text-zinc-100">
          Time for a break?
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          You&rsquo;ve been watching for about {minutes} minutes in the last few hours. The feed
          isn&rsquo;t going anywhere — step away and come back later.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={onGoHome}
            className="rounded-full bg-zinc-100 px-5 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
          >
            Take a break
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full px-5 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200"
          >
            Keep watching
          </button>
        </div>
      </div>
    </div>
  );
}
