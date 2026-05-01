import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSetLegContext,
  useConcludeLeg,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
} from "@workspace/api-client-react";
import type { ClaimResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Loader2,
  Save,
  Workflow,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";
import { ClaimDetailV2 } from "@/components/claim-detail-v2";
import { useToast } from "@/hooks/use-toast";
import { deriveLegSubStatus, type LegSubStatus } from "@workspace/leg-state";

// ─────────────────────────────────────────────────────────────────────────
// LegConclusionRow — the Queue Panel A row introduced in Task #265.
//
// What it replaces: InlineClaimWorkflow (collapsed-only header → optional
// expanded ClaimDetailV2). The replacement keeps that affordance but adds
// inline per-leg context capture + a three-button conclusion control
// directly on the row, so an operator can resolve a leg without opening
// the full investigation surface.
//
// Conclusion control:
//   - "Open SOP"      → expands the row; the operator walks the existing
//                       SOP tree inside ClaimDetailV2.
//   - "Non-issue"     → calls /claims/:id/conclude-leg with reason=non_issue
//                       (drops the leg as not actually a billing issue).
//   - "Non-contest."  → calls /claims/:id/conclude-leg with
//                       reason=cannot_dispute (drops the leg as something
//                       we can't push back on).
//
// Per-leg context Textarea autosaves on blur (or via Save) using the
// existing /claims/:id/per-leg-context endpoint. The save is required
// before conclusion (visual hint, not a hard backend gate) so the AI
// dispute draft has narrative to work with.
// ─────────────────────────────────────────────────────────────────────────

const PROCESSED_SUB_STATUSES: ReadonlySet<LegSubStatus> = new Set([
  "ready",
  "dropped",
  "excluded",
]);

const CLOSED_OUTCOMES = new Set([
  "Approved",
  "Denied",
  "Closed",
  "Closed - No Response",
]);

type LegVariant = "active" | "processed" | "terminal";

function classifyVariant(claim: ClaimResponse): LegVariant {
  if (claim.outcome && CLOSED_OUTCOMES.has(claim.outcome)) return "terminal";
  const sub = deriveLegSubStatus(claim);
  if (PROCESSED_SUB_STATUSES.has(sub)) return "processed";
  return "active";
}

export interface LegConclusionRowHandle {
  expand: () => void;
  scrollIntoView: () => void;
}

interface RowProps {
  claim: ClaimResponse;
  groupId: number;
  // Group-level lock (presence). Disables every mutating control with a
  // tooltip-friendly hint.
  lockReason?: string | null;
  initiallyExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  highlight?: boolean;
}

export const LegConclusionRow = forwardRef<LegConclusionRowHandle, RowProps>(
  function LegConclusionRow(
    {
      claim,
      groupId,
      lockReason,
      initiallyExpanded = false,
      onExpandedChange,
      highlight = false,
    },
    ref,
  ) {
    const qc = useQueryClient();
    const { toast } = useToast();
    const [expanded, setExpanded] = useState(initiallyExpanded);
    const [perLegDraft, setPerLegDraft] = useState<string>(claim.perLegContext ?? "");
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      // Reset the draft whenever the upstream claim's perLegContext shifts
      // (e.g. another tab saved it). Avoids the local draft going stale.
      setPerLegDraft(claim.perLegContext ?? "");
    }, [claim.perLegContext]);

    useImperativeHandle(ref, () => ({
      expand: () => {
        setExpanded(true);
        onExpandedChange?.(true);
      },
      scrollIntoView: () => {
        rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    }));

    const variant = classifyVariant(claim);
    const subStatus = deriveLegSubStatus(claim);
    const isResolved = PROCESSED_SUB_STATUSES.has(subStatus);
    const isOpen = !isResolved && variant !== "terminal";

    const setLegContextMutation = useSetLegContext();
    const concludeLegMutation = useConcludeLeg();

    function invalidateGroup() {
      qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
      qc.invalidateQueries({
        queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
      });
      qc.invalidateQueries({ queryKey: ["invoice-groups"] });
    }

    const dirtyContext =
      (perLegDraft || "").trim() !== ((claim.perLegContext ?? "").trim());

    function onSaveContext() {
      if (!dirtyContext) return;
      setLegContextMutation.mutate(
        { id: claim.id, data: { context: perLegDraft } },
        {
          onSuccess: () => {
            invalidateGroup();
          },
          onError: (e: unknown) =>
            toast({
              title: "Save failed",
              description: String((e as Error).message),
              variant: "destructive",
            }),
        },
      );
    }

    function onConclude(reason: "non_issue" | "cannot_dispute") {
      // Persist any unsaved per-leg context first so the AI write-up has
      // the operator's reasoning when it regenerates.
      const finalize = () => {
        concludeLegMutation.mutate(
          { id: claim.id, data: { reason } },
          {
            onSuccess: () => {
              toast({
                title:
                  reason === "non_issue"
                    ? "Leg marked Non-issue"
                    : "Leg marked Non-contestable",
              });
              invalidateGroup();
            },
            onError: (e: unknown) =>
              toast({
                title: "Could not conclude leg",
                description: String((e as Error).message),
                variant: "destructive",
              }),
          },
        );
      };
      if (dirtyContext) {
        setLegContextMutation.mutate(
          { id: claim.id, data: { context: perLegDraft } },
          { onSuccess: finalize, onError: finalize },
        );
      } else {
        finalize();
      }
    }

    const handleToggle = () => {
      const next = !expanded;
      setExpanded(next);
      onExpandedChange?.(next);
    };

    const variantIcon =
      variant === "processed" ? (
        <CheckCircle2
          className="h-3.5 w-3.5 text-green-600"
          data-testid={`leg-row-icon-processed-${claim.id}`}
        />
      ) : variant === "terminal" ? (
        <XCircle
          className="h-3.5 w-3.5 text-muted-foreground"
          data-testid={`leg-row-icon-terminal-${claim.id}`}
        />
      ) : subStatus === "blocked" ? (
        <PauseCircle
          className="h-3.5 w-3.5 text-amber-600"
          data-testid={`leg-row-icon-blocked-${claim.id}`}
        />
      ) : null;

    const cardClass = useMemo(() => {
      const base = "scroll-mt-4";
      if (highlight) return `ring-2 ring-amber-500 border-amber-400 ${base}`;
      if (variant === "processed") return `bg-muted/20 ${base}`;
      if (variant === "terminal") return `bg-muted/40 ${base}`;
      return base;
    }, [highlight, variant]);

    const concluding = concludeLegMutation.isPending;
    const savingContext = setLegContextMutation.isPending;

    return (
      <Card
        ref={rootRef}
        data-testid={`leg-conclusion-row-${claim.id}`}
        data-variant={variant}
        className={cardClass}
      >
        <CardContent className="p-0">
          {/* Header: identity + status pill + open/hide toggle. Click
              anywhere on the strip to toggle expansion. */}
          <button
            type="button"
            onClick={handleToggle}
            aria-expanded={expanded}
            data-testid={`leg-conclusion-toggle-${claim.id}`}
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
                <Badge variant="outline" className="text-[10px]">
                  {claim.outcome}
                </Badge>
              )}
              {claim.errorTypeName && (
                <span className="text-xs text-muted-foreground truncate">
                  {claim.errorTypeName}
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
              {expanded ? (
                <>
                  Hide <ChevronUp className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  Open <ChevronDown className="h-3.5 w-3.5" />
                </>
              )}
            </span>
          </button>

          {/* Inline per-leg context + conclusion controls. Shown for open
              legs only — once the leg has reached a terminal sub-status we
              keep the body collapsed by default to reduce visual noise. */}
          {isOpen && (
            <div
              className="border-t px-4 py-3 space-y-3"
              data-testid={`leg-conclusion-controls-${claim.id}`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={`leg-context-${claim.id}`}
                    className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Per-leg context
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onSaveContext}
                    disabled={
                      !!lockReason || !dirtyContext || savingContext
                    }
                    title={lockReason ?? undefined}
                    data-testid={`leg-context-save-${claim.id}`}
                  >
                    {savingContext ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    Save
                  </Button>
                </div>
                <Textarea
                  id={`leg-context-${claim.id}`}
                  value={perLegDraft}
                  onChange={(e) => setPerLegDraft(e.target.value)}
                  onBlur={onSaveContext}
                  rows={2}
                  placeholder="What does the dispute write-up need to know about this leg? (driver swap, GPS gap, MAS error message, …)"
                  disabled={!!lockReason}
                  data-testid={`leg-context-input-${claim.id}`}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground mr-1">
                  Conclude this leg as:
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!expanded) {
                      setExpanded(true);
                      onExpandedChange?.(true);
                    }
                  }}
                  disabled={!!lockReason}
                  title={lockReason ?? undefined}
                  data-testid={`leg-conclude-sop-${claim.id}`}
                >
                  <Workflow className="h-3.5 w-3.5 mr-1" />
                  Open SOP
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onConclude("non_issue")}
                  disabled={!!lockReason || concluding}
                  title={lockReason ?? undefined}
                  data-testid={`leg-conclude-non-issue-${claim.id}`}
                >
                  {concluding ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : null}
                  Non-issue
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onConclude("cannot_dispute")}
                  disabled={!!lockReason || concluding}
                  title={lockReason ?? undefined}
                  data-testid={`leg-conclude-cannot-dispute-${claim.id}`}
                >
                  {concluding ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : null}
                  Non-contestable
                </Button>
              </div>
            </div>
          )}

          {expanded && (
            <div
              className="border-t bg-background"
              data-testid={`leg-conclusion-body-${claim.id}`}
            >
              <ClaimDetailV2 claimId={claim.id} />
            </div>
          )}
        </CardContent>
      </Card>
    );
  },
);

