import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ClaimResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, PauseCircle } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";
import { ClaimDetailV2 } from "@/components/claim-detail-v2";
import { deriveLegSubStatus, type LegSubStatus } from "@workspace/leg-state";

// Inline per-claim workflow — the "open me to investigate this leg" row
// the queue inline workspace renders for every disputed leg in a group.
//
// Three visual variants drive the row chrome:
//   - "active"    — leg owes work (needs_classification, investigating,
//                   ready-but-not-confirmed, blocked). Expanded by default
//                   when the gauntlet jumps to it; otherwise collapsed.
//   - "processed" — leg has reached a terminal-for-submission sub-status
//                   (ready / dropped / excluded). Compact pill so the
//                   operator can scan past it without losing the option to
//                   open it back up.
//   - "terminal"  — closed legs (Approved / Denied / Closed). Shown as
//                   read-only summary; expanding reveals the verdict
//                   recap from ClaimDetailV2.
//
// We intentionally render <ClaimDetailV2 /> as the expanded body rather
// than fork its internals: the per-leg surface is the same one the user
// sees on /claims/:id, so the inline workspace stays a true mirror of
// the canonical workflow.

const PROCESSED_SUB_STATUSES: ReadonlySet<LegSubStatus> = new Set([
  "ready",
  "dropped",
  "excluded",
]);

const CLOSED_OUTCOMES = new Set(["Approved", "Denied", "Closed", "Closed - No Response"]);

export type InlineClaimWorkflowVariant = "active" | "processed" | "terminal";

export function classifyClaimVariant(claim: ClaimResponse): InlineClaimWorkflowVariant {
  if (claim.outcome && CLOSED_OUTCOMES.has(claim.outcome)) return "terminal";
  const sub = deriveLegSubStatus(claim);
  if (PROCESSED_SUB_STATUSES.has(sub)) return "processed";
  return "active";
}

export interface InlineClaimWorkflowHandle {
  expand: () => void;
  scrollIntoView: () => void;
}

interface RowProps {
  claim: ClaimResponse;
  /** When true, this row starts expanded. The parent uses this to honour
   * `?leg=` URL state so a refresh restores the open leg. */
  initiallyExpanded?: boolean;
  /** Notified when the user toggles expansion. The parent persists the
   * URL state. */
  onExpandedChange?: (expanded: boolean) => void;
  /** Optional dim — when the parent has flagged this leg as the
   * "next unprocessed" target after a gauntlet failure, we ring it. */
  highlight?: boolean;
}

export const InlineClaimWorkflow = forwardRef<InlineClaimWorkflowHandle, RowProps>(
  function InlineClaimWorkflow(
    { claim, initiallyExpanded = false, onExpandedChange, highlight = false },
    ref,
  ) {
    const [expanded, setExpanded] = useState(initiallyExpanded);
    const rootRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      expand: () => {
        setExpanded(true);
        onExpandedChange?.(true);
      },
      scrollIntoView: () => {
        rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    }));

    const variant = classifyClaimVariant(claim);
    const subStatus = deriveLegSubStatus(claim);

    const handleToggle = () => {
      const next = !expanded;
      setExpanded(next);
      onExpandedChange?.(next);
    };

    const variantIcon =
      variant === "processed" ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" data-testid={`leg-row-icon-processed-${claim.id}`} />
      ) : variant === "terminal" ? (
        <XCircle className="h-3.5 w-3.5 text-muted-foreground" data-testid={`leg-row-icon-terminal-${claim.id}`} />
      ) : subStatus === "blocked" ? (
        <PauseCircle className="h-3.5 w-3.5 text-amber-600" data-testid={`leg-row-icon-blocked-${claim.id}`} />
      ) : null;

    return (
      <Card
        ref={rootRef}
        data-testid={`inline-claim-row-${claim.id}`}
        data-variant={variant}
        className={
          highlight
            ? "ring-2 ring-amber-500 border-amber-400 scroll-mt-4"
            : variant === "processed"
              ? "bg-muted/20 scroll-mt-4"
              : variant === "terminal"
                ? "bg-muted/40 scroll-mt-4"
                : "scroll-mt-4"
        }
      >
        <CardContent className="p-0">
          <button
            type="button"
            onClick={handleToggle}
            aria-expanded={expanded}
            data-testid={`inline-claim-toggle-${claim.id}`}
            className="w-full text-left px-4 py-3 flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
          >
            <span className="font-mono font-semibold text-sm shrink-0">
              #{claim.id}
            </span>
            <span className="font-mono text-xs text-muted-foreground shrink-0">
              {claim.confNumber || "—"}
            </span>
            <span className="text-xs text-muted-foreground shrink-0">
              {claim.date ? formatDate(claim.date) : "—"}
            </span>
            <span className="text-xs tabular-nums shrink-0">
              {formatCurrency(claim.claimAmount ?? "0")}
            </span>
            <span className="flex-1 min-w-0 flex items-center gap-2">
              {variantIcon}
              <LegSubStatusPill leg={claim} />
              {variant === "terminal" && claim.outcome && (
                <Badge variant="outline" className="text-[10px]">{claim.outcome}</Badge>
              )}
              {claim.errorTypeName && (
                <span className="text-xs text-muted-foreground truncate">
                  {claim.errorTypeName}
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
              {expanded ? (
                <>Hide <ChevronUp className="h-3.5 w-3.5" /></>
              ) : (
                <>Open <ChevronDown className="h-3.5 w-3.5" /></>
              )}
            </span>
          </button>

          {expanded && (
            <div
              className="border-t bg-background"
              data-testid={`inline-claim-body-${claim.id}`}
            >
              <ClaimDetailV2 claimId={claim.id} />
            </div>
          )}
        </CardContent>
      </Card>
    );
  },
);

