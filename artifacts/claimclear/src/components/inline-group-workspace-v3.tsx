import { useEffect, useMemo, useState } from "react";
import {
  useGetInvoiceGroup,
  useGetClaim,
  useListErrorTypes,
  useStampPreviewGenerated,
  useSaveInvoiceGroupDraft,
  useRegenerateInvoiceGroupDraft,
  useMarkInvoiceGroupDraftReviewed,
  useCreatePortalSubmission,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getGetClaimQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ClaimResponse,
  ErrorTypeResponse,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { buildLegResolvedIndex, outcomeRole } from "@workspace/leg-state";
import {
  CheckCircle2,
  Circle,
  HelpCircle,
  XCircle,
  Loader2,
  FileText,
  ShieldCheck,
  Send,
  Archive,
  PanelRight,
  Sparkles,
  RefreshCw,
  Save,
  Edit3,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RefNumber } from "@/components/ref-number";
import { ClaimDetailV2 } from "@/components/claim-detail-v2";
import { InvoiceGroupActionSlot } from "@/components/invoice-group-action-slot";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import type { DecisionTree } from "@/components/decision-tree/types";
import { useUrlParams } from "@/lib/use-url-params";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { HideForClerk } from "@/lib/role";
import { useToast, successToast } from "@/hooks/use-toast";
import {
  deriveInvoiceDisputeOutlook,
  type InvoiceDisputeOutlook,
} from "@/lib/whats-next-derivation";

// ─────────────────────────────────────────────────────────────────────
// Queue V3 — Walk-first wizard right-pane (Task #517 + #521 rebuild).
//
// Mounted at /queue-v3 as a sibling to the classic InlineGroupWorkspace.
// Same data, same mutations — different chrome AND a different hero per
// phase. The wizard's whole point is that the right pane is *focused*:
// during walk you see one SOP question, during preview you see the
// assembled MAS package, during review you edit it, after submit you
// see the receipt. Activity / Notes / Thread / MAS live in a slide-over
// drawer so the hero stays clean.
//
// Hero swap (has_disputable):
//   Phase 0 walking      → WalkSopHero (one SOP question, active leg)
//   Phase 1 walk done    → WalkCompleteHero (verdict cards + Generate)
//   Phase 2 preview      → PreviewDocHero (read-only assembled doc)
//   Phase 3 review       → ReviewEditHero (editable subject/body + Submit)
//   Phase 4 submitted    → SubmittedReceiptHero (receipt + per-leg track)
//
// Outlook collapse:
//   has_disputable → full wizard, hero phase-swaps as above.
//   reattest_only  → wizard chrome + walk hero until all walked, then
//                    the existing Re-attest CTA replaces the hero.
//   nothing_to_do  → chrome collapses to a single close-out card.
//
// ClaimDetailV2 is mounted ONCE, in the drawer, where Activity / Notes
// / Thread / MAS legitimately live. The hero never embeds it.
// ─────────────────────────────────────────────────────────────────────

function WorkspaceLoadingCard() {
  return (
    <Card>
      <CardContent className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading workspace…
      </CardContent>
    </Card>
  );
}

interface PhaseConfig {
  steps: readonly string[];
  /** Index into `steps` of the currently-active phase. */
  activeIndex: number;
  /** Helper text under the gauntlet row. */
  helper: string;
  /** Right-aligned readiness pill. */
  pill: { label: string; tone: "amber" | "green" | "blue" };
}

interface PhaseInputs {
  outlook: InvoiceDisputeOutlook;
  legCount: number;
  resolvedCount: number;
  previewGenerated: boolean;
  draftReviewed: boolean;
  submitted: boolean;
}

export function buildPhaseConfigV3(inputs: PhaseInputs): PhaseConfig {
  const {
    outlook,
    legCount,
    resolvedCount,
    previewGenerated,
    draftReviewed,
    submitted,
  } = inputs;
  const allWalked = legCount > 0 && resolvedCount === legCount;

  if (outlook === "has_disputable") {
    const steps = ["Walk legs", "Preview", "Review", "Submit"] as const;
    let activeIndex = 0;
    if (submitted) activeIndex = 3;
    else if (draftReviewed) activeIndex = 3;
    else if (previewGenerated) activeIndex = 2;
    else if (allWalked) activeIndex = 1;

    let helper: string;
    if (submitted) helper = "Submitted to the portal.";
    else if (draftReviewed) helper = "Draft reviewed — submit to the portal.";
    else if (previewGenerated) helper = "Preview generated — review the draft, then submit.";
    else if (allWalked) helper = "All legs walked — generate the preview, then submit to the portal.";
    else helper = `Walk all ${legCount} leg${legCount === 1 ? "" : "s"} to unlock Generate preview, then Submit.`;

    let pillLabel: string;
    let pillTone: "amber" | "green" | "blue";
    if (submitted) {
      pillLabel = "Submitted";
      pillTone = "green";
    } else if (draftReviewed) {
      pillLabel = "Ready to submit";
      pillTone = "green";
    } else if (previewGenerated) {
      pillLabel = "Awaiting review";
      pillTone = "blue";
    } else if (allWalked) {
      pillLabel = "Ready to preview";
      pillTone = "blue";
    } else {
      pillLabel = `${resolvedCount} of ${legCount} ready`;
      pillTone = "amber";
    }

    return {
      steps,
      activeIndex,
      helper,
      pill: { label: pillLabel, tone: pillTone },
    };
  }

  if (outlook === "reattest_only") {
    return {
      steps: ["Walk legs", "Re-attest"],
      activeIndex: allWalked ? 1 : 0,
      helper: allWalked
        ? "All legs walked — re-attest survivors in the portal."
        : `Walk all ${legCount} leg${legCount === 1 ? "" : "s"} to unlock Re-attest.`,
      pill: {
        label: allWalked ? "Ready to re-attest" : `${resolvedCount} of ${legCount} ready`,
        tone: allWalked ? "blue" : "amber",
      },
    };
  }

  // nothing_to_do — collapsed: chrome is suppressed by the outer
  // component; this config is informational only.
  return {
    steps: ["Close"],
    activeIndex: 0,
    helper: "Nothing left to dispute — close the invoice out as Withdrawn.",
    pill: { label: "Ready to close", tone: "amber" },
  };
}

function legStateIcon(
  leg: ClaimResponse,
  resolvedIndex: ReturnType<typeof buildLegResolvedIndex>,
) {
  if (leg.includedInDispute === false) {
    return <XCircle className="w-3 h-3" aria-label="excluded" />;
  }
  if (resolvedIndex.isLegResolved(leg)) {
    return <CheckCircle2 className="w-3 h-3" aria-label="resolved" />;
  }
  if (!leg.errorTypeName) {
    return <HelpCircle className="w-3 h-3" aria-label="needs classification" />;
  }
  return <Circle className="w-3 h-3" aria-label="pending" />;
}

function outlookIcon(outlook: InvoiceDisputeOutlook) {
  if (outlook === "has_disputable") return <Send className="w-3.5 h-3.5" />;
  if (outlook === "reattest_only") return <ShieldCheck className="w-3.5 h-3.5" />;
  return <Archive className="w-3.5 h-3.5" />;
}

// Map per-leg derivation to the verdict-summary card on the
// walk-complete hero. Mirrors the same rules `whats-next-derivation`
// already enforces, so the labels never disagree with the outlook.
function legVerdictLabel(leg: ClaimResponse): { label: string; tone: "green" | "amber" | "blue" } {
  if (leg.includedInDispute === false) {
    return { label: "Excluded from dispute", tone: "amber" };
  }
  const role = outcomeRole(leg);
  if (role === "non_issue") return { label: "Non-issue — re-attest in portal", tone: "green" };
  if (role === "cannot_dispute") return { label: "Non-contestable — will be cancelled", tone: "amber" };
  if (role === "duplicate") return { label: "Sibling duplicate — follows primary", tone: "blue" };
  if (leg.sopOutcome === "portal_dispute" || leg.sopOutcome === "dispute") {
    return { label: "Ready for dispute submission", tone: "green" };
  }
  if (leg.sopOutcome === "hold") return { label: "On hold", tone: "amber" };
  return { label: "Walk complete", tone: "blue" };
}

interface Props {
  groupId: number;
}

type DetailGroup = InvoiceGroupDetailResponse & {
  previewGeneratedAt?: string | null;
  draftReviewedAt?: string | null;
  draftSubject?: string | null;
  draftDescriptionHtml?: string | null;
  aiBaselineSubject?: string | null;
  aiBaselineDescriptionHtml?: string | null;
  understandingReadback?: string | null;
  useDirectEmail?: boolean | null;
  submissions?: Array<{ id: number; createdAt?: string | null; portalReferenceId?: string | null } & Record<string, unknown>>;
};

export function InlineGroupWorkspaceV3({ groupId }: Props) {
  const { get, set } = useUrlParams();
  const legParam = Number.parseInt(get("leg"), 10);
  const urlLegId: number | null =
    Number.isFinite(legParam) && legParam > 0 ? legParam : null;
  const setActiveLegId = (id: number | null) => {
    set({ leg: id == null ? null : String(id) }, false);
  };

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Local "I'm reviewing now" toggle — flips the Preview hero into the
  // editable Review hero before the operator hits Mark reviewed. Reset
  // automatically when the upstream draftReviewedAt stamps so we don't
  // get stuck in review mode after a Mark-reviewed succeeds.
  const [reviewMode, setReviewMode] = useState(false);

  const { data: group, isLoading } = useGetInvoiceGroup(groupId);

  const detail: DetailGroup | null = useMemo(
    () => (group ? (group as DetailGroup) : null),
    [group],
  );
  const rides: ClaimResponse[] = detail?.rides ?? [];
  const resolvedIndex = useMemo(
    () => buildLegResolvedIndex(rides),
    [rides],
  );

  if (isLoading || !detail) {
    return <WorkspaceLoadingCard />;
  }

  const explicitLeg = urlLegId
    ? rides.find((r) => r.id === urlLegId) ?? null
    : null;
  const firstUnresolved =
    rides.find(
      (r) =>
        r.includedInDispute !== false && !resolvedIndex.isLegResolved(r),
    ) ?? null;
  const activeLeg: ClaimResponse | null =
    explicitLeg ?? firstUnresolved ?? rides[0] ?? null;

  const { outlook, survivors, dropped } = deriveInvoiceDisputeOutlook(
    detail,
    rides,
  );
  const resolvedCount = rides.filter(
    (r) => r.includedInDispute === false || resolvedIndex.isLegResolved(r),
  ).length;

  const previewGenerated = !!detail.previewGeneratedAt;
  const draftReviewed = !!detail.draftReviewedAt;
  const submitted =
    !!detail.outcome &&
    detail.outcome !== "Withdrawn" &&
    detail.outcome !== "Non-Issue" &&
    detail.status !== "New" &&
    detail.status !== "Needs Evidence";
  const allWalked = rides.length > 0 && resolvedCount === rides.length;

  const phase = buildPhaseConfigV3({
    outlook,
    legCount: rides.length,
    resolvedCount,
    previewGenerated,
    draftReviewed,
    submitted,
  });

  const collapseToTerminator = outlook === "nothing_to_do";

  const summaryHeader = (
    <div className="cc-group-header" data-testid="v3-group-header">
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <RefNumber value={detail.invoiceNumber} variant="inline" className="font-semibold" />
      <span className="cc-meta">
        {detail.rideCount} ride{detail.rideCount === 1 ? "" : "s"}
        <HideForClerk>
          {" · "}
          {formatCurrency(detail.totalAmount)}
        </HideForClerk>
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 px-2 text-xs"
        onClick={() => setDrawerOpen(true)}
        data-testid="v3-open-details-drawer"
        aria-label="Open activity, notes, communication, and MAS panels"
      >
        <PanelRight className="w-3.5 h-3.5 mr-1" />
        Details
      </Button>
      {!collapseToTerminator && rides.length > 0 && (
        <div
          className="cc-segmented"
          role="tablist"
          aria-label="Legs"
          data-testid="v3-leg-switcher"
        >
          {rides.map((leg, i) => {
            const isActive = activeLeg?.id === leg.id;
            return (
              <button
                key={leg.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={isActive ? "is-active" : ""}
                onClick={() => setActiveLegId(leg.id)}
                data-testid={`v3-leg-tab-${leg.id}`}
              >
                Leg {i + 1} {legStateIcon(leg, resolvedIndex)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const outlookSummary =
    outlook === "reattest_only"
      ? `${survivors.length} leg${survivors.length === 1 ? "" : "s"} need re-attestation${
          dropped.length > 0
            ? `; ${dropped.length} non-contestable will be cancelled`
            : ""
        }.`
      : outlook === "nothing_to_do"
      ? dropped.length > 0
        ? `${dropped.length} non-contestable / sibling-duplicate leg${dropped.length === 1 ? "" : "s"} — nothing to dispute.`
        : "No legs remain to dispute or re-attest."
      : null;

  // The drawer is the ONLY place ClaimDetailV2 mounts in the wizard —
  // Activity / Notes / Thread / MAS / per-leg context legitimately
  // live there. The hero never embeds it.
  const detailsDrawer = (
    <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto"
        data-testid="v3-details-drawer"
      >
        <SheetHeader>
          <SheetTitle>
            {activeLeg ? (
              <>
                Leg details · <RefNumber value={activeLeg.confNumber} variant="inline" />
              </>
            ) : (
              "Leg details"
            )}
          </SheetTitle>
        </SheetHeader>
        <div className="cc-scope mt-4">
          {activeLeg ? (
            <ClaimDetailV2 claimId={activeLeg.id} embedded />
          ) : (
            <p className="text-sm text-muted-foreground">
              No active leg to show details for.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );

  // ─── Pick the hero for this phase ──────────────────────────────────
  // has_disputable swaps through five heroes by group state; the
  // reattest_only path uses the walk hero during walking and hands off
  // to the existing Re-attest CTA when allWalked.
  let hero: React.ReactNode = null;
  let footerPrimary: React.ReactNode = null;

  if (!collapseToTerminator) {
    if (outlook === "has_disputable") {
      if (submitted) {
        hero = (
          <SubmittedReceiptHero detail={detail} rides={rides} />
        );
        footerPrimary = null;
      } else if (previewGenerated && (draftReviewed || reviewMode)) {
        hero = (
          <ReviewEditHero
            detail={detail}
            rides={rides}
            groupId={groupId}
            onJumpToLeg={(id) => setActiveLegId(id)}
            onAfterReviewed={() => setReviewMode(false)}
          />
        );
      } else if (previewGenerated) {
        hero = (
          <PreviewDocHero
            detail={detail}
            rides={rides}
            groupId={groupId}
            onJumpToLeg={(id) => setActiveLegId(id)}
            onEnterReview={() => setReviewMode(true)}
          />
        );
      } else if (allWalked) {
        hero = (
          <WalkCompleteHero
            rides={rides}
            groupId={groupId}
            onJumpToLeg={(id) => setActiveLegId(id)}
          />
        );
      } else if (activeLeg) {
        hero = <WalkSopHero leg={activeLeg} />;
      } else {
        hero = (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              This invoice has no legs to walk.
            </CardContent>
          </Card>
        );
      }
    } else if (outlook === "reattest_only") {
      if (allWalked) {
        // Hand off to the existing Re-attest CTA — same component the
        // classic queue mounts. Don't render a custom hero on top.
        hero = null;
      } else if (activeLeg) {
        hero = <WalkSopHero leg={activeLeg} />;
      }
    }
  }

  return (
    <div
      className="cc-scope space-y-3"
      data-testid="inline-group-workspace-v3"
      data-outlook={outlook}
      data-collapsed={collapseToTerminator ? "true" : "false"}
    >
      {summaryHeader}

      {outlookSummary && (
        <div
          className="cc-meta text-xs flex items-center gap-2"
          data-testid="v3-outlook-summary"
        >
          {outlookIcon(outlook)}
          <span>{outlookSummary}</span>
        </div>
      )}

      {hero}

      {/* Pinned footer — phase ladder reflecting real group state. */}
      {!collapseToTerminator && (
        <div
          className="cc-footer-card cc-footer-pinned"
          data-testid="v3-pinned-footer"
        >
          <span
            className={`cc-pill cc-pill-${phase.pill.tone}`}
            data-testid="v3-phase-pill"
          >
            {phase.pill.label}
          </span>
          <span className="cc-meta text-xs flex-1 min-w-0">
            {phase.helper}
          </span>
          <ul
            className="cc-gauntlet-row"
            data-testid="v3-gauntlet-steps"
            aria-label="Gauntlet phase"
          >
            {phase.steps.map((label, i) => (
              <li
                key={label}
                className={`cc-gauntlet-step ${
                  i < phase.activeIndex
                    ? "cc-gauntlet-done"
                    : i === phase.activeIndex
                    ? "cc-gauntlet-active"
                    : ""
                }`}
                data-testid={`v3-gauntlet-step-${i}`}
              >
                {i < phase.activeIndex && (
                  <CheckCircle2 className="w-3 h-3" />
                )}
                {label}
              </li>
            ))}
          </ul>
          {footerPrimary}
        </div>
      )}

      {/* Phase-4 terminal action — outlook-routed.
          For has_disputable, the gauntlet's mutations are bound
          inline by each phase hero above, so we deliberately do NOT
          mount InvoiceGroupActionSlot in that branch (it would render
          the entire classic gauntlet card stacked underneath the
          wizard, which is what shipped in Task #517 and was wrong).
          For reattest_only and nothing_to_do, the action slot is the
          terminator and renders here. */}
      {outlook !== "has_disputable" && (
        <>
          {/* V4 Q6/Q7 graduation — cards-row preamble for off-ramps.
              Anchors the operator on which legs they're acting on
              before the existing reattest / close CTA renders below.
              Wiring stays in InvoiceGroupActionSlot so the modal flows
              don't fork. */}
          {((outlook === "reattest_only" && allWalked) ||
            outlook === "nothing_to_do") && (
            <OffRampInputsHero
              rides={rides}
              outlook={outlook}
              onJumpToLeg={(id) => setActiveLegId(id)}
            />
          )}
          <InvoiceGroupActionSlot
            group={detail}
            groupId={groupId}
            bare
            onJumpToLeg={(claimId) => setActiveLegId(claimId)}
          />
        </>
      )}

      {detailsDrawer}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 0 hero — Walk SOP
// One leg, one question. Pulls the active claim + its error-type tree
// and mounts SopAdvancePlayer in live mode. No transcript, no per-leg
// context editor, no evidence panel — those all live in the drawer
// (via the drawer's ClaimDetailV2 embed).
// ─────────────────────────────────────────────────────────────────────
function WalkSopHero({ leg }: { leg: ClaimResponse }) {
  const qc = useQueryClient();
  const { data: claim } = useGetClaim(leg.id, {
    query: { queryKey: getGetClaimQueryKey(leg.id), enabled: !!leg.id },
  });
  const { data: errorTypes } = useListErrorTypes();
  const errorType: ErrorTypeResponse | undefined = useMemo(() => {
    if (!claim?.errorTypeId || !errorTypes) return undefined;
    return errorTypes.find((t) => String(t.id) === String(claim.errorTypeId));
  }, [claim?.errorTypeId, errorTypes]);
  const tree: DecisionTree | null = useMemo(() => {
    const raw = errorType?.decisionTree as DecisionTree | undefined | null;
    if (!raw || !raw.nodes || !raw.rootId) return null;
    return raw;
  }, [errorType]);

  const invalidateLeg = () => {
    qc.invalidateQueries({ queryKey: getGetClaimQueryKey(leg.id) });
    if (claim?.invoiceGroupId != null) {
      qc.invalidateQueries({
        queryKey: getGetInvoiceGroupQueryKey(claim.invoiceGroupId),
      });
      qc.invalidateQueries({
        queryKey: getGetInvoiceGroupValidTransitionsQueryKey(
          claim.invoiceGroupId,
        ),
      });
    }
  };

  const legMeta = (
    <div className="cc-meta text-[11px] mb-2 flex items-center gap-2">
      <RefNumber value={claim?.confNumber ?? leg.confNumber} variant="inline" />
      {claim?.date && <span>· {claim.date}</span>}
      {claim?.claimAmount && <span>· {claim.claimAmount}</span>}
      {claim?.errorTypeName && (
        <Badge variant="outline" className="text-[10px] font-normal ml-1">
          {claim.errorTypeName}
        </Badge>
      )}
    </div>
  );

  return (
    <div data-testid="v3-hero-walk" className="space-y-2">
      <Card>
        <CardContent className="pt-4 pb-3">
          {legMeta}
          {!claim ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading leg…
            </div>
          ) : !claim.errorTypeId ? (
            <div className="text-xs flex items-start gap-2 p-3 rounded bg-amber-50 border border-amber-200 text-amber-900">
              <HelpCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                This leg has no error type yet. Open Details to classify it
                — the SOP walk unlocks once an error type is assigned.
              </span>
            </div>
          ) : !tree ? (
            <div className="text-xs flex items-start gap-2 p-3 rounded bg-amber-50 border border-amber-200 text-amber-900">
              <HelpCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                The assigned error type ({claim.errorTypeName ?? "—"}) has
                no decision tree configured. Configure one to walk the SOP.
              </span>
            </div>
          ) : (
            <SopAdvancePlayer
              leg={{
                id: claim.id,
                errorTypeId: claim.errorTypeId,
                sopNodeId: claim.sopNodeId,
                sopOutcome: claim.sopOutcome,
                dropReason: claim.dropReason,
                invoiceGroupId: claim.invoiceGroupId,
                duplicateOfClaimId: claim.duplicateOfClaimId,
                perLegContext: claim.perLegContext,
              }}
              tree={tree}
              onAdvanced={invalidateLeg}
              errorType={
                errorType
                  ? { useDirectEmail: errorType.useDirectEmail ?? null }
                  : null
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 1 hero — AI Inputs Summary (post-walk, pre-generate)
// All legs have a verdict. Renders compact stubby cards (one per leg)
// in a horizontal row that mirrors what the AI will see when it drafts
// the dispute note: which legs feed the prompt, which are filtered.
// The non-contestable / excluded / held buckets stay visible (so
// nothing looks "missing") but are visually marked "Not in prompt" so
// the operator can confirm at-a-glance the AI won't write them up.
// Followed by a paragraph-slot placeholder explaining the about-to-be-
// generated single dispute note, then the Generate-preview CTA.
//
// Mirrors the canonical V4 Q1 mockup; uses cc-* tokens from the
// claimclear index.css (already loaded under cc-scope).
// ─────────────────────────────────────────────────────────────────────

/** Whether this leg will be included in the AI prompt + attachments
 * pass. Mirrors the server-side filter in
 * `routes/portal-submissions.ts#filterRidesForSubmission` — keep these
 * two in sync. */
function legAiInclusion(
  leg: ClaimResponse,
): "included" | "non_contestable" | "duplicate" | "held" | "excluded" {
  if (leg.includedInDispute === false) return "excluded";
  const role = outcomeRole(leg);
  if (role === "cannot_dispute" || role === "non_issue") return "non_contestable";
  if (role === "duplicate") return "duplicate";
  if (leg.sopOutcome === "hold") return "held";
  return "included";
}

function inclusionPill(kind: ReturnType<typeof legAiInclusion>): { label: string; tone: "green" | "amber" | "blue" | "muted" } {
  switch (kind) {
    case "included": return { label: "Included in draft", tone: "green" };
    case "non_contestable": return { label: "Not in prompt · cannot dispute", tone: "amber" };
    case "excluded": return { label: "Not in prompt · excluded", tone: "amber" };
    case "held": return { label: "Not in prompt · on hold", tone: "amber" };
    case "duplicate": return { label: "Follows primary", tone: "blue" };
  }
}

/**
 * Shared compact-card row used by all three has_disputable heroes
 * (WalkCompleteHero, PreviewDocHero, ReviewEditHero). The row is the
 * visual anchor that tells the operator at-a-glance which legs feed
 * the AI prompt. `variant`:
 *   - "full"  → cards show SOP verdict + inclusion pill (Q1 layout)
 *   - "slim"  → cards drop the SOP verdict line; just leg meta + pill
 *               (Q3/Q4/Q5 layout where the paragraph is the focus)
 */
function InputsCardsRow({
  rides,
  onJumpToLeg,
  variant,
}: {
  rides: ClaimResponse[];
  onJumpToLeg: (id: number) => void;
  variant: "full" | "slim";
}) {
  return (
    <div className="flex flex-wrap gap-2.5" data-testid="v3-inputs-cards">
      {rides.map((leg, i) => {
        const inclusion = legAiInclusion(leg);
        const verdict = legVerdictLabel(leg);
        const pill = inclusionPill(inclusion);
        const isFiltered = inclusion !== "included";
        const accent = inclusion === "included" ? "var(--cc-green-fg)" : "var(--cc-amber-fg)";
        return (
          <div
            key={leg.id}
            data-testid={`v3-inputs-card-${leg.id}`}
            className="cc-card"
            style={{
              flex: "1 1 280px",
              minWidth: 280,
              maxWidth: 340,
              borderTop: `3px solid ${accent}`,
              padding: variant === "slim" ? "0.5rem 0.75rem" : "0.625rem 0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: variant === "slim" ? "0.3rem" : "0.4rem",
              opacity: isFiltered ? 0.78 : 1,
            }}
          >
            <div className="flex items-center gap-1.5">
              <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">
                Leg {i + 1}
              </span>
              <RefNumber value={leg.confNumber} variant="inline" className="font-medium text-[12px]" />
              {!isFiltered && (
                <CheckCircle2 className="w-3 h-3 ml-auto" style={{ color: "var(--cc-green-fg)" }} />
              )}
              {isFiltered && inclusion !== "duplicate" && (
                <XCircle className="w-3 h-3 ml-auto" style={{ color: "var(--cc-amber-fg)" }} />
              )}
            </div>
            {(leg.date || leg.claimAmount) && (
              <div className="cc-meta text-[11px]">
                {leg.date}{leg.date && leg.claimAmount ? " · " : ""}{leg.claimAmount}
              </div>
            )}
            {leg.errorTypeName && (
              <span className="cc-tag" style={{ alignSelf: "flex-start" }}>{leg.errorTypeName}</span>
            )}
            {variant === "full" && (
              <>
                <div style={{ height: 1, background: "var(--cc-border)", margin: "0.125rem 0" }} />
                <div className="flex items-center gap-1.5">
                  <span className="cc-meta text-[10px] uppercase tracking-wider">SOP</span>
                  <span className={`cc-pill cc-pill-${verdict.tone}`}>{verdict.label}</span>
                </div>
              </>
            )}
            <div className="flex items-center gap-2 pt-0.5">
              <span className={`cc-pill cc-pill-${pill.tone}`}>{pill.label}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs ml-auto"
                onClick={() => onJumpToLeg(leg.id)}
                data-testid={`v3-inputs-jump-${leg.id}`}
              >
                Open
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Helper: bucket counts for the inputs strip + paragraph helper text.
 * Counts every leg, even filtered ones, so the strip's "N walked"
 * total never disagrees with what the cards show.
 */
function summarizeInclusion(rides: ClaimResponse[]): { included: number; filtered: number; total: number } {
  let included = 0;
  let filtered = 0;
  for (const leg of rides) {
    if (legAiInclusion(leg) === "included") included++;
    else filtered++;
  }
  return { included, filtered, total: rides.length };
}

function WalkCompleteHero({
  rides,
  groupId,
  onJumpToLeg,
}: {
  rides: ClaimResponse[];
  groupId: number;
  onJumpToLeg: (id: number) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const stampPreview = useStampPreviewGenerated();

  const buckets = useMemo(() => summarizeInclusion(rides), [rides]);

  function onGenerate() {
    stampPreview.mutate(
      { id: groupId },
      {
        onSuccess: () => {
          successToast({ title: "__VERB__", description: "Submission preview generated" });
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId) });
        },
        onError: (e: unknown) =>
          toast({
            title: "Preview generation failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <div data-testid="v3-hero-walk-complete" className="space-y-3">
      {/* Strip — one-line summary the operator sees first */}
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-green-700" />
        <span className="font-semibold text-sm">AI inputs · what the prompt will see</span>
        <span className="cc-pill cc-pill-muted ml-auto">
          {buckets.total} walked · {buckets.included} disputable · {buckets.filtered} filtered
        </span>
      </div>

      <InputsCardsRow rides={rides} onJumpToLeg={onJumpToLeg} variant="full" />

      {/* Paragraph slot — empty pre-generate */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <FileText className="w-4 h-4" style={{ color: "var(--cc-meta-fg, currentColor)" }} />
          <span className="font-semibold text-sm">Dispute note · one paragraph for this invoice</span>
          <span className="cc-meta text-xs ml-auto">Not generated yet</span>
        </div>
        <div
          data-testid="v3-inputs-paragraph-slot"
          style={{
            minHeight: 140,
            border: "1px dashed var(--cc-border)",
            borderRadius: "var(--cc-radius)",
            background: "var(--cc-bg)",
            padding: "1.25rem",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            textAlign: "center",
          }}
        >
          <Sparkles className="w-5 h-5" style={{ color: "var(--cc-blue-fg)" }} />
          <div className="font-semibold text-sm">
            One dispute note will be drafted from the {buckets.included} included leg{buckets.included === 1 ? "" : "s"} above
          </div>
          {buckets.filtered > 0 && (
            <div className="cc-meta text-xs" style={{ maxWidth: 520 }}>
              {buckets.filtered} leg{buckets.filtered === 1 ? "" : "s"} filtered out before the AI sees the
              prompt — non-contestable verdicts, holds, and excluded legs never enter the write-up.
            </div>
          )}
        </div>
      </div>

      {/* Generate CTA — right-aligned, hero-internal (parent gauntlet
          footer doesn't carry a primary at this phase). */}
      <div className="flex justify-end pt-1">
        <Button
          onClick={onGenerate}
          disabled={stampPreview.isPending || buckets.included === 0}
          data-testid="v3-generate-preview"
        >
          {stampPreview.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1" />
          )}
          Generate dispute note
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2 hero — Preview (read-only · POST-generate)
// Mirrors V4 Q3: cards row at top (slim variant) anchors which legs
// fed the prompt, then the AI-drafted single paragraph below. Subject
// stays visible (the portal needs it) but de-emphasized — the body is
// the focus. Two affordances: "Skip review" (mark reviewed → unlocks
// Submit) and "Review & edit" (flips reviewMode → ReviewEditHero).
// ─────────────────────────────────────────────────────────────────────
function PreviewDocHero({
  detail,
  rides,
  groupId,
  onJumpToLeg,
  onEnterReview,
}: {
  detail: DetailGroup;
  rides: ClaimResponse[];
  groupId: number;
  onJumpToLeg: (id: number) => void;
  onEnterReview: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const markReviewed = useMarkInvoiceGroupDraftReviewed();
  const subject = detail.draftSubject ?? detail.aiBaselineSubject ?? "";
  const body =
    detail.draftDescriptionHtml ?? detail.aiBaselineDescriptionHtml ?? "";
  const buckets = useMemo(() => summarizeInclusion(rides), [rides]);

  function onSkipReview() {
    markReviewed.mutate(
      { id: groupId },
      {
        onSuccess: () => {
          successToast({ title: "__VERB__", description: "Draft marked as reviewed" });
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId) });
        },
        onError: (e: unknown) =>
          toast({
            title: "Mark reviewed failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <div data-testid="v3-hero-preview" className="space-y-3">
      {/* Strip — what fed the prompt */}
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-blue-700" />
        <span className="font-semibold text-sm">AI draft · review before submit</span>
        <span className="cc-pill cc-pill-muted ml-auto">
          {buckets.included} included · {buckets.filtered} filtered
        </span>
      </div>

      <InputsCardsRow rides={rides} onJumpToLeg={onJumpToLeg} variant="slim" />

      {/* Paragraph — AI-drafted, read-only here */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <FileText className="w-4 h-4" style={{ color: "var(--cc-meta-fg, currentColor)" }} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">
              {subject || "(no subject yet — regenerate to populate)"}
            </div>
            <div className="cc-meta text-[10px] uppercase tracking-wider">
              Dispute note · one paragraph for this invoice
            </div>
          </div>
          {detail.previewGeneratedAt && (
            <Badge variant="secondary" className="text-[10px]">
              Generated {formatDateTime(detail.previewGeneratedAt)}
            </Badge>
          )}
        </div>
        <div
          className="text-sm whitespace-pre-wrap leading-relaxed max-h-[420px] overflow-auto"
          style={{
            border: "1px solid var(--cc-border)",
            borderRadius: "var(--cc-radius)",
            background: "var(--cc-card)",
            padding: "1rem 1.125rem",
          }}
          data-testid="v3-preview-body"
        >
          {body || (
            <span className="text-muted-foreground italic">
              No draft body yet. Regenerate from preview to populate it.
            </span>
          )}
        </div>
        {buckets.filtered > 0 && (
          <p className="cc-meta text-xs mt-2">
            {buckets.filtered} leg{buckets.filtered === 1 ? "" : "s"} filtered out before draft —
            non-contestable verdicts, holds, and excluded legs were never sent to the AI.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          variant="outline"
          onClick={onSkipReview}
          disabled={markReviewed.isPending || !body.trim()}
          data-testid="v3-skip-review"
        >
          {markReviewed.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
          )}
          Skip review
        </Button>
        <Button onClick={onEnterReview} data-testid="v3-enter-review">
          <Edit3 className="h-3.5 w-3.5 mr-1" />
          Review &amp; edit
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 3 hero — Review & edit, then Queue
// Two internal modes (V4 Q4 + Q5), toggled by `submitMode` state:
//   - Q4 (edit): cards row · editable subject + body · Save /
//                Regenerate / Mark reviewed → on success flips to Q5.
//   - Q5 (submit): cards row · locked paragraph · "Queue for Portal"
//                  CTA wired to useCreatePortalSubmission.
// "Queue for Portal" wording is scoped to this V3 wizard step only —
// the classic gauntlet and per-claim email path keep their existing
// labels.
// ─────────────────────────────────────────────────────────────────────
function ReviewEditHero({
  detail,
  rides,
  groupId,
  onJumpToLeg,
  onAfterReviewed,
}: {
  detail: DetailGroup;
  rides: ClaimResponse[];
  groupId: number;
  onJumpToLeg: (id: number) => void;
  onAfterReviewed: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const saveDraft = useSaveInvoiceGroupDraft();
  const regenDraft = useRegenerateInvoiceGroupDraft();
  const markReviewed = useMarkInvoiceGroupDraftReviewed();
  const submitMutation = useCreatePortalSubmission();

  const [subject, setSubject] = useState<string>(
    detail.draftSubject ?? detail.aiBaselineSubject ?? "",
  );
  const [body, setBody] = useState<string>(
    detail.draftDescriptionHtml ?? detail.aiBaselineDescriptionHtml ?? "",
  );
  useEffect(() => {
    setSubject(detail.draftSubject ?? detail.aiBaselineSubject ?? "");
    setBody(detail.draftDescriptionHtml ?? detail.aiBaselineDescriptionHtml ?? "");
  }, [
    detail.draftSubject,
    detail.draftDescriptionHtml,
    detail.aiBaselineSubject,
    detail.aiBaselineDescriptionHtml,
  ]);

  const dirty =
    subject !== (detail.draftSubject ?? detail.aiBaselineSubject ?? "") ||
    body !== (detail.draftDescriptionHtml ?? detail.aiBaselineDescriptionHtml ?? "");
  const bodyEmpty = body.trim().length === 0;
  const draftReviewed = !!detail.draftReviewedAt;
  const isDirectEmail = detail.useDirectEmail === true;
  const buckets = useMemo(() => summarizeInclusion(rides), [rides]);

  // Q4 → Q5 toggle. Default to submit-mode IFF the draft is already
  // reviewed (operator came back to a queued-but-not-sent invoice);
  // otherwise start in edit-mode. Flips to submit on Mark reviewed
  // success.
  const [submitMode, setSubmitMode] = useState(draftReviewed);
  useEffect(() => {
    if (draftReviewed) setSubmitMode(true);
  }, [draftReviewed]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId) });
  }

  function onSave() {
    if (!dirty) return;
    saveDraft.mutate(
      { id: groupId, data: { subject, descriptionHtml: body } },
      {
        onSuccess: () => {
          successToast({ title: "__VERB__", description: "Draft saved" });
          invalidate();
        },
        onError: (e: unknown) =>
          toast({
            title: "Save failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  function onRegenerate() {
    regenDraft.mutate(
      { id: groupId },
      {
        onSuccess: () => {
          successToast({ title: "__VERB__", description: "Draft regenerated from preview" });
          invalidate();
        },
        onError: (e: unknown) =>
          toast({
            title: "Regenerate failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  function onMarkReviewed() {
    const finalize = () =>
      markReviewed.mutate(
        { id: groupId },
        {
          onSuccess: () => {
            successToast({ title: "__VERB__", description: "Draft marked as reviewed" });
            invalidate();
            setSubmitMode(true);
            onAfterReviewed();
          },
          onError: (e: unknown) =>
            toast({
              title: "Mark reviewed failed",
              description: e instanceof Error ? e.message : String(e),
              variant: "destructive",
            }),
        },
      );
    if (dirty) {
      saveDraft.mutate(
        { id: groupId, data: { subject, descriptionHtml: body } },
        { onSuccess: finalize, onError: finalize },
      );
    } else {
      finalize();
    }
  }

  function onSubmit() {
    submitMutation.mutate(
      {
        data: {
          invoiceGroupId: groupId,
          actorType: "operator",
          understandingReadback: detail.understandingReadback ?? "",
          subject,
          descriptionHtml: body,
        },
      },
      {
        onSuccess: () => {
          successToast({
            title: "__VERB__",
            description: isDirectEmail ? "Email sent" : "Submitted to portal",
          });
          invalidate();
        },
        onError: (e: unknown) =>
          toast({
            title: "Submission failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  const queueLabel = isDirectEmail ? "Queue email" : "Queue for Portal";

  return (
    <div
      data-testid="v3-hero-review"
      data-submit-mode={submitMode ? "true" : "false"}
      className="space-y-3"
    >
      {/* Strip — phase indicator + mode swap affordance */}
      <div className="flex items-center gap-2">
        {submitMode ? (
          <Send className="w-4 h-4 text-blue-700" />
        ) : (
          <Edit3 className="w-4 h-4 text-amber-700" />
        )}
        <span className="font-semibold text-sm">
          {submitMode ? "Ready to queue · final check" : "Review & edit dispute write-up"}
        </span>
        {draftReviewed && detail.draftReviewedAt && (
          <Badge variant="secondary" className="text-[10px]">
            Reviewed {formatDateTime(detail.draftReviewedAt)}
          </Badge>
        )}
        <span className="cc-pill cc-pill-muted ml-auto">
          {buckets.included} included · {buckets.filtered} filtered
        </span>
      </div>

      <InputsCardsRow rides={rides} onJumpToLeg={onJumpToLeg} variant="slim" />

      {/* Body — editable in Q4, locked in Q5 */}
      {submitMode ? (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <FileText className="w-4 h-4" style={{ color: "var(--cc-meta-fg, currentColor)" }} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate">
                {subject || "(no subject)"}
              </div>
              <div className="cc-meta text-[10px] uppercase tracking-wider">
                Locked for queueing · use Edit again to revise
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSubmitMode(false)}
              data-testid="v3-edit-again"
            >
              <Edit3 className="h-3.5 w-3.5 mr-1" />
              Edit again
            </Button>
          </div>
          <div
            className="text-sm whitespace-pre-wrap leading-relaxed max-h-[360px] overflow-auto"
            style={{
              border: "1px solid var(--cc-border)",
              borderRadius: "var(--cc-radius)",
              background: "var(--cc-card)",
              padding: "1rem 1.125rem",
            }}
            data-testid="v3-locked-body"
          >
            {body || (
              <span className="text-muted-foreground italic">
                No body — go back and regenerate before queueing.
              </span>
            )}
          </div>
          <p className="cc-meta text-xs mt-2">
            Queueing packages this paragraph plus evidence from the {buckets.included}{" "}
            included leg{buckets.included === 1 ? "" : "s"} above and{" "}
            {isDirectEmail ? "sends the dispute email" : "submits to the MAS portal"}.
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" style={{ color: "var(--cc-meta-fg, currentColor)" }} />
              <span className="cc-meta text-[10px] uppercase tracking-wider font-semibold">
                Dispute note · one paragraph for this invoice
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRegenerate}
                  disabled={regenDraft.isPending}
                  data-testid="v3-regenerate"
                >
                  {regenDraft.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  )}
                  Regenerate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onSave}
                  disabled={!dirty || saveDraft.isPending}
                  data-testid="v3-save-draft"
                >
                  {saveDraft.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-1" />
                  )}
                  Save draft
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="v3-draft-subject"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Subject
              </label>
              <Input
                id="v3-draft-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Dispute subject line"
                data-testid="v3-draft-subject-input"
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="v3-draft-body"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Description
              </label>
              <Textarea
                id="v3-draft-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                placeholder="Body the dispute will send. Edit freely; Mark reviewed to lock and queue."
                data-testid="v3-draft-body-input"
              />
              {dirty && (
                <p className="text-xs text-amber-700">
                  Unsaved edits — Save draft to persist (Mark reviewed saves automatically).
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Footer CTAs — different per mode */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {submitMode ? (
          <Button
            onClick={onSubmit}
            disabled={bodyEmpty || submitMutation.isPending}
            data-testid="v3-queue-for-portal"
          >
            {submitMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Send className="h-3.5 w-3.5 mr-1" />
            )}
            {queueLabel}
          </Button>
        ) : (
          <Button
            onClick={onMarkReviewed}
            disabled={bodyEmpty || markReviewed.isPending || saveDraft.isPending}
            data-testid="v3-mark-reviewed"
          >
            {markReviewed.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
            )}
            Mark reviewed &amp; continue
          </Button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Off-ramp inputs hero (V4 Q6 + Q7)
// Cards-row preamble for the reattest_only and nothing_to_do outlooks.
// Mirrors the inputs-summary card visual the dispute path uses, so
// every walk-complete state — dispute, reattest, close — opens with
// the same anchor: "here's what you walked, here's what happens next."
// The action machinery (ReattestModal / closure launcher) lives in
// the existing InvoiceGroupActionSlot below, so wiring is unchanged.
// ─────────────────────────────────────────────────────────────────────
function OffRampInputsHero({
  rides,
  outlook,
  onJumpToLeg,
}: {
  rides: ClaimResponse[];
  outlook: InvoiceDisputeOutlook;
  onJumpToLeg: (id: number) => void;
}) {
  const isReattest = outlook === "reattest_only";
  return (
    <div
      data-testid={isReattest ? "v3-hero-reattest" : "v3-hero-close"}
      className="space-y-3"
    >
      <div className="flex items-center gap-2">
        {isReattest ? (
          <ShieldCheck className="w-4 h-4 text-blue-700" />
        ) : (
          <Archive className="w-4 h-4 text-amber-700" />
        )}
        <span className="font-semibold text-sm">
          {isReattest
            ? "No disputable legs — survivors owe re-attestation"
            : "Nothing to dispute, nothing to re-attest"}
        </span>
        <span className="cc-pill cc-pill-muted ml-auto">
          {rides.length} leg{rides.length === 1 ? "" : "s"} walked
        </span>
      </div>
      <InputsCardsRow rides={rides} onJumpToLeg={onJumpToLeg} variant="slim" />
      <p className="cc-meta text-xs px-1">
        {isReattest
          ? "No portal note will be drafted. Use the action below to queue the survivors for re-attestation; non-contestable legs will be cancelled."
          : "Use the action below to close this invoice out for the audit trail. No portal post, no re-attest queued."}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 4 hero — Submitted receipt
// Group has been POSTed to the portal. Show the submission row from
// detail.submissions (newest first) and a per-leg tracking strip
// drawn from the legs' own state. No CTAs — the wizard is at rest
// until MAS responds and the response lands in the inbox.
// ─────────────────────────────────────────────────────────────────────
function SubmittedReceiptHero({
  detail,
  rides,
}: {
  detail: DetailGroup;
  rides: ClaimResponse[];
}) {
  const submissions = detail.submissions ?? [];
  const newest = submissions.length > 0
    ? [...submissions].sort((a, b) => {
        const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bT - aT;
      })[0]
    : null;

  return (
    <div data-testid="v3-hero-submitted" className="space-y-3">
      <Card>
        <CardContent className="pt-4 flex items-center gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-blue-900">
              Submitted to MAS portal
            </div>
            <div className="cc-meta text-xs mt-0.5">
              {newest?.portalReferenceId && (
                <>
                  Reference{" "}
                  <span className="font-mono font-semibold">
                    {newest.portalReferenceId}
                  </span>
                  {" · "}
                </>
              )}
              {newest?.createdAt
                ? formatDateTime(newest.createdAt)
                : "Submission timestamp unavailable"}
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4">
          <div className="font-semibold text-sm flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4" />
            Per-leg tracking
            <span className="cc-meta text-xs ml-auto">
              {rides.length} leg{rides.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="space-y-1.5">
            {rides.map((leg, i) => {
              const v = legVerdictLabel(leg);
              return (
                <div
                  key={leg.id}
                  className="flex items-center gap-2 py-1.5 border-t first:border-t-0 text-xs"
                  data-testid={`v3-tracking-${leg.id}`}
                >
                  <span className="cc-meta font-semibold uppercase tracking-wider min-w-[2.5rem]">
                    Leg {i + 1}
                  </span>
                  <RefNumber value={leg.confNumber} variant="inline" className="font-medium" />
                  {leg.claimAmount && (
                    <span className="cc-meta tabular-nums">{leg.claimAmount}</span>
                  )}
                  <span className={`cc-pill cc-pill-${v.tone} ml-auto`}>{v.label}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <div className="text-xs text-muted-foreground italic px-1">
        ClaimClear polls the portal periodically and will surface MAS's
        reply in the Classification Inbox when it arrives.
      </div>
    </div>
  );
}
