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
  useMarkLegDuplicate,
  useRecordLegVerdict,
  useClearLegVerdictDraft,
  useCompleteLegMasAction,
  getGetClaimQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
  getListClaimNotesQueryKey,
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  ErrorTypeResponse,
  InvoiceGroupDetailResponse,
  NoteResponse,
} from "@workspace/api-client-react";
import type { DecisionTree } from "@/components/decision-tree/types";
import {
  buildLegResolvedIndex,
  deriveLegSubStatus,
} from "@workspace/leg-state";
import { siblingPromptEligibilityFor } from "@/lib/sop-sibling-eligibility";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  FileText,
  Gavel,
  HelpCircle,
  Loader2,
  Paperclip,
  PauseCircle,
  PlayCircle,
  Send,
  Stamp,
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
import { InvoiceGroupActionSlot } from "@/components/invoice-group-action-slot";
import { PerLegVerdictPicker } from "@/components/per-leg-verdict-picker";
import { useUrlParams } from "@/lib/use-url-params";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { HideForClerk } from "@/lib/role";
import { deriveInvoiceDisputeOutlook } from "@/lib/whats-next-derivation";
import { getGroupLifecyclePhaseFromGroup } from "@/lib/lifecycle-phase";
import { buildSopTranscript, type TranscriptLine } from "@/lib/sop-transcript";
import {
  applyGroupMutationResult,
  applyLegMutationResult,
} from "@/lib/apply-mutation-result";
import { useToast, successToast } from "@/hooks/use-toast";
import { markLocalAction } from "@/hooks/use-local-action-mark";

// ─────────────────────────────────────────────────────────────────────
// InlineGroupWorkspaceMini — Task #657 dossier.
//
// Two-column dossier that mirrors /claims/:id inside the queue right
// pane. Replaces the chip-strip + ChipDrawerOverlay model. The per-leg
// walk surface always renders for any walkable leg, regardless of the
// group's outlook; group-level next-step CTAs (gauntlet / re-attest /
// closeout) live in the right column's `group-next-step` card.
// ─────────────────────────────────────────────────────────────────────

type DetailGroup = InvoiceGroupDetailResponse & {
  holdReason?: string | null;
  payorEmailBounceState?: {
    kind: "hard_bounced";
    email: string;
    reason: string;
    bouncedAt: string;
  } | null;
};

interface Props {
  groupId: number;
}

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
  | "classify"
  | "sop"
  | "resolved"
  | "empty";

