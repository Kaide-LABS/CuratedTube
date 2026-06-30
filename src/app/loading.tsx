// Home route loading state (Implements PHASE_3_SPEC.md §6) — shown while getHomeFeed resolves.
import { CardGridSkeleton } from "@/components/Skeleton";

export default function HomeLoading() {
  return (
    <div className="px-4 py-6">
      <CardGridSkeleton count={12} />
    </div>
  );
}
