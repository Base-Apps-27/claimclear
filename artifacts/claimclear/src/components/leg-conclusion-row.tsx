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
  useConcludeLeg,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
} from "@workspace/api-client-react";
import type { ClaimResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Loader2,
  Workflow,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";
import { ClaimDetailV2 } from "@/components/claim-detail-v2";
import { useToast } from "@/hooks/use-toast";
import { useClaimEvents } from "@/hooks/use-claim-events";
import { useAuth } from "@workspace/replit-auth-web";
import { deriveLegSubStatus, type LegSubStatus } from "@workspace/leg-state";

// ─────────────────────────────────────────────────────────────────────────
// LegConclusionRow — the Queue Panel A row.
//
// Design intent (restored): each leg is a thin strip. The strip carries
// identity + status, and ONE primary action: a button that opens the
// worktree (SOP) inline beneath the strip. Per-leg context is NOT
// captured here as a free-text field — it is derived and persisted as
// the operator walks the worktree (see SopAdvancePlayer).
//
// Quick-conclude buttons (Non-issue / Non-contestable) are only shown
// when the leg has NO error type defined. With an error type set, the
// leg is contestable by definition and must go through the worktree.
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

    const variant = classifyVariant(claim);
    const subStatus = deriveLegSubStatus(claim);
    const isResolved = PROCESSED_SUB_STATUSES.has(subStatus);
    const isOpen = !isResolved && variant !== "terminal";

    // ─────────────────────────────────────────────────────────────────────
    // "You finished a leg" microinteraction (Task #324). Mirrors the
    // claim-detail-v2 sibling (Task #315) so finishing an SOP from the
    // queue feels just as rewarding as finishing it from the detail page.
    // We track the row's variant transitioning from non-processed to
    // processed and animate the LegSubStatusPill once. SSE author gating
    // suppresses the animation when a collaborator's action triggered the
    // refetch, and `prefers-reduced-motion` is honored by the shared CSS
    // hooks (`cc-check-tick` / `cc-pill-just-transitioned`).
    // ─────────────────────────────────────────────────────────────────────
    const { user } = useAuth();
    const { lastClaimUpdateBy } = useClaimEvents(claim.id);
    const prevVariantRef = useRef<LegVariant | undefined>(undefined);
    const [justProcessed, setJustProcessed] = useState(false);
    useEffect(() => {
      const prev = prevVariantRef.current;
      prevVariantRef.current = variant;
      // Skip on initial mount (and on subsequent re-renders that don't
      // actually flip the variant) so the animation cannot replay on
      // remount or background refetches.
      if (prev === undefined) return;
      if (prev === variant) return;
      if (variant !== "processed") return;
      // If the most recent SSE event for this claim came from a different
      // operator, the transition isn't "ours" — stay quiet.
      const lastBy = lastClaimUpdateBy.current?.email ?? null;
      if (lastBy && user?.email && lastBy !== user.email) return;
      setJustProcessed(true);
      const t = setTimeout(() => setJustProcessed(false), 500);
      return () => clearTimeout(t);
    }, [variant, user?.email, lastClaimUpdateBy]);

    const concludeLegMutation = useConcludeLeg();

    function invalidateGroup() {
      qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
      qc.invalidateQueries({
        queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
      });
      qc.invalidateQueries({ queryKey: ["invoice-groups"] });
    }

    function onConclude(reason: "non_issue" | "cannot_dispute") {
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
    const hasErrorType = !!claim.errorTypeId;
    const sopStarted = !!claim.sopNodeId;
    const sopButtonLabel = sopStarted ? "Continue" : "Process";

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
              <LegSubStatusPill leg={claim} justTransitioned={justProcessed} />
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

          {/* Strip action area. Shown only for active (open) legs. The
              primary action is the worktree button; quick-conclude
              fallbacks appear ONLY when no error type has been
              classified for this leg. */}
          {isOpen && (
            <div
              className="border-t px-4 py-2 flex flex-wrap items-center gap-2"
              data-testid={`leg-conclusion-controls-${claim.id}`}
            >
              <Button
                type="button"
                size="sm"
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
                {sopButtonLabel}
              </Button>

              {!hasErrorType && (
                <>
                  <span className="text-xs text-muted-foreground mx-1">
                    or quick-conclude:
                  </span>
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
                </>
              )}
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
