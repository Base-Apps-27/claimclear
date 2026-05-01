import { Badge } from "@/components/ui/badge";
import {
  deriveLegSubStatus,
  type LegForSubStatus,
  type LegSubStatus,
} from "@workspace/leg-state";
import {
  legSubStatusLabel as glossarySubStatusLabel,
  legSubStatusDisplayLabel,
} from "@workspace/vocab";

// Single source of presentation for the per-leg sub-status. Anything that
// wants to show the inner-tier state of one leg renders this pill —
// detail page, group rides table, list filters legend.
//
// Operator labels live in `@workspace/vocab` (`legSubStatusLabel` /
// `legSubStatusDisplayLabel`). Colors are still owned here because they
// belong with the React render, not the vocabulary.

// Colors deliberately mirror the status-badge.tsx palette
// (`bg-X-100 text-X-800 border-X-200`) so the inner-tier sub-status pill and
// the outer status pill read at the same visual weight when stacked on the
// same row. `green` and `orange` are used (not `emerald`/`amber-50`) to match
// the production status-badge vocabulary exactly.
const CLASSES: Record<LegSubStatus, string> = {
  excluded: "bg-muted text-muted-foreground border-border",
  needs_classification: "bg-amber-100 text-amber-800 border-amber-200",
  investigating: "bg-blue-100 text-blue-800 border-blue-200",
  blocked: "bg-orange-100 text-orange-800 border-orange-200",
  ready: "bg-green-100 text-green-800 border-green-200",
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
  // When we have the leg row in hand, prefer the reason-aware label so a
  // dropped-via-cannot_dispute leg reads as "Non-contestable" and a
  // dropped-via-non_issue leg reads as "Non-issue".
  const label = leg ? legSubStatusDisplayLabel(value, leg) : glossarySubStatusLabel(value);
  return (
    <Badge
      variant="outline"
      className={`${CLASSES[value]} ${className}`}
      data-testid={`leg-sub-status-pill-${value}`}
    >
      {label}
    </Badge>
  );
}

// Re-export the glossary helper under the local name so existing
// importers continue to compile. New code should import directly from
// `@workspace/vocab`.
export { glossarySubStatusLabel as legSubStatusLabel };
