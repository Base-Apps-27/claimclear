import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoiceGroup,
  useGetClaim,
  useHoldInvoiceGroup,
  usePlaceLegOnHold,
  useRemoveInvoiceGroupHold,
  useRemoveLegHold,
  useListErrorTypes,
  useListClaimNotes,
  useCreateClaimNote,
  useDeleteNote,
  useGetInvoiceGroupEmailThread,
  useReplyToInvoiceGroupEmailConversation,
  useCreatePortalSubmission,
  useExcludeLeg,
  useMarkLegDuplicate,
  getGetClaimQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListClaimNotesQueryKey,
  getGetInvoiceGroupEmailThreadQueryKey,
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupsQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  ErrorTypeResponse,
  InvoiceGroupDetailResponse,
  EmailThreadConversation,
  EmailThreadMessage,
  NoteResponse,
} from "@workspace/api-client-react";
import type { DecisionTree } from "@/components/decision-tree/types";
import {
  buildLegResolvedIndex,
  deriveLegSubStatus,
} from "@workspace/leg-state";
import { legSubStatusLabel } from "@workspace/vocab";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  Circle,
  Copy,
  FileText,
  HelpCircle,
  Link2Off,
  Loader2,
  MessageSquare,
  Paperclip,
  PauseCircle,
  PlayCircle,
  Send,
  Sparkles,
  StickyNote,
  Tag,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefNumber } from "@/components/ref-number";
import { ServiceDateCell, type ServiceDateReason } from "@/components/service-date-cell";
import { ClassifyDialog } from "@/components/classify-dialog";
import {
  HoldReasonSelect,
  isHoldReasonValid,
} from "@/components/hold-reason-select";
import type { LegHoldReason } from "@workspace/leg-state";
import { EvidenceFileList } from "@/components/evidence-file-list";
import { ActivityFeed } from "@/components/activity-feed";
import type { ActionCategory } from "@/lib/audit-action-meta";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import { InvoiceGroupSubmissionGauntlet, type GauntletFooterState } from "@/components/invoice-group-submission-gauntlet";
import { useUrlParams } from "@/lib/use-url-params";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { HideForClerk } from "@/lib/role";
import {
  deriveInvoiceDisputeOutlook,
  derivePreviewGateState,
} from "@/lib/whats-next-derivation";
import { getGroupLifecyclePhaseFromGroup } from "@/lib/lifecycle-phase";
import {
  applyGroupMutationResult,
  applyLegMutationResult,
} from "@/lib/apply-mutation-result";
import { useToast, successToast } from "@/hooks/use-toast";
import { markLocalAction } from "@/hooks/use-local-action-mark";

// ─────────────────────────────────────────────────────────────────────
// InlineGroupWorkspaceMini — Task #565 right pane.
//
// Single-pane workspace: hero per leg, four-chip strip with inline
// panels (Evidence/Notes/Comms/Activity), a persistent group-hold
// banner, and a single pinned footer that owns the readiness pill,
// helper copy, and the only Submit CTA.
//
// Reads canonical group fields only (`group.phase`, the lifecycle
// helper). Never reads deprecated `detail.status` / `detail.outcome`
// to decide what stage we're in. The dispute/re-attest fork still
// flows through `deriveInvoiceDisputeOutlook` because that helper
// inspects the leg shape, not the group status.
// ─────────────────────────────────────────────────────────────────────

type DetailGroup = InvoiceGroupDetailResponse & {
  previewGeneratedAt?: string | null;
  draftReviewedAt?: string | null;
  holdReason?: string | null;
  // Optional bounce signal surfaced when the group's payor email has
  // a hard-bounce on record. The banner + submit gate read this; the
  // bounce-detection mechanism itself lives on the API server (see
  // `lib/bounce-detection.ts`) and is out of scope for this UI.
  payorEmailBounceState?: {
    kind: "hard_bounced";
    email: string;
    reason: string;
    bouncedAt: string;
  } | null;
};

type ChipKey = "evidence" | "notes" | "comms" | "activity";

interface Props {
  groupId: number;
}

interface PhaseConfig {
  steps: readonly string[];
  activeIndex: number;
  helper: string;
  pill: { label: string; tone: "amber" | "green" | "blue" };
}

interface PhaseInputs {
  outlook: ReturnType<typeof deriveInvoiceDisputeOutlook>["outlook"];
  legCount: number;
  resolvedCount: number;
  previewGenerated: boolean;
  draftReviewed: boolean;
  submitted: boolean;
  needsClassificationCount: number;
}

// Inlined phase-pill builder (formerly imported from
// inline-group-workspace-v3). Owned here so the V3 file can be deleted
// in the same task.
function buildMiniPhase(inputs: PhaseInputs): PhaseConfig {
  const {
    outlook,
    legCount,
    resolvedCount,
    previewGenerated,
    draftReviewed,
    submitted,
    needsClassificationCount,
  } = inputs;
  const allWalked = legCount > 0 && resolvedCount === legCount;

  if (outlook === "has_disputable") {
    const needsClassification = needsClassificationCount > 0;
    const steps = needsClassification
      ? (["Classify", "Walk legs", "Preview", "Review", "Submit"] as const)
      : (["Walk legs", "Preview", "Review", "Submit"] as const);
    const shift = needsClassification ? 1 : 0;
    let activeIndex = 0;
    if (submitted) activeIndex = 3 + shift;
    else if (draftReviewed) activeIndex = 3 + shift;
    else if (previewGenerated) activeIndex = 2 + shift;
    else if (allWalked) activeIndex = 1 + shift;
    else if (!needsClassification) activeIndex = 0;

    let helper: string;
    if (submitted) helper = "Submitted to the portal.";
    else if (draftReviewed) helper = "Draft reviewed — submit to the portal.";
    else if (previewGenerated)
      helper = "Preview generated — review the draft, then submit.";
    else if (allWalked)
      helper = "All legs walked — generate the preview, then submit to the portal.";
    else if (needsClassification)
      helper = `Pick the error type for ${needsClassificationCount} leg${needsClassificationCount === 1 ? "" : "s"} to unlock the SOP walk.`;
    else
      helper = `Walk all ${legCount} leg${legCount === 1 ? "" : "s"} to unlock Generate preview, then Submit.`;

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
      pillLabel = `${needsClassificationCount} to classify`;
      pillTone = "amber";
    } else {
      pillLabel = `${resolvedCount} of ${legCount} ready`;
      pillTone = "amber";
    }
    return { steps, activeIndex, helper, pill: { label: pillLabel, tone: pillTone } };
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

  return {
    steps: ["Close"],
    activeIndex: 0,
    helper: "Nothing left to dispute — close the invoice out as Withdrawn.",
    pill: { label: "Ready to close", tone: "amber" },
  };
}

// Submitted-or-later macro check sourced from canonical phase only.
function isPostSubmit(group: DetailGroup): boolean {
  const phase = group.phase;
  return (
    phase === "submitted" ||
    phase === "response_received" ||
    phase === "reviewed" ||
    phase === "awaiting_reattestation" ||
    phase === "closed"
  );
}

type HeroState =
  | "withdrawn"
  | "submitted"
  | "ready"
  | "review"
  | "generate"
  | "classify"
  | "sop"
  | "resolved"
  | "empty";

