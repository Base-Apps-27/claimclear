import { AlertTriangle, Clock } from "lucide-react";

// Task #352 — two variants:
//   "urgent"  = pre-submit, deadline today or past → red "Today" badge,
//               tooltip "Must file today — cannot wait until tomorrow".
//   "stuck"   = post-submit (Portal Queued / Processed), deadline slipped
//               without a confirmation → amber "Stuck" badge, distinct
//               tooltip so the operator knows the action is a chase, not a re-file.
//
// Helper for callers that receive both `isUrgent` and `submittedStuck` off
// a list row — infers the right kind automatically:
//   submittedStuck && isUrgent → "stuck" (claim level: both can be true)
//   submittedStuck             → "stuck" (group level: mutually exclusive)
//   isUrgent                   → "urgent"
//   otherwise                  → null (badge renders nothing)
export function pickBadgeKind(
  isUrgent: boolean | undefined | null,
  submittedStuck: boolean | undefined | null,
): "urgent" | "stuck" | null {
  if (submittedStuck) return "stuck";
  if (isUrgent) return "urgent";
  return null;
}

interface UrgentTodayBadgeProps {
  isUrgent: boolean | undefined | null;
  /** Task #352 — when true renders the amber "Stuck" variant instead of
   *  the red "Today" one. Takes precedence over `isUrgent`. */
  submittedStuck?: boolean | undefined | null;
  size?: "sm" | "md";
  className?: string;
}

export function UrgentTodayBadge({
  isUrgent,
  submittedStuck,
  size = "sm",
  className = "",
}: UrgentTodayBadgeProps) {
  const kind = pickBadgeKind(isUrgent, submittedStuck);
  if (!kind) return null;

  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";

  if (kind === "stuck") {
    return (
      <span
        data-testid="badge-submitted-stuck"
        className={`inline-flex items-center gap-1 rounded font-semibold uppercase tracking-wide whitespace-nowrap ${padding} ${className}`}
        style={{
          background: "hsl(var(--cc-amber-bg))",
          color: "hsl(var(--cc-amber-fg))",
          border: "1px solid hsl(var(--cc-amber-border))",
        }}
        title="Past filing deadline — submission sent but unconfirmed. Chase portal confirmation, do not re-file."
      >
        <Clock className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
        Stuck
      </span>
    );
  }

  return (
    <span
      data-testid="badge-urgent-today"
      className={`inline-flex items-center gap-1 rounded font-semibold uppercase tracking-wide whitespace-nowrap ${padding} ${className}`}
      style={{
        background: "hsl(var(--destructive))",
        color: "white",
      }}
      title="Must file today — cannot wait until tomorrow"
    >
      <AlertTriangle className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
      Today
    </span>
  );
}
