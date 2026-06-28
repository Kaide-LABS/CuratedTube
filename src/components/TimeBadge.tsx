import { formatDuration } from "@/lib/format";

export function TimeBadge({ durationSec }: { durationSec: number }) {
  if (!durationSec) return null;
  return (
    <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 font-mono text-xs text-zinc-100">
      {formatDuration(durationSec)}
    </span>
  );
}
