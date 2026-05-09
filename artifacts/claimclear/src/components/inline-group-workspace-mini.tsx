import { useEffect, useMemo, useState } from "react";
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
  useStampPreviewGenerated,
  useMarkInvoiceGroupDraftReviewed,
  useCreatePortalSubmission,
  getGetClaimQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListClaimNotesQueryKey,
  getGetInvoiceGroupEmailThreadQueryKey,
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupsQueryKey,
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
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
  HelpCircle,
  Loader2,
  MessageSquare,
  Paperclip,
  PauseCircle,
  PlayCircle,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
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
import { ClassifyDialog } from "@/components/classify-dialog";
import { EvidenceFileList } from "@/components/evidence-file-list";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import { useUrlParams } from "@/lib/use-url-params";
import { formatCurrency } from "@/lib/format";
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

export function InlineGroupWorkspaceMini({ groupId }: Props) {
  const { get, set } = useUrlParams();
  const legParam = Number.parseInt(get("leg"), 10);
  const urlLegId: number | null =
    Number.isFinite(legParam) && legParam > 0 ? legParam : null;

  const [chipOpen, setChipOpen] = useState<ChipKey | null>(null);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [walkStartedFor, setWalkStartedFor] = useState<number | null>(null);
  const [holdLegOpen, setHoldLegOpen] = useState(false);
  const [holdGroupOpen, setHoldGroupOpen] = useState(false);

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

  type HeroState =
    | "submitted"
    | "review"
    | "preview"
    | "classify"
    | "sop"
    | "resolved"
    | "empty";
  let hero: HeroState;
  if (submitted) hero = "submitted";
  else if (previewGenerated && draftReviewed) hero = "review";
  else if (previewGenerated) hero = "preview";
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

      <div aria-live="polite" className="cc-mini-hero">
        {hero === "submitted" && <SubmittedHero detail={detail} />}
        {hero === "review" && <ReviewHero detail={detail} groupId={groupId} />}
        {hero === "preview" && (
          <PreviewHero detail={detail} groupId={groupId} rides={rides} />
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

      {activeLeg && hero !== "submitted" && (
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
      />

      {activeLeg && classifyOpen && (
        <ClassifyDialog
          open={classifyOpen}
          onOpenChange={setClassifyOpen}
          groupId={groupId}
          highlightLegId={activeLeg.id}
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
      <Link href={fullHref}>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-xs"
          data-testid="mini-open-details"
        >
          Full details
          <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
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

// Preview hero owns "Generate preview" — stamps previewGeneratedAt
// and progresses the phase pill in the footer.
function PreviewHero({
  detail,
  groupId,
  rides,
}: {
  detail: DetailGroup;
  groupId: number;
  rides: ClaimResponse[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const stamp = useStampPreviewGenerated();
  const gate = derivePreviewGateState(detail, rides);
  function regenerate() {
    stamp.mutate(
      { id: groupId },
      {
        onSuccess: (g) => {
          applyGroupMutationResult(qc, g);
          successToast({ title: "Done", description: "Preview regenerated" });
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
  return (
    <Card>
      <CardContent className="py-5 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Preview generated</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          The dispute draft is ready. Open Full details to read the body and
          mark it reviewed, then submit from the footer.
        </p>
        {!gate.ok && gate.reason && (
          <p className="text-xs text-amber-700">{gate.reason}</p>
        )}
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={stamp.isPending || !gate.ok}
            onClick={regenerate}
            data-testid="mini-regenerate-preview"
          >
            {stamp.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : null}
            Regenerate preview
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Review hero owns "Mark reviewed" — stamps draftReviewedAt and the
// footer Submit unlocks immediately (single CTA, no extra accordion).
function ReviewHero({
  detail,
  groupId,
}: {
  detail: DetailGroup;
  groupId: number;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const mark = useMarkInvoiceGroupDraftReviewed();
  function markReviewed() {
    mark.mutate(
      { id: groupId },
      {
        onSuccess: (g) => {
          applyGroupMutationResult(qc, g);
          successToast({ title: "Done", description: "Draft marked reviewed" });
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
    <Card>
      <CardContent className="py-5 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Reviewed — ready to submit</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {detail.draftReviewedAt
            ? "The draft has been reviewed. Submit to the portal from the footer below."
            : "Confirm the draft reads correctly, then submit from the footer."}
        </p>
        {!detail.draftReviewedAt && (
          <div>
            <Button
              size="sm"
              variant="outline"
              disabled={mark.isPending}
              onClick={markReviewed}
              data-testid="mini-mark-reviewed"
            >
              {mark.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : null}
              Mark reviewed
            </Button>
          </div>
        )}
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

      {openChip && (
        <div className="cc-mini-chip-panel" data-testid={`mini-chip-panel-${openChip}`}>
          {openChip === "evidence" && (
            <EvidenceFileList
              urls={evidenceFiles
                .map((f) => f.url)
                .filter((u): u is string => !!u)}
            />
          )}
          {openChip === "notes" && (
            <NotesPanel leg={leg} inlineNote={inlineNote} />
          )}
          {openChip === "comms" && <CommsPanel groupId={groupId} />}
          {openChip === "activity" && (
            <ActivityPanel groupId={groupId} legId={leg.id} />
          )}
        </div>
      )}
    </div>
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

// Activity — links into the canonical detail page where the full
// audit trail lives. The mini panel surfaces the count so operators
// know whether there's history to read.
function ActivityPanel({
  groupId,
  legId,
}: {
  groupId: number;
  legId: number;
}) {
  return (
    <div className="text-xs space-y-1.5" data-testid="mini-activity-panel">
      <div>Audit trail and recent activity live in full details.</div>
      <Link
        href={`/invoice-groups/${groupId}?leg=${legId}#activity`}
        className="underline text-muted-foreground"
      >
        Open full details to view activity →
      </Link>
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

// ─── Pinned footer (single Submit) ──────────────────────────────────
// One inline Submit CTA built directly on `useCreatePortalSubmission`
// + `derivePreviewGateState`. The footer no longer mounts the
// gauntlet — readiness is the single pill, the helper line owns
// the explanation, and the button is the one and only submit path.
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
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const submit = useCreatePortalSubmission();
  const gate = derivePreviewGateState(detail, rides);

  // Submit is enabled only when the readback gate is satisfied AND
  // the operator has progressed through preview + reviewed. Disabled
  // tooltip text is the gate reason (or a step hint when the gate
  // is fine but earlier steps haven't been completed).
  const stepReady = previewGenerated && draftReviewed;
  const enabled =
    !submitted &&
    !groupHoldActive &&
    outlook === "has_disputable" &&
    gate.ok &&
    stepReady;

  let disabledReason: string | null = null;
  if (submitted) disabledReason = "Already submitted.";
  else if (groupHoldActive) disabledReason = "Release the hold first.";
  else if (outlook !== "has_disputable")
    disabledReason = "Nothing to dispute on this invoice.";
  else if (!gate.ok) disabledReason = gate.reason;
  else if (!previewGenerated)
    disabledReason = "Generate the preview first.";
  else if (!draftReviewed) disabledReason = "Mark the draft reviewed first.";

  function onSubmit() {
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
        onError: (e: unknown) =>
          toast({
            title: "Submit failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  return (
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
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  function submit() {
    const trimmed = reason.trim();
    if (!trimmed) return;
    mutation.mutate(
      { id: leg.id, data: { reason: trimmed } },
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
        <div className="space-y-2">
          <label className="text-xs font-medium">Reason</label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why are you holding this leg?"
            rows={4}
            data-testid="mini-leg-hold-reason"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!reason.trim() || mutation.isPending}
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
