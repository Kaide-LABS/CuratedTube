// Channel route loading state (Implements PHASE_3_SPEC.md §6) — shown while the archive resolves.
import { ChannelSkeleton } from "@/components/Skeleton";

export default function ChannelLoading() {
  return <ChannelSkeleton />;
}