// List wrapper — bucketed render so the operator sees open legs at the
// top of Panel A, then resolved (collapsed) legs, then closed (read-only).
interface ListProps {
  claims: ClaimResponse[];
  groupId: number;
  expandedClaimId: number | null;
  onExpandedChange: (claimId: number | null) => void;
  highlightClaimId?: number | null;
  lockReason?: string | null;
}

export function LegConclusionList({
  claims,
  groupId,
  expandedClaimId,
  onExpandedChange,
  highlightClaimId,
  lockReason,
}: ListProps) {
  if (claims.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic px-2 py-3">
        No legs included in the dispute for this group.
      </p>
    );
  }

  const sorted = [...claims].sort((a, b) => {
    const order: Record<LegVariant, number> = {
      active: 0,
      processed: 1,
      terminal: 2,
    };
    const va = classifyVariant(a);
    const vb = classifyVariant(b);
    if (order[va] !== order[vb]) return order[va] - order[vb];
    return a.id - b.id;
  });

  return (
    <div className="space-y-2" data-testid="leg-conclusion-list">
      {sorted.map((c) => (
        <LegConclusionListItem
          key={c.id}
          claim={c}
          groupId={groupId}
          lockReason={lockReason}
          expandedClaimId={expandedClaimId}
          onExpandedChange={onExpandedChange}
          highlightClaimId={highlightClaimId ?? null}
        />
      ))}
    </div>
  );
}

function LegConclusionListItem({
  claim,
  groupId,
  lockReason,
  expandedClaimId,
  onExpandedChange,
  highlightClaimId,
}: {
  claim: ClaimResponse;
  groupId: number;
  lockReason?: string | null;
  expandedClaimId: number | null;
  onExpandedChange: (claimId: number | null) => void;
  highlightClaimId: number | null;
}) {
  const ref = useRef<LegConclusionRowHandle>(null);
  const isExpanded = expandedClaimId === claim.id;
  const isHighlight = highlightClaimId === claim.id;

  useEffect(() => {
    if (!isHighlight) return;
    ref.current?.expand();
    const handle = window.requestAnimationFrame(() =>
      ref.current?.scrollIntoView(),
    );
    return () => window.cancelAnimationFrame(handle);
  }, [isHighlight]);

  return (
    <LegConclusionRow
      ref={ref}
      claim={claim}
      groupId={groupId}
      lockReason={lockReason}
      initiallyExpanded={isExpanded}
      highlight={isHighlight}
      onExpandedChange={(next) => {
        onExpandedChange(next ? claim.id : null);
      }}
    />
  );
}