interface ListProps {
  claims: ClaimResponse[];
  expandedClaimId: number | null;
  onExpandedChange: (claimId: number | null) => void;
  highlightClaimId?: number | null;
}

// Convenience list wrapper so the queue page doesn't have to manage refs
// for every leg. Keeps the gauntlet's "jump to next unprocessed" simple:
// the parent updates `expandedClaimId` and `highlightClaimId`, and the
// row's effect handles scroll + expand on the next render.
export function InlineClaimWorkflowList({
  claims,
  expandedClaimId,
  onExpandedChange,
  highlightClaimId,
}: ListProps) {
  if (claims.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic px-2 py-3">
        No legs included in the dispute for this group.
      </p>
    );
  }

  // Bucketed render: active legs first (the work), then processed
  // (collapsed pills), then terminal (read-only). Operators read top to
  // bottom and the eye lands on the next thing that owes action.
  const sorted = [...claims].sort((a, b) => {
    const va = classifyClaimVariant(a);
    const vb = classifyClaimVariant(b);
    const order: Record<InlineClaimWorkflowVariant, number> = {
      active: 0,
      processed: 1,
      terminal: 2,
    };
    if (order[va] !== order[vb]) return order[va] - order[vb];
    return a.id - b.id;
  });

  return (
    <div className="space-y-2" data-testid="inline-claim-workflow-list">
      {sorted.map((c) => (
        <InlineClaimWorkflowRow
          key={c.id}
          claim={c}
          expandedClaimId={expandedClaimId}
          onExpandedChange={onExpandedChange}
          highlightClaimId={highlightClaimId ?? null}
        />
      ))}
    </div>
  );
}

function InlineClaimWorkflowRow({
  claim,
  expandedClaimId,
  onExpandedChange,
  highlightClaimId,
}: {
  claim: ClaimResponse;
  expandedClaimId: number | null;
  onExpandedChange: (claimId: number | null) => void;
  highlightClaimId: number | null;
}) {
  const ref = useRef<InlineClaimWorkflowHandle>(null);
  const isExpanded = expandedClaimId === claim.id;
  const isHighlight = highlightClaimId === claim.id;

  // When the parent flips highlight on (gauntlet jump), expand the row
  // and scroll it into view on the next animation frame. We also re-fire
  // the scroll on subsequent highlight changes so consecutive jumps
  // (e.g. operator clears one gate then submits, hits another) keep
  // bringing the right row into view.
  useEffect(() => {
    if (!isHighlight) return;
    ref.current?.expand();
    const handle = window.requestAnimationFrame(() => ref.current?.scrollIntoView());
    return () => window.cancelAnimationFrame(handle);
  }, [isHighlight]);

  return (
    <InlineClaimWorkflow
      ref={ref}
      claim={claim}
      initiallyExpanded={isExpanded}
      highlight={isHighlight}
      onExpandedChange={(next) => {
        onExpandedChange(next ? claim.id : null);
      }}
    />
  );
}
