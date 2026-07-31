"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { RosterRowSchema, VideoSchema, type PlaylistItem, type Video } from "@/lib/types";
import { mergeRosterRows } from "@/lib/channels";
import { getNextQueueItem, getPlaylistItem, QUEUE_PLAYLIST_ID, removeFromPlaylist } from "@/lib/playlists";
import { getUserChannels } from "@/lib/userChannels";
import { getSuppressedChannels } from "@/lib/suppressedChannels";
import { WatchPlayer } from "./WatchPlayer";
import { VideoPreviewCard } from "./VideoPreviewCard";
import { WatchSkeleton } from "./Skeleton";
import { TranscriptPanel } from "./TranscriptPanel";

const RosterResponseSchema = z.object({ rows: z.array(RosterRowSchema) });
const VideosResponseSchema = z.object({ videos: z.array(VideoSchema) });

/**
 * Watch a video reached via playlist provenance (/watch/<id>?list=<playlistId>). Resolves
 * metadata from the local snapshot ONLY — zero YouTube Data API calls for the video itself, and
 * NO effective-roster existence check (a playlist item the user saved deliberately must still
 * play even if its channel was later removed/suppressed — see channels.ts's mergeRosterRows,
 * reused here only to decide whether to show the "more from this channel" rail, never to gate
 * playback). Uses the SAME WatchPlayer as everywhere else, so the watch-time guardian's cap and
 * staged interrupts apply identically — this is not a way around them.
 */
export function PlaylistWatchView({ videoId, playlistId }: { videoId: string; playlistId: string }) {
  const router = useRouter();
  const [item, setItem] = useState<PlaylistItem | null | undefined>(undefined);
  const [rail, setRail] = useState<Video[]>([]);

  useEffect(() => {
    let alive = true;
    getPlaylistItem(playlistId, videoId).then(async (found) => {
      if (!alive) return;
      if (!found) {
        // Invalid/stale provenance — fall back to the normal (unprovenanced) watch flow.
        router.replace(`/watch/${videoId}`);
        return;
      }
      setItem(found);

      try {
        const [rosterRes, additions, suppressed] = await Promise.all([
          fetch("/api/channels/roster").then((r) => r.json()),
          getUserChannels(),
          getSuppressedChannels(),
        ]);
        const baseRows = RosterResponseSchema.parse(rosterRes).rows;
        const effective = mergeRosterRows(baseRows, additions, suppressed.map((s) => s.channelId));
        const row = effective.find((r) => r.channelId === found.channelId);
        // Out-of-roster (or suppressed): hide the rail entirely — never fetch a suppressed
        // channel's uploads, never error.
        if (!alive || !row) return;

        // Just a sidebar rail (12 items) — request a single page, not the full-archive default
        // (matches getWatchData's own same-channel rail, which uses maxPages: 1 for the same
        // reason: no need to paginate hundreds of videos to show a dozen recent ones).
        const railRes = await fetch("/api/channels/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelId: row.channelId,
            uploadsPlaylistId: row.uploadsPlaylistId,
            maxPages: 1,
          }),
        });
        if (!alive || !railRes.ok) return;
        const parsed = VideosResponseSchema.parse(await railRes.json());
        setRail(parsed.videos.filter((v) => v.videoId !== videoId).slice(0, 12));
      } catch {
        /* rail is additive; a failed fetch just leaves it empty */
      }
    });
    return () => {
      alive = false;
    };
  }, [playlistId, videoId, router]);

  if (item === undefined) return <WatchSkeleton />;
  if (item === null) return null; // redirecting to the unprovenanced URL

  async function onRemove(): Promise<void> {
    await removeFromPlaylist(playlistId, videoId);
    router.push(playlistId === QUEUE_PLAYLIST_ID ? "/queue" : `/playlists/${playlistId}`);
  }

  // The ONE sanctioned auto-advance in the app (see WatchPlayer's onEnded doc): only wired up
  // for the reserved queue, only on a natural end, only to the NEXT item the user themselves
  // queued. No wrap-around, no fallback to recommendations — running off the end just stops.
  async function onQueueEnded(): Promise<void> {
    if (playlistId !== QUEUE_PLAYLIST_ID) return;
    const next = await getNextQueueItem(videoId);
    if (next) router.push(`/watch/${next.videoId}?list=${QUEUE_PLAYLIST_ID}`);
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 lg:grid lg:grid-cols-3">
      <div className="lg:col-span-2">
        <WatchPlayer videoId={videoId} onEnded={playlistId === QUEUE_PLAYLIST_ID ? () => void onQueueEnded() : undefined} />
        <div className="border-b border-zinc-800 py-4">
          <h1 className="text-lg font-semibold leading-snug text-zinc-100">{item.title}</h1>
          <p className="mt-2 text-sm text-zinc-500">
            {playlistId === QUEUE_PLAYLIST_ID
              ? "Playing from your queue — the next queued video plays automatically when this one ends."
              : "Saved to this playlist — playing from a snapshot."}
          </p>
        </div>
        <TranscriptPanel videoId={videoId} />
        <div className="mt-4 flex items-center justify-between gap-3">
          <Link href={`/channel/${item.channelId}`} className="flex items-center gap-3 hover:opacity-90">
            <span className="text-sm font-medium text-zinc-200">{item.channelTitle}</span>
          </Link>
          <button
            type="button"
            onClick={() => void onRemove()}
            className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-900"
          >
            {playlistId === QUEUE_PLAYLIST_ID ? "Remove from queue" : "Remove from playlist"}
          </button>
        </div>
      </div>

      {/* Hidden entirely for an out-of-roster (removed/suppressed) channel — see the effect above. */}
      {rail.length > 0 && (
        <aside className="flex flex-col gap-4 lg:col-span-1">
          <h2 className="text-sm font-semibold text-zinc-400">More from {item.channelTitle}</h2>
          {rail.map((v) => (
            <VideoPreviewCard key={v.videoId} video={v} showAvatar={false} />
          ))}
        </aside>
      )}
    </div>
  );
}
