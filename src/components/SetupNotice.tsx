export function SetupNotice({ reason }: { reason: "no-api-key" | "no-channels" }) {
  return (
    <div className="px-4 py-16">
      <div className="mx-auto max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8">
        <h1 className="text-xl font-semibold text-zinc-100">Almost there</h1>
        {reason === "no-api-key" ? (
          <div className="mt-4 space-y-3 text-sm text-zinc-400">
            <p>No YouTube Data API key found. To bring the feed online:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Copy <code className="rounded bg-zinc-800 px-1">.env.example</code> to{" "}
                <code className="rounded bg-zinc-800 px-1">.env</code>.
              </li>
              <li>
                Add your key as{" "}
                <code className="rounded bg-zinc-800 px-1">YOUTUBE_API_KEY=…</code> (enable
                &ldquo;YouTube Data API v3&rdquo; in Google Cloud).
              </li>
              <li>Restart the dev server.</li>
            </ol>
          </div>
        ) : (
          <div className="mt-4 space-y-3 text-sm text-zinc-400">
            <p>
              No channels are resolved yet. Add your handles to{" "}
              <code className="rounded bg-zinc-800 px-1">src/config/channels.json</code> and run:
            </p>
            <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-300">
              npm run resolve-channels
            </pre>
            <p>
              That fills each channel&rsquo;s <code className="rounded bg-zinc-800 px-1">channelId</code>{" "}
              and <code className="rounded bg-zinc-800 px-1">uploadsPlaylistId</code> (UULF).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
