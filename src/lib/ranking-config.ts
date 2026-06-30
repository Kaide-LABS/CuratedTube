// Single source of the Focus Feed ranking defaults (PHASE_2_SPEC.md §1/§3).
//
// Every tunable weight/window lives here and is validated by RankingConfigSchema, so the
// ranking math in ranking.ts carries no magic numbers and a malformed override fails at the
// boundary. These are the documented EMPIRICAL defaults (context.md §5 "tune empirically");
// the ratified *methods* — not these constants — are the load-bearing citations
// (PHASE_2_SPEC §0.5). Change ranking behavior by editing this object, nothing else.

import { RankingConfigSchema, type RankingConfig } from "./types";

/** The locked default ranking configuration (S₁ gravity model). */
export const DEFAULT_RANKING_CONFIG: RankingConfig = RankingConfigSchema.parse({});
