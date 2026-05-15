// Session milestone celebrations (Task #491, expanded by Task #541).
//
// Tracks "claims processed this session" client-side and fires a small
// one-shot celebration when the operator crosses 10 / 25 / 50 within
// the current calendar day. State is persisted to sessionStorage so:
//
//   • the counter survives component unmounts (operators move between
//     the queue, detail pages, and the dashboard while still in the
//     same "session") without resetting,
//   • the counter ALSO survives full page reloads / HMR / Clerk re-auth
//     within the same calendar day — the original v1 stored state in a
//     module-level Set, which got wiped on every reload and meant a
//     user could process 9 claims, refresh, process another 10, and
//     still never hit a milestone. Storage is keyed by ISO date so the
//     midnight rollover wipes counts naturally without us having to
//     implement a clear-at-midnight timer,
//   • dedupe is global — a single processing event in two different
//     views increments the counter exactly once,
//   • the milestone-fired set guarantees each tier celebrates exactly
//     once per day even if the operator re-loads the same claim or
//     hard-refreshes the page after the milestone fires.
//
// Reset on sign-out by `useSessionMilestonesLifecycle` (cleanup wipes
// the storage keys for the current day).
//
// Confetti + copy come from `lib/celebrations.ts` (Task #509). The
// "session-milestone" tier is the SMALL sibling of day-complete in
// the type system; tweaking visuals or copy is a one-file edit.
//
// TASK #541 — generation-aware dedup. The dedup key is
// `${claimId}:${generation}` where `generation` is any monotonically-
// changing token the caller already has on hand:
//   • the leg/group `updatedAt` ISO string off the row payload, OR
//   • the leg's status string ("processed", "filed", etc.), OR
//   • a manual epoch the caller bumps when it knows a new processing
//     pass started.
// Callers that pass no generation get the legacy `claimId`-only dedup
// (semantic-preserving for the two pre-#541 callsites inside
// `claim-detail-v2` and `leg-conclusion-row`). The new callsites
// (portal queue submit, email batch send, re-attestation complete,
// withdraw, non-issue closure) pass the leg's transition timestamp
// so each fresh state-machine pass increments cleanly.

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "@/hooks/use-toast";
import { fireCelebration, celebrationCopy } from "@/lib/celebrations";

const MILESTONES = [10, 25, 50] as const;

const SEEN_KEY_PREFIX = "cc:session-milestones:seen:";
const FIRED_KEY_PREFIX = "cc:session-milestones:fired:";

function todayKey(): string {
  // Local-date YYYY-MM-DD; midnight rollover wipes the counter
  // naturally because tomorrow's keys are different. We deliberately
  // use local time (not UTC) so a user crossing midnight sees the
  // counter reset at the same moment their daily brief does.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function storageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && !!window.sessionStorage;
  } catch {
    return false;
  }
}

// In-memory fallback for environments without sessionStorage (node
// tests, SSR pre-hydration). Keyed by `${prefix}${date}` so the
// midnight rollover still wipes naturally and tests can simulate
// "next day" by stubbing the date helper. The product behavior in
// the browser path is identical because each browser load reads from
// real storage; this Map only ever holds entries for the current
// process. Cleared by `__resetSessionMilestonesForTests`.
const memoryFallback = new Map<string, Set<string>>();

function readSet(prefix: string): Set<string> {
  const key = prefix + todayKey();
  if (!storageAvailable()) {
    return new Set<string>(memoryFallback.get(key) ?? []);
  }
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set<string>(parsed.map(String));
  } catch {
    return new Set<string>();
  }
}

