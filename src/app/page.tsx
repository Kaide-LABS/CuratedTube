import { getHomeFeed } from "@/lib/data";
import { HomeFeed } from "@/components/HomeFeed";
import { SetupNotice } from "@/components/SetupNotice";

// Re-fetch at most on the RSS cadence; the Data API reads inside are themselves cached.
export const revalidate = 1800;

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
