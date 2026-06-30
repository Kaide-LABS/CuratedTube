// Single source of the focus-session-limiter defaults (Implements PHASE_3_SPEC.md §3/§6).
//
// Every limiter constant lives here and is validated by SessionConfigSchema, so session.ts
// carries no magic numbers and a malformed override fails at the boundary. Defaults encode the
// PRD §6 / context.md §5 policy: prompt a break after 30 min of active playback in a rolling 4h
// window. Tune the policy by editing this object, nothing else.

import { SessionConfigSchema, type SessionConfig } from "./types";

/** The locked default session-limit policy (30 min active / rolling 4h). */
export const DEFAULT_SESSION_CONFIG: SessionConfig = SessionConfigSchema.parse({});
