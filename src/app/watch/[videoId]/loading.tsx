// Watch route loading state (Implements PHASE_3_SPEC.md §6) — shown while getWatchData resolves.
import { WatchSkeleton } from "@/components/Skeleton";

export default function WatchLoading() {
  return <WatchSkeleton />;
}