function writeSet(prefix: string, set: Set<string>): void {
  const key = prefix + todayKey();
  if (!storageAvailable()) {
    memoryFallback.set(key, new Set<string>(set));
    return;
  }
  try {
    window.sessionStorage.setItem(key, JSON.stringify([...set]));
    // Best-effort sweep: drop any keys for dates other than today so
    // sessionStorage doesn't grow unbounded for users who never close
    // their tab. Bounded loop — sessionStorage is per-tab so the total
    // key count is small.
    const keep = todayKey();
    for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
      const k = window.sessionStorage.key(i);
      if (!k) continue;
      if (
        (k.startsWith(SEEN_KEY_PREFIX) && !k.endsWith(keep)) ||
        (k.startsWith(FIRED_KEY_PREFIX) && !k.endsWith(keep))
      ) {
        window.sessionStorage.removeItem(k);
      }
    }
  } catch {
    // Quota exceeded / disabled — drop silently. Celebrations are best-effort.
  }
}

function clearForToday(): void {
  memoryFallback.clear();
  if (!storageAvailable()) return;
  try {
    window.sessionStorage.removeItem(SEEN_KEY_PREFIX + todayKey());
    window.sessionStorage.removeItem(FIRED_KEY_PREFIX + todayKey());
  } catch {
    /* ignore */
  }
}

// Lightweight pub/sub so UI surfaces (e.g. the top-bar pace badge) can
// subscribe to the live session count without coupling to storage
// internals. Snapshot is the integer count; listeners fire on every
// change including resets to 0.
const listeners = new Set<() => void>();
function emit(): void {
  for (const l of listeners) l();
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot(): number {
  return readSet(SEEN_KEY_PREFIX).size;
}

/**
 * Subscribes a React component to the live "claims processed this
 * session" count. Returns 0 when no claims have been processed yet —
 * callers should hide their UI in that case to keep the empty state
 * uncluttered.
 */
export function useSessionProcessedCount(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}

/**
 * Record that a claim just transitioned through a fresh processing
 * step for the current operator. Dedupe is per `${claimId}:${generation}`
 * so the same claim re-processed in a later state-machine pass (e.g.
 * after a revert) increments cleanly, while replays of the SAME
 * transition from multiple SSE / refetch surfaces still collapse to
 * one increment.
 *
 * Pass any monotonically-changing string for `generation`: the leg
 * `updatedAt`, the new status name, or a hand-bumped epoch all work.
 * Omit it entirely for the legacy "once per claim id per day"
 * behavior the two pre-#541 callsites rely on.
 *
 * Returns the new session count (post-increment), or `null` if this
 * exact event was already counted today.
 */
export function notifyClaimProcessedThisSession(
  claimId: number,
  generation?: string | number | null,
): number | null {
  const key = `${claimId}:${generation ?? ""}`;
  const seen = readSet(SEEN_KEY_PREFIX);
  if (seen.has(key)) return null;
  seen.add(key);
  writeSet(SEEN_KEY_PREFIX, seen);
  const count = seen.size;
  emit();
  const fired = readSet(FIRED_KEY_PREFIX);
  for (const milestone of MILESTONES) {
    if (count === milestone && !fired.has(String(milestone))) {
      fired.add(String(milestone));
      writeSet(FIRED_KEY_PREFIX, fired);
      fireCelebration("session-milestone");
      const copy = celebrationCopy({ kind: "session-milestone", milestone });
      toast({ ...copy, duration: 4500 });
      break;
    }
  }
  return count;
}

/**
 * Test/dev helper. Not used in production paths — exported only so
 * unit tests can reset the storage between cases. Importing this
 * from product code is a smell.
 */
export function __resetSessionMilestonesForTests(): void {
  clearForToday();
  emit();
}

/**
 * Resets the session counters when the operator signs out. Mounted
 * once from `layout.tsx`; the effect's cleanup runs when the auth
 * gate flips back to "not authenticated".
 */
export function useSessionMilestonesLifecycle(opts: { enabled: boolean }): void {
  const { enabled } = opts;
  useEffect(() => {
    if (!enabled) return;
    return () => {
      clearForToday();
      emit();
    };
  }, [enabled]);
}
