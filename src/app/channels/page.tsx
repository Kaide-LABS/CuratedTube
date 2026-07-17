"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { ChannelCandidateSchema, type ChannelAddition, type ChannelCandidate } from "@/lib/types";
import { addUserChannel, getUserChannels, removeUserChannel } from "@/lib/userChannels";

const ErrorResponseSchema = z.object({ error: z.string() });

const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "1 · Beneficial",
  2: "2 · Educational",
  3: "3 · Entertainment",
};

/**
 * Add-channels-by-URL surface (IndexedDB overlay on the read-only baked roster). Never linked
 * from the home feed — reachable only via the header nav (see layout.tsx), same as Watch Later.
 */
export default function ChannelsPage() {
  const [additions, setAdditions] = useState<ChannelAddition[]>([]);
  const [url, setUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ChannelCandidate | null>(null);
  const [category, setCategory] = useState("");
  const [tier, setTier] = useState<1 | 2 | 3 | "">("");
  const [saving, setSaving] = useState(false);

  const refresh = () => {
    getUserChannels().then(setAdditions);
  };

  useEffect(() => {
    refresh();
  }, []);

  async function onResolve(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!url.trim()) return;
    setResolving(true);
    setError(null);
    setCandidate(null);
    setCategory("");
    setTier("");
    try {
      const res = await fetch("/api/channels/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          existingIds: additions.map((a) => a.channelId),
        }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        setError(ErrorResponseSchema.parse(body).error);
        return;
      }
      setCandidate(ChannelCandidateSchema.parse(body));
    } catch {
      setError("Could not resolve that channel. Check the URL and try again.");
    } finally {
      setResolving(false);
    }
  }

  async function onSave(): Promise<void> {
    if (!candidate || !category.trim() || tier === "") return;
    setSaving(true);
    try {
      const addition: ChannelAddition = {
        channelId: candidate.channelId,
        handle: candidate.handle,
        uploadsPlaylistId: candidate.uploadsPlaylistId,
        title: candidate.title,
        avatarUrl: candidate.avatarUrl,
        subscriberCount: candidate.subscriberCount,
        category: category.trim(),
        tier,
        addedAt: new Date().toISOString(),
      };
      await addUserChannel(addition);
      refresh();
      setCandidate(null);
      setUrl("");
      setCategory("");
      setTier("");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(channelId: string): Promise<void> {
    await removeUserChannel(channelId);
    refresh();
  }

  const canSave = candidate !== null && category.trim().length > 0 && tier !== "";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold text-zinc-100">Add a channel</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Paste a channel URL or @handle. It resolves against the YouTube Data API, then you pick
        a category and tier before it joins your feed — nothing is saved until you confirm.
      </p>

      <form onSubmit={(e) => void onResolve(e)} className="mt-6 flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/@handle"
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={resolving || !url.trim()}
          className="rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {resolving ? "Resolving…" : "Resolve"}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {candidate && (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="flex items-center gap-3">
            {candidate.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={candidate.avatarUrl}
                alt=""
                className="h-12 w-12 rounded-full object-cover"
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-zinc-800" />
            )}
            <div>
              <p className="font-medium text-zinc-100">{candidate.title}</p>
              <p className="text-xs text-zinc-500">
                {candidate.subscriberCount.toLocaleString()} subscribers ·{" "}
                {candidate.longformCount} long-form video{candidate.longformCount === 1 ? "" : "s"}{" "}
                found
              </p>
            </div>
          </div>

          {candidate.warnings.duplicate && (
            <p className="mt-3 rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
              This channel is already in your roster (baked or previously added).
            </p>
          )}
          {candidate.warnings.shortsOnly && (
            <p className="mt-3 rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
              No long-form uploads found — this channel looks Shorts-only or empty. You can still
              save it, but it may never surface any videos.
            </p>
          )}
          {candidate.warnings.usedUU && (
            <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
              Long-form playlist unavailable — falling back to the full uploads list with Shorts
              filtered out.
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-xs text-zinc-400">
              Category
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Islamic"
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
              />
            </label>
            <label className="text-xs text-zinc-400">
              Tier
              <select
                value={tier}
                onChange={(e) => setTier(Number(e.target.value) as 1 | 2 | 3)}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
              >
                <option value="">Choose…</option>
                {([1, 2, 3] as const).map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!canSave || saving}
            className="mt-4 w-full rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save channel"}
          </button>
        </div>
      )}

      <h2 className="mt-10 text-sm font-semibold text-zinc-100">Your added channels</h2>
      {additions.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">No channels added yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {additions.map((a) => (
            <li key={a.channelId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                {a.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-zinc-800" />
                )}
                <div>
                  <p className="text-sm text-zinc-100">{a.title}</p>
                  <p className="text-xs text-zinc-500">
                    {a.category} · Tier {a.tier}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onRemove(a.channelId)}
                className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
