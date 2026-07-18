"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  ChannelCandidateSchema,
  RosterRowSchema,
  type ChannelAddition,
  type ChannelCandidate,
  type RosterRow,
  type Tier,
} from "@/lib/types";
import { mergeRosterRows, promoteParkedRow } from "@/lib/channels";
import { addUserChannel, getUserChannels, removeUserChannel } from "@/lib/userChannels";
import {
  getSuppressedChannels,
  suppressChannel,
  unsuppressChannel,
} from "@/lib/suppressedChannels";

const ErrorResponseSchema = z.object({ error: z.string() });
const RosterResponseSchema = z.object({ rows: z.array(RosterRowSchema) });

const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: "1 · Beneficial",
  2: "2 · Educational",
  3: "3 · Entertainment",
};

const TIER_WEIGHT_NOTE: Record<1 | 2 | 3, string> = {
  1: "15 home-feed slots",
  2: "9 home-feed slots",
  3: "0 home-feed slots — channel page only",
};

const PAGE_SIZE = 24;

function subCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Channel Library — the app's "subscriptions" page. ONE surface: browse the effective roster
 * (baked channels.json + IndexedDB user additions, addition wins), add a channel by URL, remove
 * any channel (base or added), and classify a parked channel. Never linked from the home feed
 * body — only from the header nav, same as Watch Later.
 *
 * "Remove" is a single verb in the UI regardless of source, but the mechanism it triggers still
 * differs: an added channel is hard-deleted (nothing to restore); a base channel gets a
 * reversible suppression record, restorable from the tucked-away "Recently removed" drawer at
 * the bottom of the page — not an always-visible section.
 */
