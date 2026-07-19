"use client";

import { useState } from "react";
import type { InterruptThresholdMin } from "@/lib/watchGuardian";

export type GuardianOverlayState =
  | { kind: "none" }
  | { kind: "interrupt1"; minutes: InterruptThresholdMin }
  | { kind: "checkin"; minutes: InterruptThresholdMin }
  | { kind: "journal"; minutes: InterruptThresholdMin; saved: boolean }
  | { kind: "steppedAway" }
  | { kind: "locked" };

const overlayBase =
  "fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4";
const cardBase =
  "w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-center shadow-2xl";
const primaryButton =
  "w-full rounded-full bg-zinc-100 px-5 py-2 text-sm font-medium text-zinc-900 hover:bg-white";
const secondaryButton =
  "w-full rounded-full border border-zinc-700 px-5 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-900";

/**
 * Every watch-time guardian overlay in one component, switched on `state.kind`. Renders nothing
 * for `{ kind: "none" }`. Each overlay is a dead end unless the user picks an explicit action —
 * there is no auto-dismiss, no timeout, no implicit resume anywhere in this file.
 */
export function GuardianOverlay({
  state,
  whatsappNumber,
  onDoneForNow,
  onProceedToCheckin,
  onStepAway,
  onMessageSomeone,
  onGoToJournal,
  onSaveJournal,
  onTalkToAI,
  onResume,
  onBackToFeed,
}: {
  state: GuardianOverlayState;
  whatsappNumber: string;
  onDoneForNow: () => void;
  /** Interrupt 1's "Keep watching" — advances to the check-in, does NOT resume playback yet. */
  onProceedToCheckin: () => void;
  onStepAway: () => void;
  onMessageSomeone: () => void;
  onGoToJournal: () => void;
  onSaveJournal: (text: string) => void;
  onTalkToAI: () => void;
  /** The check-in's (or post-journal) "Keep watching" — actually resumes playback. */
  onResume: () => void;
  onBackToFeed: () => void;
}) {
  if (state.kind === "none") return null;

  if (state.kind === "interrupt1") {
    return (
      <div role="dialog" aria-modal="true" aria-labelledby="guardian-title" className={overlayBase}>
        <div className={cardBase}>
          <h2 id="guardian-title" className="text-lg font-semibold text-zinc-100">
            You&rsquo;ve been watching for {state.minutes} minutes.
          </h2>
          <p className="mt-2 text-sm text-zinc-400">Probably time for a break.</p>
          <div className="mt-6 flex flex-col gap-2">
            <button type="button" onClick={onDoneForNow} className={primaryButton}>
              I&rsquo;m done for now
            </button>
            <button type="button" onClick={onProceedToCheckin} className={secondaryButton}>
              Keep watching
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "checkin") {
    return (
      <div role="dialog" aria-modal="true" aria-labelledby="guardian-title" className={overlayBase}>
        <div className={cardBase}>
          <h2 id="guardian-title" className="text-lg font-semibold text-zinc-100">
            Are you okay?
          </h2>
          <p className="mt-2 text-sm text-zinc-400">
            Sometimes we watch to avoid something heavier. What do you need right now?
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <button type="button" onClick={onStepAway} className={primaryButton}>
              Step away / salah
            </button>
            <button
              type="button"
              onClick={onMessageSomeone}
              disabled={!whatsappNumber}
              className={`${secondaryButton} disabled:cursor-not-allowed disabled:opacity-40`}
              title={whatsappNumber ? undefined : "Set a contact in Settings first"}
            >
              Message someone
            </button>
            <button type="button" onClick={onGoToJournal} className={secondaryButton}>
              Write it down
            </button>
            <button type="button" onClick={onTalkToAI} className={secondaryButton}>
              Talk it through with AI
            </button>
            <button
              type="button"
              onClick={onResume}
              className="mt-2 px-5 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-300"
            >
              Keep watching
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "journal") {
    return <JournalCard state={state} onSave={onSaveJournal} onStepAway={onStepAway} onKeepWatching={onResume} />;
  }

  if (state.kind === "steppedAway") {
    return (
      <div className={overlayBase}>
        <div className={cardBase}>
          <h2 className="text-lg font-semibold text-zinc-100">Take the moment you need.</h2>
          <p className="mt-2 text-sm text-zinc-400">The player is closed. Come back whenever you&rsquo;re ready.</p>
          <button type="button" onClick={onBackToFeed} className={`${primaryButton} mt-6`}>
            Back to feed
          </button>
        </div>
      </div>
    );
  }

  // state.kind === "locked"
  return (
    <div className={overlayBase}>
      <div className={cardBase}>
        <h2 className="text-lg font-semibold text-zinc-100">You&rsquo;ve reached today&rsquo;s 2-hour limit.</h2>
        <p className="mt-2 text-sm text-zinc-400">HalalTube is closed until tomorrow.</p>
      </div>
    </div>
  );
}

function JournalCard({
  state,
  onSave,
  onStepAway,
  onKeepWatching,
}: {
  state: { saved: boolean };
  onSave: (text: string) => void;
  onStepAway: () => void;
  onKeepWatching: () => void;
}) {
  const [text, setText] = useState("");

  if (state.saved) {
    return (
      <div role="dialog" aria-modal="true" className={overlayBase}>
        <div className={cardBase}>
          <h2 className="text-lg font-semibold text-zinc-100">Saved — just for you.</h2>
          <p className="mt-2 text-sm text-zinc-400">Nothing here leaves this device.</p>
          <div className="mt-6 flex flex-col gap-2">
            <button type="button" onClick={onStepAway} className={primaryButton}>
              Step away
            </button>
            <button type="button" onClick={onKeepWatching} className={secondaryButton}>
              Keep watching
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div role="dialog" aria-modal="true" className={overlayBase}>
      <div className={cardBase}>
        <h2 className="text-lg font-semibold text-zinc-100">Write it down.</h2>
        <p className="mt-2 text-sm text-zinc-400">A couple of lines. Private, saved only on this device.</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="What's actually going on right now?"
          className="mt-4 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => onSave(text)}
          disabled={!text.trim()}
          className={`${primaryButton} mt-4 disabled:cursor-not-allowed disabled:opacity-40`}
        >
          Save
        </button>
      </div>
    </div>
  );
}
