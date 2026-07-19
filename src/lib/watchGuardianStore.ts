// Watch-time guardian persistence — client-only IndexedDB (watchSession / journalEntries /
// guardianSettings) plus a BroadcastChannel for multi-tab convergence. The MATH (monotonic
// merge, clock guard, threshold/cap decisions) is the pure, unit-tested `watchGuardian.ts`; this
// module is a thin, degrade-silently-on-failure I/O layer, matching watchState.ts's siblings.
"use client";

import { tx } from "./watchState";
import { localDateKey, mergeSessions, reconcileSessionForToday } from "./watchGuardian";
import type { GuardianSettings, JournalEntry, WatchSession } from "./types";

const SESSION_STORE = "watchSession";
const JOURNAL_STORE = "journalEntries";
const SETTINGS_STORE = "guardianSettings";
const SETTINGS_ID = "default";
const BROADCAST_CHANNEL_NAME = "halaltube-watch-guardian";

// --- Today's watch session --------------------------------------------------------------

/**
 * Load (and reconcile) today's session: applies the midnight-rollover / clock-guard rule, then
 * persists the reconciled result and prunes any other stale-day rows, so the store never holds
 * more than one row across normal use.
 */
export async function getTodaySession(now: number): Promise<WatchSession> {
  try {
    const todayKey = localDateKey(now);
    const all = await tx<WatchSession[]>(
      SESSION_STORE,
      "readonly",
      (s) => s.getAll() as IDBRequest<WatchSession[]>,
    );
    const existing = all.find((s) => s.date === todayKey) ?? all[0];
    const reconciled = reconcileSessionForToday(existing, todayKey);
    await tx(SESSION_STORE, "readwrite", (s) => s.put(reconciled));
    await Promise.all(
      all
        .filter((s) => s.date !== reconciled.date)
        .map((s) => tx(SESSION_STORE, "readwrite", (os) => os.delete(s.date))),
    );
    return reconciled;
  } catch {
    return { date: localDateKey(now), activeSeconds: 0, interruptsShown: [], capReached: false };
  }
}

/** Monotonic write: merges with whatever is already stored for the same date (never regresses). */
export async function saveSession(session: WatchSession): Promise<WatchSession> {
  try {
    const existing = await tx<WatchSession | undefined>(
      SESSION_STORE,
      "readonly",
      (s) => s.get(session.date) as IDBRequest<WatchSession | undefined>,
    );
    const merged = existing ? mergeSessions(existing, session) : session;
    await tx(SESSION_STORE, "readwrite", (s) => s.put(merged));
    return merged;
  } catch {
    return session;
  }
}

// --- Multi-tab convergence (BroadcastChannel) -------------------------------------------

let channel: BroadcastChannel | null | undefined;
function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  return channel;
}

/** Tell other tabs about this tab's latest (already-merged) session. */
export function broadcastSession(session: WatchSession): void {
  try {
    getChannel()?.postMessage(session);
  } catch {
    /* BroadcastChannel unavailable — degrade silently, IndexedDB reads still converge */
  }
}

/** Adopt other tabs' broadcasts — the caller merges each message with its own local state. */
export function subscribeGuardianBroadcast(onMessage: (session: WatchSession) => void): () => void {
  const c = getChannel();
  if (!c) return () => {};
  const handler = (e: MessageEvent): void => onMessage(e.data as WatchSession);
  c.addEventListener("message", handler);
  return () => c.removeEventListener("message", handler);
}

// --- Journal entries ---------------------------------------------------------------------

export async function addJournalEntry(entry: JournalEntry): Promise<void> {
  try {
    await tx(JOURNAL_STORE, "readwrite", (s) => s.put(entry));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

export async function getJournalEntries(): Promise<JournalEntry[]> {
  try {
    const all = await tx<JournalEntry[]>(
      JOURNAL_STORE,
      "readonly",
      (s) => s.getAll() as IDBRequest<JournalEntry[]>,
    );
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

// --- Guardian settings (single row: the preset WhatsApp contact) ------------------------

const DEFAULT_SETTINGS: GuardianSettings = { id: "default", whatsappNumber: "" };

export async function getGuardianSettings(): Promise<GuardianSettings> {
  try {
    const found = await tx<GuardianSettings | undefined>(
      SETTINGS_STORE,
      "readonly",
      (s) => s.get(SETTINGS_ID) as IDBRequest<GuardianSettings | undefined>,
    );
    return found ?? DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveGuardianSettings(settings: GuardianSettings): Promise<void> {
  try {
    await tx(SETTINGS_STORE, "readwrite", (s) => s.put(settings));
  } catch {
    /* storage unavailable — degrade silently */
  }
}
