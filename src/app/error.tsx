// Top-level error boundary (Implements PHASE_3_SPEC.md §6). A calm recovery screen with a working
// reset — never a blank page. App Router error boundaries must be client components.
"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // Surface to the console for debugging; no external telemetry (single-user, no backend).
    console.error(error);
  }, [error]);

  return (
    <div className="px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold text-zinc-100">Something went wrong</h1>
      <p className="mt-2 text-sm text-zinc-500">
        That didn&rsquo;t load. You can try again without leaving your curated set.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 inline-block rounded-full bg-zinc-100 px-5 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
      >
        Try again
      </button>
    </div>
  );
}
