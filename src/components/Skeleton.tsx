// Loading skeletons (Implements PHASE_3_SPEC.md §6). Presentational placeholders shown while a
// route's server data resolves, so a navigation never flashes an empty screen. No data, no state.

/** A single pulsing block. */
function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-900 ${className}`} />;
}

/** A grid of card skeletons matching the feed layout. */
export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Block className="aspect-video w-full" />
          <div className="flex gap-3">
            <Block className="h-9 w-9 flex-shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Block className="h-3 w-full" />
              <Block className="h-3 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Watch-page skeleton: player block + metadata + a short rail. */
export function WatchSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-4 lg:grid lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Block className="aspect-video w-full" />
        <Block className="h-5 w-3/4" />
        <Block className="h-3 w-1/2" />
      </div>
      <div className="space-y-4 lg:col-span-1">
        {Array.from({ length: 4 }, (_, i) => (
          <Block key={i} className="aspect-video w-full" />
        ))}
      </div>
    </div>
  );
}

/** Channel-page skeleton: banner + header + a card grid. */
export function ChannelSkeleton() {
  return (
    <div>
      <Block className="h-32 w-full rounded-none sm:h-48 md:h-56" />
      <div className="flex items-center gap-4 border-b border-zinc-800 px-4 py-6">
        <Block className="h-20 w-20 flex-shrink-0 rounded-full" />
        <div className="space-y-2">
          <Block className="h-5 w-48" />
          <Block className="h-3 w-32" />
        </div>
      </div>
      <div className="p-4">
        <CardGridSkeleton count={8} />
      </div>
    </div>
  );
}
