import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoiceGroup,
  useGetClaim,
  useHoldInvoiceGroup,
  usePlaceLegOnHold,
  useRemoveInvoiceGroupHold,
  useRemoveLegHold,
  useListErrorTypes,
  useCreatePortalSubmission,
  useClearLegVerdictDraft,
  useSopRestartLeg,
  useExcludeLeg,
  getGetClaimQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupsQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import { AdminStatusOverride } from "@/components/admin-status-override";
import type {
  ClaimResponse,
  ErrorTypeResponse,
  LintResult,
} from "@workspace/api-client-react";
import { LintGateDialog, type LintGateMode } from "@/components/lint-gate-dialog";
import type { DecisionTree } from "@/components/decision-tree/types";
import {
  buildLegResolvedIndex,
  deriveLegSubStatus,
} from "@workspace/leg-state";
import { siblingPromptEligibilityFor } from "@/lib/sop-sibling-eligibility";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  Edit2,
  FileText,
  HelpCircle,
  Link2Off,
  Loader2,
  MessageSquare,
  Paperclip,
  PauseCircle,
  Play,
  PlayCircle,
  Send,
  Sparkles,
  StickyNote,
  Tag,
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
import { RefNumber } from "@/components/ref-number";
import { useIsQueuePreview } from "@/lib/preview-mode";
import { ServiceDateCell, type ServiceDateReason } from "@/components/service-date-cell";
import { ClassifyDialog } from "@/components/classify-dialog";
import {
  HoldReasonSelect,
  isHoldReasonValid,
} from "@/components/hold-reason-select";
import type { LegHoldReason } from "@workspace/leg-state";
import {
  ChipDrawerOverlay,
  MarkDuplicateDialog,
  legStateIcon,
  type ChipKey,
  type DetailGroup,
} from "@/components/chip-drawer-overlay";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import { InvoiceGroupSubmissionGauntlet, type GauntletFooterState } from "@/components/invoice-group-submission-gauntlet";
import { InvoiceGroupActionSlot } from "@/components/invoice-group-action-slot";
import { useUrlParams } from "@/lib/use-url-params";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { HideForClerk } from "@/lib/role";
import {
  deriveInvoiceDisputeOutlook,
  derivePreviewGateState,
} from "@/lib/whats-next-derivation";
import { getGroupLifecyclePhaseFromGroup } from "@/lib/lifecycle-phase";
import { buildSopTranscript, type TranscriptLine } from "@/lib/sop-transcript";
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

