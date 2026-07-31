import Link from "next/link";
import { notFound } from "next/navigation";
import { getWatchData } from "@/lib/data";
import { WatchPlayer } from "@/components/WatchPlayer";
import { MetadataPanel } from "@/components/MetadataPanel";
import { VideoPreviewCard } from "@/components/VideoPreviewCard";
import { WatchLaterButton } from "@/components/WatchLaterButton";
import { AddToQueueButton } from "@/components/AddToQueueButton";
import { AddToPlaylistButton } from "@/components/AddToPlaylistButton";
import { PlaylistWatchView } from "@/components/PlaylistWatchView";
import { TranscriptPanel } from "@/components/TranscriptPanel";

// Dynamic: Data API reads use `cache: "no-store"` (the ETag/304 layer governs quota spend).
export const dynamic = "force-dynamic";

export default async function WatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ list?: string }>;
}) {
  const { videoId } = await params;
  const { list } = await searchParams;

  // Playlist provenance (?list=<playlistId>): resolve ENTIRELY from the local snapshot, client-
  // side — no server Data API call, no roster/existence check (a playlist item the user saved
  // deliberately must still play even if its channel was later removed/suppressed). This never
  // touches the normal flow below; if the snapshot turns out to be missing/stale, the client
  // component itself falls back by redirecting to the plain (unprovenanced) URL.
  if (list) {
    return <PlaylistWatchView videoId={videoId} playlistId={list} />;
  }

  const { video, meta, rail } = await getWatchData(videoId);

  if (!video) notFound();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 lg:grid lg:grid-cols-3">
      {/* Player + metadata */}
      <div className="lg:col-span-2">
        <WatchPlayer videoId={video.videoId} />
        <MetadataPanel video={video} />
        <TranscriptPanel videoId={video.videoId} />
        <div className="mt-4 flex items-center justify-between gap-3">
          <Link
            href={`/channel/${video.channelId}`}
            className="flex items-center gap-3 hover:opacity-90"
          >
            {meta?.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={meta.avatarUrl} alt="" className="h-10 w-10 rounded-full bg-zinc-800" />
            )}
            <span className="text-sm font-medium text-zinc-200">{video.channelTitle}</span>
          </Link>
          <div className="flex items-center gap-2">
            <AddToQueueButton video={video} />
            <AddToPlaylistButton video={video} />
            <WatchLaterButton video={video} />
          </div>
        </div>
      </div>

      {/* Same-channel rail only — never cross-channel recommendations (PRD §5.3) */}
      <aside className="flex flex-col gap-4 lg:col-span-1">
        <h2 className="text-sm font-semibold text-zinc-400">More from {video.channelTitle}</h2>
        {rail.length === 0 && <p className="text-sm text-zinc-600">Nothing else here yet.</p>}
        {rail.map((v) => (
          <VideoPreviewCard key={v.videoId} video={v} showAvatar={false} />
        ))}
      </aside>
    </div>
  );
}
