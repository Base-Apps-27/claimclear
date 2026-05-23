import { useCallback, useEffect, useState } from "react";

export type RecentGroupVisit = {
  id: number;
  invoiceNumber: string;
  clientNumber?: string | null;
  phase?: string | null;
  visitedAt: number;
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
    return parsed
      .filter(
        (e): e is RecentGroupVisit =>
          e != null &&
          typeof e === "object" &&
          typeof e.id === "number" &&
          typeof e.invoiceNumber === "string" &&
          typeof e.visitedAt === "number",
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
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

/**
 * Per-user localStorage-backed list of the last 10 invoice groups the
 * operator opened. Used by the sidebar "Recently viewed" rail
 * (Task #839). Per-user so two operators sharing a browser don't see
 * each other's history; local-only by design — no backend round trip
 * on each navigation.
 */
export function useRecentGroupVisits(userId: string | undefined): {
  visits: RecentGroupVisit[];
  recordVisit: (entry: Omit<RecentGroupVisit, "visitedAt">) => void;
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
    (entry: Omit<RecentGroupVisit, "visitedAt">) => {
      if (!key) return;
      const next: RecentGroupVisit = { ...entry, visitedAt: Date.now() };
      const current = readFromStorage(key);
      const deduped = current.filter((v) => v.id !== entry.id);
      const merged = [next, ...deduped].slice(0, MAX_ENTRIES);
      writeToStorage(key, merged);
      setVisits(merged);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT));
      }
    },
    [key],
  );

  return { visits, recordVisit };
}
