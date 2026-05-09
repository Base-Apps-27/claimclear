import type { InvoiceGroupResponse } from "@workspace/api-client-react";
import { Sparkles } from "lucide-react";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";
import { Badge } from "@/components/ui/badge";
import { WrapTooltip } from "@/components/info-tooltip";
import { getGroupLifecyclePhaseFromGroup } from "@/lib/lifecycle-phase";
import type { LegSubStatus } from "@workspace/leg-state";

// Shared sub-status breakdown pill used by the Queue and Invoice
// Groups list (Task #558). Renders the canonical "X ready ·
// Y investigating · Z dropped" triad next to a row when the group is
// in the Pre-submit phase, plus the "Ready to Generate" indicator
// when every disputable leg has settled and the writeup hasn't been
// generated yet. Returns null outside the Pre-submit phase so the two
// list pages render the exact same atom in the exact same place.

const TRIAD: readonly LegSubStatus[] = ["ready", "investigating", "dropped"];

interface PreSubmitBreakdownProps {
  group: Pick<
    InvoiceGroupResponse,
    "id" | "phase" | "status" | "legSubStatusCounts" | "previewGeneratedAt"
  >;
  className?: string;
}

export function PreSubmitBreakdown({ group, className = "" }: PreSubmitBreakdownProps) {
  if (getGroupLifecyclePhaseFromGroup(group) !== "pre-submit") return null;

  const counts = (group.legSubStatusCounts ?? {}) as Record<string, number>;
  const ready = counts.ready ?? 0;
  const investigating = counts.investigating ?? 0;
  const blocked = counts.blocked ?? 0;
  const needsClassification = counts.needs_classification ?? 0;
  const previewGenerated = !!group.previewGeneratedAt;
  // "Every disputed leg is `ready` or `dropped`" — disputed legs that
  // haven't settled show up as `investigating` or `blocked`. Triage
  // (`needs_classification`) sits earlier in the funnel: until those
  // legs are classified the writeup gate would refuse, so we keep
  // them in the gate too.
  const allDisputableSettled = investigating === 0 && blocked === 0 && needsClassification === 0;
  const readyToGenerate = allDisputableSettled && ready > 0 && !previewGenerated;

  return (
    <div
      className={`inline-flex items-center gap-2 flex-wrap ${className}`}
      data-testid={`pre-submit-breakdown-${group.id}`}
    >
      <span
        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
        data-testid={`leg-breakdown-${group.id}`}
      >
        {TRIAD.map((k, i) => {
          const n = counts[k] ?? 0;
          return (
            <span key={k} className="inline-flex items-center gap-1">
              <LegSubStatusPill subStatus={k} className="text-[10px] px-1.5 py-0" />
              <span className="tabular-nums" data-testid={`leg-breakdown-${group.id}-${k}`}>
                {n}
              </span>
              {i < TRIAD.length - 1 && <span className="opacity-50">·</span>}
            </span>
          );
        })}
      </span>
      {readyToGenerate && (
        <WrapTooltip content="Every disputable leg is ready or dropped — generate the writeup to move this group to Portal Queued.">
          <Badge
            data-testid={`ready-to-generate-${group.id}`}
            variant="outline"
            className="text-[10px] inline-flex items-center gap-1 cursor-help"
            style={{
              background: "hsl(var(--cc-green-bg))",
              color: "hsl(var(--cc-green-fg))",
              borderColor: "hsl(var(--cc-green-border))",
            }}
          >
            <Sparkles className="h-3 w-3" />
            Ready to Generate
          </Badge>
        </WrapTooltip>
      )}
    </div>
  );
}
