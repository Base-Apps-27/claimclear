import { BookOpen } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  StateBadge,
  STATE_BADGE_DOMAIN_LABEL,
  STATE_BADGE_DOMAIN_DEFINITION,
  type StateBadgeVariant,
} from "@/components/state-badge";

// ─────────────────────────────────────────────────────────────────────
// StateLegend — sidebar-mounted reference popover for the six state
// vocabularies (Task #554). Lets an operator look up which domain a
// pill is showing without leaving the page they're working on. Each
// row in the popover renders a real `<StateBadge>` so the legend stays
// in lock-step with the renderer used everywhere else.
// ─────────────────────────────────────────────────────────────────────

interface LegendRow {
  variant: StateBadgeVariant;
  examples: string[];
  /** Surfaces in the operator UI that use this variant. */
  surfaces: string;
}

const ROWS: LegendRow[] = [
  {
    variant: "phase",
    examples: ["triage", "submitted", "awaiting_reattestation", "closed"],
    surfaces: "Invoice Group Detail header, Queue lanes, MAS Action surfaces",
  },
  {
    variant: "status",
    examples: ["New", "Awaiting Response", "On Hold", "Resolved"],
    surfaces: "Claims list, Invoice Groups list, Queue cards, Claim Detail",
  },
  {
    variant: "subStatus",
    examples: ["needs_classification", "investigating", "ready", "dropped"],
    surfaces: "Group legs panel, Claim Detail header, Queue per-leg row",
  },
  {
    variant: "verdict",
    examples: ["Approved", "Partial", "Denied"],
    surfaces: "Claim Detail latest-verdict card, Responses Awaiting Review",
  },
  {
    variant: "outcome",
    // vocab-allow-next-line — example wire-enum values shown in the legend; resolved to display labels by StateBadge at render time.
    examples: ["Approved", "Denied", "Non-Issue", "Withdrawn"],
    surfaces: "Group verdict block, Withdrawals page, audit log",
  },
  {
    variant: "stage",
    examples: ["queued", "in_progress", "submitted", "failed"],
    surfaces: "Portal Submissions page",
  },
];

export function StateLegend() {
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex items-center gap-2 px-2 py-1.5 rounded text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        data-testid="state-legend-trigger"
      >
        <BookOpen className="w-3.5 h-3.5" />
        <span>State legend</span>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        className="w-[28rem] p-0"
        data-testid="state-legend-popover"
      >
        <div className="p-3 border-b bg-muted/30">
          <h4 className="font-semibold text-sm">State vocabulary</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Phase belongs to invoice groups, sub-status belongs to legs,
            workflow status is a denormalized cache of the two. Hover any
            pill in the app to see which domain it belongs to.
          </p>
        </div>
        <ul className="divide-y">
          {ROWS.map((row) => (
            <li key={row.variant} className="p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {STATE_BADGE_DOMAIN_LABEL[row.variant]}
                </span>
                <code className="text-[10px] text-muted-foreground">
                  variant=&quot;{row.variant}&quot;
                </code>
              </div>
              <p className="text-xs text-muted-foreground">
                {STATE_BADGE_DOMAIN_DEFINITION[row.variant]}.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {row.examples.map((value) => (
                  <StateBadge
                    key={value}
                    variant={row.variant}
                    value={value}
                    className="text-[10px]"
                  />
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground/80">
                Used on: {row.surfaces}.
              </p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