export function InlineGroupWorkspaceMini({ groupId }: Props) {
  const { get, set } = useUrlParams();
  const legParam = Number.parseInt(get("leg"), 10);
  const urlLegId: number | null =
    Number.isFinite(legParam) && legParam > 0 ? legParam : null;

  const [chipOpen, setChipOpen] = useState<ChipKey | null>(null);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [markDuplicateOpen, setMarkDuplicateOpen] = useState(false);
  const [walkStartedFor, setWalkStartedFor] = useState<number | null>(null);
  const [holdLegOpen, setHoldLegOpen] = useState(false);
  const [holdGroupOpen, setHoldGroupOpen] = useState(false);
  const [forceReview, setForceReview] = useState(false);
  const [gauntletFooterState, setGauntletFooterState] = useState<GauntletFooterState | null>(null);
  const [gauntletDirty, setGauntletDirty] = useState(false);
  const onFooterStateChange = useCallback((s: GauntletFooterState) => setGauntletFooterState(s), []);

  useEffect(() => {
    setForceReview(false);
    setGauntletFooterState(null);
  }, [groupId]);

  const setActiveLegId = (id: number | null) => {
    setWalkStartedFor(null);
    setChipOpen(null);
    set({ leg: id == null ? null : String(id) }, false);
  };

  const { data: group, isLoading } = useGetInvoiceGroup(groupId);

  if (isLoading || !group) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }

  const detail = group as DetailGroup;
  const rides: ClaimResponse[] = detail.rides ?? [];
  const resolvedIndex = buildLegResolvedIndex(rides);

  const explicitLeg = urlLegId
    ? rides.find((r) => r.id === urlLegId) ?? null
    : null;
  const firstUnresolved =
    rides.find(
      (r) => r.includedInDispute !== false && !resolvedIndex.isLegResolved(r),
    ) ?? null;
  const activeLeg: ClaimResponse | null =
    explicitLeg ?? firstUnresolved ?? rides[0] ?? null;

  const { outlook } = deriveInvoiceDisputeOutlook(detail, rides);

  const resolvedCount = rides.filter(
    (r) => r.includedInDispute === false || resolvedIndex.isLegResolved(r),
  ).length;
  const needsClassificationCount = rides.filter(
    (r) =>
      r.includedInDispute !== false &&
      deriveLegSubStatus(r) === "needs_classification",
  ).length;

  const previewGenerated = !!detail.previewGeneratedAt;
  const draftReviewed = !!detail.draftReviewedAt;
  // Canonical post-submit signal — `group.phase` + the lifecycle
  // helper. Never reads `detail.status` or `detail.outcome` directly.
  const submitted = isPostSubmit(detail);

  const phase = buildMiniPhase({
    outlook,
    legCount: rides.length,
    resolvedCount,
    previewGenerated,
    draftReviewed,
    submitted,
    needsClassificationCount,
  });

  const groupHoldActive =
    !submitted && getGroupLifecyclePhaseFromGroup(detail) === "on-hold";
  const legHoldActive =
    !submitted &&
    !groupHoldActive &&
    activeLeg != null &&
    activeLeg.sopOutcome !== "hold" &&
    (activeLeg.holdReason ?? null) != null;

  const allWalked = rides.length > 0 && resolvedCount === rides.length;
  // Ordered priority: terminal phases (submitted) → group-level draft
  // states (ready/review/generate) → per-leg states (sop/classify/
  // resolved). Group-level wins over per-leg so an operator who has
  // walked everything sees the "generate / review / submit" pre-flight
  // instead of a stale resolved-leg card.
  // Distinguish a closed-while-walking group from a real portal
  // submission. Both fold into the post-submit lane (no submit CTA,
  // no walk affordances), but a withdrawn group needs a banner that
  // tells the operator their walk has been short-circuited rather
  // than the misleading "Submitted to the portal" copy.
  const withdrawn = detail.phase === "closed";
  let hero: HeroState;
  if (withdrawn) hero = "withdrawn";
  else if (submitted) hero = "submitted";
  else if (previewGenerated && draftReviewed && !forceReview) hero = "ready";
  else if (previewGenerated) hero = "review";
  else if (allWalked && outlook === "has_disputable") hero = "generate";
  else if (!activeLeg) hero = "empty";
  else if (activeLeg.includedInDispute === false) hero = "resolved";
  else if (resolvedIndex.isLegResolved(activeLeg)) hero = "resolved";
  else if (deriveLegSubStatus(activeLeg) === "needs_classification") hero = "classify";
  else hero = "sop";

  return (
    <div
      className="cc-scope cc-mini space-y-3"
      data-testid="inline-group-workspace-mini"
      data-outlook={outlook}
      data-hero={hero}
      data-phase={detail.phase ?? ""}
    >
      <GroupSummaryHeader
        detail={detail}
        rides={rides}
        activeLeg={activeLeg}
        resolvedIndex={resolvedIndex}
        onSelectLeg={setActiveLegId}
      />

      {groupHoldActive && (
        <GroupHoldBanner
          detail={detail}
          onPlaceHoldEdit={() => setHoldGroupOpen(true)}
        />
      )}

      {detail.payorEmailBounceState?.kind === "hard_bounced" && (
        <PayorBounceBanner bounce={detail.payorEmailBounceState} />
      )}

      <div aria-live="polite" className="cc-mini-hero">
        {hero === "withdrawn" && <WithdrawnHero detail={detail} />}
        {hero === "submitted" && <SubmittedHero detail={detail} />}
        {hero === "ready" && (
          <ReadyHero
            detail={detail}
            rides={rides}
            resolvedIndex={resolvedIndex}
          />
        )}
        {(hero === "generate" || hero === "review") && (
          <Card>
            <CardContent className="py-5">
              <InvoiceGroupSubmissionGauntlet
                bare
                group={detail}
                groupId={groupId}
                onJumpToLeg={(id) => setActiveLegId(id)}
                onFooterStateChange={onFooterStateChange}
                onDirtyChange={setGauntletDirty}
              />
            </CardContent>
          </Card>
        )}
        {hero === "empty" && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              This invoice has no legs to walk.
            </CardContent>
          </Card>
        )}
        {hero === "resolved" && activeLeg && <ResolvedHero leg={activeLeg} />}
        {hero === "classify" && activeLeg && (
          <ClassifyHero
            leg={activeLeg}
            onOpenClassify={() => setClassifyOpen(true)}
          />
        )}
        {hero === "sop" && activeLeg && (
          <SopHero
            leg={activeLeg}
            walkStartedFor={walkStartedFor}
            onStartWalk={() => setWalkStartedFor(activeLeg.id)}
          />
        )}
      </div>

      {activeLeg && hero !== "submitted" && hero !== "withdrawn" && (
        <ChipStrip
          leg={activeLeg}
          groupId={groupId}
          openChip={chipOpen}
          onToggle={(k) => setChipOpen((cur) => (cur === k ? null : k))}
          onPlaceLegHold={() => setHoldLegOpen(true)}
          legHoldActive={legHoldActive}
        />
      )}

      <PinnedFooter
        phase={phase}
        detail={detail}
        groupId={groupId}
        rides={rides}
        onPlaceGroupHold={() => setHoldGroupOpen(true)}
        groupHoldActive={groupHoldActive}
        outlook={outlook}
        previewGenerated={previewGenerated}
        draftReviewed={draftReviewed}
        submitted={submitted}
        hero={hero}
        gauntletFooterState={gauntletFooterState}
        gauntletDirty={gauntletDirty}
        forceReview={forceReview}
        onBackToReview={() => setForceReview(true)}
        onMarkReviewedDone={() => setForceReview(false)}
      />

      {activeLeg && classifyOpen && (
        <ClassifyDialog
          open={classifyOpen}
          onOpenChange={setClassifyOpen}
          groupId={groupId}
          highlightLegId={activeLeg.id}
        />
      )}

      {activeLeg && markDuplicateOpen && (
        <MarkDuplicateDialog
          open={markDuplicateOpen}
          onOpenChange={setMarkDuplicateOpen}
          legId={activeLeg.id}
          groupId={groupId}
          rides={rides}
        />
      )}

      {activeLeg && (
        <PlaceLegHoldDialog
          open={holdLegOpen}
          onOpenChange={setHoldLegOpen}
          leg={activeLeg}
        />
      )}

      <PlaceGroupHoldDialog
        open={holdGroupOpen}
        onOpenChange={setHoldGroupOpen}
        groupId={groupId}
        existingReason={detail.holdReason ?? ""}
        groupHoldActive={groupHoldActive}
      />

      {/* Chip-panel content as a right-edge floating drawer overlay.
          Rendered LAST so it paints above everything else; uses fixed
          positioning so it never disturbs the workspace flow.
          Includes the V3 invoice + leg context cards so the operator
          gets the full leg dossier, not just the chip body. */}
      {chipOpen && activeLeg && (
        <ChipDrawerOverlay
          openChip={chipOpen}
          leg={activeLeg}
          detail={detail}
          rides={rides}
          resolvedIndex={resolvedIndex}
          groupId={groupId}
          onSelectLeg={setActiveLegId}
          onOpenClassify={() => setClassifyOpen(true)}
          onOpenMarkDuplicate={() => setMarkDuplicateOpen(true)}
          onClose={() => setChipOpen(null)}
        />
      )}
    </div>
  );
}