export function InlineGroupWorkspaceMini({ groupId }: Props) {
  const { get, set } = useUrlParams();
  const legParam = Number.parseInt(get("leg"), 10);
  const urlLegId: number | null =
    Number.isFinite(legParam) && legParam > 0 ? legParam : null;

  const [classifyOpen, setClassifyOpen] = useState(false);
  const [markDuplicateOpen, setMarkDuplicateOpen] = useState(false);
  const [walkStartedFor, setWalkStartedFor] = useState<number | null>(null);
  const [holdLegOpen, setHoldLegOpen] = useState(false);
  const [holdGroupOpen, setHoldGroupOpen] = useState(false);

  const setActiveLegId = (id: number | null) => {
    setWalkStartedFor(null);
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

  const submitted = isPostSubmit(detail);
  const withdrawn = detail.phase === "closed";

  // Group-level outlook decides where the InvoiceGroupActionSlot mounts.
  // Per anti-drift: the submission gauntlet (has_disputable) MUST stay
  // in the hero slot so generate/review groups still surface it
  // prominently. Reattest_only / nothing_to_do CTAs demote into the
  // right column "Group next step" card.
  const outlook = !submitted && !withdrawn
    ? deriveInvoiceDisputeOutlook(detail, rides).outlook
    : null;
  const showHeroGauntlet = outlook === "has_disputable";
  const showGroupNextStepCard =
    outlook === "reattest_only" || outlook === "nothing_to_do";

  const groupHoldActive =
    !submitted && getGroupLifecyclePhaseFromGroup(detail) === "on-hold";
  const legHoldActive =
    !submitted &&
    !groupHoldActive &&
    activeLeg != null &&
    activeLeg.sopOutcome !== "hold" &&
    (activeLeg.holdReason ?? null) != null;

  // Hero priority — the per-leg walk wins over group-level outlook so a
  // walkable leg is always reachable. Group-level next-step CTAs render
  // in the right column instead of eclipsing the walk.
  let hero: HeroState;
  if (withdrawn) hero = "withdrawn";
  else if (submitted) hero = "submitted";
  else if (!activeLeg) hero = "empty";
  else if (activeLeg.includedInDispute === false) hero = "resolved";
  else if (
    resolvedIndex.isLegResolved(activeLeg) &&
    activeLeg.sopOutcome != null
  )
    hero = "sop";
  else if (resolvedIndex.isLegResolved(activeLeg)) hero = "resolved";
  else if (deriveLegSubStatus(activeLeg) === "needs_classification")
    hero = "classify";
  else hero = "sop";

  const showDossier = hero !== "submitted" && hero !== "withdrawn";

  return (
    <div
      className="cc-scope cc-mini space-y-3"
      data-testid="queue-dossier-root"
      data-hero={hero}
      data-active-leg={activeLeg?.id ?? ""}
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

      {hero === "withdrawn" && <WithdrawnHero detail={detail} />}
      {hero === "submitted" && <SubmittedHero detail={detail} />}
      {showHeroGauntlet && (
        <Card data-testid="queue-dossier-hero-gauntlet">
          <CardContent className="py-3">
            <InvoiceGroupActionSlot
              bare
              group={detail}
              groupId={groupId}
              onJumpToLeg={setActiveLegId}
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

      {showDossier && activeLeg && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div
            data-testid="queue-dossier-left"
            className="lg:col-span-2 space-y-3 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pr-1"
          >
            {hero === "classify" ? (
              <ClassifyHero
                leg={activeLeg}
                onOpenClassify={() => setClassifyOpen(true)}
              />
            ) : null}

            <WalkTranscriptSection leg={activeLeg} />

            <InvestigationWalkSection
              leg={activeLeg}
              rides={rides}
              groupMacroPhase={detail.macroPhase ?? null}
              walkStartedFor={walkStartedFor}
              onStartWalk={() => setWalkStartedFor(activeLeg.id)}
              onRequestReclassify={() => setClassifyOpen(true)}
            />

            <EvidenceSection leg={activeLeg} detail={detail} />

            <NotesSection leg={activeLeg} />
          </div>

          <div
            data-testid="queue-dossier-right"
            className="space-y-3 lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto lg:pr-1"
          >
            <ParentInvoiceCard detail={detail} />

            <PayorVerdictCard
              leg={activeLeg}
              detail={detail}
            />

            <MasActionCard leg={activeLeg} detail={detail} />

            <ActivityCard detail={detail} groupId={groupId} legId={activeLeg.id} />

            {showGroupNextStepCard && (
              <GroupNextStepCard
                detail={detail}
                groupId={groupId}
                onJumpToLeg={setActiveLegId}
              />
            )}

            <LegHoldControls
              leg={activeLeg}
              legHoldActive={legHoldActive}
              groupHoldActive={groupHoldActive}
              onPlaceLegHold={() => setHoldLegOpen(true)}
              onPlaceGroupHold={() => setHoldGroupOpen(true)}
              onMarkDuplicate={() => setMarkDuplicateOpen(true)}
            />
          </div>
        </div>
      )}

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
    </div>
  );
}

// ─── Group summary header ───────────────────────────────────────────
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

// ─── Banners ────────────────────────────────────────────────────────
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

// ─── Terminal hero banners ──────────────────────────────────────────
function WithdrawnHero({ detail }: { detail: DetailGroup }) {
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
          {reasonLabel ? ` (${reasonLabel})` : ""} elsewhere. Open Full
          details to review, or pick a different claim from the queue.
        </p>
      </CardContent>
    </Card>
  );
}

function SubmittedHero({ detail }: { detail: DetailGroup }) {
  const lifecycle = getGroupLifecyclePhaseFromGroup(detail);
  return (
    <Card data-testid="mini-submitted-banner">
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

// ─── Left column: walk transcript ────────────────────────────────────
function WalkTranscriptSection({ leg }: { leg: ClaimResponse }) {
  const { data: claim } = useGetClaim(leg.id, {
    query: { queryKey: getGetClaimQueryKey(leg.id), enabled: !!leg.id },
  });
  const live = (claim ?? leg) as ClaimResponse;
  const { data: errorTypes } = useListErrorTypes();
  const tree: DecisionTree | null = useMemo(() => {
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

// ─── Left column: investigation walk (SopAdvancePlayer) ─────────────
function InvestigationWalkSection({
  leg,
  rides,
  groupMacroPhase,
  walkStartedFor,
  onStartWalk,
  onRequestReclassify,
}: {
  leg: ClaimResponse;
  rides: ClaimResponse[];
  groupMacroPhase: string | null;
  walkStartedFor: number | null;
  onStartWalk: () => void;
  onRequestReclassify: () => void;
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
  const noErrorType = !live.errorTypeId;

  return (
    <Card data-testid="queue-dossier-section-investigation-walk">
      <CardContent className="py-4 space-y-2">
        <div className="flex items-center gap-2">
          <PlayCircle className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Investigation walk</h3>
        </div>
        {noErrorType ? (
          <p className="text-xs text-muted-foreground italic">
            No error type — classify the leg to unlock the SOP walk.
          </p>
        ) : showLanding ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {live.errorTypeName ?? "Walk this leg"} — step through the
              playbook for this leg. You can pause and come back anytime.
            </p>
            <Button
              size="sm"
              onClick={onStartWalk}
              data-testid="mini-start-walk"
            >
              Start walk
            </Button>
          </div>
        ) : !tree || !errorType ? (
          <p className="text-xs text-muted-foreground">Loading playbook…</p>
        ) : (
          <SopAdvancePlayer
            mode="live"
            leg={live}
            tree={tree}
            errorType={errorType}
            bulkSiblingCount={bulkSiblingCount}
            onRequestReclassify={onRequestReclassify}
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
        )}
      </CardContent>
    </Card>
  );
}

// ─── Left column: evidence ──────────────────────────────────────────
function EvidenceSection({
  leg,
  detail,
}: {
  leg: ClaimResponse;
  detail: DetailGroup;
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
    const groupRows =
      (detail as { groupEvidence?: Array<{ imageUrl?: string | null }> })
        .groupEvidence ?? [];
    const legRows =
      (leg as { evidence?: Array<{ imageUrl?: string | null }> }).evidence ?? [];
    for (const r of [...groupRows, ...legRows]) {
      const url = r?.imageUrl;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, size: null });
    }
    return out;
  }, [detail.evidenceFiles, leg.evidenceFiles, (detail as { groupEvidence?: unknown }).groupEvidence, (leg as { evidence?: unknown }).evidence]);
  const evidenceUrls = useMemo(() => evidenceFiles.map((f) => f.url), [evidenceFiles]);
  const evidenceSizeMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of evidenceFiles) {
      if (f.size != null && f.size > 0) m.set(f.url, f.size);
    }
    return m;
  }, [evidenceFiles]);
  return (
    <Card data-testid="queue-dossier-section-evidence">
      <CardContent className="py-4 space-y-2">
        <div className="flex items-center gap-2">
          <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Evidence</h3>
          <span className="cc-meta text-[11px] ml-auto">
            {evidenceUrls.length} {evidenceUrls.length === 1 ? "file" : "files"}
          </span>
        </div>
        {evidenceUrls.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No evidence attached.
          </p>
        ) : (
          <EvidenceFileList urls={evidenceUrls} sizeMap={evidenceSizeMap} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Left column: internal notes ────────────────────────────────────
function NotesSection({ leg }: { leg: ClaimResponse }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: notes, isLoading } = useListClaimNotes(leg.id);
  const create = useCreateClaimNote();
  const remove = useDeleteNote();
  const [draft, setDraft] = useState("");
  const inlineNote = (leg.evidenceNotes ?? "").trim();

  function refresh() {
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
          refresh();
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
  function del(id: number) {
    remove.mutate(
      { id },
      {
        onSuccess: () => {
          refresh();
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
    <Card data-testid="queue-dossier-section-internal-notes">
      <CardContent className="py-4 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <StickyNote className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Internal notes</h3>
          <span className="cc-meta text-[11px] ml-auto">
            {(notes ?? []).length}
          </span>
        </div>
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
          <div className="text-muted-foreground italic">No notes yet.</div>
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
                    {n.createdAt
                      ? ` · ${new Date(n.createdAt).toLocaleString()}`
                      : ""}
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
        <div className="space-y-1.5 pt-1">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add an internal note (operators only)…"
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
      </CardContent>
    </Card>
  );
}

// ─── Right column: parent invoice ───────────────────────────────────
function ParentInvoiceCard({ detail }: { detail: DetailGroup }) {
  return (
    <Card data-testid="queue-dossier-card-parent-invoice">
      <CardContent className="py-3 space-y-1.5 text-xs">
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Parent invoice</h3>
        </div>
        <div className="font-mono text-sm font-bold">
          {detail.invoiceNumber ? (
            <RefNumber value={detail.invoiceNumber} variant="inline" />
          ) : (
            <span>INV-{detail.id}</span>
          )}
        </div>
        <div className="text-muted-foreground">
          {detail.rideCount ?? 0} {detail.rideCount === 1 ? "leg" : "legs"}
          <HideForClerk>
            {detail.totalAmount ? (
              <> · <span className="font-mono">{formatCurrency(detail.totalAmount)}</span></>
            ) : null}
          </HideForClerk>
        </div>
        <div className="text-muted-foreground">
          Phase: <span className="font-medium text-foreground">{detail.macroPhase ?? detail.phase ?? "—"}</span>
        </div>
        {detail.holdReason && (
          <div className="text-muted-foreground truncate" title={detail.holdReason}>
            On hold: {detail.holdReason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Right column: payor verdict ────────────────────────────────────
function PayorVerdictCard({
  leg,
  detail,
}: {
  leg: ClaimResponse;
  detail: DetailGroup;
}) {
  const qc = useQueryClient();
  const recordMutation = useRecordLegVerdict();
  const clearMutation = useClearLegVerdictDraft();
  const { data: claim } = useGetClaim(leg.id, {
    query: { queryKey: getGetClaimQueryKey(leg.id), enabled: !!leg.id },
  });
  const live = (claim ?? leg) as ClaimResponse;
  const phase = detail.macroPhase ?? null;
  const canEdit =
    phase === "response-pending" ||
    phase === "mas-action-required" ||
    phase === "awaiting-payout" ||
    phase === "closed";
  const verdict = live.latestVerdict ?? null;
  function invalidateLeg() {
    qc.invalidateQueries({ queryKey: getGetClaimQueryKey(leg.id) });
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(detail.id) });
  }
  return (
    <Card data-testid="queue-dossier-card-payor-verdict">
      <CardContent className="py-3 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <Gavel className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Latest payor verdict</h3>
        </div>
        {canEdit ? (
          <PerLegVerdictPicker
            claim={live}
            latestVerdict={live.latestVerdict ?? null}
            latestDraft={live.latestDraft ?? null}
            latestSuggestion={live.latestAiSuggestion ?? null}
            onSelect={async (outcome) => {
              await recordMutation.mutateAsync({
                id: leg.id,
                data: { source: "operator_draft", outcome },
              });
              invalidateLeg();
            }}
            onClear={async () => {
              await clearMutation.mutateAsync({ id: leg.id });
              invalidateLeg();
            }}
          />
        ) : verdict ? (
          <div className="space-y-1">
            <div className="font-medium">{verdict.outcome}</div>
            <div className="text-muted-foreground">
              via {verdict.source}
              {verdict.createdAt ? ` · ${formatDateTime(verdict.createdAt)}` : ""}
            </div>
            {verdict.note && (
              <div className="whitespace-pre-wrap">{verdict.note}</div>
            )}
          </div>
        ) : (
          <div className="text-muted-foreground italic">
            No verdict yet — recorded after submission.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Right column: MAS action ───────────────────────────────────────
function MasActionCard({
  leg,
  detail,
}: {
  leg: ClaimResponse;
  detail: DetailGroup;
}) {
  const qc = useQueryClient();
  const completeMutation = useCompleteLegMasAction();
  const { data: claim } = useGetClaim(leg.id, {
    query: { queryKey: getGetClaimQueryKey(leg.id), enabled: !!leg.id },
  });
  const live = (claim ?? leg) as ClaimResponse;
  const masRequired = live.masActionRequired === "cancel";
  const masCompleted = !!live.masActionCompletedAt;
  const phase = detail.macroPhase ?? null;
  return (
    <Card data-testid="queue-dossier-card-mas-action">
      <CardContent className="py-3 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <Stamp className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">MAS action</h3>
        </div>
        {!masRequired ? (
          <div className="text-muted-foreground italic">
            No MAS action required for this leg.
          </div>
        ) : masCompleted ? (
          <div className="text-emerald-700 font-medium">
            MAS cancel complete
            {live.masActionCompletedAt
              ? ` · ${formatDateTime(live.masActionCompletedAt)}`
              : ""}
          </div>
        ) : (
          <div className="text-amber-700 font-medium">Cancel required</div>
        )}
        {masRequired && live.masActionNote && (
          <div className="whitespace-pre-wrap text-muted-foreground">
            {live.masActionNote}
          </div>
        )}
        {masRequired && phase === "mas-action-required" && !masCompleted ? (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={false}
              disabled={completeMutation.isPending}
              onChange={async (e) => {
                if (!e.target.checked) return;
                await completeMutation.mutateAsync({ id: leg.id, data: {} });
                qc.invalidateQueries({ queryKey: getGetClaimQueryKey(leg.id) });
                qc.invalidateQueries({
                  queryKey: getGetInvoiceGroupQueryKey(detail.id),
                });
              }}
              data-testid="mini-mas-cancel-checkbox"
            />
            <span>I cancelled this trip in MAS for this leg.</span>
          </label>
        ) : !masCompleted ? (
          <p className="text-muted-foreground italic">
            Cancel can only be stamped while the invoice is in MAS Action
            Required.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Right column: activity ─────────────────────────────────────────
function ActivityCard({
  detail,
  groupId,
  legId,
}: {
  detail: DetailGroup;
  groupId: number;
  legId: number;
}) {
  const [filter, setFilter] = useState<ActionCategory | "all">("all");
  const auditLogs = (detail.auditLogs ?? []) as React.ComponentProps<
    typeof ActivityFeed
  >["auditLogs"];
  const notes = (detail.notes ?? []) as React.ComponentProps<
    typeof ActivityFeed
  >["notes"];
  return (
    <Card data-testid="queue-dossier-card-activity">
      <CardContent className="py-3 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Activity</h3>
        </div>
        <ActivityFeed
          auditLogs={auditLogs}
          notes={notes}
          kind="group"
          filter={filter}
          onFilterChange={setFilter}
          title=""
          className="border-0 shadow-none bg-transparent"
          maxHeightClass="max-h-[40vh]"
          testId="dossier-activity-feed"
        />
        <div className="flex justify-end pt-1 border-t">
          <Link
            href={`/invoice-groups/${groupId}?leg=${legId}#activity`}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Open full activity view <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Right column: group next step ──────────────────────────────────
function GroupNextStepCard({
  detail,
  groupId,
  onJumpToLeg,
}: {
  detail: DetailGroup;
  groupId: number;
  onJumpToLeg: (id: number) => void;
}) {
  // InvoiceGroupActionSlot internally routes between the submission
  // gauntlet (has_disputable), the Re-attest CTA (reattest_only), and
  // the Close-as-Withdrawn CTA (nothing_to_do). We always mount it for
  // non-submitted/non-withdrawn groups so the operator sees the
  // group-level next move alongside the per-leg walk.
  return (
    <Card data-testid="queue-dossier-card-group-next-step">
      <CardContent className="py-3 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <Send className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Group next step</h3>
        </div>
        <InvoiceGroupActionSlot
          bare
          group={detail}
          groupId={groupId}
          onJumpToLeg={onJumpToLeg}
        />
      </CardContent>
    </Card>
  );
}

// ─── Right column: per-leg hold + duplicate controls ────────────────
function LegHoldControls({
  leg,
  legHoldActive,
  groupHoldActive,
  onPlaceLegHold,
  onPlaceGroupHold,
  onMarkDuplicate,
}: {
  leg: ClaimResponse;
  legHoldActive: boolean;
  groupHoldActive: boolean;
  onPlaceLegHold: () => void;
  onPlaceGroupHold: () => void;
  onMarkDuplicate: () => void;
}) {
  return (
    <Card>
      <CardContent className="py-3 space-y-2 text-xs">
        <div className="flex items-center gap-2">
          <PauseCircle className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Leg actions</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {legHoldActive ? (
            <ReleaseLegHoldButton legId={leg.id} />
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={onPlaceLegHold}
              data-testid="mini-place-leg-hold"
            >
              <PauseCircle className="w-3 h-3 mr-1" />
              Hold leg
            </Button>
          )}
          {!groupHoldActive && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={onPlaceGroupHold}
              data-testid="mini-place-group-hold"
            >
              <PauseCircle className="w-3 h-3 mr-1" />
              Hold invoice
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={onMarkDuplicate}
            disabled={!!leg.duplicateOfClaimId}
            data-testid="mini-mark-duplicate"
          >
            Mark duplicate
          </Button>
        </div>
      </CardContent>
    </Card>
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

// ─── Dialogs ────────────────────────────────────────────────────────
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
          toast({
            title: "Mark duplicate failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
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
