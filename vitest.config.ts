import { defineConfig } from "vitest/config";

// Coverage is scoped to the deterministic Phase 1 logic added/reworked in this build:
// the roster pipeline helpers, the roster loader + tier selectors, the schema boundary,
// the tier-weighted feed builder, and the quota counter. The network/IO surface of
// youtube.ts/rss.ts/data.ts is integration-exercised by `next build` against the live API;
// youtube.ts's pure helpers (parseISODuration/isShort) are unit-tested in youtube.test.ts
// but the file is left out of the coverage gate because its network functions are not
// unit-covered.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/lib/feed.ts",
        "src/lib/ranking.ts",
        "src/lib/ranking-config.ts",
        "src/lib/session.ts",
        "src/lib/session-config.ts",
        "src/lib/channels.ts",
        "src/lib/types.ts",
        "src/lib/quota.ts",
        "scripts/roster-lib.mjs",
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
