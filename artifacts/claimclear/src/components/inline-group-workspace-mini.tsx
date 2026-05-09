import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoiceGroup,
  useGetClaim,
  useHoldInvoiceGroup,
  usePlaceLegOnHold,
  useRemoveInvoiceGroupHold,
  useRemoveLegHold,
  useListErrorTypes,
  getGetClaimQueryKey,
  getGetInvoiceGroupValidTransitionsQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  ErrorTypeResponse,
  InvoiceGroupDetailResponse,
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
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RefNumber } from "@/components/ref-number";
import { ClaimDetailV2 } from "@/components/claim-detail-v2";
import { ClassifyDialog } from "@/components/classify-dialog";
import { EvidenceFileList } from "@/components/evidence-file-list";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import { InvoiceGroupActionSlot } from "@/components/invoice-group-action-slot";
import { useUrlParams } from "@/lib/use-url-params";
import { formatCurrency } from "@/lib/format";
import { HideForClerk } from "@/lib/role";
import {
  buildPhaseConfigV3,
} from "@/components/inline-group-workspace-v3";
import {
  deriveInvoiceDisputeOutlook,
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
// One stable hero per leg with six explicit states (Classify, SOP,
// Resolved, Preview, Review, Submitted), a 4-chip strip with one
// inline accordion panel for context (Evidence/Notes/Comms/Activity),
// a persistent group-hold banner, and a single pinned footer that
// owns the readiness pill, helper copy, and the only Submit CTA.
//
// This component is *additive* — it ships behind a feature flag in
// queue.tsx and leaves the classic + V3 right panes untouched.
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

export function InlineGroupWorkspaceMini({ groupId }: Props) {
  const { get, set } = useUrlParams();
  const legParam = Number.parseInt(get("leg"), 10);
  const urlLegId: number | null =
    Number.isFinite(legParam) && legParam > 0 ? legParam : null;

  const [chipOpen, setChipOpen] = useState<ChipKey | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  const submitted =
    !!detail.outcome &&
    detail.outcome !== "Withdrawn" &&
    detail.outcome !== "Non-Issue" &&
    detail.status !== "New" &&
    detail.status !== "Needs Evidence";

  const phase = buildPhaseConfigV3({
    outlook,
    legCount: rides.length,
    resolvedCount,
    previewGenerated,
    draftReviewed,
    submitted,
    needsClassificationCount,
  });

  const groupHoldActive =
    !submitted &&
    (getGroupLifecyclePhaseFromGroup(detail) === "on-hold" ||
      (detail.holdReason ?? null) != null);
  const legHoldActive =
    !submitted &&
    !groupHoldActive &&
    activeLeg != null &&
    activeLeg.sopOutcome !== "hold" &&
    (activeLeg.holdReason ?? null) != null;

  // ─── Hero state machine ─────────────────────────────────────────────
  // Six explicit states keyed off real group/leg data — no hidden
  // intermediate cards, no overlapping decks. Order matters: Submitted
  // wins, then Review/Preview chrome, then per-leg work (Classify or
  // SOP) or the per-leg "Resolved" terminal.
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
    >
      <GroupSummaryHeader
        detail={detail}
        rides={rides}
        activeLeg={activeLeg}
        resolvedIndex={resolvedIndex}
        onSelectLeg={setActiveLegId}
        onOpenDetails={() => setDetailsOpen(true)}
      />

      {groupHoldActive && (
        <GroupHoldBanner
          detail={detail}
          onPlaceHoldEdit={() => setHoldGroupOpen(true)}
        />
      )}

      <div aria-live="polite" className="cc-mini-hero">
        {hero === "submitted" && <SubmittedHero detail={detail} />}
        {hero === "review" && <ReviewHero detail={detail} />}
        {hero === "preview" && <PreviewHero detail={detail} />}
        {hero === "empty" && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              This invoice has no legs to walk.
            </CardContent>
          </Card>
        )}
        {hero === "resolved" && activeLeg && (
          <ResolvedHero leg={activeLeg} />
        )}
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
          onOpenFullDetails={() => setDetailsOpen(true)}
          onPlaceLegHold={() => setHoldLegOpen(true)}
          legHoldActive={legHoldActive}
        />
      )}

      <PinnedFooter
        phase={phase}
        detail={detail}
        groupId={groupId}
        activeLeg={activeLeg}
        onJumpToLeg={setActiveLegId}
        onPlaceGroupHold={() => setHoldGroupOpen(true)}
        groupHoldActive={groupHoldActive}
        outlook={outlook}
      />

      {/* Full leg details — kept as the existing Sheet so editing-heavy
          surfaces (composer, comms reply, activity) stay ergonomic. */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl overflow-y-auto"
          data-testid="mini-details-drawer"
        >
          <SheetHeader>
            <SheetTitle>
              {activeLeg ? (
                <>
                  Leg details ·{" "}
                  <RefNumber value={activeLeg.confNumber} variant="inline" />
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
                No active leg to show.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

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

// ─── Group summary header (with Leg tabs) ───────────────────────────
function GroupSummaryHeader({
  detail,
  rides,
  activeLeg,
  resolvedIndex,
  onSelectLeg,
  onOpenDetails,
}: {
  detail: DetailGroup;
  rides: ClaimResponse[];
  activeLeg: ClaimResponse | null;
  resolvedIndex: ReturnType<typeof buildLegResolvedIndex>;
  onSelectLeg: (id: number) => void;
  onOpenDetails: () => void;
}) {
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
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 px-2 text-xs"
        onClick={onOpenDetails}
        data-testid="mini-open-details"
      >
        Full details
        <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
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

// ─── Group-hold banner (persistent across all heroes) ───────────────
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
          successToast({ title: "__VERB__", description: "Hold released" });
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
          This leg has no error type yet. Pick one to unlock the SOP walk.
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

function PreviewHero({ detail }: { detail: DetailGroup }) {
  return (
    <Card>
      <CardContent className="py-5 space-y-2">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Preview generated</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          The dispute draft is ready. Open Full details to review the subject
          and body, then come back here to submit.
        </p>
      </CardContent>
    </Card>
  );
}

function ReviewHero({ detail }: { detail: DetailGroup }) {
  return (
    <Card>
      <CardContent className="py-5 space-y-2">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Reviewed — ready to submit</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          The draft has been reviewed. Submit to the portal from the footer
          below.
        </p>
      </CardContent>
    </Card>
  );
}

function SubmittedHero({ detail }: { detail: DetailGroup }) {
  return (
    <Card>
      <CardContent className="py-5 space-y-2">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold">Submitted to the portal</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Outcome: {detail.outcome ?? "—"} · Status: {detail.status}
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Chip strip with inline expand panel ────────────────────────────
function ChipStrip({
  leg,
  openChip,
  onToggle,
  onOpenFullDetails,
  onPlaceLegHold,
  legHoldActive,
}: {
  leg: ClaimResponse;
  groupId: number;
  openChip: ChipKey | null;
  onToggle: (k: ChipKey) => void;
  onOpenFullDetails: () => void;
  onPlaceLegHold: () => void;
  legHoldActive: boolean;
}) {
  // Counts come from the claim payload itself — no extra fetches. This
  // matches v3's `WalkSopHero` counts strip and keeps the chip strip
  // cheap to render even when the operator has the full leg list open.
  const evidenceFiles = leg.evidenceFiles ?? [];
  const evidenceCount = evidenceFiles.length;
  const hasNotes = (leg.evidenceNotes ?? "").trim().length > 0;
  const notesCount = hasNotes ? 1 : 0;

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
          count={notesCount}
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
          {legHoldActive && (
            <ReleaseLegHoldButton legId={leg.id} />
          )}
        </div>
      </div>

      {openChip && (
        <div className="cc-mini-chip-panel" data-testid={`mini-chip-panel-${openChip}`}>
          {openChip === "evidence" && (
            <EvidenceFileList
              urls={evidenceFiles.map((f) => f.url).filter((u): u is string => !!u)}
            />
          )}
          {openChip === "notes" && (
            <NotesPanel
              notes={(leg.evidenceNotes ?? "").trim()}
              onOpenFullDetails={onOpenFullDetails}
            />
          )}
          {openChip === "comms" && (
            <CommsPanel onOpenFullDetails={onOpenFullDetails} />
          )}
          {openChip === "activity" && (
            <ActivityPanel onOpenFullDetails={onOpenFullDetails} />
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

function NotesPanel({
  notes,
  onOpenFullDetails,
}: {
  notes: string;
  onOpenFullDetails: () => void;
}) {
  if (!notes) {
    return (
      <div className="text-xs text-muted-foreground py-2">
        No evidence notes yet.{" "}
        <button
          type="button"
          className="underline"
          onClick={onOpenFullDetails}
        >
          Add a note in full details →
        </button>
      </div>
    );
  }
  return (
    <div className="text-xs space-y-1.5">
      <div className="whitespace-pre-wrap">{notes}</div>
      <button
        type="button"
        className="underline text-muted-foreground"
        onClick={onOpenFullDetails}
      >
        Open full details to edit →
      </button>
    </div>
  );
}

function CommsPanel({
  onOpenFullDetails,
}: {
  onOpenFullDetails: () => void;
}) {
  return (
    <div className="text-xs space-y-1.5">
      <div>Payor email conversations live in full details.</div>
      <button
        type="button"
        className="underline text-muted-foreground"
        onClick={onOpenFullDetails}
      >
        Open full details to read or reply →
      </button>
    </div>
  );
}

function ActivityPanel({
  onOpenFullDetails,
}: {
  onOpenFullDetails: () => void;
}) {
  return (
    <div className="text-xs space-y-1.5">
      <div>Audit trail and recent activity live in full details.</div>
      <button
        type="button"
        className="underline text-muted-foreground"
        onClick={onOpenFullDetails}
      >
        Open full details to view activity →
      </button>
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
          successToast({ title: "__VERB__", description: "Leg hold released" });
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

// ─── Pinned footer (readiness pill + helper + Submit) ───────────────
function PinnedFooter({
  phase,
  detail,
  groupId,
  activeLeg,
  onJumpToLeg,
  onPlaceGroupHold,
  groupHoldActive,
  outlook,
}: {
  phase: ReturnType<typeof buildPhaseConfigV3>;
  detail: DetailGroup;
  groupId: number;
  activeLeg: ClaimResponse | null;
  onJumpToLeg: (id: number | null) => void;
  onPlaceGroupHold: () => void;
  groupHoldActive: boolean;
  outlook: ReturnType<typeof deriveInvoiceDisputeOutlook>["outlook"];
}) {
  return (
    <div className="space-y-2">
      <div
        className="cc-footer-card cc-footer-pinned"
        data-testid="mini-pinned-footer"
      >
        <span
          className={`cc-pill cc-pill-${phase.pill.tone}`}
          data-testid="mini-phase-pill"
        >
          {phase.pill.label}
        </span>
        <span className="cc-meta text-xs flex-1 min-w-0">{phase.helper}</span>
        {!groupHoldActive && outlook !== "nothing_to_do" && (
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
      {/* The single Submit/Generate/Re-attest CTA — delegated to the
          existing gauntlet so the wiring stays canonical. `bare` strips
          the gauntlet's own card chrome so it reads as the footer's
          terminator. */}
      <InvoiceGroupActionSlot
        group={detail}
        groupId={groupId}
        bare
        onJumpToLeg={(id) => onJumpToLeg(id)}
      />
    </div>
  );
}

// ─── Hold dialogs (leg + group) ─────────────────────────────────────
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
          successToast({ title: "__VERB__", description: "Leg placed on hold" });
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
            title: "__VERB__",
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
