import { getHomeFeed } from "@/lib/data";
import { HomeFeed } from "@/components/HomeFeed";
import { SetupNotice } from "@/components/SetupNotice";

// Rendered per-request: the Data API reads use `cache: "no-store"` so the ETag/304 layer
// (src/lib/youtube.ts) is the single authority on quota spend, so the route is dynamic.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const feed = await getHomeFeed();

  if (!feed.ready) return <SetupNotice reason={feed.reason ?? "no-api-key"} />;

  if (feed.videos.length === 0) {
    return (
      <div className="px-4 py-16 text-center text-sm text-zinc-500">
        No recent uploads found across your channels yet.
      </div>
    );
  }

  return <HomeFeed pool={feed.videos} />;
}
