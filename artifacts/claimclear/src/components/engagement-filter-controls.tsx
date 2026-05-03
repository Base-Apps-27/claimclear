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
// - HideExpiredToggle: "Hide expired" (default on, pressed) | "Show
//   expired". Mirrors the existing `?includeExpired=true` URL param
//   but with a depressed visual so the operator knows the gate is on.

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
            ? "bg-foreground text-background shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]"
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
            ? "bg-foreground text-background shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]"
            : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")
        }
      >
        All
      </button>
    </div>
  );
}

interface HideExpiredToggleProps {
  /** True when the includeExpired URL param is on (i.e. expired ARE shown). */
  includeExpired: boolean;
  onChange: (nextIncludeExpired: boolean) => void;
  testid?: string;
}

export function HideExpiredToggle({
  includeExpired,
  onChange,
  testid = "toggle-hide-expired",
}: HideExpiredToggleProps) {
  // "Hide expired" is the default state; when pressed (hidePressed=true)
  // the toggle visibly looks depressed so the operator knows the gate is
  // on and a single click ("Show expired") releases it.
  const hidePressed = !includeExpired;
  return (
    <div
      role="group"
      aria-label="Expired filter"
      className="inline-flex rounded-md border border-border overflow-hidden shadow-sm"
      data-testid={testid}
    >
      <button
        type="button"
        onClick={() => onChange(false)}
        aria-pressed={hidePressed}
        data-testid={`${testid}-hide`}
        title="Hide expired rows. Items past their filing deadline are tucked away. Press 'Show expired' to include them."
        className={
          "px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 " +
          (hidePressed
            ? "bg-foreground text-background shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]"
            : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")
        }
      >
        <span aria-hidden className={hidePressed ? "h-1.5 w-1.5 rounded-full bg-background/80" : "h-1.5 w-1.5 rounded-full bg-muted-foreground/40"} />
        Hide expired
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        aria-pressed={!hidePressed}
        data-testid={`${testid}-show`}
        title="Include rows whose filing deadline has passed."
        className={
          "px-3 py-1.5 text-xs font-semibold transition-colors border-l border-border " +
          (!hidePressed
            ? "bg-foreground text-background shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]"
            : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground")
        }
      >
        Show expired
      </button>
    </div>
  );
}