// `DetailGroup` and `ChipKey` are defined in `chip-drawer-overlay.tsx`
// (the drawer needs the same shape). Imported above.

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
  | "reattest"
  | "closeout"
  | "classify"
  | "sop"
  | "resolved"
  | "hold"
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
  const [forceWalk, setForceWalk] = useState(false);
  const [gauntletFooterState, setGauntletFooterState] = useState<GauntletFooterState | null>(null);
  const [gauntletDirty, setGauntletDirty] = useState(false);
  const onFooterStateChange = useCallback((s: GauntletFooterState) => setGauntletFooterState(s), []);
  // Gate experimental UX (e.g. the active-leg end-state stack below
  // the group hero) to /queue-preview so the live /queue stays stable.
  const queuePreview = useIsQueuePreview();

  useEffect(() => {
    setForceReview(false);
    setForceWalk(false);
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
  // Task #682d (V3HoldExit) — manual holds (group-scope or active-leg
  // scope) own the hero region. They short-circuit the gauntlet /
  // walk routing because the operator can't progress while a hold is
  // active. SOP-terminal holds (sopOutcome === "hold") still flow
  // through SopHero → SopAdvancePlayer's HoldTerminal as before; the
  // legHoldActive gate already excludes them.
  else if (groupHoldActive || legHoldActive) hero = "hold";
  else if (previewGenerated && draftReviewed && !forceReview && !forceWalk) hero = "ready";
  else if (previewGenerated && !forceWalk) hero = "review";
  else if (allWalked && outlook === "has_disputable" && !forceWalk) hero = "generate";
  // After all legs are walked, surface the invoice-level next-step CTA
  // (Re-attest survivors, or close-out as Withdrawn) right in the hero
  // slot — same component the full detail page mounts via
  // InvoiceGroupActionSlot, so the operator gets a first-class exit
  // instead of just a footer hint.
  else if (allWalked && outlook === "reattest_only" && !forceWalk) hero = "reattest";
  else if (allWalked && outlook === "nothing_to_do" && !forceWalk) hero = "closeout";
  else if (!activeLeg) hero = "empty";
  else if (activeLeg.includedInDispute === false) hero = "resolved";
  // SOP-terminal legs (cannot_dispute / dispute / portal_dispute /
  // internal / hold) used to land on the passive ResolvedHero card,
  // which gave the operator no way back if they hit the wrong terminal
  // by mistake. Route them to the SOP hero instead — `SopHero` will
  // mount `SopAdvancePlayer` whose terminal screens expose
  // "Change my answer" / "Restart walk" / "Reclassify the leg" (closed)
  // and "Resume from hold" (hold), all of which call the existing
  // /sop-back-step / /sop-restart / reclassify / clear-hold endpoints.
  // `includedInDispute === false` (caught above) keeps non-SOP
  // exclusions like classify-non_issue on the passive card — those
  // have no SOP walk to rewind. Hold-terminal legs (Task #647) used
  // to be excluded here and also fell through to ResolvedHero, leaving
  // the operator with no Resume affordance from the queue.
  else if (
    resolvedIndex.isLegResolved(activeLeg)
    && activeLeg.sopOutcome != null
  ) {
    hero = "sop";
  }
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
        onOpenChip={(k) => setChipOpen(k)}
      />

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
                onReclassifyLeg={(id) => {
                  setActiveLegId(id);
                  setClassifyOpen(true);
                }}
                onFooterStateChange={onFooterStateChange}
                onDirtyChange={setGauntletDirty}
              />
            </CardContent>
          </Card>
        )}
        {(hero === "reattest" || hero === "closeout") && (
          <Card>
            <CardContent className="py-5">
              <InvoiceGroupActionSlot
                bare
                group={detail}
                groupId={groupId}
                onJumpToLeg={(id) => setActiveLegId(id)}
                onReclassifyLeg={(id) => {
                  // Task #685 (R3) — reuse A's existing ClassifyDialog
                  // (already mounted below via setClassifyOpen). Setting
                  // the active leg first scopes the dialog to the
                  // requested leg via highlightLegId on next render.
                  setActiveLegId(id);
                  setClassifyOpen(true);
                }}
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
        {hero === "hold" && (
          <HoldHero
            scope={groupHoldActive ? "group" : "leg"}
            detail={detail}
            leg={activeLeg}
            onEditReason={() =>
              groupHoldActive ? setHoldGroupOpen(true) : setHoldLegOpen(true)
            }
          />
        )}
        {hero === "sop" && activeLeg && (
          <SopHero
            leg={activeLeg}
            rides={rides}
            detail={detail}
            groupId={groupId}
            groupMacroPhase={detail.macroPhase ?? null}
            walkStartedFor={walkStartedFor}
            onStartWalk={() => setWalkStartedFor(activeLeg.id)}
            onOpenClassify={() => setClassifyOpen(true)}
            onOpenMarkDuplicate={() => setMarkDuplicateOpen(true)}
          />
        )}
      </div>

      {/* Per-leg end-state stack. Once every leg is walked, the hero
          slot above is owned by the GROUP rollup
          ("generate" / "reattest" / "closeout") and the per-leg
          terminal screen — the one that carries Change my answer /
          Restart walk / Reclassify — is hidden. That left operators
          unable to undo a single wrong leg verdict from the queue
          mini workspace; the only restart paths were the bulk
          "Reopen N legs" on the close-out card or jumping out to
          /claims/:id. We surface the active leg's terminal here,
          stacked directly under the group hero, so both end states
          are visible at the same time and the leg-scoped restart
          verbs are one click away. Gated to terminal legs only:
          • sopOutcome != null   → SOP terminal (cannot_dispute,
            non_issue, dispute, portal_dispute, internal, hold) →
            SopAdvancePlayer routes to ClosedTerminalRewindCard /
            LegTerminalRewindFooter, both of which expose the
            existing /sop-restart + /sop-back-step buttons.
          • includedInDispute === false (no sopOutcome) → classify-
            time exclusion → ResolvedHero (passive; no walk to
            rewind, matches the per-leg page behavior).
          • sopOutcome set but no errorTypeId → leg was disposed via
            a non-SOP path (classify-time non_issue, backfill, etc).
            There is no decision tree to mount, so SopHero would be
            stuck on its "Loading playbook…" placeholder forever.
            Fall through to ResolvedHero — it accurately reflects
            the terminal and the leg has no walk to rewind. */}
      {/* Gated to Queue Preview only — the operator opted into the
          experimental surface, so we trial leg-end-state stacking
          there before promoting it to the live Queue. */}
      {queuePreview &&
        activeLeg &&
        (hero === "reattest" ||
          hero === "closeout" ||
          hero === "generate") &&
        (activeLeg.sopOutcome != null ||
          activeLeg.includedInDispute === false) && (
          <div
            className="space-y-2"
            data-testid="mini-active-leg-terminal-stack"
            data-leg-id={activeLeg.id}
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground px-1">
              Active leg end state
            </div>
            {activeLeg.sopOutcome != null && activeLeg.errorTypeId ? (
              <SopHero
                leg={activeLeg}
                rides={rides}
                detail={detail}
                groupId={groupId}
                groupMacroPhase={detail.macroPhase ?? null}
                walkStartedFor={walkStartedFor}
                onStartWalk={() => setWalkStartedFor(activeLeg.id)}
                onOpenClassify={() => setClassifyOpen(true)}
                onOpenMarkDuplicate={() => setMarkDuplicateOpen(true)}
              />
            ) : (
              <ResolvedHero leg={activeLeg} />
            )}
          </div>
        )}

      {activeLeg && hero !== "submitted" && hero !== "withdrawn" && (
        <WalkTranscriptSection leg={activeLeg} />
      )}

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

      <AdminStatusOverride groupId={groupId} currentStatus={detail.status ?? null} />

      <PinnedFooter
        phase={phase}
        detail={detail}
        groupId={groupId}
        rides={rides}
        activeLeg={activeLeg}
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
        forceWalk={forceWalk}
        onReopenWalk={() => {
          setForceWalk(true);
          setForceReview(false);
        }}
        onBackToSubmit={() => {
          setForceWalk(false);
          setForceReview(false);
        }}
        previewExists={previewGenerated}
        draftReviewedExists={draftReviewed}
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
  onOpenChip,
}: {
  detail: DetailGroup;
  rides: ClaimResponse[];
  activeLeg: ClaimResponse | null;
  resolvedIndex: ReturnType<typeof buildLegResolvedIndex>;
  onSelectLeg: (id: number) => void;
  onOpenChip: (k: ChipKey) => void;
}) {
  const queuePreview = useIsQueuePreview();
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
      {/* Compact ↗ icon-only affordance — opens the right-edge chip
          drawer on the Evidence panel instead of navigating away to
          /invoice-groups/:id. Keeps the operator in the queue context.
          Rewired in Task #678. */}
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
        aria-label="Open invoice group in full view"
        title="Open invoice group in full view"
        data-testid="mini-open-details"
        onClick={() => onOpenChip("evidence")}
      >
        <ArrowUpRight className="w-3.5 h-3.5" />
      </Button>
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
                {queuePreview && leg.confNumber && (
                  <span
                    className="mono text-[10px] opacity-70 ml-1"
                    data-testid={`mini-leg-tab-conf-${leg.id}`}
                  >
                    {leg.confNumber}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Hold hero ──────────────────────────────────────────────────────
// Task #682d (V3HoldExit) — graduates the V3HoldExit mockup into A as
// the canonical hold-exit surface. One component for both scopes:
//
//   scope === "leg"   → calls useRemoveLegHold({id: leg.id})
//   scope === "group" → calls useRemoveInvoiceGroupHold({id: detail.id})
//
// Wiring is scope-strict per wiring-map.md "hold mutations" rule —
// never cross-bind the leg-scope and group-scope hooks. The place-hold
// flow (PlaceLegHoldDialog / PlaceGroupHoldDialog driven by
// HoldReasonSelect) is unchanged; this hero only owns the release.
function HoldHero({
  scope,
  detail,
  leg,
  onEditReason,
}: {
  scope: "leg" | "group";
  detail: DetailGroup;
  leg: ClaimResponse | null;
  onEditReason: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const removeGroup = useRemoveInvoiceGroupHold();
  const removeLeg = useRemoveLegHold();

  // Bind reason / pending-from / placed-at off the right payload.
  // Field names verified against openapi.yaml: holdReason,
  // holdPendingFrom, holdPlacedAt — all live on both ClaimResponse
  // and InvoiceGroupDetailResponse. No invented fields.
  const source =
    scope === "leg" && leg
      ? {
          reason: (leg.holdReason ?? "").trim(),
          pendingFrom: (leg.holdPendingFrom ?? "").trim(),
          placedAt: leg.holdPlacedAt ?? null,
          title: "This leg is on hold",
          clearLabel: "Clear leg hold",
          footnote: "Clearing this hold returns the leg to the SOP walk where it left off.",
        }
      : {
          reason: (detail.holdReason ?? "").trim(),
          pendingFrom: (detail.holdPendingFrom ?? "").trim(),
          placedAt: detail.holdPlacedAt ?? null,
          title: "The whole invoice is on hold",
          clearLabel: "Clear group hold",
          footnote: "Clearing this hold returns the whole invoice to the queue.",
        };

  const pending = scope === "leg" ? removeLeg.isPending : removeGroup.isPending;

  function release() {
    if (scope === "leg") {
      if (!leg) return;
      removeLeg.mutate(
        { id: leg.id },
        {
          onSuccess: (next) => {
            applyLegMutationResult(qc, next);
            markLocalAction(`claim:${leg.id}`);
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
    } else {
      removeGroup.mutate(
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
  }

  return (
    <Card>
      <CardContent
        className="py-5 space-y-3"
        data-testid={`mini-hold-hero-${scope}`}
        data-scope={scope}
      >
        <div className="flex items-center gap-2">
          <span
            className="cc-pill cc-pill-amber text-[10px] uppercase tracking-wide"
            data-testid={`mini-hold-hero-${scope}-scope-pill`}
          >
            {scope === "leg" ? "Leg-scoped hold" : "Group-scoped hold"}
          </span>
          {source.placedAt && (
            <span className="cc-meta text-[11px] ml-auto" data-testid={`mini-hold-hero-${scope}-placed-at`}>
              Placed {formatDateTime(source.placedAt)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <PauseCircle className="w-6 h-6 text-amber-600 dark:text-amber-400 shrink-0" />
          <h3 className="text-base font-semibold">{source.title}</h3>
        </div>

        {(source.reason || source.pendingFrom) && (
          <div
            className="rounded-md border border-amber-300/60 bg-background px-2.5 py-2 text-xs leading-relaxed space-y-1"
            data-testid={`mini-hold-hero-${scope}-detail`}
          >
            {source.reason && (
              <div>
                <span className="cc-meta text-[11px]">Reason:</span>{" "}
                <span className="font-medium" data-testid={`mini-hold-hero-${scope}-reason`}>
                  {source.reason}
                </span>
              </div>
            )}
            {source.pendingFrom && (
              <div>
                <span className="cc-meta text-[11px]">Pending from:</span>{" "}
                <span data-testid={`mini-hold-hero-${scope}-pending-from`}>
                  {source.pendingFrom}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={release}
            disabled={pending}
            data-testid={`mini-hold-hero-${scope}-clear`}
          >
            {pending ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 mr-1" />
            )}
            {source.clearLabel}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onEditReason}
            className="h-8 px-2 text-xs"
            data-testid={`mini-hold-hero-${scope}-edit`}
          >
            <Edit2 className="w-3 h-3 mr-1" />
            Edit reason
          </Button>
        </div>

        <p className="cc-meta text-[11px] pt-2 border-t border-dashed border-amber-300/40">
          {source.footnote}
        </p>
      </CardContent>
    </Card>
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
  rides,
  detail,
  groupId,
  groupMacroPhase,
  walkStartedFor,
  onStartWalk,
  onOpenClassify,
  onOpenMarkDuplicate,
}: {
  leg: ClaimResponse;
  /** Sibling rides in the same invoice group — used to compute the
   *  bulk-apply count and the in-SOP sibling-detection prompt so the
   *  queue's per-leg workspace mirrors the Leg Details surface (Task #647). */
  rides: ClaimResponse[];
  /** Parent group payload — sourced for the V3LandingStartWalk hero's
   *  group-state line ("Group state: …") and the invoice-number link.
   *  Read-only; SopHero does not mutate it. */
  detail: DetailGroup;
  /** Group id used to invalidate the parent group query after exclude. */
  groupId: number;
  /** Pre-submit gate for the sibling prompt. Forwarded from the parent
   *  invoice group so the helper can short-circuit on post-submit groups. */
  groupMacroPhase: string | null;
  walkStartedFor: number | null;
  onStartWalk: () => void;
  /** Task #682d (V3LandingStartWalk) — escape hatches on the pre-walk
   *  landing card. Reuse A's existing dialog mounts. */
  onOpenClassify: () => void;
  onOpenMarkDuplicate: () => void;
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

  // Task #647 — parity with claim-detail-v2's Investigation walk.
  // Surfacing the "Apply to all matching legs" bulk checkbox and the
  // in-SOP sibling-detection prompt requires feeding the same inputs
  // the leg detail page computes. Eligibility is enforced server-side;
  // these counts only gate whether the affordances render at all.
  const bulkSiblingCount = useMemo(() => {
    if (!live || live.invoiceGroupId == null) return 0;
    if (!live.sopNodeId || live.sopOutcome != null) return 0;
    return rides.filter(
      (r) =>
        r.id !== live.id &&
        r.sopNodeId === live.sopNodeId &&
        r.sopOutcome == null &&
        r.includedInDispute === true &&
        r.duplicateOfClaimId == null,
    ).length;
  }, [live, rides]);

  const siblingPromptCandidate = useMemo(() => {
    return siblingPromptEligibilityFor({
      selfClaimId: live.id,
      selfErrorTypeId: live.errorTypeId ?? null,
      selfDuplicateOfClaimId: live.duplicateOfClaimId ?? null,
      groupMacroPhase,
      rides,
      errorTypes: (errorTypes ?? []) as Array<
        ErrorTypeResponse & { tripOverriding?: boolean }
      >,
    });
  }, [live, rides, groupMacroPhase, errorTypes]);

  const hasProgress = !!live.sopNodeId || live.sopOutcome != null;
  const showLanding =
    !!live.errorTypeId && !hasProgress && walkStartedFor !== live.id;

  if (showLanding) {
    return (
      <V3LandingStartWalkHero
        leg={live}
        detail={detail}
        groupId={groupId}
        onStartWalk={onStartWalk}
        onOpenClassify={onOpenClassify}
        onOpenMarkDuplicate={onOpenMarkDuplicate}
      />
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
          bulkSiblingCount={bulkSiblingCount}
          siblingPrompt={
            siblingPromptCandidate
              ? {
                  primaryClaimId: siblingPromptCandidate.primary.id,
                  primaryConfNumber:
                    siblingPromptCandidate.primary.confNumber ||
                    `CLM-${siblingPromptCandidate.primary.id}`,
                  primaryErrorTypeName:
                    siblingPromptCandidate.primary.errorTypeName ?? null,
                }
              : null
          }
        />
      </CardContent>
    </Card>
  );
}

// ─── V3 Landing — pre-walk "Start walk" hero ────────────────────────
// Task #682d — graduates the V3LandingStartWalk mockup into A. Replaces
// the bare landing card SopHero used to render before the operator
// clicks Start walk. Adds a status pill, a Change-classification chip,
// the parent-group state line, and the three escape hatches that
// claim-detail-v2 already exposed (Reclassify / Mark as duplicate /
// Exclude). All wiring reuses A's existing dialog mounts and the
// `useExcludeLeg` hook (same hook chip-drawer-overlay calls).
function V3LandingStartWalkHero({
  leg,
  detail,
  groupId,
  onStartWalk,
  onOpenClassify,
  onOpenMarkDuplicate,
}: {
  leg: ClaimResponse;
  detail: DetailGroup;
  groupId: number;
  onStartWalk: () => void;
  onOpenClassify: () => void;
  onOpenMarkDuplicate: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const exclude = useExcludeLeg();
  function onExclude() {
    exclude.mutate(
      { id: leg.id, data: { reason: "other" as const, note: "Excluded from queue landing" } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
          qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
          markLocalAction(`claim:${leg.id}`);
          successToast({ title: "Done", description: "Leg excluded from this dispute" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Exclude failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  const groupPhaseLabel = (detail.phase ?? "").replace(/_/g, " ").trim() || "in progress";

  return (
    <Card data-testid="mini-landing-start-walk" data-leg-id={leg.id}>
      <CardContent className="py-5 space-y-3">
        <div className="cc-meta text-[11px] flex items-center gap-2 flex-wrap">
          {leg.confNumber && <RefNumber value={leg.confNumber} variant="inline" />}
          {leg.date && <><span>·</span><span>DOS {leg.date}</span></>}
          {leg.claimAmount != null && <><span>·</span><span>{formatCurrency(leg.claimAmount)}</span></>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="cc-pill cc-pill-muted text-[11px]">Not started</span>
          <span className="cc-meta text-xs">·</span>
          <span className="text-xs font-medium">
            {leg.errorTypeName ?? "Classification pending"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[11px]"
            onClick={onOpenClassify}
            data-testid="mini-landing-change-classification"
          >
            <Edit2 className="w-3 h-3 mr-1" />
            Change
          </Button>
        </div>

        <div className="space-y-1">
          <h3 className="text-base font-semibold">Ready to walk this leg</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Walking the SOP confirms whether this leg is disputable. You can stop
            and resume at any time — your answers are saved as you go.
          </p>
        </div>

        <div className="text-[11px] text-muted-foreground border-t pt-2">
          Group state:{" "}
          <span className="text-foreground font-medium" data-testid="mini-landing-group-state">
            {groupPhaseLabel}
          </span>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={onStartWalk} data-testid="mini-start-walk">
            Start walk
            <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-dashed">
          <span className="cc-meta text-[11px]">
            Or, if this leg shouldn't be walked:
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={onOpenClassify}
            data-testid="mini-landing-reclassify"
          >
            <Tag className="w-3 h-3 mr-1" />
            Reclassify
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={onOpenMarkDuplicate}
            data-testid="mini-landing-mark-duplicate"
          >
            <Copy className="w-3 h-3 mr-1" />
            Mark as duplicate
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={onExclude}
            disabled={exclude.isPending}
            data-testid="mini-landing-exclude"
          >
            {exclude.isPending ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Link2Off className="w-3 h-3 mr-1" />
            )}
            Exclude
          </Button>
        </div>
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
  const queuePreview = useIsQueuePreview();
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
      const seen = new Set<string>();
      const files = (leg as { evidenceFiles?: { url: string; filename?: string | null }[] | null }).evidenceFiles;
      if (files) {
        for (const f of files) {
          if (!f?.url || seen.has(f.url)) continue;
          seen.add(f.url);
          result.push({
            name: f.filename ?? f.url.split("/").pop() ?? "file",
            legIndex: i + 1,
            legIncluded: included,
          });
        }
      }
      // Canonical claim_evidence rows for this leg — same source the
      // bot worker actually submits via collectGroupEvidenceUrls.
      const rows = (leg as { evidence?: Array<{ imageUrl?: string | null; evidenceTypeName?: string | null }> }).evidence ?? [];
      for (const r of rows) {
        const url = r?.imageUrl;
        if (!url || seen.has(url)) continue;
        seen.add(url);
        result.push({
          name: r.evidenceTypeName ?? url.split("/").pop() ?? "file",
          legIndex: i + 1,
          legIncluded: included,
        });
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
                  <span
                    className={
                      queuePreview
                        ? "mono text-[12px] font-bold text-foreground"
                        : "mono text-[11px] font-semibold"
                    }
                    data-testid={`ready-leg-card-conf-${leg.id}`}
                  >
                    {leg.confNumber ?? ""}
                  </span>
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
// ─── Walk transcript (read-only summary kept inline for backtracking) ─
function WalkTranscriptSection({ leg }: { leg: ClaimResponse }) {
  const { data: claim } = useGetClaim(leg.id, {
    query: { queryKey: getGetClaimQueryKey(leg.id), enabled: !!leg.id },
  });
  const live = (claim ?? leg) as ClaimResponse;
  const { data: errorTypes } = useListErrorTypes();
  const tree = useMemo(() => {
    if (!live.errorTypeId || !errorTypes) return null;
    const et = errorTypes.find((t) => String(t.id) === String(live.errorTypeId));
    const raw = et?.decisionTree as DecisionTree | undefined | null;
    if (!raw || !raw.nodes || !raw.rootId) return null;
    return raw;
  }, [live.errorTypeId, errorTypes]);
  const lines: TranscriptLine[] = useMemo(
    () => buildSopTranscript(live.sopAnswers, tree),
    [live.sopAnswers, tree],
  );
  return (
    <Card data-testid="queue-dossier-section-walk-transcript">
      <CardContent className="py-4 space-y-2">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">SOP walk transcript</h3>
          <span className="cc-meta text-[11px] ml-auto">
            {lines.length} {lines.length === 1 ? "answer" : "answers"}
          </span>
        </div>
        {lines.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No walk progress yet.
          </p>
        ) : (
          <ol className="space-y-1.5 text-xs">
            {lines.map((line, i) => (
              <li
                key={i}
                className="rounded border p-2"
                data-testid={`queue-dossier-transcript-line-${i}`}
              >
                <div className="font-medium">{line.question}</div>
                <div className="text-muted-foreground">→ {line.answer}</div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

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
  // Include canonical claim_evidence rows in the chip count so the
  // pill matches what the drawer + portal submission actually carry.
  const legEvidenceRows = (leg as { evidence?: Array<{ imageUrl?: string | null }> }).evidence ?? [];
  const seenUrls = new Set<string>();
  for (const f of evidenceFiles) { if (f?.url) seenUrls.add(f.url); }
  let extraRowCount = 0;
  for (const r of legEvidenceRows) {
    if (r?.imageUrl && !seenUrls.has(r.imageUrl)) {
      seenUrls.add(r.imageUrl);
      extraRowCount++;
    }
  }
  const evidenceCount = evidenceFiles.length + extraRowCount;
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
            <button
              type="button"
              className="cc-pill cc-pill-amber chip-peer"
              onClick={onPlaceLegHold}
              data-testid="mini-place-leg-hold"
            >
              <PauseCircle className="w-3 h-3 mr-1" />
              Hold leg
            </button>
          )}
          {/* Task #682d — release-hold moved to <HoldHero/> (hero === "hold").
              ChipStrip keeps the place-hold button for the !held branch. */}
        </div>
      </div>

      {/* The chip-PANEL body used to expand inline here. It now renders
          as a floating right-edge overlay (`<ChipDrawerOverlay>` mounted
          from `InlineGroupWorkspaceMini`) so the existing hero / footer
          layout never shifts when an operator opens a chip. */}
    </div>
  );
}

// Single chip pill used by the chip strip above. Toggles the
// right-edge ChipDrawerOverlay open/closed for its key.
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

function PinnedFooter({
  phase,
  detail,
  groupId,
  rides,
  activeLeg,
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
  forceWalk,
  onReopenWalk,
  onBackToSubmit,
  previewExists,
  draftReviewedExists,
}: {
  phase: PhaseConfig;
  detail: DetailGroup;
  groupId: number;
  rides: ClaimResponse[];
  activeLeg: ClaimResponse | null;
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
  forceWalk: boolean;
  onReopenWalk: () => void;
  onBackToSubmit: () => void;
  previewExists: boolean;
  draftReviewedExists: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const submit = useCreatePortalSubmission();
  const clearLegVerdictDraft = useClearLegVerdictDraft();
  // Task #688 — Group-level "Discard response & restart" reuses the
  // per-leg sop-restart and clear-verdict-draft mutations, fanning
  // them out across every leg in the invoice. We rely on the hook
  // instance allowing concurrent in-flight `mutateAsync` calls (each
  // returns its own promise); the loop below awaits them via Promise.all.
  const sopRestartLeg = useSopRestartLeg();
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardPending, setDiscardPending] = useState(false);
  const gate = derivePreviewGateState(detail, rides);
  const [serviceTokenExpired, setServiceTokenExpired] = useState(false);
  // Task #703 follow-up — POST /portal-submissions now runs `lintDraft`
  // on the prospective row before insert and 422s when there are hard
  // failures or unacknowledged warnings. Pre-#703 the lint dialog was
  // only wired into the standalone Portal Submissions page (via the
  // now-removed /confirm step), so the queue mini just showed a generic
  // "HTTP 422" toast and the operator had no way forward. We surface
  // the failures inline and, for warnings, give them the same "Submit
  // anyway + write a bypass reason" path the legacy flow had.
  const [lintGateOpen, setLintGateOpen] = useState(false);
  const [lintGateMode, setLintGateMode] = useState<LintGateMode>("warn");
  const [lintResults, setLintResults] = useState<LintResult[]>([]);

  // Task #681 — Clear recorded verdict (per-leg DELETE
  // /claims/{id}/verdict/draft). Distinct from "Reopen walk" — that
  // mutation reopens the walk to fix a verdict; this one zeroes the
  // recorded draft on the active leg. Ported from claim-detail-v2's
  // PerLegVerdictPicker.
  const activeLegId = activeLeg?.id ?? null;
  // `latestDraft` is the per-leg verdict-draft slot on ClaimResponse
  // (lib/api-client-react/src/generated/api.schemas.ts L455). Mirrors
  // claim-detail-v2.tsx's PerLegVerdictPicker which gates Clear on
  // the same field.
  const hasVerdictDraft = activeLeg?.latestDraft != null;
  function onClearVerdictDraft() {
    if (activeLegId == null) return;
    clearLegVerdictDraft.mutate(
      { id: activeLegId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetClaimQueryKey(activeLegId) });
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
          successToast({
            title: "Done",
            description: "Recorded verdict cleared on this leg.",
          });
        },
        onError: (e: unknown) =>
          toast({
            title: "Clear verdict failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  // Task #688 — Discard the generated portal response and restart
  // every leg's SOP walk. Used at the Queue-for-Portal stage when the
  // operator realizes the generated response is wrong (e.g. they
  // walked one or more legs incorrectly so the AI draft is built on
  // bad inputs). Wipes per-leg verdict drafts where present, restarts
  // every leg's SOP walk in parallel, then drops the operator back into
  // walk mode. The draft body becomes stale once the legs are no
  // longer concluded; the gauntlet will regenerate when they finish
  // again.
  async function onDiscardAndRestart() {
    if (discardPending) return;
    setDiscardPending(true);
    try {
      const ops: Promise<unknown>[] = [];
      for (const r of rides) {
        if (r.includedInDispute === false) continue;
        // `discardDraft: true` opts the rewind into clearing the
        // parent group's cached AI dispute draft + reviewed stamp
        // (SopRewindBody contract). One leg restart with this flag
        // is enough to wipe the group draft, but we send it on every
        // leg so the call is idempotent regardless of order.
        ops.push(
          sopRestartLeg
            .mutateAsync({ id: r.id, data: { discardDraft: true } })
            .catch(() => undefined),
        );
        if (r.latestDraft != null) {
          ops.push(
            clearLegVerdictDraft
              .mutateAsync({ id: r.id })
              .catch(() => undefined),
          );
        }
      }
      await Promise.all(ops);
      qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
      for (const r of rides) {
        qc.invalidateQueries({ queryKey: getGetClaimQueryKey(r.id) });
      }
      successToast({
        title: "Done",
        description:
          "Generated response discarded. All walks reopened — redo each leg.",
      });
      setDiscardOpen(false);
      onReopenWalk();
    } catch (e: unknown) {
      toast({
        title: "Discard failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDiscardPending(false);
    }
  }

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

  function submitOnce(extra?: { ack: boolean; bypassReason: string }) {
    submit.mutate(
      {
        data: {
          invoiceGroupId: groupId,
          actorType: "operator",
          understandingReadback: detail.understandingReadback ?? "",
          // Forward the operator-reviewed draft so /portal-submissions
          // ships the exact text the user just confirmed on Q5. Falls
          // back to the AI baseline so the backend still has a body if
          // the draft column was never written. Mirrors the Q4 gauntlet
          // submit path (invoice-group-submission-gauntlet.tsx).
          subject: detail.draftSubject ?? detail.aiBaselineSubject ?? "",
          descriptionHtml:
            detail.draftDescriptionHtml ??
            detail.aiBaselineDescriptionHtml ??
            "",
          ...(extra ?? {}),
        },
      },
      {
        onSuccess: () => {
          setLintGateOpen(false);
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
          qc.invalidateQueries({
            queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
          });
          qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
          successToast({ title: "Done", description: "Submitted to the portal" });
        },
        onError: (e: unknown) => {
          const data =
            e instanceof ApiError && e.data && typeof e.data === "object"
              ? (e.data as { code?: unknown; failures?: unknown })
              : undefined;
          const code = data?.code;
          if (e instanceof ApiError && e.status === 401 && code === "token_expired") {
            setServiceTokenExpired(true);
            return;
          }
          // Task #703 — 422 with `{ failures: LintResult[] }` is the
          // lint gate. Hard fails (severity === "fail") need a code
          // change to the draft; soft warnings can be acknowledged
          // with a typed bypass reason. We open LintGateDialog instead
          // of toasting "HTTP 422" so the operator sees what's wrong
          // and either fixes it or owns the override on the audit row.
          if (e instanceof ApiError && e.status === 422 && Array.isArray(data?.failures)) {
            const failures = data.failures as LintResult[];
            const hasHardFail = failures.some((r) => r.severity === "fail");
            setLintResults(failures);
            setLintGateMode(hasHardFail ? "fail" : "warn");
            setLintGateOpen(true);
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

  function onSubmit() {
    setServiceTokenExpired(false);
    submitOnce();
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
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onReopenWalk}
            data-testid="mini-reopen-walk"
            title="Go back to per-leg walk to fix a verdict, classification, or evidence"
          >
            Reopen walk
          </Button>
          {hasVerdictDraft && activeLegId != null && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={onClearVerdictDraft}
              disabled={clearLegVerdictDraft.isPending}
              data-testid="mini-clear-verdict-draft"
              title="Erase the recorded verdict draft on this leg so it can be re-recorded"
            >
              {clearLegVerdictDraft.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : null}
              Clear recorded verdict
            </Button>
          )}
          {/* Task #688 — Operator's last chance to back out a wholly-
              wrong response before it ships. Sits next to Queue so it
              can't be missed but is styled destructive (outline +
              destructive label) so it's clearly not the happy path.
              Requires AlertDialog confirmation; on confirm wipes per-leg
              verdict drafts + restarts every SOP walk + drops the
              operator back into walk mode. */}
          {previewExists && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => setDiscardOpen(true)}
              disabled={discardPending}
              data-testid="mini-discard-and-restart"
              title="Throw away the generated portal response and reopen every leg's walk"
            >
              {discardPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : null}
              Discard response &amp; restart
            </Button>
          )}
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
          <LintGateDialog
            open={lintGateOpen}
            mode={lintGateMode}
            results={lintResults}
            pending={submit.isPending}
            onClose={() => setLintGateOpen(false)}
            onConfirmAnyway={(bypassReason) =>
              submitOnce({ ack: true, bypassReason })
            }
          />
          <AlertDialog
            open={discardOpen}
            onOpenChange={(next) => !discardPending && setDiscardOpen(next)}
          >
            <AlertDialogContent data-testid="mini-discard-and-restart-dialog">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Discard generated response &amp; restart every walk?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This throws away the AI-drafted portal response and reopens
                  every leg's SOP walk on this invoice. Per-leg verdict drafts
                  are cleared. Anything you've already submitted to the portal
                  is unaffected — this only resets in-progress work.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={discardPending}>
                  Keep response
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void onDiscardAndRestart();
                  }}
                  disabled={discardPending}
                  data-testid="mini-discard-and-restart-confirm"
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {discardPending ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : null}
                  Discard &amp; restart all walks
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
            <span className="cc-meta text-xs flex-1 min-w-0">
              {forceWalk && previewExists && draftReviewedExists
                ? "Walk reopened — fix what you need, then jump back to submit."
                : phase.helper}
            </span>
            {forceWalk && previewExists && draftReviewedExists && !submitted && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={onBackToSubmit}
                data-testid="mini-back-to-submit"
                title="Return to the ready-to-send screen without changing anything else"
              >
                Back to submit
              </Button>
            )}
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
