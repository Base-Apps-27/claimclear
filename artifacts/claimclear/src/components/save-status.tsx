import * as React from "react";
import { Loader2 } from "lucide-react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

// Last-saved status line for textarea-backed editors (Task #846).
//
// Operators in the per-leg context editor, the SOP plain-text tab, the
// notes textarea, and the dispute draft already get a silent unsaved-
// draft leave guard, but nothing in the UI confirms that the save
// actually landed. The result is compulsive re-pasting and a vague
// sense that work might be lost. This component is the visible
// counterpart — a small "Saved 4s ago" / "Saving…" / "Unsaved changes"
// line that the editor mounts under its textarea.
//
// State semantics (caller-controlled — this component only renders):
//   • "saving"  → spinner + "Saving…"
//   • "unsaved" → amber dot + "Unsaved changes"
//   • "saved"   → relative "Saved Xs ago" / "Saved just now", ticking.
//                 The breath microinteraction fires once when
//                 `lastSavedAt` advances; reduced-motion users get the
//                 same text without the scale-down.
//   • "idle"    → renders nothing (no prior save this session).
//
// Ticking: a single `setInterval` is mounted only while state is
// "saved" so an editor at rest with nothing to display does not run a
// background timer.

export type SaveStatusState = "saving" | "unsaved" | "saved" | "idle";

export interface SaveStatusProps {
  state: SaveStatusState;
  /** Epoch ms of the most recent successful save (or null). */
  lastSavedAt: number | null;
  className?: string;
  /** Override the default `save-status` test id (handy when there are
   *  multiple editors on one screen). */
  testId?: string;
}

/** Pure helper: relative "Saved …" copy. Exported for unit tests. */
export function formatSavedAgo(nowMs: number, lastSavedAtMs: number): string {
  const deltaSec = Math.max(0, Math.floor((nowMs - lastSavedAtMs) / 1000));
  if (deltaSec < 5) return "Saved just now";
  if (deltaSec < 60) return `Saved ${deltaSec}s ago`;
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `Saved ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Saved ${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `Saved ${day}d ago`;
}

function useNowTick(active: boolean): number {
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export function SaveStatus({
  state,
  lastSavedAt,
  className,
  testId,
}: SaveStatusProps) {
  const reduced = useReducedMotion();
  const now = useNowTick(state === "saved" && lastSavedAt !== null);

  // Fire the breath microinteraction whenever `lastSavedAt` advances
  // while we're in the "saved" state. Bumping `breathKey` remounts the
  // outer span so the CSS animation restarts cleanly. Reduced-motion
  // callers get the class skipped — text alone still updates.
  const [breathKey, setBreathKey] = React.useState(0);
  const lastSeenRef = React.useRef<number | null>(lastSavedAt);
  React.useEffect(() => {
    if (
      state === "saved" &&
      lastSavedAt !== null &&
      lastSeenRef.current !== lastSavedAt
    ) {
      lastSeenRef.current = lastSavedAt;
      setBreathKey((k) => k + 1);
    }
  }, [state, lastSavedAt]);

  let content: React.ReactNode = null;
  if (state === "saving") {
    content = (
      <>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        <span>Saving…</span>
      </>
    );
  } else if (state === "unsaved") {
    content = (
      <>
        <span
          className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block"
          aria-hidden
        />
        <span>Unsaved changes</span>
      </>
    );
  } else if (state === "saved" && lastSavedAt !== null) {
    content = <span>{formatSavedAgo(now, lastSavedAt)}</span>;
  } else {
    return null;
  }

  const breathClass = !reduced && breathKey > 0 ? "animate-cc-breath" : "";

  return (
    <div
      key={breathKey || "static"}
      className={`inline-flex items-center gap-1 text-[11px] text-muted-foreground ${breathClass} ${className ?? ""}`}
      data-testid={testId ?? "save-status"}
      data-state={state}
      role="status"
      aria-live="polite"
    >
      {content}
    </div>
  );
}