export default function ChannelsPage() {
  const [baseRows, setBaseRows] = useState<RosterRow[]>([]);
  const [additions, setAdditions] = useState<ChannelAddition[]>([]);
  const [suppressedIds, setSuppressedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<string | null>(null);

  // Add-by-URL flow (unchanged from the original add-channels-by-URL feature).
  const [url, setUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ChannelCandidate | null>(null);
  const [category, setCategory] = useState("");
  const [tier, setTier] = useState<1 | 2 | 3 | "">("");
  const [saving, setSaving] = useState(false);

  const refreshAdditions = () => {
    getUserChannels().then(setAdditions);
  };

  const refreshSuppressed = () => {
    getSuppressedChannels().then((s) => setSuppressedIds(s.map((r) => r.channelId)));
  };

  useEffect(() => {
    refreshAdditions();
    refreshSuppressed();
    fetch("/api/channels/roster")
      .then((r) => r.json())
      .then((body) => setBaseRows(RosterResponseSchema.parse(body).rows))
      .finally(() => setLoading(false));
  }, []);

  // Effective roster = base + additions - suppressed, deduped by channelId, addition wins over
  // both a same-channelId base row AND any prior suppression. Same merge the feed builder uses
  // (mergeAdditionVideos mirrors this at the video level) — reused here, not reimplemented.
  const effectiveRoster = useMemo(
    () => mergeRosterRows(baseRows, additions, suppressedIds),
    [baseRows, additions, suppressedIds],
  );

  // Recently removed base channels: their original base rows, kept around (unlike the effective
  // roster) so the tucked-away "Recently removed" drawer can still show what they were and offer
  // a Restore action. An added channel is hard-deleted on removal and never appears here.
  const recentlyRemovedRows = useMemo(() => {
    const suppressed = new Set(suppressedIds);
    const addedIds = new Set(additions.map((a) => a.channelId));
    return baseRows.filter((r) => suppressed.has(r.channelId) && !addedIds.has(r.channelId));
  }, [baseRows, suppressedIds, additions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return effectiveRoster;
    return effectiveRoster.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.handle.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q),
    );
  }, [effectiveRoster, query]);

  const active = filtered.filter((r) => !r.parked);
  const parked = filtered.filter((r) => r.parked);
  const tier1 = active.filter((r) => r.tier === 1);
  const tier2 = active.filter((r) => r.tier === 2);
  const tier3 = active.filter((r) => r.tier === 3);

  // Header strip counts against the UNFILTERED roster — the roster's health, not the search hit count.
  const allActive = effectiveRoster.filter((r) => !r.parked);
  const allParked = effectiveRoster.filter((r) => r.parked);
  const allTier1 = allActive.filter((r) => r.tier === 1).length;
  const allTier2 = allActive.filter((r) => r.tier === 2).length;
  const allTier3 = allActive.filter((r) => r.tier === 3).length;

  async function onResolve(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!url.trim()) return;
    setResolving(true);
    setResolveError(null);
    setCandidate(null);
    setCategory("");
    setTier("");
    try {
      const res = await fetch("/api/channels/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, existingIds: additions.map((a) => a.channelId) }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        setResolveError(ErrorResponseSchema.parse(body).error);
        return;
      }
      setCandidate(ChannelCandidateSchema.parse(body));
    } catch {
      setResolveError("Could not resolve that channel. Check the URL and try again.");
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
        usedUU: candidate.warnings.usedUU,
        shortsOnly: candidate.warnings.shortsOnly,
      };
      await addUserChannel(addition);
      refreshAdditions();
      setCandidate(null);
      setUrl("");
      setCategory("");
      setTier("");
    } finally {
      setSaving(false);
    }
  }

  // The user sees one verb everywhere ("Remove"); the mechanism underneath still differs — an
  // added channel is hard-deleted (nothing to restore), a base channel gets a reversible
  // suppression record (restorable from "Recently removed").
  async function onRemove(row: RosterRow): Promise<void> {
    if (row.source === "added") {
      await removeUserChannel(row.channelId);
      refreshAdditions();
    } else {
      await suppressChannel(row.channelId);
      refreshSuppressed();
      setToast("Removed — restore from Recently removed below.");
      setTimeout(() => setToast(null), 4000);
    }
  }

  async function onRestore(channelId: string): Promise<void> {
    await unsuppressChannel(channelId);
    refreshSuppressed();
  }

  async function onChangeAddedTier(channelId: string, newTier: Tier): Promise<void> {
    if (newTier === null) return;
    const existing = additions.find((a) => a.channelId === channelId);
    if (!existing) return;
    await addUserChannel({ ...existing, tier: newTier });
    refreshAdditions();
  }

  async function onPromoteParked(row: RosterRow, newTier: Tier): Promise<void> {
    if (newTier === null) return;
    await addUserChannel(promoteParkedRow(row, newTier));
    refreshAdditions();
  }

  function showMore(sectionKey: string): void {
    setVisibleCount((prev) => ({ ...prev, [sectionKey]: (prev[sectionKey] ?? PAGE_SIZE) + PAGE_SIZE }));
  }

  const canSave = candidate !== null && category.trim().length > 0 && tier !== "";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-xl font-semibold text-zinc-100">Channel Library</h1>

      {/* Header strip: roster health at a glance. */}
      <p className="mt-1 text-sm text-zinc-400">
        {loading
          ? "Loading roster…"
          : `${allActive.length} channels — ${allTier1} Beneficial / ${allTier2} Educational / ${allTier3} Entertainment` +
            (allParked.length > 0 ? ` — ${allParked.length} parked` : "")}
      </p>

      {/* Search/filter — THIS roster only, never a YouTube search.list call. */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by title, handle, or category…"
        className="mt-4 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
      />

      {/* Add a channel by URL. */}
      <details className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-100">
          Add a channel
        </summary>

        <form onSubmit={(e) => void onResolve(e)} className="mt-4 flex gap-2">
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

        {resolveError && (
          <p className="mt-3 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {resolveError}
          </p>
        )}

        {candidate && (
          <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center gap-3">
              {candidate.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={candidate.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <div className="h-12 w-12 rounded-full bg-zinc-800" />
              )}
              <div>
                <p className="font-medium text-zinc-100">{candidate.title}</p>
                <p className="text-xs text-zinc-500">
                  {candidate.subscriberCount.toLocaleString()} subscribers · {candidate.longformCount}{" "}
                  long-form video{candidate.longformCount === 1 ? "" : "s"} found
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
                No long-form uploads found — this channel looks Shorts-only or empty. You can
                still save it, but it may never surface any videos.
              </p>
            )}
            {candidate.warnings.usedUU && (
              <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
                Long-form playlist unavailable — falling back to the full uploads list with
                Shorts filtered out.
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
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none"
                />
              </label>
              <label className="text-xs text-zinc-400">
                Tier
                <select
                  value={tier}
                  onChange={(e) => setTier(Number(e.target.value) as 1 | 2 | 3)}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-600 focus:outline-none"
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
      </details>

      {/* Grouped by tier (not alphabetical): T1, T2, T3, then Parked/Unclassified last. */}
      <div className="mt-8 space-y-10">
        {([1, 2, 3] as const).map((t) => (
          <TierSection
            key={t}
            tier={t}
            rows={t === 1 ? tier1 : t === 2 ? tier2 : tier3}
            visibleCount={visibleCount[`tier-${t}`] ?? PAGE_SIZE}
            onShowMore={() => showMore(`tier-${t}`)}
            onRemove={(row) => void onRemove(row)}
            onChangeTier={(id, nt) => void onChangeAddedTier(id, nt)}
          />
        ))}

        <section>
          <h2 className="text-sm font-semibold text-zinc-100">
            Parked / Unclassified{" "}
            <span className="font-normal text-zinc-500">({parked.length})</span>
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">Excluded entirely — never in any feed.</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {parked.slice(0, visibleCount["parked"] ?? PAGE_SIZE).map((row) => (
              <ParkedCard
                key={row.channelId}
                row={row}
                onPromote={(nt) => void onPromoteParked(row, nt)}
              />
            ))}
          </div>
          {parked.length > (visibleCount["parked"] ?? PAGE_SIZE) && (
            <button
              type="button"
              onClick={() => showMore("parked")}
              className="mt-3 rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Show more
            </button>
          )}
        </section>
      </div>

      {/* Tucked away, not an always-visible roster-like section — a collapsed drawer at the
          very bottom of the library, same affordance as "Add a channel" above. */}
      <details className="mt-10 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-100">
          Recently removed{" "}
          {recentlyRemovedRows.length > 0 && (
            <span className="font-normal text-zinc-500">({recentlyRemovedRows.length})</span>
          )}
        </summary>

        {recentlyRemovedRows.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Nothing removed yet.</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recentlyRemovedRows.slice(0, visibleCount["removed"] ?? PAGE_SIZE).map((row) => (
                <RecentlyRemovedCard
                  key={row.channelId}
                  row={row}
                  onRestore={() => void onRestore(row.channelId)}
                />
              ))}
            </div>
            {recentlyRemovedRows.length > (visibleCount["removed"] ?? PAGE_SIZE) && (
              <button
                type="button"
                onClick={() => showMore("removed")}
                className="mt-3 rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Show more
              </button>
            )}
          </>
        )}
      </details>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs text-zinc-200 shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function TierSection({
  tier,
  rows,
  visibleCount,
  onShowMore,
  onRemove,
  onChangeTier,
}: {
  tier: 1 | 2 | 3;
  rows: RosterRow[];
  visibleCount: number;
  onShowMore: () => void;
  onRemove: (row: RosterRow) => void;
  onChangeTier: (channelId: string, tier: Tier) => void;
}) {
  // Grouped by category within the tier — categories are derived from the roster, never hardcoded.
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category))].filter(Boolean).sort(),
    [rows],
  );
  const visibleRows = rows.slice(0, visibleCount);

  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-100">
        Tier {TIER_LABELS[tier]} <span className="font-normal text-zinc-500">({rows.length})</span>
      </h2>
      <p className="mt-0.5 text-xs text-zinc-500">{TIER_WEIGHT_NOTE[tier]}</p>

      {categories.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No channels in this tier yet.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleRows.map((row) => (
            <ChannelCard
              key={row.channelId}
              row={row}
              onRemove={() => onRemove(row)}
              onChangeTier={(nt) => onChangeTier(row.channelId, nt)}
            />
          ))}
        </div>
      )}

      {rows.length > visibleCount && (
        <button
          type="button"
          onClick={onShowMore}
          className="mt-3 rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Show more
        </button>
      )}
    </section>
  );
}

