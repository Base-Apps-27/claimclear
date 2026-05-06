import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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
  Tag,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";
import { ClaimDetailV2 } from "@/components/claim-detail-v2";
import { ClassifyDialog } from "@/components/classify-dialog";
import { useToast, successToast } from "@/hooks/use-toast";
import { useClaimEvents } from "@/hooks/use-claim-events";
import { consumeLocalActionMark, markLocalAction } from "@/hooks/use-local-action-mark";
import { notifyClaimProcessedThisSession } from "@/hooks/use-session-milestones";
import { useAuth } from "@workspace/replit-auth-web";
import { buildLegResolvedIndex } from "@workspace/leg-state";

// ─────────────────────────────────────────────────────────────────────────
// LegConclusionRow — the Queue Panel A row.
//
// Design intent (restored): each leg is a thin strip. The strip carries
// identity + status, and ONE primary action whose label tracks the
// leg's first ask:
//   • No error type yet (needs_classification) → "Classify" with a tag
//     icon. Click expands the strip AND scrolls to the embedded leg
//     detail's error-type entry point so the operator lands on the
//     classifier instead of staring at a blocked SOP.
//   • Error type assigned, SOP not started → "Process" with the
//     workflow icon. Opens the worktree inline beneath the strip.
//   • Error type assigned, SOP in progress → "Continue" with the
//     workflow icon. Resumes the worktree.
// Per-leg context is NOT captured here as a free-text field — it is
// derived and persisted as the operator walks the worktree (see
// SopAdvancePlayer).
//
// Quick-conclude buttons (Non-issue / Non-contestable) are only shown
// when the leg has NO error type defined. With an error type set, the
// leg is contestable by definition and must go through the worktree.
// ─────────────────────────────────────────────────────────────────────────

const CLOSED_OUTCOMES = new Set([
  "Approved",
  "Denied",
  "Closed",
  "Closed - No Response",
]);

type LegVariant = "active" | "processed" | "terminal";

// Variant classifier needs the sibling list so `duplicate` legs can be
// resolved against their primary's terminal sub-status — same rule as
// the backend (`evaluateDisputedLegsResolved`). The rule lives in
// `lib/leg-resolved` so this surface and the submission gauntlet stay
// in sync; do not re-inline a "resolved" set here.
function classifyVariant(
  claim: ClaimResponse,
  siblings: readonly ClaimResponse[],
): LegVariant {
  if (claim.outcome && CLOSED_OUTCOMES.has(claim.outcome)) return "terminal";
  const index = buildLegResolvedIndex(siblings);
  if (index.isLegResolved(claim)) return "processed";
  return "active";
}

export interface LegConclusionRowHandle {
  expand: () => void;
  scrollIntoView: () => void;
}

interface RowProps {
  claim: ClaimResponse;
  groupId: number;
  // Full leg list for this invoice group (the same `claims` the
  // LegConclusionList renders). Threaded down so the row can resolve a
  // `duplicate` leg against its primary's sub-status — same rule as the
  // backend's `evaluateDisputedLegsResolved`.
  siblings: readonly ClaimResponse[];
  initiallyExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  highlight?: boolean;
  // Optional content (e.g. the group-level submission preview) that
  // ClaimDetailV2 will render directly below the worktree when this
  // row is expanded. Only the actively-expanded row should be given a
  // slot — see LegConclusionList for the gating.
  submissionSlot?: ReactNode;
}