// ─── Group summary header ───────────────────────────────────────────
// "Full details" is now a deep link to the canonical detail page so
// the workspace stays a single right pane (no nested drawer). The
// link carries `?leg=` so the operator lands on the same leg they
// were working in here.
function GroupSummaryHeader({
  detail,
  rides,
  activeLeg,
  resolvedIndex,
  onSelectLeg,
}: {
  detail: DetailGroup;
  rides: ClaimResponse[];
  activeLeg: ClaimResponse | null;
  resolvedIndex: ReturnType<typeof buildLegResolvedIndex>;
  onSelectLeg: (id: number) => void;
}) {
  const fullHref = activeLeg
    ? `/invoice-groups/${detail.id}?leg=${activeLeg.id}`
    : `/invoice-groups/${detail.id}`;
  return (
    <div className="cc-group-header" data-testid="mini-group-header">
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <RefNumber
        value={detail.invoiceNumber}
        variant="inline"
        className="font-semibold"
      />
      <span className="cc-meta">
        {detail.rideCount} ride{detail.rideCount === 1 ? "" : "s"}
        <HideForClerk>
          {" · "}
          {formatCurrency(detail.totalAmount)}
        </HideForClerk>
      </span>
      {/* Service date inline so the operator doesn't have to drill
           into Full details just to see when the ride happened. Uses
           the same labeled-empty-state component as the list page so
           "no claims" / "couldn't read dates" never collapse to a
           bare em-dash.
           Caveat: `earliestDate` / `isUrgent` on the group payload are
           "Only populated by list endpoints" per the openapi spec, so
           we derive earliestDate from `detail.rides` here (MIN of
           serviceDate across non-excluded legs) instead of trusting
           the field on the detail payload. `serviceDateReason` IS
           populated by the detail endpoint. */}
      <span className="cc-meta inline-flex items-center text-xs" data-testid="mini-service-date">
        <ServiceDateCell
          earliestDate={
            (detail as { earliestDate?: string | null }).earliestDate ??
            ((detail.rides ?? [])
              .filter((r) => r.includedInDispute !== false && r.date)
              .map((r) => r.date as string)
              .sort()[0] ?? null)
          }
          reason={(detail as { serviceDateReason?: ServiceDateReason | null }).serviceDateReason ?? null}
          groupId={detail.id}
          isUrgent={(detail as { isUrgent?: boolean }).isUrgent}
          testIdPrefix="mini-service-date"
        />
      </span>
      {/* Single drilldown to /invoice-groups/:id — compact ↗ icon-only
          affordance, matches the V3 edge-drawer invoice-card circle.
          Carries `?leg=` so the detail page auto-selects the same leg
          the operator was working on here. */}
      <Link href={fullHref}>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Open invoice group in full view"
          title="Open invoice group in full view"
          data-testid="mini-open-details"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Button>
      </Link>
      {rides.length > 0 && (
        <div
          className="cc-segmented w-full mt-1.5"
          role="tablist"
          aria-label="Legs"
          data-testid="mini-leg-tabs"
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
                onClick={() => onSelectLeg(leg.id)}
                data-testid={`mini-leg-tab-${leg.id}`}
              >
                Leg {i + 1} {legStateIcon(leg, resolvedIndex)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
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

// ─── Group-hold banner ──────────────────────────────────────────────
function GroupHoldBanner({
  detail,
  onPlaceHoldEdit,
}: {
  detail: DetailGroup;
  onPlaceHoldEdit: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const removeMutation = useRemoveInvoiceGroupHold();
  const reason = (detail.holdReason ?? "").trim();
  function release() {
    removeMutation.mutate(
      { id: detail.id },
      {
        onSuccess: (g) => {
          applyGroupMutationResult(qc, g);
          successToast({ title: "Done", description: "Hold released" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Release failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }
  return (
    <div className="cc-mini-hold-banner" data-testid="mini-group-hold-banner">
      <PauseCircle className="w-4 h-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">This invoice is on hold</div>
        {reason && (
          <div className="cc-meta text-xs truncate" title={reason}>
            {reason}
          </div>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={onPlaceHoldEdit}
        data-testid="mini-edit-group-hold"
      >
        Edit reason
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        onClick={release}
        disabled={removeMutation.isPending}
        data-testid="mini-release-group-hold"
      >
        {removeMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          "Release hold"
        )}
      </Button>
    </div>
  );
}

// ─── Payor-bounce banner ────────────────────────────────────────────
// Surfaced when the group's payor email has a hard-bounce on record.
// The banner explains why we can't send and the PinnedFooter gates
// the Submit CTA off the same `payorEmailBounceState` field. The
// bounce-detection mechanism itself is owned by Task #50; this banner
// only consumes the signal.
function PayorBounceBanner({
  bounce,
}: {
  bounce: NonNullable<DetailGroup["payorEmailBounceState"]>;
}) {
  return (
    <div
      className="cc-mini-hold-banner"
      data-testid="mini-payor-bounce-banner"
      role="alert"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">
          Payor email has hard-bounced
        </div>
        <div
          className="cc-meta text-xs truncate"
          data-testid="mini-payor-bounce-email"
          title={bounce.email}
        >
          {bounce.email}
        </div>
        <div
          className="cc-meta text-xs truncate"
          data-testid="mini-payor-bounce-reason"
          title={bounce.reason}
        >
          {bounce.reason}
        </div>
      </div>
    </div>
  );
}

// ─── Heroes ─────────────────────────────────────────────────────────
function ClassifyHero({
  leg,
  onOpenClassify,
}: {
  leg: ClaimResponse;
  onOpenClassify: () => void;
}) {
  return (
    <Card>
      <CardContent className="py-5 space-y-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Pick the error type</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {leg.confNumber
            ? `Leg ${leg.confNumber} has no error type yet. Pick one to unlock the SOP walk.`
            : "This leg has no error type yet. Pick one to unlock the SOP walk."}
        </p>
        <div>
          <Button
            size="sm"
            onClick={onOpenClassify}
            data-testid="mini-classify-cta"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1" />
            Classify leg
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SopHero({
  leg,
  walkStartedFor,
  onStartWalk,
}: {
  leg: ClaimResponse;
  walkStartedFor: number | null;
  onStartWalk: () => void;
}) {
  const { data: claim } = useGetClaim(leg.id, {
    query: { queryKey: getGetClaimQueryKey(leg.id), enabled: !!leg.id },
  });
  const live = (claim ?? leg) as ClaimResponse;
  const { data: errorTypes } = useListErrorTypes();
  const errorType: ErrorTypeResponse | undefined = useMemo(() => {
    if (!live.errorTypeId || !errorTypes) return undefined;
    return errorTypes.find((t) => String(t.id) === String(live.errorTypeId));
  }, [live.errorTypeId, errorTypes]);
  const tree: DecisionTree | null = useMemo(() => {
    const raw = errorType?.decisionTree as DecisionTree | undefined | null;
    if (!raw || !raw.nodes || !raw.rootId) return null;
    return raw;
  }, [errorType]);

  const hasProgress = !!live.sopNodeId || live.sopOutcome != null;
  const showLanding =
    !!live.errorTypeId && !hasProgress && walkStartedFor !== live.id;

  if (showLanding) {
    return (
      <Card>
        <CardContent className="py-5 space-y-3">
          <div className="flex items-center gap-2">
            <PlayCircle className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">
              {live.errorTypeName ?? "Walk this leg"}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Step through the playbook for this leg. You can pause and come back
            anytime.
          </p>
          <div>
            <Button
              size="sm"
              onClick={onStartWalk}
              data-testid="mini-start-walk"
            >
              Start walk
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!tree || !errorType) {
    return (
      <Card>
        <CardContent className="py-5 text-sm text-muted-foreground">
          Loading playbook…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-4">
        <SopAdvancePlayer
          mode="live"
          leg={live}
          tree={tree}
          errorType={errorType}
        />
      </CardContent>
    </Card>
  );
}

function ResolvedHero({ leg }: { leg: ClaimResponse }) {
  return (
    <Card>
      <CardContent className="py-5 space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold">Leg resolved</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {leg.includedInDispute === false
            ? "Excluded from this dispute."
            : "This leg is ready. Pick another leg above, or move on to preview."}
        </p>
      </CardContent>
    </Card>
  );
}

// Generate-preview + review-draft heroes were removed — both phases
// now mount <InvoiceGroupSubmissionGauntlet bare /> directly in the
// hero slot (see hero render block) so the queue-walk operator sees
// the full readback + subject/body editor + mark-reviewed + submit
// surface inline. The previous bespoke heroes only exposed buttons
// with no editor, leaving operators with a dead end.

function ReadyHero({
  detail,
  rides,
  resolvedIndex,
}: {
  detail: DetailGroup;
  rides: ClaimResponse[];
  resolvedIndex: ReturnType<typeof buildLegResolvedIndex>;
}) {
  const isDirectEmail = detail.useDirectEmail === true;
  const destinationName = isDirectEmail
    ? (detail.payorEmail ? `Direct email (${detail.payorEmail})` : "Direct email")
    : (detail.clientNumber ? `Portal · ${detail.clientNumber}` : "Portal");

  function isLegDisputed(leg: ClaimResponse): boolean {
    if (leg.includedInDispute === false) return false;
    const sub = resolvedIndex.subStatusOf(leg);
    return sub === "ready" || sub === "dropped";
  }

  const disputedCount = rides.filter(isLegDisputed).length;
  const filteredCount = rides.length - disputedCount;

  const draftText = detail.draftDescriptionHtml ?? detail.aiBaselineDescriptionHtml ?? "";
  const draftSubject = detail.draftSubject ?? detail.aiBaselineSubject ?? "";

  const attachments = useMemo(() => {
    const result: { name: string; legIndex: number; legIncluded: boolean }[] = [];
    for (let i = 0; i < rides.length; i++) {
      const leg = rides[i];
      const included = isLegDisputed(leg);
      const files = (leg as { evidenceFiles?: { url: string; filename?: string | null }[] | null }).evidenceFiles;
      if (files) {
        for (const f of files) {
          result.push({
            name: f.filename ?? f.url.split("/").pop() ?? "file",
            legIndex: i + 1,
            legIncluded: included,
          });
        }
      }
    }
    return result;
  }, [rides, resolvedIndex]);

  const includedAttachments = attachments.filter((a) => a.legIncluded);
  const filteredLegsWithAttachments = useMemo(() => {
    const legSet = new Set<number>();
    for (const a of attachments) {
      if (!a.legIncluded) legSet.add(a.legIndex);
    }
    return Array.from(legSet).sort((a, b) => a - b);
  }, [attachments]);

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div
          className="flex items-center gap-2 flex-wrap"
          style={{
            padding: "0.5rem 0.75rem",
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: "var(--cc-radius)",
          }}
          data-testid="ready-destination-header"
        >
          <span className="mono text-[12px] font-semibold">{detail.invoiceNumber}</span>
          <span className="cc-meta text-[11px]">
            {detail.rideCount} ride{detail.rideCount === 1 ? "" : "s"} · {formatCurrency(detail.totalAmount)}
          </span>
          <span className="cc-meta text-[11px] inline-flex items-center gap-1">
            <Send className="w-3 h-3" />
            →
            <strong style={{ color: "var(--foreground)" }}>{destinationName}</strong>
            · {disputedCount} disputed / {filteredCount} filtered
          </span>
          <div className="cc-segmented ml-auto" style={{ fontSize: "10px" }}>
            <button type="button"><CheckCircle2 className="w-2.5 h-2.5 inline mr-0.5" />Walk ✓</button>
            <button type="button"><Sparkles className="w-2.5 h-2.5 inline mr-0.5" />Preview ✓</button>
            <button type="button"><FileText className="w-2.5 h-2.5 inline mr-0.5" />Review ✓</button>
            <button type="button" className="is-active"><Send className="w-2.5 h-2.5 inline mr-0.5" />Submit</button>
          </div>
        </div>

        <div
          className="rounded-md border p-3 text-xs"
          style={{ background: "hsl(var(--cc-amber-bg))", borderColor: "hsl(var(--cc-amber-border))", color: "hsl(var(--cc-amber-fg))" }}
          data-testid="ready-last-check-banner"
        >
          <strong>Last check before this leaves your desk.</strong>{" "}
          Confirm the destination, the attachments, and the final note.
          {isDirectEmail
            ? " Submit sends to the configured recipient; you can't recall a submission once it's sent."
            : " Submit posts to the MAS portal; you can't recall a submission once it's sent."}
        </div>

        <div className="flex gap-2 flex-wrap" data-testid="ready-leg-cards">
          {rides.map((leg, i) => {
            const included = isLegDisputed(leg);
            const accent = included ? "hsl(var(--cc-green-fg))" : "hsl(var(--cc-amber-fg))";
            return (
              <div
                key={leg.id}
                className="flex-1 min-w-0"
                style={{
                  background: "var(--cc-card, hsl(var(--card)))",
                  border: "1px solid var(--cc-border, hsl(var(--border)))",
                  borderTop: `3px solid ${accent}`,
                  borderRadius: "var(--cc-radius, 0.5rem)",
                  padding: "0.5rem 0.75rem",
                  opacity: included ? 1 : 0.7,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="cc-meta text-[10px] font-semibold uppercase tracking-wider">Leg {i + 1}</span>
                  <span className="mono text-[11px] font-semibold">{leg.confNumber ?? ""}</span>
                  <span className="cc-meta text-[11px] ml-auto">{formatCurrency(leg.claimAmount)}</span>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {leg.errorTypeName && <span className="cc-tag">{leg.errorTypeName}</span>}
                  {included
                    ? <span className="cc-pill cc-pill-green">In submission</span>
                    : <span className="cc-pill cc-pill-amber">Filtered out</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: "0.75rem" }}>
          <div className="flex flex-col gap-1" data-testid="ready-locked-note">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" style={{ color: "hsl(var(--cc-blue-fg, var(--primary)))" }} />
              <span className="font-semibold text-sm">Final note · locked</span>
              <span className="cc-meta text-xs ml-auto">{draftText.length} chars</span>
            </div>
            <div
              style={{
                padding: "0.75rem 0.875rem",
                background: "var(--cc-card, hsl(var(--card)))",
                border: "1px solid var(--cc-border, hsl(var(--border)))",
                borderLeft: "3px solid hsl(var(--cc-blue-fg, var(--primary)))",
                borderRadius: "var(--cc-radius, 0.5rem)",
                fontSize: "0.8125rem",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                flex: 1,
                overflow: "auto",
                maxHeight: 300,
              }}
            >
              {draftSubject && (
                <div className="text-xs font-semibold mb-1">{draftSubject}</div>
              )}
              {draftText}
            </div>
          </div>

          <div className="flex flex-col gap-1" data-testid="ready-attachments-rail">
            <div className="flex items-center gap-2">
              <Paperclip className="w-4 h-4" style={{ color: "hsl(var(--cc-blue-fg, var(--primary)))" }} />
              <span className="font-semibold text-sm">Attachments · {includedAttachments.length}</span>
            </div>
            <div
              style={{
                padding: "0.5rem 0.625rem",
                background: "var(--cc-card, hsl(var(--card)))",
                border: "1px solid var(--cc-border, hsl(var(--border)))",
                borderRadius: "var(--cc-radius, 0.5rem)",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                flex: 1,
              }}
            >
              {includedAttachments.length === 0 && (
                <span className="cc-meta text-[11px] italic">No attachments on included legs.</span>
              )}
              {includedAttachments.map((a, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <Paperclip className="w-3 h-3 shrink-0 text-muted-foreground" />
                  <span className="mono text-[11px] flex-1 min-w-0 truncate">{a.name}</span>
                  <span className="cc-pill cc-pill-muted" style={{ fontSize: "9px", padding: "0 0.3rem" }}>L{a.legIndex}</span>
                </div>
              ))}
              {filteredLegsWithAttachments.length > 0 && (
                <div className="cc-meta text-[10px] mt-auto pt-1 inline-flex items-center gap-1" style={{ color: "hsl(var(--cc-amber-fg))" }}>
                  <AlertTriangle className="w-3 h-3" />
                  Leg {filteredLegsWithAttachments.join(", ")} attachments excluded (filtered)
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WithdrawnHero({ detail }: { detail: DetailGroup }) {
  // Surfaced when the group has been closed (typically withdrawn) by
  // someone — or some external process — *while* this user was still
  // walking the claim. Submit CTA is already gone because `submitted`
  // covers `phase==="closed"`; this banner is the explicit signal
  // that there is nothing left to do here, so navigating away is the
  // only path forward. Pins Smoke #25.
  const reason = detail.closureReason ?? null;
  const reasonLabel =
    reason === "non_issue"
      ? "Non-issue"
      : reason === "cannot_dispute"
        ? "Cannot dispute"
        : reason === "denied_by_payor"
          ? "Denied by payor"
          : null;
  return (
    <Card data-testid="mini-withdrawn-banner">
      <CardContent className="py-5 space-y-2">
        <div className="flex items-center gap-2">
          <XCircle className="w-4 h-4 text-amber-600" />
          <h3 className="text-sm font-semibold">Claim withdrawn</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          This invoice has been closed
          {reasonLabel ? ` (${reasonLabel})` : ""} elsewhere. Your walk
          is no longer valid — open Full details to review, or pick a
          different claim from the queue.
        </p>
      </CardContent>
    </Card>
  );
}

function SubmittedHero({ detail }: { detail: DetailGroup }) {
  // Read-only acknowledgement — informational copy is keyed off the
  // canonical phase, not the deprecated `outcome` column.
  const lifecycle = getGroupLifecyclePhaseFromGroup(detail);
  return (
    <Card>
      <CardContent className="py-5 space-y-2">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold">Submitted to the portal</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Phase: {lifecycle}. Open Full details to follow up on portal
          responses or close the invoice out.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Chip strip + inline panels ─────────────────────────────────────
function ChipStrip({
  leg,
  groupId,
  openChip,
  onToggle,
  onPlaceLegHold,
  legHoldActive,
}: {
  leg: ClaimResponse;
  groupId: number;
  openChip: ChipKey | null;
  onToggle: (k: ChipKey) => void;
  onPlaceLegHold: () => void;
  legHoldActive: boolean;
}) {
  const evidenceFiles = leg.evidenceFiles ?? [];
  const evidenceCount = evidenceFiles.length;
  const inlineNote = (leg.evidenceNotes ?? "").trim();

  return (
    <div className="cc-mini-chips" data-testid="mini-chip-strip">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Chip
          k="evidence"
          label="Evidence"
          icon={<Paperclip className="w-3 h-3" />}
          count={evidenceCount}
          openChip={openChip}
          onToggle={onToggle}
        />
        <Chip
          k="notes"
          label="Notes"
          icon={<StickyNote className="w-3 h-3" />}
          openChip={openChip}
          onToggle={onToggle}
        />
        <Chip
          k="comms"
          label="Comms"
          icon={<MessageSquare className="w-3 h-3" />}
          openChip={openChip}
          onToggle={onToggle}
        />
        <Chip
          k="activity"
          label="Activity"
          icon={<Activity className="w-3 h-3" />}
          openChip={openChip}
          onToggle={onToggle}
        />
        <div className="ml-auto flex items-center gap-1.5">
          {!legHoldActive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={onPlaceLegHold}
              data-testid="mini-place-leg-hold"
            >
              <PauseCircle className="w-3 h-3 mr-1" />
              Hold leg
            </Button>
          )}
          {legHoldActive && <ReleaseLegHoldButton legId={leg.id} />}
        </div>
      </div>

      {/* The chip-PANEL body used to expand inline here. It now renders
          as a floating right-edge overlay (`<ChipDrawerOverlay>` mounted
          from `InlineGroupWorkspaceMini`) so the existing hero / footer
          layout never shifts when an operator opens a chip. */}
    </div>
  );
}

// Right-edge floating drawer for the chip-panel content. Rendered as
// an additive overlay layer (position: fixed) on top of the queue —
// it does NOT participate in the workspace's flex/grid flow, so the
// hero, footer, banners, and GroupSummaryHeader stay anchored exactly
// where they already were. Closes via the chip toggle (the chip
// button stays the source of truth), Esc, or backdrop click.
const CHIP_LABEL: Record<ChipKey, string> = {
  evidence: "Evidence",
  notes: "Notes",
  comms: "Comms",
  activity: "Activity",
};

const CHIP_ICON: Record<ChipKey, React.FC<{ className?: string }>> = {
  evidence: Paperclip,
  notes: StickyNote,
  comms: MessageSquare,
  activity: Activity,
};


function ChipDrawerOverlay({
  openChip,
  leg,
  detail,
  rides,
  resolvedIndex,
  groupId,
  onSelectLeg,
  onOpenClassify,
  onOpenMarkDuplicate,
  onClose,
}: {
  openChip: ChipKey;
  leg: ClaimResponse;
  detail: DetailGroup;
  rides: ClaimResponse[];
  resolvedIndex: ReturnType<typeof buildLegResolvedIndex>;
  groupId: number;
  onSelectLeg: (id: number) => void;
  onOpenClassify: () => void;
  onOpenMarkDuplicate: () => void;
  onClose: () => void;
}) {
  const evidenceFiles = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ url: string; size?: number | null }> = [];
    for (const f of [...(detail.evidenceFiles ?? []), ...(leg.evidenceFiles ?? [])]) {
      const ref = f as { url?: string; size?: number } | null | undefined;
      const url = ref?.url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, size: ref?.size ?? null });
    }
    return out;
  }, [detail.evidenceFiles, leg.evidenceFiles]);
  const evidenceUrls = useMemo(() => evidenceFiles.map((f) => f.url), [evidenceFiles]);
  const evidenceSizeMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of evidenceFiles) {
      if (f.size != null && f.size > 0) m.set(f.url, f.size);
    }
    return m;
  }, [evidenceFiles]);
  const inlineNote = (leg.evidenceNotes ?? "").trim();
  const fullHref = `/invoice-groups/${detail.id}?leg=${leg.id}`;
  const activeLegIndex = rides.findIndex((r) => r.id === leg.id);

  const legSubStatus = deriveLegSubStatus(leg);
  const legStatusLabel = legSubStatusLabel(legSubStatus);

  const qc = useQueryClient();
  const { toast } = useToast();
  const excludeMutation = useExcludeLeg();

  function onExclude() {
    excludeMutation.mutate(
      { id: leg.id, data: { reason: "other" as const, note: "Excluded via drawer" } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
          qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
          successToast({ title: "Done", description: "Leg excluded from dispute." });
        },
        onError: (e: unknown) =>
          toast({ title: "Exclude failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
      },
    );
  }

  // Esc-to-close. Backdrop click is wired below.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Subtle backdrop — click anywhere outside the drawer to close.
          Translucent (not solid) so the queue underneath stays
          legible; the drawer is a contextual layer, not a modal. */}
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onClick={onClose}
        data-testid="chip-drawer-backdrop"
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label={`${CHIP_LABEL[openChip]} — quick view`}
        data-testid={`chip-drawer-${openChip}`}
        className="cc-scope cc-mini fixed right-3 top-1/2 z-50 -translate-y-1/2 w-[360px] max-w-[calc(100vw-1.5rem)] max-h-[85vh] flex flex-col gap-2 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Card 1 — invoice context (smallest, top) ─────────────── */}
        <div className="rounded-xl border bg-card shadow-2xl p-2.5 flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Link href={fullHref}>
              <a
                aria-label="Open invoice group in full view"
                title="Open invoice group in full view"
                className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-50 text-blue-600 border border-blue-200 shrink-0 hover:bg-blue-100"
                data-testid="chip-drawer-open-invoice"
              >
                <ArrowUpRight className="w-3 h-3" />
              </a>
            </Link>
            <RefNumber
              value={detail.invoiceNumber}
              variant="inline"
              className="text-xs font-semibold flex-1 min-w-0 truncate"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={onClose}
              aria-label="Close drawer"
              title="Close"
              data-testid="chip-drawer-close"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-wrap">
            {(detail as DetailGroup & { payorEmail?: string }).payorEmail && (
              <>
                <span className="text-[11px]">{(detail as DetailGroup & { payorEmail?: string }).payorEmail}</span>
                <span>·</span>
              </>
            )}
            <HideForClerk>
              <span className="font-semibold text-foreground text-xs">
                {formatCurrency(detail.totalAmount)}
              </span>
              <span>·</span>
            </HideForClerk>
            <span>
              {detail.rideCount} leg{detail.rideCount === 1 ? "" : "s"}
            </span>
          </div>
          {rides.length > 0 && (
            <div
              className="cc-segmented w-full"
              role="tablist"
              aria-label="Legs"
              data-testid="chip-drawer-leg-tabs"
            >
              {rides.map((r, i) => {
                const isActive = r.id === leg.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={isActive ? "is-active" : ""}
                    onClick={() => onSelectLeg(r.id)}
                    data-testid={`chip-drawer-leg-tab-${r.id}`}
                  >
                    Leg {i + 1} {legStateIcon(r, resolvedIndex)}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Card 2 — leg context (CLM, classification, $, status, actions) */}
        <div className="rounded-xl border bg-card shadow-2xl p-2.5 flex flex-col gap-1.5 shrink-0">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-[15px] font-bold tracking-tight flex-1 min-w-0 truncate leading-tight">
              {leg.confNumber ?? `Leg ${activeLegIndex + 1}`}
            </span>
            {rides.length > 0 && (
              <span className="text-[11px] text-muted-foreground shrink-0">
                Leg {activeLegIndex + 1} of {rides.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
            {leg.errorTypeName ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5">
                <AlertTriangle className="w-3 h-3" />
                {leg.errorTypeName}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border px-2 py-0.5">
                <HelpCircle className="w-3 h-3" />
                Unclassified
              </span>
            )}
            {leg.date && (
              <span className="text-muted-foreground">{leg.date}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
            <HideForClerk>
              <span className="text-[13px] font-semibold">
                {formatCurrency(leg.claimAmount ?? "0")}
              </span>
            </HideForClerk>
            <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-[11px] ml-auto">
              {legStatusLabel}
            </span>
          </div>
          {leg.includedInDispute === false && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border px-2 py-0.5">
                <XCircle className="w-3 h-3" /> Excluded
              </span>
            </div>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                onOpenClassify();
                onClose();
              }}
              data-testid="chip-drawer-reclassify"
            >
              <Tag className="w-3 h-3 mr-1" />
              {leg.errorTypeName ? "Reclassify" : "Classify"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                onOpenMarkDuplicate();
                onClose();
              }}
              disabled={!!leg.duplicateOfClaimId}
              data-testid="chip-drawer-mark-duplicate"
            >
              <Copy className="w-3 h-3 mr-1" />
              Mark duplicate
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onExclude}
              disabled={excludeMutation.isPending || leg.includedInDispute === false}
              data-testid="chip-drawer-exclude"
            >
              <Link2Off className="w-3 h-3 mr-1" />
              Exclude
            </Button>
          </div>
        </div>

        {/* ── Card 3 — section (chip-driven body) ──────────────────── */}
        <div className="rounded-xl border bg-card shadow-2xl flex flex-col flex-1 min-h-0 overflow-hidden">
          <header className="flex items-center gap-2 border-b px-3 py-1.5 shrink-0">
            {(() => { const Icon = CHIP_ICON[openChip]; return <Icon className="w-3.5 h-3.5 text-foreground" />; })()}
            <span className="text-xs font-semibold">{CHIP_LABEL[openChip]}</span>
            {(() => {
              let count = 0;
              if (openChip === "evidence") count = evidenceUrls.length;
              else if (openChip === "notes") count = (detail.notes ?? []).length + (inlineNote ? 1 : 0);
              else if (openChip === "activity") count = (detail.auditLogs ?? []).length;
              return count > 0 ? (
                <span className="inline-flex items-center justify-center rounded bg-blue-50 text-blue-700 text-[10px] font-semibold px-1.5 py-0.5 leading-none">
                  {count}
                </span>
              ) : null;
            })()}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 ml-auto shrink-0"
              onClick={onClose}
              aria-label="Close section"
              data-testid="chip-drawer-section-close"
            >
              <X className="h-3 w-3" />
            </Button>
          </header>
          <div className="overflow-auto p-3 flex-1 min-h-0">
            {openChip === "evidence" && <EvidenceFileList urls={evidenceUrls} sizeMap={evidenceSizeMap} />}
            {openChip === "notes" && (
              <NotesPanel leg={leg} inlineNote={inlineNote} />
            )}
            {openChip === "comms" && <CommsPanel groupId={groupId} />}
            {openChip === "activity" && (
              <ActivityPanel detail={detail} groupId={groupId} legId={leg.id} />
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function Chip({
  k,
  label,
  icon,
  count,
  openChip,
  onToggle,
}: {
  k: ChipKey;
  label: string;
  icon: React.ReactNode;
  count?: number;
  openChip: ChipKey | null;
  onToggle: (k: ChipKey) => void;
}) {
  const open = openChip === k;
  return (
    <button
      type="button"
      className={`cc-mini-chip ${open ? "is-active" : ""}`}
      onClick={() => onToggle(k)}
      data-testid={`mini-chip-${k}`}
      aria-expanded={open}
    >
      {icon}
      <span>{label}</span>
      {count != null && count > 0 && (
        <span className="cc-mini-chip-count">{count}</span>
      )}
    </button>
  );
}

// Notes — real list + create + delete via the leg-scoped notes
// endpoint. Inline `evidenceNotes` is shown read-only above the
// thread because that field is edited from the leg detail editor and
// there's no dedicated mini composer for it.
function NotesPanel({
  leg,
  inlineNote,
}: {
  leg: ClaimResponse;
  inlineNote: string;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: notes, isLoading } = useListClaimNotes(leg.id);
  const create = useCreateClaimNote();
  const remove = useDeleteNote();
  const [draft, setDraft] = useState("");

  function refreshNotes() {
    qc.invalidateQueries({ queryKey: getListClaimNotesQueryKey(leg.id) });
  }

  function submit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    create.mutate(
      { id: leg.id, data: { content: trimmed } },
      {
        onSuccess: () => {
          setDraft("");
          refreshNotes();
          successToast({ title: "Done", description: "Note added" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Add note failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  function del(noteId: number) {
    remove.mutate(
      { id: noteId },
      {
        onSuccess: () => {
          refreshNotes();
          successToast({ title: "Done", description: "Note deleted" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Delete failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <div className="text-xs space-y-2" data-testid="mini-notes-panel">
      {inlineNote && (
        <div className="rounded border bg-muted/40 p-2 whitespace-pre-wrap">
          <div className="font-medium text-muted-foreground mb-0.5">
            Evidence note
          </div>
          {inlineNote}
        </div>
      )}
      {isLoading ? (
        <div className="text-muted-foreground">Loading notes…</div>
      ) : (notes ?? []).length === 0 ? (
        <div className="text-muted-foreground">No notes yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {(notes ?? []).map((n: NoteResponse) => (
            <li
              key={n.id}
              className="rounded border p-2 flex items-start gap-2"
              data-testid={`mini-note-${n.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="whitespace-pre-wrap">{n.content}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {n.author ?? "—"}
                  {n.createdAt ? ` · ${new Date(n.createdAt).toLocaleString()}` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5"
                onClick={() => del(n.id)}
                disabled={remove.isPending}
                aria-label="Delete note"
                data-testid={`mini-note-delete-${n.id}`}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1.5">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note for the team…"
          rows={2}
          data-testid="mini-note-composer"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={submit}
            disabled={!draft.trim() || create.isPending}
            data-testid="mini-note-submit"
          >
            {create.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : null}
            Add note
          </Button>
        </div>
      </div>
    </div>
  );
}

// Comms — real group-level email thread + inline reply on the most
// recent conversation. Replies are routed through the conversation's
// outlook id; full reply composer with attachments stays on the
// detail page.
function CommsPanel({ groupId }: { groupId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: thread, isLoading } = useGetInvoiceGroupEmailThread(groupId);
  const reply = useReplyToInvoiceGroupEmailConversation();
  const [body, setBody] = useState("");

  const conversations: EmailThreadConversation[] = useMemo(() => {
    return thread?.conversations ?? [];
  }, [thread]);
  const latest: EmailThreadConversation | undefined = conversations[0];

  function send() {
    if (!latest) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    reply.mutate(
      {
        id: groupId,
        conversationId: latest.conversationId,
        data: {
          subject: latest.latestSubject ?? "Re: invoice dispute",
          bodyText: trimmed,
          to: latest.latestInboundSender ? [latest.latestInboundSender] : [],
        },
      },
      {
        onSuccess: () => {
          setBody("");
          qc.invalidateQueries({
            queryKey: getGetInvoiceGroupEmailThreadQueryKey(groupId),
          });
          successToast({ title: "Done", description: "Reply sent" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Send failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <div className="text-xs space-y-2" data-testid="mini-comms-panel">
      {isLoading ? (
        <div className="text-muted-foreground">Loading messages…</div>
      ) : conversations.length === 0 ? (
        <div className="text-muted-foreground">No payor messages yet.</div>
      ) : (
        <div className="space-y-1.5">
          <div className="font-medium text-muted-foreground">
            Latest conversation
          </div>
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {(latest?.messages ?? []).slice(-4).map((m: EmailThreadMessage) => (
              <li
                key={m.id}
                className="rounded border p-2"
                data-testid={`mini-comms-msg-${m.id}`}
              >
                <div className="text-[10px] text-muted-foreground">
                  {m.direction === "outbound" ? "→ " : "← "}
                  {m.sender}
                  {m.timestamp ? ` · ${new Date(m.timestamp).toLocaleString()}` : ""}
                </div>
                {m.subject && (
                  <div className="font-medium truncate">{m.subject}</div>
                )}
                <div className="whitespace-pre-wrap line-clamp-3">
                  {m.bodyPreview ?? ""}
                </div>
              </li>
            ))}
          </ul>
          {latest && (
            <div className="space-y-1.5">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Reply to the latest message…"
                rows={2}
                data-testid="mini-comms-composer"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={send}
                  disabled={!body.trim() || reply.isPending}
                  data-testid="mini-comms-send"
                >
                  {reply.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : null}
                  Send reply
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Activity — real audit + notes feed pulled from the group detail
// payload (`detail.auditLogs` + `detail.notes`), rendered with the
// shared `<ActivityFeed>` so the wording, filter chips, and grouping
// match the canonical detail page exactly. Group-scoped audit rows
// already include leg events propagated up via `viaGroup`, so the
// operator sees both invoice-level and leg-level actions in one
// timeline. The drilldown link to /invoice-groups/:id stays as a
// secondary "see everything" affordance.
function ActivityPanel({
  detail,
  groupId,
  legId,
}: {
  detail: DetailGroup;
  groupId: number;
  legId: number;
}) {
  const [filter, setFilter] = useState<ActionCategory | "all">("all");
  const auditLogs = (detail.auditLogs ?? []) as React.ComponentProps<typeof ActivityFeed>["auditLogs"];
  const notes = (detail.notes ?? []) as React.ComponentProps<typeof ActivityFeed>["notes"];
  return (
    <div className="text-xs space-y-2" data-testid="mini-activity-panel">
      <ActivityFeed
        auditLogs={auditLogs}
        notes={notes}
        kind="group"
        filter={filter}
        onFilterChange={setFilter}
        title="Activity"
        // Neutralize the Card chrome — the drawer's section card
        // already provides border/shadow, so a nested Card would
        // double-up the visual weight.
        className="border-0 shadow-none bg-transparent"
        maxHeightClass="max-h-[40vh]"
        testId="drawer-activity-feed"
      />
      <div className="flex justify-end pt-1 border-t">
        <Link
          href={`/invoice-groups/${groupId}?leg=${legId}#activity`}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          aria-label="Open invoice group activity in full view"
          title="Open invoice group activity in full view"
        >
          Open full activity view <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}

function ReleaseLegHoldButton({ legId }: { legId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mutation = useRemoveLegHold();
  function release() {
    mutation.mutate(
      { id: legId },
      {
        onSuccess: (leg) => {
          applyLegMutationResult(qc, leg);
          markLocalAction(`claim:${legId}`);
          successToast({ title: "Done", description: "Leg hold released" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Release failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={release}
      disabled={mutation.isPending}
      data-testid="mini-release-leg-hold"
    >
      {mutation.isPending ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <>
          <PauseCircle className="w-3 h-3 mr-1" />
          Release leg hold
        </>
      )}
    </Button>
  );
}

function MarkDuplicateDialog({
  open,
  onOpenChange,
  legId,
  groupId,
  rides,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  legId: number;
  groupId: number;
  rides: ClaimResponse[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mutation = useMarkLegDuplicate();
  const [primaryId, setPrimaryId] = useState("");
  const [note, setNote] = useState("");

  const siblings = rides.filter((r) => r.id !== legId);

  function submit() {
    const id = Number(primaryId);
    if (!Number.isFinite(id) || id <= 0) return;
    mutation.mutate(
      { id: legId, data: { primaryClaimId: id, note: note || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
          qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
          successToast({ title: "Done", description: "Leg marked as duplicate." });
          onOpenChange(false);
          setPrimaryId("");
          setNote("");
        },
        onError: (e: unknown) =>
          toast({ title: "Mark duplicate failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Mark as sibling duplicate</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <div>
            <label className="font-medium block mb-1">Primary leg (original)</label>
            {siblings.length > 0 ? (
              <select
                className="w-full border rounded px-2 py-1.5 text-xs bg-background"
                value={primaryId}
                onChange={(e) => setPrimaryId(e.target.value)}
              >
                <option value="">Select a leg…</option>
                {siblings.map((s, i) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.confNumber ?? `Leg ${i + 1}`} (#{s.id})
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-muted-foreground">No sibling legs available.</div>
            )}
          </div>
          <div>
            <label className="font-medium block mb-1">Note (optional)</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why is this a duplicate?"
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={!primaryId || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
            Mark duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PinnedFooter({
  phase,
  detail,
  groupId,
  rides,
  onPlaceGroupHold,
  groupHoldActive,
  outlook,
  previewGenerated,
  draftReviewed,
  submitted,
  hero,
  gauntletFooterState,
  gauntletDirty,
  forceReview,
  onBackToReview,
  onMarkReviewedDone,
}: {
  phase: PhaseConfig;
  detail: DetailGroup;
  groupId: number;
  rides: ClaimResponse[];
  onPlaceGroupHold: () => void;
  groupHoldActive: boolean;
  outlook: ReturnType<typeof deriveInvoiceDisputeOutlook>["outlook"];
  previewGenerated: boolean;
  draftReviewed: boolean;
  submitted: boolean;
  hero: HeroState;
  gauntletFooterState: GauntletFooterState | null;
  gauntletDirty: boolean;
  forceReview: boolean;
  onBackToReview: () => void;
  onMarkReviewedDone: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const submit = useCreatePortalSubmission();
  const gate = derivePreviewGateState(detail, rides);
  const [serviceTokenExpired, setServiceTokenExpired] = useState(false);

  const stepReady = previewGenerated && draftReviewed;
  const payorBounced =
    detail.payorEmailBounceState?.kind === "hard_bounced";
  const enabled =
    !submitted &&
    !groupHoldActive &&
    !payorBounced &&
    outlook === "has_disputable" &&
    gate.ok &&
    stepReady;

  let disabledReason: string | null = null;
  if (submitted) disabledReason = "Already submitted.";
  else if (groupHoldActive) disabledReason = "Release the hold first.";
  else if (payorBounced)
    disabledReason = `Payor email ${detail.payorEmailBounceState?.email ?? ""} has hard-bounced — won't send.`;
  else if (outlook !== "has_disputable")
    disabledReason = "Nothing to dispute on this invoice.";
  else if (!gate.ok) disabledReason = gate.reason;
  else if (!previewGenerated)
    disabledReason = "Generate the preview first.";
  else if (!draftReviewed) disabledReason = "Mark the draft reviewed first.";

  function onSubmit() {
    setServiceTokenExpired(false);
    submit.mutate(
      { data: { invoiceGroupId: groupId } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
          qc.invalidateQueries({
            queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
          });
          qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
          successToast({ title: "Done", description: "Submitted to the portal" });
        },
        onError: (e: unknown) => {
          const code =
            e instanceof ApiError && e.data && typeof e.data === "object"
              ? (e.data as { code?: unknown }).code
              : undefined;
          if (e instanceof ApiError && e.status === 401 && code === "token_expired") {
            setServiceTokenExpired(true);
            return;
          }
          toast({
            title: "Submit failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
        },
      },
    );
  }

  const showReviewFooter =
    hero === "review" && outlook === "has_disputable" && !submitted;
  const showReadyFooter =
    hero === "ready" && outlook === "has_disputable" && !submitted;
  const showDefaultFooter = !showReviewFooter && !showReadyFooter;

  const gState = gauntletFooterState;

  const markReviewedEnabled =
    gState != null &&
    !gState.draftBodyEmpty &&
    !gState.markReviewedPending &&
    !gState.saveDraftPending &&
    !gState.draftReviewed;

  let markReviewedTooltip: string | null = null;
  if (gState?.draftBodyEmpty) markReviewedTooltip = "Generate or regenerate the draft first.";
  else if (gState?.saveDraftPending) markReviewedTooltip = "Saving…";
  else if (gState?.draftReviewed) markReviewedTooltip = "Already reviewed.";

  function handleMarkReviewed() {
    gState?.onMarkReviewed();
    onMarkReviewedDone();
  }

  return (
    <div className="space-y-2">
      {showReviewFooter && (
        <div className="cc-footer-card cc-footer-pinned" data-testid="mini-pinned-footer" style={{ padding: "0.5rem 0.875rem" }}>
          {gauntletDirty ? (
            <span className="cc-pill cc-pill-amber" data-testid="mini-review-status-pill">Unsaved edits</span>
          ) : (
            <span className="cc-pill cc-pill-green" data-testid="mini-review-status-pill">Note ready</span>
          )}
          <span className="cc-meta text-xs flex-1 min-w-0">
            Edits stay on this draft only — they do not change the prompt or the underlying inputs.
          </span>
          <div className="cc-gauntlet-row" style={{ margin: 0 }}>
            <span className="cc-gauntlet-step cc-gauntlet-done"><CheckCircle2 className="w-3 h-3" /> Walk</span>
            <span className="cc-gauntlet-step cc-gauntlet-done"><CheckCircle2 className="w-3 h-3" /> Generate</span>
            <span className="cc-gauntlet-step cc-gauntlet-active">Review &amp; edit</span>
            <span className="cc-gauntlet-step"><Send className="w-3 h-3" /> Submit</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={!gauntletDirty}
            onClick={() => gState?.discardEdits()}
            data-testid="mini-discard-edits"
          >
            Discard edits
          </Button>
          {forceReview && gState?.draftReviewed ? (
            <Button
              size="sm"
              onClick={onMarkReviewedDone}
              data-testid="mini-return-to-submit"
            >
              <Send className="w-3 h-3 mr-1" />
              Return to submit
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleMarkReviewed}
              disabled={!markReviewedEnabled}
              data-testid="mini-mark-reviewed"
            >
              {gState?.markReviewedPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <Send className="w-3 h-3 mr-1" />
              )}
              Mark reviewed
            </Button>
          )}
          {!groupHoldActive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={onPlaceGroupHold}
              data-testid="mini-place-group-hold"
            >
              <PauseCircle className="w-3 h-3 mr-1" />
              Hold invoice
            </Button>
          )}
          {!forceReview && !markReviewedEnabled && markReviewedTooltip && (
            <p className="text-[11px] text-muted-foreground w-full" data-testid="mini-mark-reviewed-reason">
              {markReviewedTooltip}
            </p>
          )}
        </div>
      )}

      {showReadyFooter && (
        <div className="cc-footer-card cc-footer-pinned" data-testid="mini-pinned-footer" style={{ padding: "0.5rem 0.875rem" }}>
          <span className="cc-pill cc-pill-green" data-testid="mini-ready-pill">Ready to send</span>
          <span className="cc-meta text-[11px] inline-flex items-center gap-1 ml-auto">
            <Sparkles className="w-3 h-3" />
            {detail.draftReviewedBy && (
              <strong style={{ color: "var(--foreground)" }}>{detail.draftReviewedBy}</strong>
            )}
            {detail.draftReviewedAt && (
              <span>{detail.draftReviewedBy ? "· " : ""}{formatDateTime(detail.draftReviewedAt)}</span>
            )}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onBackToReview}
            data-testid="mini-back-to-review"
          >
            Back to review
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={!enabled || submit.isPending}
            data-testid="mini-submit-cta"
          >
            {submit.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <Send className="w-3 h-3 mr-1" />
            )}
            Queue for Portal
          </Button>
          {!groupHoldActive && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={onPlaceGroupHold}
              data-testid="mini-place-group-hold"
            >
              <PauseCircle className="w-3 h-3 mr-1" />
              Hold invoice
            </Button>
          )}
          {!enabled && disabledReason && (
            <p className="text-[11px] text-muted-foreground w-full" data-testid="mini-submit-disabled-reason">
              {disabledReason}
            </p>
          )}
          {serviceTokenExpired && (
            <div
              className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 flex items-center justify-between gap-2 w-full"
              data-testid="mini-reauth-banner"
              role="alert"
            >
              <span>
                Submit failed because the portal service token expired.
                Re-authenticate to refresh it, then submit again.
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                data-testid="mini-reauth-cta"
                onClick={() => {
                  window.location.href = "/api/login?returnTo=" +
                    encodeURIComponent(window.location.pathname + window.location.search);
                }}
              >
                Re-authenticate
              </Button>
            </div>
          )}
        </div>
      )}

      {showDefaultFooter && (
        <div className="space-y-2">
          <div className="cc-footer-card cc-footer-pinned" data-testid="mini-pinned-footer">
            <span
              className={`cc-pill cc-pill-${phase.pill.tone}`}
              data-testid="mini-phase-pill"
            >
              {phase.pill.label}
            </span>
            <span className="cc-meta text-xs flex-1 min-w-0">{phase.helper}</span>
            {!groupHoldActive && outlook !== "nothing_to_do" && !submitted && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={onPlaceGroupHold}
                data-testid="mini-place-group-hold"
              >
                <PauseCircle className="w-3 h-3 mr-1" />
                Hold invoice
              </Button>
            )}
          </div>
          {outlook === "has_disputable" && !submitted && (
            <div className="flex flex-col gap-1.5">
              <Button
                size="sm"
                onClick={onSubmit}
                disabled={!enabled || submit.isPending}
                data-testid="mini-submit-cta"
              >
                {submit.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <Send className="w-3 h-3 mr-1" />
                )}
                Submit to portal
              </Button>
              {!enabled && disabledReason && (
                <p
                  className="text-[11px] text-muted-foreground"
                  data-testid="mini-submit-disabled-reason"
                >
                  {disabledReason}
                </p>
              )}
              {serviceTokenExpired && (
                <div
                  className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 flex items-center justify-between gap-2"
                  data-testid="mini-reauth-banner"
                  role="alert"
                >
                  <span>
                    Submit failed because the portal service token expired.
                    Re-authenticate to refresh it, then submit again.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    data-testid="mini-reauth-cta"
                    onClick={() => {
                      window.location.href = "/api/login?returnTo=" +
                        encodeURIComponent(window.location.pathname + window.location.search);
                    }}
                  >
                    Re-authenticate
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Hold dialogs ───────────────────────────────────────────────────
function PlaceLegHoldDialog({
  open,
  onOpenChange,
  leg,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leg: ClaimResponse;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mutation = usePlaceLegOnHold();
  // Server requires `reason` to be one of the canonical
  // `LEG_HOLD_REASONS` enum values. Free-text "reason" used to fall
  // through to the server and 400 with "reason must be one of …" —
  // route it through `HoldReasonSelect` so we send the enum slug and
  // route the free-text into the optional `note` field.
  const [reason, setReason] = useState<LegHoldReason | "">("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) {
      setReason("");
      setNote("");
    }
  }, [open]);
  const valid = isHoldReasonValid(reason, note);
  function submit() {
    if (!valid || !reason) return;
    mutation.mutate(
      {
        id: leg.id,
        data: { reason, note: note.trim() ? note.trim() : null },
      },
      {
        onSuccess: (updated) => {
          applyLegMutationResult(qc, updated);
          markLocalAction(`claim:${leg.id}`);
          successToast({ title: "Done", description: "Leg placed on hold" });
          onOpenChange(false);
        },
        onError: (e: unknown) =>
          toast({
            title: "Hold failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Place leg on hold</DialogTitle>
        </DialogHeader>
        <HoldReasonSelect
          reason={reason}
          note={note}
          onReasonChange={setReason}
          onNoteChange={setNote}
          disabled={mutation.isPending}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || mutation.isPending}
            data-testid="mini-leg-hold-submit"
          >
            {mutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : null}
            Place on hold
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlaceGroupHoldDialog({
  open,
  onOpenChange,
  groupId,
  existingReason,
  groupHoldActive,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupId: number;
  existingReason: string;
  groupHoldActive: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mutation = useHoldInvoiceGroup();
  const [reason, setReason] = useState(existingReason);
  useEffect(() => {
    if (open) setReason(existingReason);
  }, [open, existingReason]);
  function submit() {
    const trimmed = reason.trim();
    if (!trimmed) return;
    mutation.mutate(
      { id: groupId, data: { reason: trimmed } },
      {
        onSuccess: (g) => {
          applyGroupMutationResult(qc, g);
          qc.invalidateQueries({
            queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
          });
          successToast({
            title: "Done",
            description: groupHoldActive
              ? "Hold reason updated"
              : "Invoice placed on hold",
          });
          onOpenChange(false);
        },
        onError: (e: unknown) =>
          toast({
            title: "Hold failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {groupHoldActive ? "Edit hold reason" : "Place invoice on hold"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs font-medium">Reason</label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you holding this invoice?"
            rows={4}
            data-testid="mini-group-hold-reason"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!reason.trim() || mutation.isPending}
            data-testid="mini-group-hold-submit"
          >
            {mutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : null}
            {groupHoldActive ? "Save reason" : "Place on hold"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
