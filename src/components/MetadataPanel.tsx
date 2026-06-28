"use client";

import { useState } from "react";
import type { Video } from "@/lib/types";
import { formatCount, timeAgo } from "@/lib/format";

export function MetadataPanel({ video }: { video: Video }) {
  const [expanded, setExpanded] = useState(false);
  const hasDesc = false; // description isn't fetched per-video in Phase 1; views/likes/date only

  return (
    <div className="border-b border-zinc-800 py-4">
      <h1 className="text-lg font-semibold leading-snug text-zinc-100">{video.title}</h1>
      <p className="mt-2 text-sm text-zinc-400">
        {formatCount(video.viewCount)} views · {formatCount(video.likeCount)} likes ·{" "}
        {timeAgo(video.publishedAt)}
      </p>
      {hasDesc && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs text-zinc-500 hover:text-zinc-300"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
