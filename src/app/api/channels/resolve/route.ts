import { NextResponse } from "next/server";
import { z } from "zod";
import { parseChannelUrl } from "@/lib/channelUrl";
import { isDuplicateChannelId, resolveUploadsPlaylistId } from "@/lib/channels";
import {
  getChannelMeta,
  getChannelUploads,
  resolveChannelByHandle,
  resolveChannelByUsername,
} from "@/lib/youtube";
import type { ChannelMeta } from "@/lib/types";

export const dynamic = "force-dynamic";

// Persists nothing — resolve-only. `existingIds` lets the client fold its own IndexedDB
// additions into the duplicate check (the server only knows the baked roster on its own).
const BodySchema = z.object({
  url: z.string().min(1),
  existingIds: z.array(z.string()).optional(),
});

/**
 * POST /api/channels/resolve — resolve a pasted channel URL/handle into a save-ready
 * candidate. Never calls search.list (D4). Every quota-costing call goes through the same
 * `apiGet` path as the rest of youtube.ts, so it is counted by the existing quota counter.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = parseChannelUrl(body.url);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not parse a YouTube channel URL. Try a /@handle, /channel/UC…, or /user/… link." },
      { status: 400 },
    );
  }

  try {
    let meta: ChannelMeta | null;
    if (parsed.kind === "id") {
      const metas = await getChannelMeta([parsed.channelId]);
      meta = metas[0] ?? null;
    } else if (parsed.kind === "handle") {
      meta = await resolveChannelByHandle(parsed.handle);
    } else {
      meta = await resolveChannelByUsername(parsed.username);
    }

    if (!meta) {
      return NextResponse.json({ error: "Channel not found for that URL" }, { status: 404 });
    }

    const primaryUploadsPlaylistId = resolveUploadsPlaylistId(meta.channelId);
    const { refs, usedUU } = await getChannelUploads(meta.channelId, {
      primaryPlaylistId: primaryUploadsPlaylistId,
      maxPages: 1,
      pageSize: 10,
    });
    const uploadsPlaylistId = usedUU
      ? resolveUploadsPlaylistId(meta.channelId, { useUULF: false })
      : primaryUploadsPlaylistId;

    const duplicate = isDuplicateChannelId(meta.channelId, body.existingIds ?? []);

    return NextResponse.json({
      channelId: meta.channelId,
      handle: meta.handle || (parsed.kind === "handle" ? parsed.handle : ""),
      title: meta.title,
      avatarUrl: meta.avatarUrl,
      subscriberCount: meta.subscriberCount,
      uploadsPlaylistId,
      longformCount: refs.length,
      warnings: {
        duplicate,
        shortsOnly: refs.length === 0,
        usedUU,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error resolving channel";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