export const LegConclusionRow = forwardRef<LegConclusionRowHandle, RowProps>(
  function LegConclusionRow(
    {
      claim,
      groupId,
      siblings,
      initiallyExpanded = false,
      onExpandedChange,
      highlight = false,
      submissionSlot,
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

    // Build the resolved-leg index once per render across the full
    // sibling list. The index pre-computes every leg's sub-status so a
    // `duplicate` leg's primary lookup is O(1) — same shape as the
    // backend's pre-computation in `evaluateDisputedLegsResolved`.
    const resolvedIndex = useMemo(
      () => buildLegResolvedIndex(siblings),
      [siblings],
    );
    const variant: LegVariant =
      claim.outcome && CLOSED_OUTCOMES.has(claim.outcome)
        ? "terminal"
        : resolvedIndex.isLegResolved(claim)
          ? "processed"
          : "active";
    const subStatus = resolvedIndex.subStatusOf(claim);
    const isResolved = variant === "processed";
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
      // Task #495 — the SSE author tag arrives asynchronously and on
      // some paths (admin tools, server-driven cascades) carries no
      // email at all. A local mark left by the operator's own mutation
      // success handler short-circuits the SSE-based gate so the
      // animation always plays for the operator who earned it; if no
      // local mark is set we fall back to the existing collaborator
      // suppression rule.
      if (!consumeLocalActionMark(`claim:${claim.id}`)) {
        const lastBy = lastClaimUpdateBy.current?.email ?? null;
        if (lastBy && user?.email && lastBy !== user.email) return;
      }
      setJustProcessed(true);
      // Task #491 — bump the session milestone counter from the same
      // gated trigger so processing a leg from the queue counts toward
      // the 10/25/50 celebration. Dedupe is per-claim inside
      // `notifyClaimProcessedThisSession`.
      notifyClaimProcessedThisSession(claim.id);
      const t = setTimeout(() => setJustProcessed(false), 500);
      return () => clearTimeout(t);
    }, [variant, user?.email, lastClaimUpdateBy, claim.id]);

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
            // Task #495 — leave a local mark so the variant watcher above
            // animates this row's pill on the operator's own action even
            // when the SSE replay hasn't arrived (or carries no author).
            markLocalAction(`claim:${claim.id}`);
            successToast({
              title: "__VERB__",
              description:
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
    // Primary-action label tracks the leg's first ask. Without an error
    // type the SOP can't advance ("Pick an error type before walking the
    // SOP."), so a "Process" label is misleading — surface "Classify"
    // instead and route the click to the picker (see handlePrimary).
    const needsClassify = !hasErrorType;
    const primaryLabel = needsClassify
      ? "Classify"
      : sopStarted
        ? "Continue"
        : "Process";
    const PrimaryIcon = needsClassify ? Tag : Workflow;
    const primaryTitle = needsClassify
      ? "Pick an error type for this leg"
      : sopStarted
        ? "Continue walking the SOP"
        : "Open the SOP for this leg";

    // Task #412: Classify primary action now opens the shared
    // ClassifyDialog (the same modal the Queue's Classification Inbox
    // uses) scoped to this leg, instead of expanding the row + scrolling
    // to a read-only "pick one from the queue" banner. The expand /
    // worktree path is still reachable through the row's own toggle.
    const [classifyOpen, setClassifyOpen] = useState(false);

    function handlePrimary() {
      if (needsClassify) {
        setClassifyOpen(true);
        return;
      }
      if (!expanded) {
        setExpanded(true);
        onExpandedChange?.(true);
      }
    }

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
                onClick={handlePrimary}
                title={primaryTitle}
                aria-label={primaryLabel}
                data-testid={`leg-conclude-sop-${claim.id}`}
                data-action={needsClassify ? "classify" : sopStarted ? "continue" : "process"}
              >
                <PrimaryIcon className="h-3.5 w-3.5 mr-1" />
                {primaryLabel}
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
                    disabled={concluding}
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
                    disabled={concluding}
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
              {/* Embedded mode trims the chrome (no Back button, no
                  parent-invoice / verdict cards) and accepts a
                  submission-preview slot rendered directly under the
                  worktree, so the inline expansion reads as an active
                  workspace instead of a mini claim page. */}
              <ClaimDetailV2
                claimId={claim.id}
                embedded
                submissionSlot={submissionSlot}
              />
            </div>
          )}
        </CardContent>
        <ClassifyDialog
          open={classifyOpen}
          onOpenChange={setClassifyOpen}
          groupId={groupId}
          highlightLegId={claim.id}
        />
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
  // Optional slot (typically the group-level submission preview)
  // forwarded into the actively-expanded row's ClaimDetailV2 so it
  // renders directly below the worktree. Only the expanded row gets
  // the slot; the others render without it to avoid duplicating the
  // group-scoped surface multiple times.
  submissionSlot?: ReactNode;
}

export function LegConclusionList({
  claims,
  groupId,
  expandedClaimId,
  onExpandedChange,
  highlightClaimId,
  submissionSlot,
}: ListProps) {
  if (claims.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic px-2 py-3">
        No legs in this invoice group.
      </p>
    );
  }

  const sorted = [...claims].sort((a, b) => {
    const order: Record<LegVariant, number> = {
      active: 0,
      processed: 1,
      terminal: 2,
    };
    // Pass the full `claims` list so a sibling-duplicate leg with a
    // terminal primary correctly classifies as `processed` and sinks
    // below the open legs — same rule the row itself applies.
    const va = classifyVariant(a, claims);
    const vb = classifyVariant(b, claims);
    if (order[va] !== order[vb]) return order[va] - order[vb];
    return a.id - b.id;
  });

  return (
    <div className="space-y-2" data-testid="leg-conclusion-list">
      {sorted.map((c) => (
        <LegConclusionListItem
          key={c.id}
          claim={c}
          siblings={claims}
          groupId={groupId}
          expandedClaimId={expandedClaimId}
          onExpandedChange={onExpandedChange}
          highlightClaimId={highlightClaimId ?? null}
          submissionSlot={
            // Only the actively-expanded row receives the slot — the
            // submission preview is group-scoped and we never want
            // multiple copies stacked when the operator hops between
            // legs.
            expandedClaimId === c.id ? submissionSlot : undefined
          }
        />
      ))}
    </div>
  );
}

function LegConclusionListItem({
  claim,
  siblings,
  groupId,
  expandedClaimId,
  onExpandedChange,
  highlightClaimId,
  submissionSlot,
}: {
  claim: ClaimResponse;
  siblings: readonly ClaimResponse[];
  groupId: number;
  expandedClaimId: number | null;
  onExpandedChange: (claimId: number | null) => void;
  highlightClaimId: number | null;
  submissionSlot?: ReactNode;
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
      siblings={siblings}
      groupId={groupId}
      initiallyExpanded={isExpanded}
      highlight={isHighlight}
      submissionSlot={submissionSlot}
      onExpandedChange={(next) => {
        onExpandedChange(next ? claim.id : null);
      }}
    />
  );
}
