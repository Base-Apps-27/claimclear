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
  // Sibling-duplicate uses a muted slate tone — visually quiet on the leg
  // row because the operator should treat duplicates as no-ops; the click-
  // through link to the primary CLM does the real work.
  duplicate: "bg-slate-100 text-slate-700 border-slate-300",
  needs_classification: "bg-amber-100 text-amber-800 border-amber-200",
  investigating: "bg-blue-100 text-blue-800 border-blue-200",
  blocked: "bg-orange-100 text-orange-800 border-orange-200",
  ready: "bg-green-100 text-green-800 border-green-200",
  dropped: "bg-zinc-100 text-zinc-700 border-zinc-200",
  frozen: "bg-slate-100 text-slate-700 border-slate-300",
};

// Inline SVG check used by the one-shot completion microinteraction
// (Task #324). Mirrors the cohesion StatusPill's AnimatedCheck so the
// queue panel and detail page share visual language. Stroke-dash draw-in
// is driven by `.cc-check-tick` in `index.css`, which also handles
// `prefers-reduced-motion`.
function AnimatedCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M5 12.5l4 4 10-10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="cc-check-tick"
      />
    </svg>
  );
}

interface LegSubStatusPillProps {
  /** Pass either the derived sub-status or the leg row to derive from. */
  subStatus?: LegSubStatus;
  leg?: LegForSubStatus;
  className?: string;
  /**
   * One-shot decoration used when this leg has just transitioned to a
   * processed sub-status (ready/dropped/excluded) from the operator's own
   * SOP advance. Renders an animated check that draws in over ~420ms plus
   * a soft background glow. The caller is responsible for clearing the
   * prop after the animation so it cannot replay on re-render. See
   * Task #324 (and Task #315 for the detail-page sibling).
   */
  justTransitioned?: boolean;
}

export function LegSubStatusPill({
  subStatus,
  leg,
  className = "",
  justTransitioned = false,
}: LegSubStatusPillProps) {
  const value: LegSubStatus = subStatus ?? (leg ? deriveLegSubStatus(leg) : "needs_classification");
  // When we have the leg row in hand, prefer the reason-aware label so a
  // dropped-via-cannot_dispute leg reads as "Non-contestable" and a
  // dropped-via-non_issue leg reads as "Non-issue".
  const label = leg ? legSubStatusDisplayLabel(value, leg) : glossarySubStatusLabel(value);
  const transitionClass = justTransitioned ? " cc-pill-just-transitioned" : "";
  return (
    <Badge
      variant="outline"
      className={`${CLASSES[value]} inline-flex items-center gap-1 ${className}${transitionClass}`}
      data-testid={`leg-sub-status-pill-${value}`}
      data-just-transitioned={justTransitioned ? "true" : undefined}
    >
      {justTransitioned ? <AnimatedCheck /> : null}
      {label}
    </Badge>
  );
}

// Re-export the glossary helper under the local name so existing
// importers continue to compile. New code should import directly from
// `@workspace/vocab`.
export { glossarySubStatusLabel as legSubStatusLabel };