function ChannelCard({
  row,
  onRemove,
  onChangeTier,
}: {
  row: RosterRow;
  onRemove: () => void;
  onChangeTier: (tier: Tier) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
      <Link href={`/channel/${row.channelId}`} className="flex items-center gap-3">
        {row.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <div className="h-10 w-10 rounded-full bg-zinc-800" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{row.title}</p>
          <p className="truncate text-xs text-zinc-500">
            {row.handle} · {subCount(row.subscriberCount)} subs
          </p>
        </div>
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
          {row.category || "Uncategorized"}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] ${
            row.source === "added"
              ? "border border-emerald-900 bg-emerald-950/40 text-emerald-300"
              : "border border-zinc-800 text-zinc-500"
          }`}
        >
          {row.source === "added" ? "Added" : "Base"}
        </span>
        {row.confirm && (
          <span className="rounded-full border border-amber-900 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-300">
            Unconfirmed tier
          </span>
        )}
        {row.shortsOnly && (
          <span className="rounded-full border border-amber-900 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-300">
            No long-form uploads
          </span>
        )}
        {row.usedUU && (
          <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-[11px] text-zinc-500">
            Shorts-filtered fallback
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        {row.source === "added" ? (
          <select
            value={row.tier ?? ""}
            onChange={(e) => onChangeTier(Number(e.target.value) as Tier)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
          >
            {([1, 2, 3] as const).map((t) => (
              <option key={t} value={t}>
                {TIER_LABELS[t]}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[11px] text-zinc-600">Tier read-only (base channel)</span>
        )}

        <button
          type="button"
          onClick={onRemove}
          className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

function RecentlyRemovedCard({ row, onRestore }: { row: RosterRow; onRestore: () => void }) {
  return (
    <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3 opacity-70">
      <Link href={`/channel/${row.channelId}`} className="flex items-center gap-3">
        {row.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover grayscale" />
        ) : (
          <div className="h-10 w-10 rounded-full bg-zinc-900" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-300">{row.title}</p>
          <p className="truncate text-xs text-zinc-600">
            {row.handle} · Tier {row.tier ?? "—"}
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={onRestore}
        className="mt-2 w-full rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
      >
        Restore
      </button>
    </div>
  );
}

function ParkedCard({ row, onPromote }: { row: RosterRow; onPromote: (tier: Tier) => void }) {
  const [pick, setPick] = useState<1 | 2 | 3 | "">("");
  return (
    <div className="rounded-xl border border-zinc-900 bg-zinc-950/60 p-3 opacity-70">
      <Link href={`/channel/${row.channelId}`} className="flex items-center gap-3">
        {row.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover grayscale" />
        ) : (
          <div className="h-10 w-10 rounded-full bg-zinc-900" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-300">{row.title}</p>
          <p className="truncate text-xs text-zinc-600">{row.handle}</p>
        </div>
      </Link>
      <p className="mt-2 text-[11px] text-zinc-500">Not in any feed — assign a tier</p>
      <div className="mt-2 flex items-center gap-2">
        <select
          value={pick}
          onChange={(e) => setPick(Number(e.target.value) as 1 | 2 | 3)}
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-zinc-600 focus:outline-none"
        >
          <option value="">Choose tier…</option>
          {([1, 2, 3] as const).map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pick === ""}
          onClick={() => pick !== "" && onPromote(pick)}
          className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Assign
        </button>
      </div>
    </div>
  );
}
