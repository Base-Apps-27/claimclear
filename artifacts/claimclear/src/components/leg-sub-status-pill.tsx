import { Badge } from "@/components/ui/badge";
import {
  deriveLegSubStatus,
  type LegForSubStatus,
  type LegSubStatus,
} from "@workspace/leg-state";

// Single source of presentation for the per-leg sub-status. Anything that
// wants to show the inner-tier state of one leg renders this pill —
// detail page, group rides table, list filters legend.

const LABELS: Record<LegSubStatus, string> = {
  excluded: "Excluded",
  needs_classification: "Needs classification",
  investigating: "Investigating",
  blocked: "Blocked",
  ready: "Ready",
  dropped: "Dropped",
  frozen: "Frozen",
};

// Colors picked to match the existing status-badge palette so the two
// tiers don't visually fight each other when stacked on the same row.
const CLASSES: Record<LegSubStatus, string> = {
  excluded: "bg-muted text-muted-foreground border-border",
  needs_classification: "bg-amber-50 text-amber-800 border-amber-200",
  investigating: "bg-blue-50 text-blue-800 border-blue-200",
  blocked: "bg-orange-50 text-orange-800 border-orange-200",
  ready: "bg-emerald-50 text-emerald-800 border-emerald-200",
  dropped: "bg-zinc-100 text-zinc-700 border-zinc-200",
  frozen: "bg-slate-100 text-slate-700 border-slate-300",
};

interface LegSubStatusPillProps {
  /** Pass either the derived sub-status or the leg row to derive from. */
  subStatus?: LegSubStatus;
  leg?: LegForSubStatus;
  className?: string;
}

export function LegSubStatusPill({ subStatus, leg, className = "" }: LegSubStatusPillProps) {
  const value: LegSubStatus = subStatus ?? (leg ? deriveLegSubStatus(leg) : "needs_classification");
  return (
    <Badge
      variant="outline"
      className={`${CLASSES[value]} ${className}`}
      data-testid={`leg-sub-status-pill-${value}`}
    >
      {LABELS[value]}
    </Badge>
  );
}

export function legSubStatusLabel(s: LegSubStatus): string {
  return LABELS[s];
}
