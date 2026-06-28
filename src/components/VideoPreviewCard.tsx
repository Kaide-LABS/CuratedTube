import Link from "next/link";
import type { Video } from "@/lib/types";
import { formatCount, timeAgo } from "@/lib/format";
import { TimeBadge } from "./TimeBadge";

export function VideoPreviewCard({
  video,
  visited = false,
  showAvatar = true,
}: {
  video: Video;
  visited?: boolean;
  showAvatar?: boolean;
}) {
  return (
    <Link
      href={`/watch/${video.videoId}`}
      className={`group flex cursor-pointer flex-col gap-2 transition-all hover:scale-[1.01] ${
        visited ? "opacity-50 hover:opacity-80" : ""
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={video.thumbnailUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <TimeBadge durationSec={video.durationSec} />
        {visited && (
          <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-300">
            Watched
          </span>
        )}
      </div>
      <div className="flex gap-3">
        {showAvatar && video.channelAvatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.channelAvatarUrl}
            alt=""
            loading="lazy"
            className="mt-0.5 h-9 w-9 flex-shrink-0 rounded-full bg-zinc-800"
          />
        )}
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100">
            {video.title}
          </h3>
          <p className="mt-1 truncate text-xs text-zinc-400">{video.channelTitle}</p>
          <p className="text-xs text-zinc-500">
            {formatCount(video.viewCount)} views · {timeAgo(video.publishedAt)}
          </p>
        </div>
      </div>
    </Link>
  );
}
