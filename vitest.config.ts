import { defineConfig } from "vitest/config";

// Coverage is scoped to the deterministic Phase 1 logic added/reworked in this build:
// the roster pipeline helpers, the roster loader + tier selectors, the schema boundary,
// and the tier-weighted feed builder. Network/IO modules (youtube.ts, data.ts, rss.ts)
// are exercised at runtime, not unit-tested here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/lib/feed.ts",
        "src/lib/channels.ts",
        "src/lib/types.ts",
        "scripts/roster-lib.mjs",
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
