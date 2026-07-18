"use client";

import Link from "next/link";
import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { VideoSchema, type ChannelAddition, type Video } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { getUserChannels } from "@/lib/userChannels";
import { ChannelArchive } from "./ChannelArchive";
import { ChannelSkeleton } from "./Skeleton";

const VideosResponseSchema = z.object({ videos: z.array(VideoSchema) });

type Status = "checking" | "found" | "missing";

/**
 * Channel page fallback for a channelId the SERVER-SIDE base roster doesn't know about (see
 * getChannelArchive/getChannelConfig — channels.json only). The effective roster is base +
 * IndexedDB userChannels, and additions only exist client-side, so this check — and the video
 * fetch that follows — has to happen here, not in the Server Component page.
 *
 * The existence guard (base ∪ additions) is enforced across the two components: the server
 * already proved channelId isn't in base (that's why this component rendered at all); this
 * component then checks the client's additions. Only when BOTH come up empty is the channel
 * genuinely unknown, and `notFound()` fires exactly as it would for any other bad id.
 */
export function AddedChannelView({ channelId }: { channelId: string }) {
  const [status, setStatus] = useState<Status>("checking");
  const [addition, setAddition] = useState<ChannelAddition | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);

  useEffect(() => {
    let alive = true;
    getUserChannels().then(async (additions) => {
      const match = additions.find((a) => a.channelId === channelId);
      if (!alive) return;
      if (!match) {
        setStatus("missing");
        return;
      }
      setAddition(match);
      try {
        const res = await fetch("/api/channels/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelId: match.channelId,
            uploadsPlaylistId: match.uploadsPlaylistId,
          }),
        });
        if (alive && res.ok) {
          const parsed = VideosResponseSchema.parse(await res.json());
          setVideos(parsed.videos);
        }
      } finally {
        if (alive) setStatus("found");
      }
    });
    return () => {
      alive = false;
    };
  }, [channelId]);

  // Called during render (not inside the effect) so Next's not-found boundary can catch it.
  if (status === "missing") notFound();

  if (status === "checking" || !addition) return <ChannelSkeleton />;

  return (
    <div>
      <div className="relative h-32 w-full bg-zinc-800 bg-cover bg-center sm:h-48 md:h-56" />

      <div className="flex flex-col items-start gap-4 border-b border-zinc-800 px-4 py-6 md:flex-row md:items-center">
        {addition.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={addition.avatarUrl}
            alt=""
            className="h-20 w-20 flex-shrink-0 rounded-full bg-zinc-800"
          />
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-100">{addition.title}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {addition.handle && <span>{addition.handle} · </span>}
            {formatCount(addition.subscriberCount)} subscribers ·{" "}
            <span className="text-zinc-500">{addition.category}</span>
          </p>
        </div>
      </div>

      <div className="px-0 py-2">
        <div className="px-4 pb-2">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
            ← Back to feed
          </Link>
        </div>
        <ChannelArchive videos={videos} />
      </div>
    </div>
  );
}
