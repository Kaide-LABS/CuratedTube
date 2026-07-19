import Link from "next/link";
import type { PlaylistItem } from "@/lib/types";
import { TimeBadge } from "./TimeBadge";

/**
 * Renders a playlist's SNAPSHOT row — title/thumbnail/channel/duration as captured at add-time,
 * never re-resolved (zero API calls to render a playlist). Distinct from VideoPreviewCard, which
 * needs full live Video fields (viewCount, publishedAt, category) a snapshot doesn't carry.
 */
export function PlaylistItemCard({
  item,
  playlistId,
  onRemove,
}: {
  item: PlaylistItem;
  playlistId: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Link href={`/watch/${item.videoId}?list=${playlistId}`} className="flex flex-col gap-2">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-zinc-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          <TimeBadge durationSec={item.durationSec} />
        </div>
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-zinc-100">{item.title}</h3>
          <p className="mt-1 truncate text-xs text-zinc-400">{item.channelTitle}</p>
        </div>
      </Link>
      <button
        type="button"
        onClick={onRemove}
        className="self-start text-xs text-zinc-500 hover:text-zinc-300"
      >
        Remove
      </button>
    </div>
  );
}
