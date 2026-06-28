// Quota counter (PRD §7, §9.9). Instruments Data API unit cost per call type so we
// can prove we stay under the 10,000 units/day budget and alert at 80%.
//
// Process-local, in-memory, resets on server restart. Good enough for a single-user
// tool — the point is visibility, not durable accounting. Costs from primary source:
// https://developers.google.com/youtube/v3/determine_quota_cost
//   playlistItems.list = 1, videos.list = 1, channels.list = 1, search.list = 100 (never called).

export type QuotaCallType = "playlistItems.list" | "videos.list" | "channels.list";

const COST: Record<QuotaCallType, number> = {
  "playlistItems.list": 1,
  "videos.list": 1,
  "channels.list": 1,
};

export const DAILY_QUOTA = 10_000;
export const ALERT_THRESHOLD = 0.8;

type QuotaState = {
  total: number;
  byType: Record<QuotaCallType, number>;
  windowStart: number; // epoch ms of the current rolling 24h window
};

// Survive Next.js dev hot-reload by stashing on globalThis.
const g = globalThis as unknown as { __ctQuota?: QuotaState };

function freshState(now: number): QuotaState {
  return {
    total: 0,
    byType: { "playlistItems.list": 0, "videos.list": 0, "channels.list": 0 },
    windowStart: now,
  };
}

function state(): QuotaState {
  const now = Date.now();
  if (!g.__ctQuota) g.__ctQuota = freshState(now);
  // Roll the window every 24h.
  if (now - g.__ctQuota.windowStart > 24 * 60 * 60 * 1000) {
    g.__ctQuota = freshState(now);
  }
  return g.__ctQuota;
}

/** Record `calls` invocations of a given Data API method and log the running total. */
export function recordQuota(type: QuotaCallType, calls = 1): void {
  const s = state();
  const cost = COST[type] * calls;
  s.byType[type] += cost;
  s.total += cost;
  const pct = s.total / DAILY_QUOTA;
  const tag = pct >= ALERT_THRESHOLD ? "QUOTA ALERT" : "quota";
  // eslint-disable-next-line no-console
  console.log(
    `[${tag}] +${cost} (${type}) -> ${s.total}/${DAILY_QUOTA} units (${(pct * 100).toFixed(1)}%)`,
  );
}

export function quotaSnapshot(): QuotaState & { pct: number; alert: boolean } {
  const s = state();
  const pct = s.total / DAILY_QUOTA;
  return { ...s, pct, alert: pct >= ALERT_THRESHOLD };
}
