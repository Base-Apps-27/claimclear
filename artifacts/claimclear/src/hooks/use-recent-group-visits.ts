import { useCallback, useEffect, useState } from "react";

export type RecentGroupVisit = {
  id: number;
  invoiceNumber: string;
  clientNumber?: string | null;
  phase?: string | null;
  visitedAt: number;
  pinned?: boolean;
};

const MAX_ENTRIES = 10;

function storageKey(userId: string | undefined): string | null {
  if (!userId) return null;
  return `claimclear:recent-groups:${userId}`;
}

function readFromStorage(key: string | null): RecentGroupVisit[] {
  if (!key || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries = parsed.filter(
      (e): e is RecentGroupVisit =>
        e != null &&
        typeof e === "object" &&
        typeof e.id === "number" &&
        typeof e.invoiceNumber === "string" &&
        typeof e.visitedAt === "number",
    );
    return capUnpinned(entries);
  } catch {
    return [];
  }
}

// Apply the 10-entry FIFO cap only to *unpinned* entries. Pinned
// entries persist alongside the cap (Task #851) — they're an explicit
// "keep this one around" signal from the operator and shouldn't be
// pushed out by routine browsing.
function capUnpinned(entries: RecentGroupVisit[]): RecentGroupVisit[] {
  const pinned: RecentGroupVisit[] = [];
  const unpinned: RecentGroupVisit[] = [];
  for (const e of entries) {
    if (e.pinned) pinned.push(e);
    else unpinned.push(e);
  }
  const cappedUnpinned = unpinned.slice(0, MAX_ENTRIES);
  // Preserve insertion order from the source array so the rail keeps
  // the most-recently-visited entry on top regardless of pin state.
  const keep = new Set<number>([
    ...pinned.map((e) => e.id),
    ...cappedUnpinned.map((e) => e.id),
  ]);
  return entries.filter((e) => keep.has(e.id));
}

function writeToStorage(key: string | null, value: RecentGroupVisit[]): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or serialization errors are non-fatal — the recents
    // rail is a convenience surface, not a source of truth.
  }
}

// In-tab notifier so the sidebar updates the moment the detail page
// records a visit. The browser `storage` event only fires across
// tabs, not within the same one.
const SAME_TAB_EVENT = "claimclear:recent-groups-updated";

function notifySameTab(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT));
}

/**
 * Per-user localStorage-backed list of the last 10 invoice groups the
 * operator opened. Used by the sidebar "Recently viewed" rail
 * (Task #839). Per-user so two operators sharing a browser don't see
 * each other's history; local-only by design — no backend round trip
 * on each navigation.
 *
 * Task #851: pinned entries persist alongside the FIFO recents in the
 * same store. Pinning keeps an entry from being evicted by the
 * 10-entry cap; clearing wipes the per-user list (both pinned and
 * unpinned).
 */
export type RailPhaseUpdate = { id: number; phase?: string | null };

export function useRecentGroupVisits(userId: string | undefined): {
  visits: RecentGroupVisit[];
  recordVisit: (entry: Omit<RecentGroupVisit, "visitedAt" | "pinned">) => void;
  togglePin: (id: number) => void;
  clearRecents: () => void;
  applyPhaseUpdates: (updates: Iterable<RailPhaseUpdate>) => void;
} {
  const key = storageKey(userId);
  const [visits, setVisits] = useState<RecentGroupVisit[]>(() => readFromStorage(key));

  // Re-hydrate when the user changes (sign-out/sign-in in place).
  useEffect(() => {
    setVisits(readFromStorage(key));
  }, [key]);

  // Cross-tab + same-tab live updates.
  useEffect(() => {
    if (!key || typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setVisits(readFromStorage(key));
    };
    const onSameTab = () => setVisits(readFromStorage(key));
    window.addEventListener("storage", onStorage);
    window.addEventListener(SAME_TAB_EVENT, onSameTab);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SAME_TAB_EVENT, onSameTab);
    };
  }, [key]);

  const recordVisit = useCallback(
    (entry: Omit<RecentGroupVisit, "visitedAt" | "pinned">) => {
      if (!key) return;
      const current = readFromStorage(key);
      // Preserve the existing pinned flag if the operator had already
      // pinned this group — revisiting shouldn't un-pin it.
      const previous = current.find((v) => v.id === entry.id);
      const next: RecentGroupVisit = {
        ...entry,
        visitedAt: Date.now(),
        pinned: previous?.pinned,
      };
      const deduped = current.filter((v) => v.id !== entry.id);
      const merged = capUnpinned([next, ...deduped]);
      writeToStorage(key, merged);
      setVisits(merged);
      notifySameTab();
    },
    [key],
  );

  const togglePin = useCallback(
    (id: number) => {
      if (!key) return;
      const current = readFromStorage(key);
      const toggled = current.map((v) =>
        v.id === id ? { ...v, pinned: !v.pinned } : v,
      );
      const merged = capUnpinned(toggled);
      writeToStorage(key, merged);
      setVisits(merged);
      notifySameTab();
    },
    [key],
  );

  // Opportunistically refresh the cached phase for any rail entries
  // whose ids appear in `updates` (Task #852). The rail snapshots a
  // group's phase at visit time, so when a teammate moves a group
  // forward elsewhere we can piggy-back on list/detail query results
  // already in the React Query cache to keep the pill honest — no
  // extra HTTP requests. Entries not in `updates` are left untouched.
  const applyPhaseUpdates = useCallback(
    (updates: Iterable<RailPhaseUpdate>) => {
      if (!key) return;
      const byId = new Map<number, string | null | undefined>();
      for (const u of updates) {
        if (u && typeof u.id === "number") byId.set(u.id, u.phase);
      }
      if (byId.size === 0) return;
      const current = readFromStorage(key);
      let changed = false;
      const next = current.map((v) => {
        if (!byId.has(v.id)) return v;
        const freshPhase = byId.get(v.id) ?? null;
        const currentPhase = v.phase ?? null;
        if (freshPhase === currentPhase) return v;
        changed = true;
        return { ...v, phase: freshPhase };
      });
      if (!changed) return;
      writeToStorage(key, next);
      setVisits(next);
      notifySameTab();
    },
    [key],
  );

  const clearRecents = useCallback(() => {
    if (!key) return;
    writeToStorage(key, []);
    setVisits([]);
    notifySameTab();
  }, [key]);

  return { visits, recordVisit, togglePin, clearRecents, applyPhaseUpdates };
}
