"use client";

import { useEffect, useState } from "react";

type Snapshot = {
  total: number;
  daily: number;
  pct: number;
  alert: boolean;
  savedUnits: number;
  visible: boolean;
};

/** Dev-only Data API unit counter. Hidden in production unless CT_SHOW_QUOTA=1 (PHASE_4_SPEC §4). */
export function QuotaBadge() {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/quota")
        .then((r) => r.json())
        .then((s) => alive && setSnap(s))
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Hidden until loaded, and hidden in production unless the server opts the badge in.
  if (!snap || !snap.visible) return null;

  return (
    <span
      title={`YouTube Data API units used today (resets every 24h). ${snap.savedUnits} units saved via 304s.`}
      className={`rounded-full border px-2.5 py-1 font-mono text-xs ${
        snap.alert
          ? "border-red-800 bg-red-950/60 text-red-300"
          : "border-zinc-800 bg-zinc-900 text-zinc-400"
      }`}
    >
      {snap.total}/{snap.daily} units
    </span>
  );
}
