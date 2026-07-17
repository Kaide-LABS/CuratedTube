// PWA install affordance (Implements PHASE_3_SPEC.md §6; PRD §9 / context.md §9). Captures
// `beforeinstallprompt` on Android/Chromium for a one-tap install; on iOS/Safari (no such event)
// shows the manual "Add to Home Screen" helper. Also registers the offline-shell service worker.
// Purely an install convenience — no notifications, no push, no background sync (PHASE_3_SPEC §9).
"use client";

import { useEffect, useState } from "react";

// Minimal typing for the non-standard beforeinstallprompt event (Chromium only).
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || iosStandalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/** Install button (Chromium) or "Add to Home Screen" helper (iOS); registers the service worker. */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [installed, setInstalled] = useState(true); // assume installed until mount proves otherwise

  useEffect(() => {
    // Register the offline-shell service worker (progressive; failure is non-fatal).
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* SW unsupported / blocked — app still works online */
      });
    }

    setInstalled(isStandalone());

    const onBeforeInstall = (e: Event): void => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const onClick = async (): Promise<void> => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else if (isIOS()) {
      setShowIosHelp(true);
    }
  };

  // Show the button only when we can actually act (Chromium prompt available, or iOS helper).
  if (!deferred && !isIOS()) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => void onClick()}
        className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
      >
        Install app
      </button>

      {showIosHelp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-center shadow-2xl">
            <h2 id="ios-install-title" className="text-lg font-semibold text-zinc-100">
              Add to Home Screen
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              In Safari, tap the Share button, then choose{" "}
              <span className="font-medium text-zinc-200">Add to Home Screen</span> to install
              HalalTube.
            </p>
            <button
              type="button"
              onClick={() => setShowIosHelp(false)}
              className="mt-6 rounded-full bg-zinc-100 px-5 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
