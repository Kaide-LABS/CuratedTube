"use client";

import { useEffect, useState } from "react";
import { getGuardianSettings, saveGuardianSettings } from "@/lib/watchGuardianStore";

/**
 * Settings — currently just the watch-time guardian's preset WhatsApp contact ("Message
 * someone" door on the 30/60/90-minute check-in). The 2h cap and the 30/60/90 thresholds
 * themselves are intentionally NOT editable anywhere in the UI — self-binding is the point.
 */
export default function SettingsPage() {
  const [number, setNumber] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getGuardianSettings().then((s) => {
      setNumber(s.whatsappNumber);
      setLoading(false);
    });
  }, []);

  async function onSave(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const digits = number.replace(/\D/g, "");
    await saveGuardianSettings({ id: "default", whatsappNumber: digits });
    setNumber(digits);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-xl font-semibold text-zinc-100">Settings</h1>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="text-sm font-semibold text-zinc-100">Watch-time check-in contact</h2>
        <p className="mt-1 text-sm text-zinc-400">
          When a 30/60/90-minute check-in appears, &ldquo;Message someone&rdquo; opens a WhatsApp
          chat with this number. International format, digits only — no spaces or a leading
          &ldquo;+&rdquo; needed.
        </p>

        {loading ? (
          <p className="mt-4 text-sm text-zinc-500">Loading…</p>
        ) : (
          <form onSubmit={(e) => void onSave(e)} className="mt-4 flex gap-2">
            <input
              type="tel"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="15551234567"
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              Save
            </button>
          </form>
        )}
        {saved && <p className="mt-2 text-xs text-emerald-400">Saved.</p>}
      </section>

      <p className="mt-6 text-xs text-zinc-600">
        The 2-hour daily cap and the 30/60/90-minute check-in thresholds are not editable here —
        that&rsquo;s deliberate.
      </p>
    </div>
  );
}
