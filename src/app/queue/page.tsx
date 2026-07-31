"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PlaylistItem } from "@/lib/types";
import { QUEUE_PLAYLIST_ID, clearQueue, dequeue, getQueueItems, persistQueueReorder } from "@/lib/playlists";
import { TimeBadge } from "@/components/TimeBadge";

/**
 * The queue: ordered play-next list. A single pointer (or keyboard) drag gesture moves an item to
 * any position in one motion — @dnd-kit/sortable, not react-beautiful-dnd (unmaintained). The
 * reordered list is written on drop; playback order and everything else is pure IndexedDB.
 */
export default function QueuePage() {
  const [items, setItems] = useState<PlaylistItem[] | null>(null);

  const refresh = async (): Promise<void> => {
    setItems(await getQueueItems());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onRemove(videoId: string): Promise<void> {
    await dequeue(videoId);
    await refresh();
  }

  async function onClear(): Promise<void> {
    await clearQueue();
    await refresh();
  }

  async function onDragEnd(event: DragEndEvent): Promise<void> {
    const { active, over } = event;
    if (!over || active.id === over.id || !items) return;
    const activeVideoId = String(active.id);
    const overVideoId = String(over.id);

    // Optimistic local reorder so the drop feels instant, then persist the SAME move atomically.
    const fromIndex = items.findIndex((it) => it.videoId === activeVideoId);
    const toIndex = items.findIndex((it) => it.videoId === overVideoId);
    if (fromIndex === -1 || toIndex === -1) return;
    const reordered = [...items];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    setItems(reordered);

    await persistQueueReorder(activeVideoId, overVideoId);
    await refresh(); // adopt the persisted truth (order values), not just the optimistic splice
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Queue</h1>
        {items && items.length > 0 && (
          <button
            type="button"
            onClick={() => void onClear()}
            className="text-sm text-zinc-500 hover:text-zinc-300"
          >
            Clear queue
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-zinc-400">
        Play in order — finishing one advances to the next queued video. Drag to reorder. Never
        autoplay of recommendations: this is only ever what you put here yourself.
      </p>

      {items === null ? (
        <p className="mt-8 text-sm text-zinc-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">Nothing queued yet. Use “Queue” on a video.</p>
      ) : (
        <DndContext sensors={sensors} onDragEnd={(e) => void onDragEnd(e)}>
          <SortableContext items={items.map((it) => it.videoId)} strategy={verticalListSortingStrategy}>
            <ul className="mt-6 divide-y divide-zinc-800 rounded-xl border border-zinc-800">
              {items.map((it) => (
                <QueueRow key={it.id} item={it} onRemove={() => void onRemove(it.videoId)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function QueueRow({ item, onRemove }: { item: PlaylistItem; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.videoId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-3 bg-zinc-950 px-4 py-3">
      <button
        type="button"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
        className="flex-shrink-0 cursor-grab touch-none px-1 text-zinc-500 hover:text-zinc-300 active:cursor-grabbing"
      >
        ⠿
      </button>
      <Link
        href={`/watch/${item.videoId}?list=${QUEUE_PLAYLIST_ID}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="relative aspect-video w-24 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          <TimeBadge durationSec={item.durationSec} />
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium text-zinc-100">{item.title}</p>
          <p className="truncate text-xs text-zinc-500">{item.channelTitle}</p>
        </div>
      </Link>
      <button
        type="button"
        onClick={onRemove}
        className="flex-shrink-0 rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
      >
        Remove
      </button>
    </li>
  );
}
