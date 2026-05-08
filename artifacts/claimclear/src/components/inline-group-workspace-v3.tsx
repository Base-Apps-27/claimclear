import { useEffect, useMemo, useState } from "react";
import {
  useGetInvoiceGroup,
  useGetClaim,
  useListErrorTypes,
  useClassifyLeg,
  useLookupErrorDetailMappings,
  useStampPreviewGenerated,
  useSaveInvoiceGroupDraft,
  useRegenerateInvoiceGroupDraft,
  useMarkInvoiceGroupDraftReviewed,
  useCreatePortalSubmission,
  useBulkQueueGroupReattest,
  usePromoteVerdictDrafts,
  useSopBackStepLeg,
  useSopJumpLeg,
  useSopRestartLeg,
  useReclassifyLeg,
  getGetInvoiceGroupQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getGetClaimQueryKey,
  getListInvoiceGroupsQueryKey,
  getGetResponsesAwaitingReviewCountQueryKey,
  getListClaimEvidenceQueryKey,
  getGetSopRewindImpactQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ClaimResponse,
  ErrorTypeResponse,
  InvoiceGroupDetailResponse,
  SopRewindAction,
  SopRewindImpactResponse,
} from "@workspace/api-client-react";
import { RewindConfirmDialog } from "@/components/decision-tree/rewind-confirm-dialog";
import { ReclassifyConfirmDialog } from "@/components/decision-tree/reclassify-confirm-dialog";
import { buildLegResolvedIndex, outcomeRole, deriveLegSubStatus } from "@workspace/leg-state";
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
  Paperclip,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Bot,
  Search,
  Layers,
  Tag,
  MoreHorizontal,
  RotateCcw,
  Undo2,
  MessageSquare,
  Activity,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@workspace/replit-auth-web";
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
import {
  WalkLandingHero,
  HoldExitHero,
  EdgeDrawer,
  type DrawerSection,
} from "@/components/inline-group-workspace-v3-extras";
import { InvoiceGroupActionSlot } from "@/components/invoice-group-action-slot";
import { useClosureLauncher } from "@/components/closure/closure-launcher";
import {
  CLOSURE_REASON_BANNER,
  type ClosureReasonKey,
} from "@/components/closure/closure-options";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { markLocalAction } from "@/hooks/use-local-action-mark";
import type { DecisionTree } from "@/components/decision-tree/types";
import { useUrlParams } from "@/lib/use-url-params";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { HideForClerk } from "@/lib/role";
import { useToast, successToast, toast } from "@/hooks/use-toast";
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
  /** When > 0 in the has_disputable outlook, the wizard prepends a
   *  leading "Classify" pill to the segmented stepper so the chrome
   *  reads correctly while the operator is still picking error types
   *  for one or more legs. Defaults to 0 — every existing call site
   *  keeps the four-pill ladder until at least one leg is in
   *  needs_classification. */
  needsClassificationCount?: number;
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
    const needsClassification = (inputs.needsClassificationCount ?? 0) > 0;
    const steps = needsClassification
      ? (["Classify", "Walk legs", "Preview", "Review", "Submit"] as const)
      : (["Walk legs", "Preview", "Review", "Submit"] as const);
    // Phase indices below assume the 4-pill ladder. When the leading
    // Classify pill is shown we shift everything by one so the same
    // group state lights the same conceptual phase.
    const shift = needsClassification ? 1 : 0;
    let activeIndex = needsClassification ? 0 : 0;
    if (submitted) activeIndex = 3 + shift;
    else if (draftReviewed) activeIndex = 3 + shift;
    else if (previewGenerated) activeIndex = 2 + shift;
    else if (allWalked) activeIndex = 1 + shift;
    else if (!needsClassification) activeIndex = 0;
    // Keep activeIndex at 0 (Classify) while at least one leg still
    // needs classification — the wizard hero is the Classify hero.

    let helper: string;
    if (submitted) helper = "Submitted to the portal.";
    else if (draftReviewed) helper = "Draft reviewed — submit to the portal.";
    else if (previewGenerated) helper = "Preview generated — review the draft, then submit.";
    else if (allWalked) helper = "All legs walked — generate the preview, then submit to the portal.";
    else if (needsClassification) {
      const n = inputs.needsClassificationCount ?? 0;
      helper = `Pick the error type for ${n} leg${n === 1 ? "" : "s"} to unlock the SOP walk.`;
    } else helper = `Walk all ${legCount} leg${legCount === 1 ? "" : "s"} to unlock Generate preview, then Submit.`;

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
    } else if (needsClassification) {
      const n = inputs.needsClassificationCount ?? 0;
      pillLabel = `${n} to classify`;
      pillTone = "amber";
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
  // R3 — when the operator picks "Open walk" from a card's kebab on
  // WalkCompleteHero, we want to drop them back into the SOP player
  // for that leg even though `allWalked` is still true. This is a
  // transient "force the walk view for this leg" intent that resets
  // the moment they switch legs via the top-strip leg tabs.
  const [forceWalkLegId, setForceWalkLegId] = useState<number | null>(null);
  const setActiveLegId = (id: number | null) => {
    setForceWalkLegId(null);
    setWalkStartedFor(null);
    set({ leg: id == null ? null : String(id) }, false);
  };
  const openEdgeDrawer = (section: DrawerSection) => {
    setEdgeSection(section);
    setEdgeDrawerOpen(true);
  };
  const openWalkForLeg = (id: number) => {
    setForceWalkLegId(id);
    set({ leg: String(id) }, false);
  };

  const [drawerOpen, setDrawerOpen] = useState(false);
  // Edge drawer (chip-driven, two floating right-edge cards). Lives
  // alongside the full Sheet drawer above so the operator can reach
  // ClaimDetailV2 (composer / comms / activity) via the "Open full
  // leg details" footer links when the compact section card isn't
  // enough. `edgeSection` defaults to "evidence" because that's what
  // the chip strip surfaces first.
  const [edgeDrawerOpen, setEdgeDrawerOpen] = useState(false);
  const [edgeSection, setEdgeSection] = useState<DrawerSection>("evidence");
  // "Start walk" CTA on the landing hero flips this for the active
  // leg id, which makes the routing below render WalkSopHero on the
  // next tick. Resets when the operator switches legs so each leg
  // starts on its own landing card.
  const [walkStartedFor, setWalkStartedFor] = useState<number | null>(null);
  // Local "I'm reviewing now" toggle — flips the Preview hero into the
  // editable Review hero before the operator hits Mark reviewed. Reset
  // automatically when the upstream draftReviewedAt stamps so we don't
  // get stuck in review mode after a Mark-reviewed succeeds.
  const [reviewMode, setReviewMode] = useState(false);

  const qc = useQueryClient();
  const { toast } = useToast();
  // V4 Q1 — owns the Generate-preview mutation at the parent level so
  // the primary CTA can render inside the global pinned footer
  // (alongside the gauntlet row + ready-to-draft pill) instead of
  // floating right-aligned in the hero. Hook MUST be declared above
  // the loading early-return below or we trip Rules of Hooks (#300).
  const stampPreview = useStampPreviewGenerated();
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
  // R4 chrome: count legs still in needs_classification (excluded legs
  // never count — they're already removed from the dispute payload).
  const needsClassificationCount = rides.filter(
    (r) =>
      r.includedInDispute !== false &&
      deriveLegSubStatus(r) === "needs_classification",
  ).length;
  const activeLegNeedsClassification =
    !!activeLeg &&
    activeLeg.includedInDispute !== false &&
    deriveLegSubStatus(activeLeg) === "needs_classification";

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
    needsClassificationCount,
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

  // V4 Q1 — Generate-preview mutation is declared above the early
  // return (above) so Rules of Hooks always sees the same hook order
  // regardless of loading state. Buckets are derived eagerly here.
  const walkBuckets = summarizeInclusion(rides);
  function onGeneratePreview() {
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

  // Detect a manual hold scope. Group-scoped wins over leg-scoped so
  // a hold placed on the whole invoice is the hero regardless of
  // which leg is active. SOP holds (sopOutcome === "hold") are not
  // covered here — those still flow through HoldTerminal inside the
  // SOP player. We also skip the hold hero post-submission so the
  // receipt stays the source of truth.
  const groupHoldActive =
    !submitted &&
    (detail.status === "On Hold" ||
      ((detail as InvoiceGroupDetailResponse & { holdReason?: string | null }).holdReason ?? null) != null);
  const legHoldActive =
    !submitted &&
    !groupHoldActive &&
    activeLeg != null &&
    activeLeg.sopOutcome !== "hold" &&
    ((activeLeg.holdReason ?? null) != null);

  if (!collapseToTerminator) {
    if (outlook === "has_disputable") {
      if (submitted) {
        hero = (
          <SubmittedReceiptHero detail={detail} rides={rides} />
        );
        footerPrimary = null;
      } else if (groupHoldActive) {
        hero = (
          <HoldExitHero
            claim={activeLeg ?? rides[0]}
            group={detail}
            scope="group"
            onOpenFullDetails={() => setDrawerOpen(true)}
          />
        );
        footerPrimary = null;
      } else if (legHoldActive && activeLeg) {
        hero = (
          <HoldExitHero
            claim={activeLeg}
            group={detail}
            scope="leg"
            onOpenFullDetails={() => setDrawerOpen(true)}
          />
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
      } else if (
        allWalked &&
        forceWalkLegId != null &&
        activeLeg?.id === forceWalkLegId
      ) {
        // R3 — operator hit "Open walk" on a card's kebab while every
        // leg was walked. Bypass WalkCompleteHero and re-enter the SOP
        // player (or Classify hero) for the chosen leg.
        hero = activeLegNeedsClassification ? (
          <ClassifyHero leg={activeLeg} />
        ) : (
          <WalkSopHero
            leg={activeLeg}
            onOpenDrawer={() => setDrawerOpen(true)}
            onOpenSection={openEdgeDrawer}
          />
        );
      } else if (allWalked) {
        hero = (
          <WalkCompleteHero
            detail={detail}
            rides={rides}
            onJumpToLeg={(id) => setActiveLegId(id)}
            onOpenWalk={(id) => openWalkForLeg(id)}
          />
        );
        footerPrimary = (
          <Button
            onClick={onGeneratePreview}
            disabled={stampPreview.isPending || walkBuckets.included === 0}
            data-testid="v3-generate-preview"
            size="sm"
          >
            {stampPreview.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 mr-1" />
            )}
            Generate dispute note
          </Button>
        );
      } else if (activeLeg && activeLegNeedsClassification) {
        // R4 hero — phase-zero Classify picker. Replaces the SOP
        // walk player when the active leg has no errorTypeId yet.
        // Picking a type fires `/classify` and the wizard's normal
        // hero routing transitions to WalkSopHero on the next render.
        hero = <ClassifyHero leg={activeLeg} />;
      } else if (
        activeLeg &&
        activeLeg.errorTypeId &&
        !activeLeg.sopNodeId &&
        activeLeg.sopOutcome == null &&
        walkStartedFor !== activeLeg.id
      ) {
        // Pre-walk landing — leg is classified and a tree is configured
        // but no SOP progress exists yet. "Start walk" flips
        // walkStartedFor for this leg id, which falls through to the
        // SOP player below on the next render.
        hero = (
          <WalkLandingHero
            claim={activeLeg}
            group={detail}
            onStartWalk={() => setWalkStartedFor(activeLeg.id)}
            onOpenSection={openEdgeDrawer}
          />
        );
      } else if (activeLeg) {
        hero = (
          <WalkSopHero
            leg={activeLeg}
            onOpenDrawer={() => setDrawerOpen(true)}
            onOpenSection={openEdgeDrawer}
          />
        );
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
        hero = (
          <WalkSopHero
            leg={activeLeg}
            onOpenDrawer={() => setDrawerOpen(true)}
            onOpenSection={openEdgeDrawer}
          />
        );
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
          {/* V4 Q6/Q7 graduation — full off-ramp hero with header strip,
              cards-row preamble, and an inline action strip that wires
              directly to the existing reattest / closure mutations.
              When the inline strip is mounted, we DO NOT also render
              InvoiceGroupActionSlot below (it would render a second,
              redundant CTA card). For the in-progress reattest_only
              walk, the slot still owns the action surface. */}
          {((outlook === "reattest_only" && allWalked) ||
            outlook === "nothing_to_do") ? (
            <OffRampInputsHero
              detail={detail}
              groupId={groupId}
              rides={rides}
              outlook={outlook}
              survivors={survivors}
              dropped={dropped}
              onJumpToLeg={(id) => setActiveLegId(id)}
            />
          ) : (
            <InvoiceGroupActionSlot
              group={detail}
              groupId={groupId}
              bare
              onJumpToLeg={(claimId) => setActiveLegId(claimId)}
            />
          )}
        </>
      )}

      {detailsDrawer}
      {activeLeg && (
        <EdgeDrawer
          open={edgeDrawerOpen}
          section={edgeSection}
          onSectionChange={setEdgeSection}
          onClose={() => setEdgeDrawerOpen(false)}
          onOpenFullDetails={() => {
            setEdgeDrawerOpen(false);
            setDrawerOpen(true);
          }}
          claim={activeLeg}
          group={detail}
        />
      )}
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
function WalkSopHero({
  leg,
  onOpenDrawer,
  onOpenSection,
}: {
  leg: ClaimResponse;
  onOpenDrawer?: () => void;
  onOpenSection?: (section: DrawerSection) => void;
}) {
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

  // V4 — counts strip: clickable chips that open the Details drawer
  // for the active leg. Counts come from data already on the claim
  // payload (no extra fetches). Activity / Comms chips are countless
  // entry points — the drawer surfaces those panels once opened.
  const evidenceCount = (claim?.evidenceFiles ?? []).length;
  const noteCount = (claim?.evidenceNotes ?? "").trim().length > 0 ? 1 : 0;
  // The chip strip drives the right-edge drawer when `onOpenSection`
  // is wired (V3 graduation), and falls back to the full Sheet drawer
  // when it isn't.
  const openChip = (section: DrawerSection) => () => {
    if (onOpenSection) onOpenSection(section);
    else if (onOpenDrawer) onOpenDrawer();
  };
  const countsStrip = onOpenDrawer || onOpenSection ? (
    <div
      className="flex items-center gap-1.5 mb-2 flex-wrap"
      data-testid="v3-walk-counts-strip"
    >
      <button
        type="button"
        onClick={openChip("evidence")}
        className="cc-pill cc-pill-muted hover:opacity-80 transition-opacity"
        data-testid="v3-walk-counts-chip-evidence"
        aria-label="Open evidence in details drawer"
      >
        <Paperclip className="w-3 h-3 inline mr-1" />
        Evidence · {evidenceCount}
      </button>
      <button
        type="button"
        onClick={openChip("notes")}
        className="cc-pill cc-pill-muted hover:opacity-80 transition-opacity"
        data-testid="v3-walk-counts-chip-notes"
        aria-label="Open notes in details drawer"
      >
        <FileText className="w-3 h-3 inline mr-1" />
        Notes · {noteCount}
      </button>
      <button
        type="button"
        onClick={openChip("comms")}
        className="cc-pill cc-pill-muted hover:opacity-80 transition-opacity"
        data-testid="v3-walk-counts-chip-thread"
        aria-label="Open communication thread in details drawer"
      >
        <MessageSquare className="w-3 h-3 inline mr-1" />
        Comms
      </button>
      <button
        type="button"
        onClick={openChip("activity")}
        className="cc-pill cc-pill-muted hover:opacity-80 transition-opacity"
        data-testid="v3-walk-counts-chip-activity"
        aria-label="Open activity in details drawer"
      >
        <Activity className="w-3 h-3 inline mr-1" />
        Activity
      </button>
    </div>
  ) : null;

  return (
    <div data-testid="v3-hero-walk" className="space-y-2">
      <Card>
        <CardContent className="pt-4 pb-3">
          {legMeta}
          {countsStrip}
          {(() => {
            if (!claim) {
              return (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading leg…
                </div>
              );
            }
            // Closed-state legs (excluded, dropped as non_issue /
            // cannot_dispute, or frozen) must NOT show the "classify this
            // leg" prompt — they already have a final disposition and the
            // SOP walk is intentionally not their next step. Surface the
            // closure clearly instead so the operator sees why the leg is
            // inert.
            const sub = deriveLegSubStatus(claim);
            if (sub === "excluded" || sub === "dropped" || sub === "frozen") {
              const reason =
                claim.sopOutcome === "non_issue" || claim.dropReason === "non_issue"
                  ? { label: "Non-issue", body: "This leg was marked as a non-issue. Nothing to dispute — it routes to re-attestation in the payor portal.", tone: "blue" as const }
                  : claim.sopOutcome === "cannot_dispute" || claim.dropReason === "cannot_dispute"
                  ? { label: "Cannot dispute", body: "This leg is non-contestable and has been withdrawn from the dispute.", tone: "amber" as const }
                  : claim.includedInDispute === false
                  ? { label: "Excluded", body: "This leg has been excluded from the dispute.", tone: "muted" as const }
                  : { label: "Closed", body: "This leg has reached a final state and no further SOP work is needed.", tone: "muted" as const };
              const accentVar =
                reason.tone === "blue" ? "var(--cc-blue-fg)"
                : reason.tone === "amber" ? "var(--cc-amber-fg)"
                : "var(--cc-border)";
              const iconColor =
                reason.tone === "blue" ? "var(--cc-blue-fg)"
                : reason.tone === "amber" ? "var(--cc-amber-fg)"
                : "var(--cc-meta-fg)";
              const pillClass =
                reason.tone === "blue" ? "cc-pill-green"
                : reason.tone === "amber" ? "cc-pill-amber"
                : "cc-pill-muted";
              return (
                <div
                  className="cc-sop-card"
                  style={{
                    background: "var(--cc-card)",
                    border: "1px solid var(--cc-border)",
                    borderLeft: `3px solid ${accentVar}`,
                    padding: "0.875rem 1rem",
                    borderRadius: "var(--cc-radius)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                  data-testid={`v3-hero-walk-closed-${claim.id}`}
                  data-closure={reason.label.toLowerCase().replace(/\s+/g, "-")}
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" style={{ color: iconColor }} />
                    <span className="text-sm font-semibold" style={{ color: "var(--cc-fg)" }}>
                      This leg is closed as {reason.label}
                    </span>
                    <span className={`cc-pill ${pillClass} ml-auto`}>{reason.label}</span>
                  </div>
                  <p className="cc-meta text-[12px]" style={{ margin: 0, lineHeight: 1.5 }}>
                    {reason.body}
                  </p>
                  {(onOpenSection || onOpenDrawer) && (
                    <div>
                      <button
                        type="button"
                        onClick={openChip("activity")}
                        className="cc-link text-[12px]"
                        style={{ background: "transparent", border: 0, padding: 0, cursor: "pointer", font: "inherit" }}
                        data-testid={`v3-hero-walk-closed-open-activity-${claim.id}`}
                      >
                        View closure activity →
                      </button>
                    </div>
                  )}
                </div>
              );
            }
            if (!claim.errorTypeId) {
              return (
                <div className="text-xs flex items-start gap-2 p-3 rounded bg-amber-50 border border-amber-200 text-amber-900">
                  <HelpCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    This leg has no error type yet. Open Details to classify it
                    — the SOP walk unlocks once an error type is assigned.
                  </span>
                </div>
              );
            }
            if (!tree) {
              return (
                <div className="text-xs flex items-start gap-2 p-3 rounded bg-amber-50 border border-amber-200 text-amber-900">
                  <HelpCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    The assigned error type ({claim.errorTypeName ?? "—"}) has
                    no decision tree configured. Configure one to walk the SOP.
                  </span>
                </div>
              );
            }
            return (
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
                  sopAnswers: claim.sopAnswers,
                }}
                tree={tree}
                onAdvanced={invalidateLeg}
                errorType={
                  errorType
                    ? { useDirectEmail: errorType.useDirectEmail ?? null }
                    : null
                }
              />
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase 0a hero — Classify (R4)
// Mounted in front of WalkSopHero when the active leg's sub-status is
// `needs_classification`. The picker shows the most-likely error-type
// suggestions, a search box that filters every type, and an "All error
// types" grid that browses the rest of the taxonomy. Picking a type
// and clicking "Start walk" fires the existing `useClassifyLeg`
// mutation; on success we invalidate the same query keys WalkSopHero
// uses, so the wizard's hero routing transitions to the SOP walk for
// the now-classified leg with no extra click. Mutation errors stay on
// the picker (toast + selection preserved) so the operator can retry.
//
// Suggestion source: the canonical `error_detail_mappings` lookup
// (`POST /error-detail-mappings/lookup`) is the same signal the import
// pipeline and the oneshot backfill scripts use to auto-classify legs.
// When the leg's `errorDetails` resolves there to a saved mapping, we
// surface that match as the top "Recommended" pick (same id the auto-
// classifier would have stamped). The remaining suggestion slots fall
// back to a tiny token-overlap pass over the leg's error details so the
// operator sees a couple of plausible neighbors when the canonical
// match misses or is ambiguous; if neither produces results the row is
// just hidden and the operator picks straight from the grid.
// ─────────────────────────────────────────────────────────────────────

const CLASSIFY_STOPWORDS = new Set([
  "the","a","an","and","or","of","to","for","is","are","was","were",
  "in","on","at","with","by","from","as","this","that","be","been",
  "it","its","their","there","not","no","too","very","just","than",
  "but","if","so","do","does","did","has","have","had","will","would",
  "can","could","should","may","might","into","onto","than","then",
]);
function classifyTokens(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !CLASSIFY_STOPWORDS.has(t));
  return new Set(tokens);
}

interface SuggestionRanked {
  type: ErrorTypeResponse;
  score: number;
  source: "mapping" | "overlap";
}

// Token-overlap fallback. Used only to fill the suggestion slots when
// the canonical mapping lookup returns nothing or doesn't fill all
// three. Reads the same `errorDetails` field the mapping lookup keys
// off so the operator's two affordances (auto-classify on import vs.
// pick-on-walk) stay anchored to the same input.
function rankByOverlap(
  leg: ClaimResponse,
  errorTypes: ErrorTypeResponse[],
  excludeIds: Set<string>,
  limit: number,
): SuggestionRanked[] {
  if (limit <= 0) return [];
  const detailsTokens = classifyTokens(leg.errorDetails);
  if (detailsTokens.size === 0 || errorTypes.length === 0) return [];
  const detailsLower = (leg.errorDetails ?? "").toLowerCase();
  const ranked: SuggestionRanked[] = [];
  for (const type of errorTypes) {
    if (excludeIds.has(String(type.id))) continue;
    const nameLower = (type.name ?? "").toLowerCase();
    const categoryLower = (type.category ?? "").toLowerCase();
    let score = 0;
    if (nameLower && detailsLower.includes(nameLower)) score += 100;
    if (categoryLower && detailsLower.includes(categoryLower)) score += 30;
    const nameTokens = classifyTokens(type.name);
    const categoryTokens = classifyTokens(type.category);
    for (const t of nameTokens) if (detailsTokens.has(t)) score += 10;
    for (const t of categoryTokens) if (detailsTokens.has(t)) score += 4;
    if (score > 0) ranked.push({ type, score, source: "overlap" });
  }
  ranked.sort((a, b) => b.score - a.score || a.type.name.localeCompare(b.type.name));
  return ranked.slice(0, limit);
}

function ClassifyHero({ leg }: { leg: ClaimResponse }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: claim } = useGetClaim(leg.id, {
    query: { queryKey: getGetClaimQueryKey(leg.id), enabled: !!leg.id },
  });
  // Prefer the freshly-fetched claim row when it's landed (so we read
  // the latest errorDetails / classifier signals) and fall back to the
  // active-leg snapshot from the parent fetch until the row is hot.
  const sourceLeg: ClaimResponse = claim ?? leg;
  const { data: errorTypesData } = useListErrorTypes();
  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];

  const classifyLeg = useClassifyLeg();
  const lookupMappings = useLookupErrorDetailMappings();
  const [selectedTypeId, setSelectedTypeId] = useState<string>("");
  const [search, setSearch] = useState("");

  // Hit the canonical `/error-detail-mappings/lookup` endpoint once per
  // leg.errorDetails change. The matched errorTypeId (if any) is what
  // the auto-classifier on import would have stamped, so it becomes the
  // top "Recommended" suggestion. Failures fall through silently —
  // the overlap fallback still renders.
  const lookupMutate = lookupMappings.mutate;
  useEffect(() => {
    const details = sourceLeg.errorDetails?.trim();
    if (!details) return;
    lookupMutate({ data: { errorDetails: [details] } });
  }, [sourceLeg.errorDetails, lookupMutate]);

  const suggestions = useMemo<SuggestionRanked[]>(() => {
    if (errorTypes.length === 0) return [];
    const out: SuggestionRanked[] = [];
    const mapped = lookupMappings.data?.mappings?.[0];
    if (mapped?.matched && mapped.errorTypeId != null) {
      const mappedId = String(mapped.errorTypeId);
      const type = errorTypes.find((t) => String(t.id) === mappedId);
      if (type) out.push({ type, score: 1000, source: "mapping" });
    }
    const exclude = new Set(out.map((s) => String(s.type.id)));
    out.push(...rankByOverlap(sourceLeg, errorTypes, exclude, 3 - out.length));
    return out;
  }, [sourceLeg, errorTypes, lookupMappings.data]);

  // Search filters the full taxonomy (no suggestion-exclusion) so an
  // operator typing a query that overlaps with a suggested type still
  // sees that tile in the results — they shouldn't have to scroll back
  // to the suggestions row to pick it.
  const searchLower = search.trim().toLowerCase();
  const matchedTypes = useMemo(() => {
    if (!searchLower) return null;
    return errorTypes.filter((t) =>
      (t.name ?? "").toLowerCase().includes(searchLower) ||
      (t.category ?? "").toLowerCase().includes(searchLower),
    );
  }, [errorTypes, searchLower]);

  // The browse grid still hides the suggestion tiles when no search is
  // active (so the operator doesn't see the same tile twice in the
  // default view), but during search it shows every match.
  const suggestionIds = useMemo(
    () => new Set(suggestions.map((s) => String(s.type.id))),
    [suggestions],
  );
  const browseTypes = useMemo(() => {
    if (matchedTypes) return matchedTypes;
    return errorTypes.filter((t) => !suggestionIds.has(String(t.id)));
  }, [matchedTypes, errorTypes, suggestionIds]);

  const selectedType = useMemo(() => {
    if (!selectedTypeId) return null;
    return errorTypes.find((t) => String(t.id) === selectedTypeId) ?? null;
  }, [selectedTypeId, errorTypes]);

  async function handleStartWalk() {
    if (!selectedType) return;
    try {
      await classifyLeg.mutateAsync({
        id: sourceLeg.id,
        data: { errorTypeId: String(selectedType.id) },
      });
      // Invalidate the same keys WalkSopHero invalidates after each
      // SOP-advance, so the wizard's outer fetch refreshes the leg
      // (and the parent group's leg switcher counts) immediately.
      qc.invalidateQueries({ queryKey: getGetClaimQueryKey(sourceLeg.id) });
      if (sourceLeg.invoiceGroupId != null) {
        qc.invalidateQueries({
          queryKey: getGetInvoiceGroupQueryKey(sourceLeg.invoiceGroupId),
        });
        qc.invalidateQueries({
          queryKey: getGetInvoiceGroupValidTransitionsQueryKey(sourceLeg.invoiceGroupId),
        });
      }
      successToast({
        title: "Classified",
        description: `Leg classified as "${selectedType.name}". Starting SOP walk…`,
      });
    } catch (e) {
      toast({
        title: "Classify failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  const isPending = classifyLeg.isPending;
  const ctaLabel = selectedType
    ? `Start walk · ${selectedType.name}`
    : "Pick an error type to start the walk";

  return (
    <div data-testid="v3-hero-classify" className="space-y-2">
      <Card>
        <CardContent className="pt-4 pb-3 space-y-3">
          <div className="cc-meta text-[11px] flex items-center gap-2">
            <RefNumber value={sourceLeg.confNumber} variant="inline" />
            {sourceLeg.date && <span>· {sourceLeg.date}</span>}
            {sourceLeg.claimAmount && <span>· {sourceLeg.claimAmount}</span>}
            <span className="cc-pill cc-pill-amber ml-auto">Needs classification</span>
          </div>

          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-700" />
            <span className="font-semibold text-sm">
              Pick the error type for this leg
            </span>
            <span className="cc-meta text-[11px] ml-1">
              Determines which SOP this leg walks
            </span>
          </div>

          {sourceLeg.errorDetails && (
            <div className="rounded bg-muted/40 p-2 text-xs">
              <span className="font-medium">Error details:</span> {sourceLeg.errorDetails}
            </div>
          )}

          <div className="flex items-center gap-2 px-2 py-1.5 rounded border bg-background">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search error types…"
              className="flex-1 bg-transparent outline-none text-sm"
              data-testid="v3-classify-search"
            />
            <span className="cc-meta text-[11px]">
              {errorTypes.length} types
            </span>
          </div>

          {suggestions.length > 0 && !searchLower && (
            <div className="space-y-1.5" data-testid="v3-classify-suggestions">
              <span className="cc-meta text-[10px] uppercase tracking-wider">
                Most likely · based on error description
              </span>
              {suggestions.map((s, i) => {
                const id = String(s.type.id);
                const recommended = i === 0;
                const isSelected = selectedTypeId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSelectedTypeId(id)}
                    disabled={isPending}
                    data-testid={`v3-classify-suggestion-${id}`}
                    data-recommended={recommended ? "true" : "false"}
                    data-selected={isSelected ? "true" : "false"}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded border text-left ${
                      isSelected
                        ? "border-primary ring-2 ring-primary/40"
                        : recommended
                        ? "border-blue-500"
                        : "border-border"
                    }`}
                  >
                    <span className="font-semibold text-sm">{s.type.name}</span>
                    {s.type.category && (
                      <span className="cc-meta text-[11px]">· {s.type.category}</span>
                    )}
                    {recommended && (
                      <span className="cc-pill cc-pill-blue ml-auto">Recommended</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-1.5">
            <span className="cc-meta text-[10px] uppercase tracking-wider">
              {searchLower ? "Search results" : "All error types"}
            </span>
            {browseTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground italic px-2 py-1">
                {searchLower
                  ? "No error types match that search."
                  : "No additional error types configured."}
              </p>
            ) : (
              <div
                className="grid grid-cols-2 sm:grid-cols-3 gap-1.5"
                data-testid="v3-classify-grid"
              >
                {browseTypes.map((t) => {
                  const id = String(t.id);
                  const isSelected = selectedTypeId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelectedTypeId(id)}
                      disabled={isPending}
                      data-testid={`v3-classify-tile-${id}`}
                      data-selected={isSelected ? "true" : "false"}
                      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-left text-xs ${
                        isSelected
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <span className="truncate">{t.name}</span>
                      <ChevronRight className="w-3 h-3 flex-shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t pt-3">
            <span className="cc-meta text-[11px]">
              Selecting an error type stamps it on the leg and starts the SOP walk.
            </span>
            <Button
              size="sm"
              onClick={handleStartWalk}
              disabled={!selectedType || isPending}
              data-testid="v3-classify-start-walk"
              className="ml-auto"
            >
              {isPending ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</>
              ) : (
                <><Tag className="w-3.5 h-3.5 mr-1.5" /> {ctaLabel}</>
              )}
            </Button>
          </div>
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
): "included" | "non_issue" | "non_contestable" | "duplicate" | "held" | "excluded" {
  if (leg.includedInDispute === false) return "excluded";
  const role = outcomeRole(leg);
  // Per `whats-next-derivation`, non_issue is a SURVIVOR (re-attest in
  // the portal) — distinct from cannot_dispute (drop / cancel). Keep
  // them in separate buckets so the inputs strip + the file collector
  // can treat survivors with their correct calm-blue tone instead of
  // the amber "cannot dispute" warning.
  if (role === "non_issue") return "non_issue";
  if (role === "cannot_dispute") return "non_contestable";
  if (role === "duplicate") return "duplicate";
  if (leg.sopOutcome === "hold") return "held";
  return "included";
}

function inclusionPill(kind: ReturnType<typeof legAiInclusion>): { label: string; tone: "green" | "amber" | "blue" | "muted" } {
  switch (kind) {
    case "included": return { label: "Included in draft", tone: "green" };
    case "non_issue": return { label: "Not in prompt · re-attest in portal", tone: "blue" };
    case "non_contestable": return { label: "Not in prompt · cannot dispute", tone: "amber" };
    case "excluded": return { label: "Not in prompt · excluded", tone: "amber" };
    case "held": return { label: "Not in prompt · on hold", tone: "amber" };
    case "duplicate": return { label: "Follows primary", tone: "blue" };
  }
}

/**
 * Shared compact-card row used by all four has_disputable heroes
 * (WalkCompleteHero, PreviewDocHero, ReviewEditHero, SubmittedReceipt
 * Hero). The row is the visual anchor that tells the operator at-a-
 * glance which legs feed the AI prompt. `variant`:
 *   - "full"  → cards show SOP verdict + inclusion pill (Q1 layout)
 *   - "slim"  → cards drop the SOP verdict line; just leg meta + pill
 *               (Q3/Q4/Q5 layout where the paragraph is the focus)
 *   - "dense" → V4 Q2 expanded layout. Adds the SOP Q→A trail (from
 *               `leg.perLegContext`), evidence chips (from
 *               `leg.evidenceFiles`), op-note (from `leg.evidenceNotes`)
 *               and a Default L1 / Custom L2 prompt-layer pill.
 */
export function InputsCardsRow({
  rides,
  onJumpToLeg,
  onOpenWalk,
  variant,
}: {
  rides: ClaimResponse[];
  onJumpToLeg: (id: number) => void;
  onOpenWalk?: (id: number) => void;
  variant: "full" | "slim" | "dense";
}) {
  const purpleStyle: React.CSSProperties = {
    background: "var(--cc-purple-bg)",
    color: "var(--cc-purple-fg)",
    borderColor: "var(--cc-purple-bg)",
  };

  return (
    <div
      className="flex flex-wrap gap-2.5"
      data-testid="v3-inputs-cards"
      data-variant={variant}
    >
      {rides.map((leg, i) => {
        const inclusion = legAiInclusion(leg);
        const verdict = legVerdictLabel(leg);
        const pill = inclusionPill(inclusion);
        const isFiltered = inclusion !== "included";
        // Survivor (non_issue) and sibling-duplicate legs are filtered
        // out of the AI prompt for legitimate, non-warning reasons —
        // colour them calm-blue so the row reads "fine, just routed
        // elsewhere" instead of "amber-warning, something's wrong".
        const isCalmFiltered = inclusion === "non_issue" || inclusion === "duplicate";
        const accent =
          inclusion === "included" ? "var(--cc-green-fg)"
          : isCalmFiltered ? "var(--cc-blue-fg)"
          : "var(--cc-amber-fg)";
        const evidenceFiles = (leg.evidenceFiles ?? []) as Array<{
          url: string;
          name?: string | null;
        }>;
        const opNote = (leg.evidenceNotes ?? "").trim();
        const ctx = (leg.perLegContext ?? "").trim();
        const sopLines = ctx
          ? ctx
              .split(/\r?\n+/)
              .map((l) => l.replace(/^[•\-\*]\s*/, "").trim())
              .filter(Boolean)
              .slice(0, 6)
          : [];
        const hasOverride = ctx.length > 0;
        return (
          <div
            key={leg.id}
            data-testid={`v3-inputs-card-${leg.id}`}
            className="cc-card"
            style={{
              flex: "1 1 280px",
              minWidth: 280,
              maxWidth: variant === "dense" ? 360 : 340,
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
              {isFiltered && isCalmFiltered && (
                <CheckCircle2 className="w-3 h-3 ml-auto" style={{ color: "var(--cc-blue-fg)" }} />
              )}
              {isFiltered && !isCalmFiltered && (
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
            {variant === "dense" && (
              <>
                <div style={{ height: 1, background: "var(--cc-border)", margin: "0.125rem 0" }} />
                <div className="flex items-center gap-1.5">
                  <span className="cc-meta text-[10px] uppercase tracking-wider">SOP</span>
                  <span className={`cc-pill cc-pill-${verdict.tone}`}>{verdict.label}</span>
                </div>
                <div className="cc-meta text-[10px] uppercase tracking-wider font-semibold">
                  SOP walk
                </div>
                {sopLines.length > 0 ? (
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.2rem",
                    }}
                    data-testid={`v3-inputs-sop-trail-${leg.id}`}
                  >
                    {sopLines.map((line, k) => (
                      <li key={k} className="text-[11px] flex items-start gap-1">
                        <CheckCircle2
                          className="w-2.5 h-2.5 mt-0.5 flex-shrink-0"
                          style={{
                            color: isFiltered
                              ? "var(--cc-amber-fg)"
                              : "var(--cc-green-fg)",
                          }}
                        />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="cc-meta text-[11px] italic">
                    No per-leg SOP trail captured.
                  </div>
                )}
                <div className="cc-meta text-[10px] uppercase tracking-wider font-semibold">
                  Evidence
                </div>
                {evidenceFiles.length > 0 ? (
                  <div
                    className="flex items-center gap-1 flex-wrap"
                    data-testid={`v3-inputs-evidence-${leg.id}`}
                  >
                    {evidenceFiles.slice(0, 4).map((f, k) => (
                      <span
                        key={k}
                        className="cc-pill cc-pill-muted"
                        style={{ fontSize: "10px" }}
                      >
                        <Paperclip className="w-2.5 h-2.5 inline" />{" "}
                        {f.name ?? "file"}
                      </span>
                    ))}
                    {evidenceFiles.length > 4 && (
                      <span className="cc-meta text-[10px]">
                        +{evidenceFiles.length - 4} more
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="cc-meta text-[11px]">—</div>
                )}
                {opNote && (
                  <>
                    <div className="cc-meta text-[10px] uppercase tracking-wider font-semibold">
                      Op note
                    </div>
                    <div
                      className="text-[11px]"
                      style={{ fontStyle: "italic", lineHeight: 1.4 }}
                      data-testid={`v3-inputs-opnote-${leg.id}`}
                    >
                      &ldquo;{opNote.length > 160 ? `${opNote.slice(0, 160)}…` : opNote}&rdquo;
                    </div>
                  </>
                )}
              </>
            )}
            <div className="flex items-center gap-2 pt-0.5 flex-wrap">
              <span className={`cc-pill cc-pill-${pill.tone}`}>{pill.label}</span>
              {variant === "dense" && !isFiltered && (
                <span
                  className={hasOverride ? "cc-pill" : "cc-pill cc-pill-muted"}
                  style={hasOverride ? purpleStyle : undefined}
                  data-testid={`v3-inputs-layer-${leg.id}`}
                >
                  {hasOverride ? "Custom L2" : "Default L1"}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs ml-auto"
                onClick={() => onJumpToLeg(leg.id)}
                data-testid={`v3-inputs-jump-${leg.id}`}
              >
                Open
              </Button>
              <LegRewindMenu leg={leg} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Task #536 (R3) — Per-leg rewind menu on the InputsCardsRow.
//
// Renders a small overflow menu next to each leg card's "Open" button
// when the leg has any sopAnswers. Reuses the shared
// `RewindConfirmDialog` (R5 mockup, light/heavy variants chosen by
// `pickRewindDialogVariant` inside the dialog itself) for back-step /
// restart and the player's `ReclassifyConfirmDialog` for the
// destructive reclassify path. Mirrors the player's
// invalidateAfterRewind set so the cards row stays in sync after any
// of the four mutations land.
// ─────────────────────────────────────────────────────────────────────
function LegRewindMenu({ leg }: { leg: ClaimResponse }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const hasAnswers =
    Array.isArray(leg.sopAnswers) && leg.sopAnswers.length > 0;

  const [rewindAction, setRewindAction] = useState<SopRewindAction | null>(
    null,
  );
  const [reclassifyOpen, setReclassifyOpen] = useState(false);

  const backStepMutation = useSopBackStepLeg<Error>();
  const jumpMutation = useSopJumpLeg<Error>();
  const restartMutation = useSopRestartLeg<Error>();
  const reclassifyMutation = useReclassifyLeg<Error>({
    mutation: {
      onSuccess: () => {
        markLocalAction(`claim:${leg.id}`);
        invalidateAfterRewind();
        successToast({
          title: "__VERB__",
          description: "Leg reclassified — pick an error type to start over",
        });
        setReclassifyOpen(false);
      },
      onError: handleRewindError,
    },
  });

  const anyRewindPending =
    backStepMutation.isPending ||
    jumpMutation.isPending ||
    restartMutation.isPending;

  const legRefLabel = leg.confNumber || `CLM-${leg.id}`;

  function invalidateAfterRewind() {
    qc.invalidateQueries({ queryKey: ["claim", leg.id] });
    qc.invalidateQueries({ queryKey: ["claims"] });
    qc.invalidateQueries({
      queryKey: getListClaimEvidenceQueryKey(leg.id),
    });
    qc.invalidateQueries({
      queryKey: getGetSopRewindImpactQueryKey(leg.id),
    });
    if (leg.invoiceGroupId != null) {
      qc.invalidateQueries({
        queryKey: ["invoice-group", leg.invoiceGroupId],
      });
      qc.invalidateQueries({ queryKey: ["invoice-groups"] });
    }
  }

  function handleRewindError(err: unknown) {
    const e = err as { status?: number; message?: string };
    toast({
      title: "Could not rewind the SOP walk",
      description: e?.message || "Please try again.",
      variant: "destructive",
    });
  }

  function handleRewindSuccess(verb: string) {
    markLocalAction(`claim:${leg.id}`);
    invalidateAfterRewind();
    successToast({ title: "__VERB__", description: verb });
    setRewindAction(null);
  }

  function handleConfirm({ impact }: { impact: SopRewindImpactResponse }) {
    if (!rewindAction) return;
    const data = { discardDraft: impact.draftWillBeDiscarded };
    if (rewindAction === "back-step") {
      backStepMutation.mutate(
        { id: leg.id, data },
        {
          onSuccess: () =>
            handleRewindSuccess("Walk stepped back one answer"),
          onError: handleRewindError,
        },
      );
    } else if (rewindAction === "restart") {
      restartMutation.mutate(
        { id: leg.id, data },
        {
          onSuccess: () =>
            handleRewindSuccess("Walk restarted from the top"),
          onError: handleRewindError,
        },
      );
    }
    // "jump" is wired but not exposed in the cards-row menu — the
    // breadcrumb chips inside the player own that flow.
  }

  if (!hasAnswers) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            disabled={anyRewindPending || reclassifyMutation.isPending}
            data-testid={`v3-inputs-rewind-menu-${leg.id}`}
            aria-label={`Rewind options for ${legRefLabel}`}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setRewindAction("back-step");
            }}
            disabled={anyRewindPending}
            data-testid={`v3-inputs-rewind-back-step-${leg.id}`}
          >
            <Undo2 className="h-3.5 w-3.5 mr-2" />
            Back-step
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setRewindAction("restart");
            }}
            disabled={anyRewindPending}
            data-testid={`v3-inputs-rewind-restart-${leg.id}`}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-2" />
            Restart
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setReclassifyOpen(true);
            }}
            disabled={reclassifyMutation.isPending}
            data-testid={`v3-inputs-rewind-reclassify-${leg.id}`}
          >
            <Layers className="h-3.5 w-3.5 mr-2" />
            Reclassify
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {rewindAction && (
        <RewindConfirmDialog
          open={!!rewindAction}
          onOpenChange={(next) => {
            if (!next && !anyRewindPending) setRewindAction(null);
          }}
          legId={leg.id}
          legRef={legRefLabel}
          action={rewindAction}
          currentVerdictLabel={leg.sopOutcome ?? null}
          onConfirm={handleConfirm}
          isPending={anyRewindPending}
        />
      )}

      <ReclassifyConfirmDialog
        open={reclassifyOpen}
        onOpenChange={(next) =>
          !reclassifyMutation.isPending && setReclassifyOpen(next)
        }
        legRef={legRefLabel}
        isPending={reclassifyMutation.isPending}
        onConfirm={() => reclassifyMutation.mutate({ id: leg.id })}
      />
    </>
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

// ─────────────────────────────────────────────────────────────────────
// V4 Q1–Q5 chrome — unified invoice-header strip + Walk·Preview·Review
// ·Submit segmented stepper. Renders at the top of every disputable
// hero so the operator always has the same anchor: which invoice,
// what's in the prompt, which phase. The pinned footer at the bottom
// of the wizard owns the gauntlet/helper/pill chrome; this strip owns
// the at-a-glance phase indicator.
// ─────────────────────────────────────────────────────────────────────
type WizardPhase = "walk" | "preview" | "review" | "submit";
type OffRampPhase = "reattest" | "close";

function WizardInvoiceHeaderStrip({
  detail,
  rides,
  current,
  offRampCurrent,
  offRampDisabledReattest,
  onOffRampChange,
  trailingPill,
  trailingExtra,
}: {
  detail: DetailGroup;
  rides: ClaimResponse[];
  current?: WizardPhase;
  /** When set, the segmented stepper renders the off-ramp pair
   *  (Re-attest · Close) with `offRampCurrent` highlighted. Other
   *  segment is clickable when `onOffRampChange` is provided.
   *  Mutually exclusive with `current`. */
  offRampCurrent?: OffRampPhase;
  /** When true, the Re-attest segment is rendered disabled (e.g. the
   *  group has no survivors to re-attest under `nothing_to_do`). */
  offRampDisabledReattest?: boolean;
  /** Operator-override handler. When provided, the inactive off-ramp
   *  segment becomes clickable; clicks fire this with the segment
   *  the operator picked. Caller is responsible for any confirm UX. */
  onOffRampChange?: (next: OffRampPhase) => void;
  /** Optional small pill rendered after the bucket-counts pill (e.g. Q4
   *  "Note edited · unsaved" purple state, or Q5 "Ready to send"). */
  trailingPill?: {
    label: string;
    tone: "amber" | "green" | "blue" | "muted" | "purple";
    testid?: string;
  } | null;
  /** Optional inline meta to the right of the bucket-counts pill (e.g.
   *  Q5 "→ MAS Trip Inventory · 2 disputed / 1 filtered"). */
  trailingExtra?: React.ReactNode;
}) {
  const buckets = summarizeInclusion(rides);
  const phases: { key: WizardPhase; label: string }[] = [
    { key: "walk", label: "Walk" },
    { key: "preview", label: "Preview" },
    { key: "review", label: "Review" },
    { key: "submit", label: "Submit" },
  ];
  const order: WizardPhase[] = ["walk", "preview", "review", "submit"];
  const currentIdx = current ? order.indexOf(current) : -1;
  // V4 Q6 / Q7 — for off-ramp outlooks the four-step ladder collapses to a
  // single pill ("Re-attest" or "Close") so the chrome reads correctly for
  // a path that doesn't run Preview / Review / Submit.
  const offRampPhases: { key: OffRampPhase; label: string }[] = [
    { key: "reattest", label: "Re-attest" },
    { key: "close", label: "Close" },
  ];
  const purpleStyle: React.CSSProperties = {
    background: "var(--cc-purple-bg)",
    color: "var(--cc-purple-fg)",
    borderColor: "var(--cc-purple-bg)",
  };

  return (
    <div
      data-testid="v3-invoice-header-strip"
      data-phase={current}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 0.75rem",
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: "var(--cc-radius)",
        flexWrap: "wrap",
      }}
    >
      <RefNumber
        value={detail.invoiceNumber}
        variant="inline"
        className="font-semibold"
      />
      <span className="cc-meta text-[11px]">
        {detail.rideCount} ride{detail.rideCount === 1 ? "" : "s"}
        <HideForClerk>
          {" · "}
          {formatCurrency(detail.totalAmount)}
        </HideForClerk>
      </span>
      {detail.payorEmail && (
        <span
          className="cc-meta text-[11px]"
          data-testid="v3-invoice-strip-payor"
          title={`Payor · ${detail.payorEmail}`}
        >
          → <span className="font-medium">{detail.payorEmail}</span>
        </span>
      )}
      <span className="cc-pill cc-pill-muted">
        {buckets.total} walked · {buckets.included} disputable · {buckets.filtered} filtered
      </span>
      {trailingPill && (
        <span
          className={`cc-pill ${
            trailingPill.tone === "purple"
              ? ""
              : `cc-pill-${trailingPill.tone}`
          }`}
          style={trailingPill.tone === "purple" ? purpleStyle : undefined}
          data-testid={trailingPill.testid ?? "v3-invoice-strip-pill"}
        >
          {trailingPill.label}
        </span>
      )}
      {trailingExtra}
      <div
        className="cc-segmented"
        style={{ marginLeft: "auto" }}
        role="tablist"
        aria-label="Wizard phase"
        data-testid="v3-wizard-stepper"
        data-mode={offRampCurrent ? "off-ramp" : "dispute"}
      >
        {offRampCurrent
          ? offRampPhases.map((p) => {
              const isActive = p.key === offRampCurrent;
              const isUnavailable =
                p.key === "reattest" && !!offRampDisabledReattest;
              const clickable =
                !isActive && !isUnavailable && !!onOffRampChange;
              return (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-disabled={!clickable}
                  disabled={!clickable && !isActive ? true : isActive}
                  className={isActive ? "is-active" : ""}
                  data-phase={p.key}
                  data-state={
                    isActive
                      ? "active"
                      : isUnavailable
                      ? "disabled"
                      : "inactive"
                  }
                  data-testid={`v3-wizard-step-${p.key}`}
                  onClick={
                    clickable ? () => onOffRampChange!(p.key) : undefined
                  }
                  title={
                    isUnavailable
                      ? "No survivors to re-attest"
                      : clickable
                      ? `Switch to ${p.label.toLowerCase()}`
                      : undefined
                  }
                  style={
                    !isActive && !isUnavailable
                      ? { opacity: 0.78, cursor: clickable ? "pointer" : "default" }
                      : isUnavailable
                      ? { opacity: 0.5 }
                      : undefined
                  }
                >
                  {p.label}
                </button>
              );
            })
          : phases.map((p, i) => {
              const isActive = p.key === current;
              const isDone = i < currentIdx;
              return (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-disabled
                  disabled
                  className={isActive ? "is-active" : ""}
                  data-phase={p.key}
                  data-state={isActive ? "active" : isDone ? "done" : "pending"}
                  data-testid={`v3-wizard-step-${p.key}`}
                  style={isDone ? { opacity: 0.85 } : undefined}
                >
                  {isDone && (
                    <CheckCircle2 className="w-2.5 h-2.5 inline mr-1" />
                  )}
                  {p.label}
                  {isDone && " ✓"}
                </button>
              );
            })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Aggregate evidence file refs across rides for the Q5 attachments rail.
// Mirrors the bot worker's `collectGroupEvidenceUrls` selection rule:
// only legs included in the dispute contribute attachments. Filtered
// legs (non-contestable, excluded, on hold, sibling duplicates) are
// counted into `filteredCount` so the rail can surface "Leg N
// attachments excluded (filtered)" without omitting them silently.
// ─────────────────────────────────────────────────────────────────────
type LegEvidenceRow = {
  legNumber: number;
  conf: string;
  name: string;
  url: string;
  size?: number | null;
};

function collectAttachmentRows(rides: ClaimResponse[]): {
  rows: LegEvidenceRow[];
  filteredCount: number;
} {
  const rows: LegEvidenceRow[] = [];
  let filteredCount = 0;
  rides.forEach((leg, i) => {
    const inclusion = legAiInclusion(leg);
    const files = (leg.evidenceFiles ?? []) as Array<{
      url: string;
      name?: string | null;
      size?: number | null;
    }>;
    if (inclusion !== "included") {
      if (files.length > 0) filteredCount += files.length;
      return;
    }
    files.forEach((f) => {
      const fallback = f.url
        ? f.url.split("/").pop() ?? f.url
        : "(unnamed file)";
      rows.push({
        legNumber: i + 1,
        conf: leg.confNumber ?? `leg-${leg.id}`,
        name: f.name ?? fallback,
        url: f.url,
        size: f.size ?? null,
      });
    });
  });
  return { rows, filteredCount };
}

function WalkCompleteHero({
  detail,
  rides,
  onJumpToLeg,
  onOpenWalk,
}: {
  detail: DetailGroup;
  rides: ClaimResponse[];
  onJumpToLeg: (id: number) => void;
  onOpenWalk?: (id: number) => void;
}) {
  const buckets = useMemo(() => summarizeInclusion(rides), [rides]);
  // V4 Q2 — "Inputs detail" expander. Default closed (Q1 minimum-
  // density cards). Opening swaps the row to the dense variant that
  // unpacks the SOP walk, evidence chips, op-note, and L1/L2 prompt-
  // layer pill for every leg.
  const [inputsDetail, setInputsDetail] = useState(false);

  return (
    <div data-testid="v3-hero-walk-complete" className="space-y-3">
      {/* V4 unified header — invoice meta · bucket counts · stepper */}
      <WizardInvoiceHeaderStrip
        detail={detail}
        rides={rides}
        current="walk"
      />

      {/* Strip — one-line summary the operator sees first, plus the
          Q2 expander that toggles the dense per-leg unpack. */}
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-green-700" />
        <span className="font-semibold text-sm">AI inputs · what the prompt will see</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setInputsDetail((v) => !v)}
          data-testid="v3-inputs-detail-toggle"
          aria-expanded={inputsDetail}
          aria-controls="v3-inputs-cards"
          className="ml-auto h-7 px-2 text-xs"
        >
          {inputsDetail ? (
            <ChevronDown className="h-3.5 w-3.5 mr-1" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 mr-1" />
          )}
          Inputs detail
        </Button>
      </div>

      <InputsCardsRow
        rides={rides}
        onJumpToLeg={onJumpToLeg}
        onOpenWalk={onOpenWalk}
        variant={inputsDetail ? "dense" : "full"}
      />

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

      {/* Generate CTA lives in the global pinned footer (V4 Q1 parity)
          alongside the gauntlet steps + ready-to-draft pill — see the
          parent's `footerPrimary` wiring. Hero stays presentational. */}
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
      {/* V4 unified header — invoice meta · bucket counts · stepper */}
      <WizardInvoiceHeaderStrip
        detail={detail}
        rides={rides}
        current="preview"
      />

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

  // Q4 → Q5 toggle. Always start in edit-mode (Q4) so the editable
  // subject + body inputs and the Mark reviewed CTA stay visible even
  // when the operator returns to an already-reviewed draft. The
  // submit-to-portal CTA is rendered alongside Mark reviewed in the
  // edit footer when draftReviewed=true, and the operator can also
  // flip explicitly via the toggle.
  const [submitMode, setSubmitMode] = useState(false);

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

  // V4 Q5 — current operator for the "Signing as" footer line. Pulled
  // from `useAuth()` (the same hook the rest of the workspace uses for
  // presence + last-actor checks). When the session hasn't hydrated we
  // fall back to a neutral label so the strip never renders empty.
  const { user } = useAuth();
  const operatorLabel =
    (user as { displayName?: string | null; email?: string | null } | null)?.displayName?.trim() ||
    user?.email ||
    "operator";
  const attachments = useMemo(() => collectAttachmentRows(rides), [rides]);

  return (
    <div
      data-testid="v3-hero-review"
      data-submit-mode={submitMode ? "true" : "false"}
      className="space-y-3"
    >
      {/* V4 unified header — invoice meta · bucket counts · stepper.
          Q4 surfaces the dirty state inline as a purple "Note edited"
          pill so the operator never loses sight of the unsaved diff. */}
      <WizardInvoiceHeaderStrip
        detail={detail}
        rides={rides}
        current={submitMode ? "submit" : "review"}
        trailingPill={
          dirty && !submitMode
            ? { label: "Note edited · unsaved", tone: "purple", testid: "v3-strip-edited-pill" }
            : submitMode
              ? { label: "Ready to send", tone: "green" }
              : null
        }
      />

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

      {/* Body — editable in Q4, locked in Q5. The Q5 layout splits into
          a two-column grid: locked paragraph on the left, attachments
          rail aggregated from the included legs' `evidenceFiles` on
          the right. Mirrors what `collectGroupEvidenceUrls` will pack
          into the portal POST so the operator can audit the bundle. */}
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
            style={{
              display: "grid",
              gridTemplateColumns:
                attachments.rows.length > 0 || attachments.filteredCount > 0
                  ? "minmax(0, 1fr) 280px"
                  : "minmax(0, 1fr)",
              gap: "0.75rem",
              alignItems: "start",
            }}
          >
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
            {(attachments.rows.length > 0 || attachments.filteredCount > 0) && (
              <aside
                data-testid="v3-attachments-rail"
                style={{
                  border: "1px solid var(--cc-border)",
                  borderRadius: "var(--cc-radius)",
                  background: "var(--cc-card)",
                  padding: "0.75rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5" />
                  <span className="cc-meta text-[10px] uppercase tracking-wider font-semibold">
                    Attachments · in this submission
                  </span>
                </div>
                {attachments.rows.length === 0 ? (
                  <div className="cc-meta text-[11px] italic">
                    No included-leg attachments. The portal post will be
                    text-only.
                  </div>
                ) : (
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.35rem",
                    }}
                  >
                    {attachments.rows.map((row, k) => (
                      <li
                        key={`${row.legNumber}-${k}-${row.url}`}
                        data-testid={`v3-attachment-row-${row.legNumber}-${k}`}
                        className="flex items-start gap-1.5 text-[11px] leading-snug"
                      >
                        <Paperclip className="w-3 h-3 mt-0.5 flex-shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{row.name}</div>
                          <div className="cc-meta text-[10px]">
                            Leg {row.legNumber} · {row.conf}
                            {typeof row.size === "number" && row.size > 0 && (
                              <> · {Math.max(1, Math.round(row.size / 1024))} KB</>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {attachments.filteredCount > 0 && (
                  <div
                    className="cc-pill cc-pill-amber"
                    style={{ alignSelf: "flex-start", fontSize: "10px" }}
                    data-testid="v3-attachments-filtered-pill"
                  >
                    <AlertTriangle className="w-2.5 h-2.5 inline mr-1" />
                    {attachments.filteredCount} attached file
                    {attachments.filteredCount === 1 ? "" : "s"} excluded
                    (filtered legs)
                  </div>
                )}
              </aside>
            )}
          </div>
          <p className="cc-meta text-xs mt-2">
            Queueing packages this paragraph plus evidence from the {buckets.included}{" "}
            included leg{buckets.included === 1 ? "" : "s"} above and{" "}
            {isDirectEmail ? "sends the dispute email" : "submits to the MAS portal"}.
          </p>
          {/* V4 Q5 — operator attribution. The portal submission is
              actor-typed "operator", so the footer line names the
              human who authored it for the audit trail. */}
          <div
            className="cc-meta text-[11px] mt-2 flex items-center gap-1.5"
            data-testid="v3-signing-as"
          >
            <Bot className="w-3 h-3" />
            Signing as <span className="font-semibold">{operatorLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDateTime(new Date().toISOString())}</span>
          </div>
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
                data-edited={dirty ? "true" : "false"}
                style={
                  dirty
                    ? {
                        borderLeft: "3px solid var(--cc-purple-fg)",
                        background:
                          "color-mix(in srgb, var(--cc-purple-bg) 30%, var(--cc-card))",
                      }
                    : undefined
                }
              />
              {dirty && (
                <p
                  className="text-xs flex items-center gap-1"
                  style={{ color: "var(--cc-purple-fg)" }}
                  data-testid="v3-dirty-helper"
                >
                  <Edit3 className="w-3 h-3" />
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
          <>
            <Button
              onClick={onMarkReviewed}
              disabled={bodyEmpty || markReviewed.isPending || saveDraft.isPending}
              data-testid="v3-mark-reviewed"
              variant={draftReviewed ? "outline" : "default"}
            >
              {markReviewed.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              )}
              {draftReviewed ? "Re-mark reviewed" : "Mark reviewed & continue"}
            </Button>
            {draftReviewed && (
              <Button
                onClick={() => setSubmitMode(true)}
                disabled={bodyEmpty}
                data-testid="v3-submit-to-portal"
              >
                <Send className="h-3.5 w-3.5 mr-1" />
                {queueLabel}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Off-ramp inputs hero (V4 Q6 + Q7)
// Mirrors the dispute-path heroes: WizardInvoiceHeaderStrip on top
// (in single-pill mode — "Re-attest" or "Close"), the inputs cards-row
// preamble, then an inline action strip that fires the off-ramp
// mutation directly. No standalone InvoiceGroupActionSlot underneath.
//
// Q6 (reattest_only, allWalked): survivor / dropped summary, optional
// queue note, "Queue re-attest for N legs" button. Promotes verdict
// drafts then bulk-queues the group atomically — same wiring the
// existing reattest modal's queue path uses.
//
// Q7 (nothing_to_do): closure-reason <select> (cannot_dispute /
// non_issue / denied_by_payor) + "Close invoice" button that opens
// the structured closure intake via useClosureLauncher with the
// chosen reason pre-applied. If the group is already closed, render
// a passive "Closed · X" pill in place of the action.
// ─────────────────────────────────────────────────────────────────────
function OffRampInputsHero({
  detail,
  groupId,
  rides,
  outlook,
  survivors,
  dropped,
  onJumpToLeg,
}: {
  detail: DetailGroup;
  groupId: number;
  rides: ClaimResponse[];
  outlook: InvoiceDisputeOutlook;
  survivors: ClaimResponse[];
  dropped: ClaimResponse[];
  onJumpToLeg: (id: number) => void;
}) {
  const recommended: OffRampPhase =
    outlook === "reattest_only" ? "reattest" : "close";
  // Operator override of the system's recommended off-ramp. Default to
  // null so first render shows the recommended path. Switching from
  // reattest → close prompts a confirm dialog because it forfeits the
  // recommended re-attestation; reverse direction (close → reattest)
  // only appears when survivors exist, so no confirm needed there.
  const [overrideRamp, setOverrideRamp] = useState<OffRampPhase | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<OffRampPhase | null>(null);
  const activeRamp: OffRampPhase = overrideRamp ?? recommended;
  const noSurvivors = survivors.length === 0;
  const alreadyClosed =
    !!detail.outcome &&
    // vocab-allow-next-line — comparing against API enum value, not a label.
    (detail.outcome === "Withdrawn" || detail.outcome === "Non-Issue");

  function onSegmentSwitch(next: OffRampPhase) {
    if (next === activeRamp) return;
    // Destructive direction: switching FROM the recommended reattest TO
    // close means the operator is giving up on re-attesting survivors.
    if (recommended === "reattest" && next === "close" && !noSurvivors) {
      setPendingSwitch("close");
      return;
    }
    setOverrideRamp(next);
  }

  return (
    <div
      data-testid={activeRamp === "reattest" ? "v3-hero-reattest" : "v3-hero-close"}
      data-active-ramp={activeRamp}
      data-recommended-ramp={recommended}
      className="space-y-3"
    >
      <WizardInvoiceHeaderStrip
        detail={detail}
        rides={rides}
        offRampCurrent={activeRamp}
        offRampDisabledReattest={noSurvivors}
        onOffRampChange={alreadyClosed ? undefined : onSegmentSwitch}
      />
      <InputsCardsRow rides={rides} onJumpToLeg={onJumpToLeg} variant="slim" />
      {activeRamp === "reattest" ? (
        <OffRampReattestStrip
          groupId={groupId}
          survivors={survivors}
          dropped={dropped}
        />
      ) : (
        <OffRampCloseStrip
          group={detail}
          groupId={groupId}
          dropped={dropped}
        />
      )}
      <AlertDialog
        open={pendingSwitch !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSwitch(null);
        }}
      >
        <AlertDialogContent data-testid="v3-offramp-switch-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Close instead of re-attesting?</AlertDialogTitle>
            <AlertDialogDescription>
              {survivors.length} survivor leg
              {survivors.length === 1 ? "" : "s"} are eligible for
              re-attestation. Closing the invoice cancels them and they
              will not be re-submitted to MAS. This is reversible only by
              re-opening the invoice.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="v3-offramp-switch-cancel-button">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="v3-offramp-switch-confirm-button"
              onClick={() => {
                if (pendingSwitch) setOverrideRamp(pendingSwitch);
                setPendingSwitch(null);
              }}
            >
              Yes, close instead
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// V4 Q6 — inline reattest action strip.
// Replaces the launch-modal-then-pick flow for the simple "queue all
// survivors" case: one button, one optional note, fires the same
// promote-drafts + bulk-queue-reattest sequence the modal's queue
// path uses, with identical query invalidations and toast wording.
// ─────────────────────────────────────────────────────────────────────
function OffRampReattestStrip({
  groupId,
  survivors,
  dropped,
}: {
  groupId: number;
  survivors: ClaimResponse[];
  dropped: ClaimResponse[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const promoteDrafts = usePromoteVerdictDrafts();
  const bulkQueueReattest = useBulkQueueGroupReattest();
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");

  const survivorCount = survivors.length;
  const droppedCount = dropped.length;
  const busy = promoteDrafts.isPending || bulkQueueReattest.isPending;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
    });
    qc.invalidateQueries({
      queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
    });
  };

  async function onQueue() {
    try {
      await promoteDrafts.mutateAsync({ id: groupId });
      const trimmed = note.trim();
      await bulkQueueReattest.mutateAsync({
        id: groupId,
        data: trimmed ? { note: trimmed } : {},
      });
      invalidate();
      successToast({
        title: "__VERB__",
        description: `Queued ${survivorCount} leg${survivorCount === 1 ? "" : "s"} for re-attestation.`,
      });
      setNote("");
      setShowNote(false);
    } catch (e) {
      toast({
        title: "Queue re-attest failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <div
      className="rounded-md border-2 border-blue-200 bg-blue-50/50 p-3 space-y-2"
      data-testid="v3-offramp-reattest-strip"
    >
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-blue-700 flex-shrink-0" />
        <span className="text-xs text-blue-900/90 flex-1 min-w-0">
          {survivorCount} leg{survivorCount === 1 ? "" : "s"} need
          re-attestation in the portal.
          {droppedCount > 0 ? (
            <>
              {" "}
              {droppedCount} non-contestable leg
              {droppedCount === 1 ? "" : "s"} will be cancelled.
            </>
          ) : null}
        </span>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => setShowNote((v) => !v)}
          data-testid="v3-offramp-note-toggle"
          className="h-7 px-2 text-xs"
        >
          <FileText className="h-3.5 w-3.5 mr-1" />
          {showNote ? "Hide note" : "Add note"}
        </Button>
        <Button
          size="sm"
          onClick={onQueue}
          disabled={busy || survivorCount === 0}
          data-testid="v3-offramp-queue-reattest"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Send className="h-3.5 w-3.5 mr-1" />
          )}
          Queue re-attest for {survivorCount} leg
          {survivorCount === 1 ? "" : "s"}
        </Button>
      </div>
      {showNote && (
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for the queued re-attestation tasks…"
          rows={3}
          className="text-xs"
          data-testid="v3-offramp-note-input"
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// V4 Q7 — inline close-out action strip.
// Replaces the standalone "Mark as closed" card. Operator picks the
// closure reason from a 3-way <select> (cannot_dispute / non_issue /
// denied_by_payor — the keys of CLOSURE_REASON_BANNER), then clicks
// "Close invoice" to open the structured closure intake with that
// reason pre-applied. Already-closed groups render a passive pill.
// ─────────────────────────────────────────────────────────────────────
function OffRampCloseStrip({
  group,
  groupId,
  dropped,
}: {
  group: DetailGroup;
  groupId: number;
  dropped: ClaimResponse[];
}) {
  const qc = useQueryClient();
  const { open: openClosure, dialog } = useClosureLauncher();
  const [reason, setReason] = useState<ClosureReasonKey>("cannot_dispute");
  const droppedCount = dropped.length;

  const alreadyClosed =
    !!group.outcome &&
    // vocab-allow-next-line — comparing against API enum value, not a label.
    (group.outcome === "Withdrawn" || group.outcome === "Non-Issue");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
    });
    qc.invalidateQueries({
      queryKey: getGetResponsesAwaitingReviewCountQueryKey(),
    });
  };

  return (
    <div
      className="rounded-md border-2 border-amber-200 bg-amber-50/50 p-3 space-y-2"
      data-testid="v3-offramp-close-strip"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Archive className="h-4 w-4 text-amber-700 flex-shrink-0" />
        <span className="text-xs text-amber-900/90 flex-1 min-w-[12rem]">
          {droppedCount > 0 ? (
            <>
              {droppedCount} leg{droppedCount === 1 ? "" : "s"} closed as
              non-contestable / sibling-duplicate, with no survivors to
              re-attest.
            </>
          ) : (
            <>No legs remain to dispute or re-attest.</>
          )}{" "}
          Close the invoice out for the audit trail.
        </span>
        {alreadyClosed ? (
          <span
            className="cc-pill cc-pill-muted"
            data-testid="v3-offramp-already-closed"
          >
            Closed · {group.outcome}
          </span>
        ) : (
          <>
            <label className="text-xs text-amber-900/80 flex items-center gap-1.5">
              <span>Reason</span>
              <select
                value={reason}
                onChange={(e) =>
                  setReason(e.target.value as ClosureReasonKey)
                }
                className="h-7 rounded-md border border-amber-300 bg-white px-2 text-xs"
                data-testid="v3-offramp-reason-select"
              >
                {(Object.keys(CLOSURE_REASON_BANNER) as ClosureReasonKey[]).map(
                  (key) => (
                    <option key={key} value={key}>
                      {CLOSURE_REASON_BANNER[key].label}
                    </option>
                  ),
                )}
              </select>
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                openClosure({
                  target: { kind: "group", id: groupId },
                  reason,
                  onSuccess: invalidate,
                })
              }
              data-testid="v3-offramp-close-invoice"
            >
              <Archive className="h-3.5 w-3.5 mr-1" />
              Close invoice
            </Button>
          </>
        )}
      </div>
      {dialog}
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
      {/* V4 unified header — all four steps complete; Submit is the
          active terminal state, the prior three render as done ✓. */}
      <WizardInvoiceHeaderStrip
        detail={detail}
        rides={rides}
        current="submit"
        trailingPill={{ label: "Submitted", tone: "blue" }}
      />
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
