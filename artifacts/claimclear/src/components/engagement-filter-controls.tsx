// Two prominent default-on filter toggles shared by the Claims, Invoice
// Groups, and Queue list pages. Both render as segmented "pressed"
// buttons so the operator can see at a glance that the list is being
// narrowed, and un-press to widen it.
//
// - NeedsEngagementToggle: "Needs engagement" (default on) | "All".
//   When "Needs engagement" is pressed, the list is filtered to the
//   ENGAGEMENT_NEEDED_STATUSES set (pre-submit + response-pending +
//   mas-action-required). When "All" is pressed, no engagement filter
//   is applied. URL param: `engagement=needs|all`, default `needs`.
//
// - HideExpiredToggle: "Hide past-deadline" (default on, pressed) |
//   "Show past-deadline". Mirrors the existing `?includeExpired=true`
//   URL param (kept for back-compat) but with a depressed visual so
//   the operator knows the gate is on. The label says "past-deadline"
//   because the unified server-side guard hides both Expired-status
//   rows AND any row whose effective deadline has slipped, regardless
//   of status.

export type EngagementMode = "needs" | "all";

export function readEngagementMode(raw: string | null | undefined): EngagementMode {
  return raw === "all" ? "all" : "needs";
}

interface NeedsEngagementToggleProps {
  mode: EngagementMode;
  onChange: (next: EngagementMode) => void;
  testidPrefix?: string;
}

export function NeedsEngagementToggle({
  mode,
  onChange,
  testidPrefix = "engagement-toggle",
}: NeedsEngagementToggleProps) {
  const needsPressed = mode === "needs";
  const allPressed = mode === "all";
  return (
    <div
      role="group"
      aria-label="Engagement filter"
      className="inline-flex rounded-md border border-border overflow-hidden shadow-sm"
      data-testid={testidPrefix}
    >
      <button
        type="button"
        onClick={() => onChange("needs")}
        aria-pressed={needsPressed}
        data-testid={`${testidPrefix}-needs`}
        title="Show only items that need your action right now (pre-submit, response pending, MAS action). Press All to widen."
        className={
          "px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 " +
          (needsPressed
            ? "bg-primary text-primary-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]"
            : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")
        }
      >
        <span aria-hidden className={needsPressed ? "h-1.5 w-1.5 rounded-full bg-background/80" : "h-1.5 w-1.5 rounded-full bg-muted-foreground/40"} />
        Needs engagement
      </button>
      <button
        type="button"
        onClick={() => onChange("all")}
        aria-pressed={allPressed}
        data-testid={`${testidPrefix}-all`}
        title="Show everything, including managed/parked items."
        className={
          "px-3 py-1.5 text-xs font-semibold transition-colors border-l border-border " +
          (allPressed
            ? "bg-primary text-primary-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]"
            : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")
        }
      >
        All
      </button>
    </div>
  );
}

interface HideExpiredToggleProps {
  /**
   * True when the includeExpired URL param is on (i.e. past-deadline
   * rows — including Expired-status rows and any row whose effective
   * deadline has slipped — ARE shown).
   */
  includeExpired: boolean;
  onChange: (nextIncludeExpired: boolean) => void;
  testid?: string;
}

export function HideExpiredToggle({
  includeExpired,
  onChange,
  testid = "toggle-hide-expired",
}: HideExpiredToggleProps) {
  // "Hide past-deadline" is the default state; when pressed
  // (hidePressed=true) the toggle visibly looks depressed so the
  // operator knows the gate is on and a single click ("Show
  // past-deadline") releases it.
  const hidePressed = !includeExpired;
  return (
    <div
      role="group"
      aria-label="Past-deadline filter"
      className="inline-flex rounded-md border border-border overflow-hidden shadow-sm"
      data-testid={testid}
    >
      <button
        type="button"
        onClick={() => onChange(false)}
        aria-pressed={hidePressed}
        data-testid={`${testid}-hide`}
        title="Hide rows past their filing deadline (including Expired-status rows and any row whose effective deadline has slipped). Press 'Show past-deadline' to include them."
        className={
          "px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 " +
          (hidePressed
            ? "bg-primary text-primary-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]"
            : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")
        }
      >
        <span aria-hidden className={hidePressed ? "h-1.5 w-1.5 rounded-full bg-background/80" : "h-1.5 w-1.5 rounded-full bg-muted-foreground/40"} />
        Hide past-deadline
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        aria-pressed={!hidePressed}
        data-testid={`${testid}-show`}
        title="Include rows whose effective deadline has passed, including Expired-status rows."
        className={
          "px-3 py-1.5 text-xs font-semibold transition-colors border-l border-border " +
          (!hidePressed
            ? "bg-primary text-primary-foreground shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]"
            : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")
        }
      >
        Show past-deadline
      </button>
    </div>
  );
}
