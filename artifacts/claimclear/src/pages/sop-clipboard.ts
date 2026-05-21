import { useSyncExternalStore } from "react";
import type { SubtreePayload } from "./sop-full-page-editor-helpers";

// Task #816 — Cross-SOP sub-tree clipboard.
//
// Module-level store that holds the most recent copied sub-tree
// payload plus a little metadata for the top-bar chip. Mirrored to
// sessionStorage so a hard refresh within the tab restores it; NOT
// mirrored to localStorage — the clipboard intentionally does not
// survive a full browser close (matches the task spec and standard
// workflow-editor copy/paste behavior).

export interface SopClipboardEntry {
  payload: SubtreePayload;
  nodeCount: number;
  sourceSopTitle: string;
  sourceErrorTypeId: number | null;
  copiedAt: number;
}

const STORAGE_KEY = "sop-editor:clipboard";

let current: SopClipboardEntry | null = null;
const listeners = new Set<() => void>();
let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof sessionStorage === "undefined") return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as SopClipboardEntry;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.payload &&
      typeof parsed.payload.rootId === "string" &&
      Array.isArray(parsed.payload.nodes)
    ) {
      current = parsed;
    }
  } catch {
    // Corrupt entry — clear it so the next write starts clean.
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

function persist(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    if (current) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage can throw on quota / privacy modes — clipboard
    // continues to work in-memory.
  }
}

function notify(): void {
  for (const l of listeners) l();
}

export function getClipboard(): SopClipboardEntry | null {
  hydrate();
  return current;
}

export function setClipboard(entry: SopClipboardEntry): void {
  hydrate();
  current = entry;
  persist();
  notify();
}

export function clearClipboard(): void {
  hydrate();
  if (current === null) return;
  current = null;
  persist();
  notify();
}

export function subscribeClipboard(listener: () => void): () => void {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// React hook — re-renders whenever the clipboard changes. Uses
// useSyncExternalStore so the snapshot is stable across reads (the
// store returns the same object reference until setClipboard is
// called again).
export function useSopClipboard(): SopClipboardEntry | null {
  return useSyncExternalStore(
    subscribeClipboard,
    getClipboard,
    () => null, // SSR fallback — clipboard is a browser-only concern
  );
}

// Test-only helper — reset the module's state AND sessionStorage so
// each test starts from a clean slate without coupling to the React
// hook.
export function __resetClipboardForTests(): void {
  current = null;
  hydrated = false;
  listeners.clear();
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
