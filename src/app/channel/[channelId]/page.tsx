import Link from "next/link";
import { getChannelArchive } from "@/lib/data";
import { formatCount } from "@/lib/format";
import { ChannelArchive } from "@/components/ChannelArchive";
import { AddedChannelView } from "@/components/AddedChannelView";

// Dynamic: Data API reads use `cache: "no-store"` (the ETag/304 layer governs quota spend).
export const dynamic = "force-dynamic";

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  const { meta, videos } = await getChannelArchive(channelId, "latest");

  // Not in the base roster (channels.json) — could still be a user-added channel living only
  // in the client's IndexedDB, invisible to this server-rendered lookup. Hand off to the client
  // fallback, which checks the effective roster's client-side half and 404s only if that's
  // empty too (see AddedChannelView).
  if (!meta) return <AddedChannelView channelId={channelId} />;

  return (
    <div>
      {/* Banner */}
      <div
        className="relative h-32 w-full bg-zinc-800 bg-cover bg-center sm:h-48 md:h-56"
        style={meta.bannerUrl ? { backgroundImage: `url(${meta.bannerUrl}=w1707)` } : undefined}
      />

      {/* Profile header */}
      <div className="flex flex-col items-start gap-4 border-b border-zinc-800 px-4 py-6 md:flex-row md:items-center">
        {meta.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meta.avatarUrl}
            alt=""
            className="h-20 w-20 flex-shrink-0 rounded-full bg-zinc-800"
          />
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-100">{meta.title}</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {meta.handle && <span>{meta.handle} · </span>}
            {meta.hiddenSubscriberCount
              ? "subscribers hidden"
              : `${formatCount(meta.subscriberCount)} subscribers`}{" "}
            · <span className="text-zinc-500">{meta.category}</span>
          </p>
          {meta.description && (
            <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-zinc-500">{meta.description}</p>
          )}
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
