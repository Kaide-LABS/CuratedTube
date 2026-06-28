import Link from "next/link";
import { notFound } from "next/navigation";
import { getWatchData } from "@/lib/data";
import { WatchPlayer } from "@/components/WatchPlayer";
import { MetadataPanel } from "@/components/MetadataPanel";
import { VideoPreviewCard } from "@/components/VideoPreviewCard";

export const revalidate = 1800;

export default async function WatchPage({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  const { videoId } = await params;
  const { video, meta, rail } = await getWatchData(videoId);

  if (!video) notFound();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 lg:grid lg:grid-cols-3">
      {/* Player + metadata */}
      <div className="lg:col-span-2">
        <WatchPlayer videoId={video.videoId} />
        <MetadataPanel video={video} />
        <Link
          href={`/channel/${video.channelId}`}
          className="mt-4 flex items-center gap-3 hover:opacity-90"
        >
          {meta?.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.avatarUrl} alt="" className="h-10 w-10 rounded-full bg-zinc-800" />
          )}
          <span className="text-sm font-medium text-zinc-200">{video.channelTitle}</span>
        </Link>
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
