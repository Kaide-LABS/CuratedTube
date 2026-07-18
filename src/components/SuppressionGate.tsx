"use client";

import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { isChannelHidden } from "@/lib/channels";
import { getSuppressedChannels } from "@/lib/suppressedChannels";
import { getUserChannels } from "@/lib/userChannels";
import { ChannelSkeleton } from "./Skeleton";

type Status = "checking" | "visible" | "hidden";

/**
 * Gates a server-resolved BASE channel page behind the client's suppression overlay (hide-any-
 * channel feature). The server can't know about IndexedDB suppressions, so a base channel that
 * resolved fine server-side (meta found) still needs this client-side check: if the user hid it
 * — and hasn't since re-added it, which always wins (see channels.ts's isChannelHidden) — the
 * page 404s exactly like an unknown channelId would.
 */
export function SuppressionGate({
  channelId,
  children,
}: {
  channelId: string;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let alive = true;
    Promise.all([getSuppressedChannels(), getUserChannels()]).then(([suppressed, additions]) => {
      if (!alive) return;
      const hidden = isChannelHidden(
        channelId,
        suppressed.map((s) => s.channelId),
        additions.map((a) => a.channelId),
      );
      setStatus(hidden ? "hidden" : "visible");
    });
    return () => {
      alive = false;
    };
  }, [channelId]);

  // Called during render (not inside the effect) so Next's not-found boundary can catch it.
  if (status === "hidden") notFound();

  if (status === "checking") return <ChannelSkeleton />;

  return <>{children}</>;
}
