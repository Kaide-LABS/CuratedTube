// The deliberate end of the feed (PRD §2, §5.1). No infinite scroll, no "load more".
// This is the anti-distraction north star made visible: the feed is finite by design.
export function CaughtUpBlocker({ count }: { count: number }) {
  return (
    <div className="col-span-full rounded-xl border border-zinc-800 bg-zinc-900/50 py-12 text-center">
      <p className="text-lg font-medium text-zinc-200">You&rsquo;re all caught up</p>
      <p className="mt-1 text-sm text-zinc-500">
        That&rsquo;s {count} from your channels. No endless feed — go do the thing.
      </p>
    </div>
  );
}
