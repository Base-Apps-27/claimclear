import { useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Activity,
  AlertTriangle,
  Copy,
  Edit2,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  PauseCircle,
  Play,
  RotateCcw,
  Tag,
  X,
  XCircle,
} from "lucide-react";
import {
  useExcludeLeg,
  useMarkLegDuplicate,
  useReclassifyLeg,
  useRemoveLegHold,
  useRemoveInvoiceGroupHold,
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  getGetClaimQueryKey,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import type {
  ClaimResponse,
  ExcludeLegBody,
  ExcludeLegBodyReason,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { deriveLegSubStatus, buildLegResolvedIndex } from "@workspace/leg-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClassifyDialog } from "@/components/classify-dialog";
import { EvidenceFileList } from "@/components/evidence-file-list";
import { RefNumber } from "@/components/ref-number";
import { useToast, successToast, toast } from "@/hooks/use-toast";
import { markLocalAction } from "@/hooks/use-local-action-mark";
import { formatCurrency } from "@/lib/format";
import { HideForClerk } from "@/lib/role";

// ─────────────────────────────────────────────────────────────────────
// V3 extras — three graduated mockups wired to real backend hooks.
//
//  1. WalkLandingHero — pre-walk landing card. Renders when the active
//     leg has an errorTypeId + tree but no SOP progress yet.
//  2. HoldExitHero    — replaces SOP/landing when a manual hold is
//     active. Covers BOTH leg-scoped (useRemoveLegHold) and group-
//     scoped (useRemoveInvoiceGroupHold) holds. SOP holds keep their
//     existing HoldTerminal inside the SOP player.
//  3. EdgeDrawer      — two right-edge floating cards (leg-context
//     header + per-section card) driven by the chip strip. Replaces
//     the full-height Sheet drawer for chip-driven viewing; the full
//     Sheet+ClaimDetailV2 stays available via "Details" + "Open full
//     leg details →" footer links for editing surfaces (composer,
//     comms, activity) that aren't ergonomic in a 360px panel.
//
// Every field rendered below is already on the existing claim/group
// payload — no invented data.
// ─────────────────────────────────────────────────────────────────────

export type DrawerSection = "evidence" | "notes" | "comms" | "activity";

// ─────────────────────────────────────────────────────────────────────
// Shared "leg actions" hook — owns the dialog state for Reclassify /
// Mark-as-duplicate / Exclude / Classify and exposes the trigger
// buttons + portal nodes. Both the landing hero and the edge-drawer
// header card mount the same set, so the user gets identical
// behavior wherever the buttons live.
// ─────────────────────────────────────────────────────────────────────

interface LegActionsProps {
  claim: ClaimResponse;
  group: InvoiceGroupDetailResponse;
  /** Compact buttons for the landing hero / drawer header card. */
  size?: "sm" | "xs";
}

function useLegActions({ claim, group }: { claim: ClaimResponse; group: InvoiceGroupDetailResponse }) {
  const qc = useQueryClient();
  const { toast: localToast } = useToast();
  const reclassifyMutation = useReclassifyLeg();
  const excludeMutation = useExcludeLeg();
  const markDuplicateMutation = useMarkLegDuplicate();

  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excludeReason, setExcludeReason] = useState<ExcludeLegBodyReason | "">("");
  const [excludeNote, setExcludeNote] = useState("");
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicatePrimaryId, setDuplicatePrimaryId] = useState<string>("");
  const [duplicateNote, setDuplicateNote] = useState("");

  const excludeValid =
    excludeReason !== "" &&
    (excludeReason !== "other" || excludeNote.trim().length > 0);

  // Sibling-duplicate primary candidates: any other leg in the same
  // group that's not this one and not already a duplicate.
  const duplicatePrimaryCandidates = useMemo(
    () =>
      (group.rides ?? []).filter(
        (r) =>
          r.id !== claim.id &&
          r.duplicateOfClaimId == null &&
          r.includedInDispute !== false,
      ),
    [group.rides, claim.id],
  );

  const subStatus = deriveLegSubStatus(claim);
  const canReclassify =
    !!claim.errorTypeId &&
    subStatus !== "needs_classification" &&
    claim.duplicateOfClaimId == null;
  const canExclude = subStatus === "needs_classification";
  const canMarkDuplicate =
    claim.duplicateOfClaimId == null &&
    duplicatePrimaryCandidates.length > 0 &&
    claim.includedInDispute !== false;

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claim.id) });
    if (claim.invoiceGroupId != null) {
      qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(claim.invoiceGroupId) });
    }
    qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
  }

  function onReclassify() {
    reclassifyMutation.mutate(
      { id: claim.id },
      {
        onSuccess: () => {
          markLocalAction(`claim:${claim.id}`);
          successToast({ title: "__VERB__", description: "Leg reclassified — pick an error type to start over" });
          setReclassifyOpen(false);
          invalidate();
        },
        onError: (e: unknown) =>
          localToast({
            title: "Reclassify failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  function onExclude() {
    if (!excludeValid) return;
    const body: ExcludeLegBody = {
      reason: excludeReason as ExcludeLegBodyReason,
      ...(excludeNote.trim() ? { note: excludeNote.trim() } : {}),
    };
    excludeMutation.mutate(
      { id: claim.id, data: body },
      {
        onSuccess: () => {
          markLocalAction(`claim:${claim.id}`);
          successToast({ title: "__VERB__", description: "Leg excluded from dispute" });
          setExcludeOpen(false);
          setExcludeReason("");
          setExcludeNote("");
          invalidate();
        },
        onError: (e: unknown) =>
          localToast({
            title: "Exclude failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  function onMarkDuplicate() {
    const primaryId = Number.parseInt(duplicatePrimaryId, 10);
    if (!Number.isFinite(primaryId)) return;
    markDuplicateMutation.mutate(
      {
        id: claim.id,
        data: { primaryClaimId: primaryId, ...(duplicateNote.trim() ? { note: duplicateNote.trim() } : {}) },
      },
      {
        onSuccess: () => {
          markLocalAction(`claim:${claim.id}`);
          successToast({ title: "__VERB__", description: "Leg marked as Sibling Duplicate" });
          setDuplicateOpen(false);
          setDuplicatePrimaryId("");
          setDuplicateNote("");
          invalidate();
        },
        onError: (e: unknown) =>
          localToast({
            title: "Mark as duplicate failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  // ── Dialog portals — rendered once near the top of the host node. ──
  const dialogs = (
    <>
      <Dialog open={reclassifyOpen} onOpenChange={setReclassifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Reclassify this leg?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              This will <strong>discard the SOP walk and any drop reason</strong>{" "}
              on this leg, returning it to <em>needs classification</em>.
            </p>
            <p className="text-muted-foreground">
              Use this when the wrong error type was assigned at the start.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReclassifyOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={onReclassify}
              disabled={reclassifyMutation.isPending}
              data-testid="v3-leg-reclassify-confirm"
            >
              {reclassifyMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
              )}
              Reset SOP and reclassify
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={excludeOpen} onOpenChange={setExcludeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exclude this leg from the dispute?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The leg will stay visible on the invoice but won't appear in dispute work queues.
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Reason</label>
              <Select
                value={excludeReason}
                onValueChange={(v) => setExcludeReason(v as ExcludeLegBodyReason)}
              >
                <SelectTrigger data-testid="v3-leg-exclude-reason">
                  <SelectValue placeholder="Select a reason…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clean_leg">Clean leg</SelectItem>
                  <SelectItem value="out_of_scope">Out of scope</SelectItem>
                  <SelectItem value="duplicate">Duplicate</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {excludeReason === "other" && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Note (required)</label>
                <Textarea
                  value={excludeNote}
                  onChange={(e) => setExcludeNote(e.target.value)}
                  placeholder="Explain why this leg is excluded…"
                  rows={3}
                  data-testid="v3-leg-exclude-note"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExcludeOpen(false)}>Cancel</Button>
            <Button
              onClick={onExclude}
              disabled={!excludeValid || excludeMutation.isPending}
              data-testid="v3-leg-exclude-confirm"
            >
              {excludeMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <XCircle className="h-3.5 w-3.5 mr-1" />
              )}
              Exclude
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark this leg as a Sibling Duplicate?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sibling Duplicates ride along with a primary leg whose
              trip-overriding error invalidates the whole trip
              (e.g. eligibility lapse). The primary leg's SOP and
              verdict cover this leg, so we don't double-bill the same
              dispute.
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Primary leg (same invoice)</label>
              <Select value={duplicatePrimaryId} onValueChange={setDuplicatePrimaryId}>
                <SelectTrigger data-testid="v3-leg-mark-duplicate-primary">
                  <SelectValue placeholder="Pick a primary leg…" />
                </SelectTrigger>
                <SelectContent>
                  {duplicatePrimaryCandidates.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.confNumber || `CLM-${p.id}`}
                      {p.errorTypeName ? ` · ${p.errorTypeName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Note (optional)</label>
              <Textarea
                value={duplicateNote}
                onChange={(e) => setDuplicateNote(e.target.value)}
                placeholder="e.g. Same eligibility lapse covers both legs of this trip."
                rows={3}
                data-testid="v3-leg-mark-duplicate-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateOpen(false)}>Cancel</Button>
            <Button
              onClick={onMarkDuplicate}
              disabled={!duplicatePrimaryId || markDuplicateMutation.isPending}
              data-testid="v3-leg-mark-duplicate-confirm"
            >
              {markDuplicateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Copy className="h-3.5 w-3.5 mr-1" />
              )}
              Mark as Sibling Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClassifyDialog
        open={classifyOpen}
        onOpenChange={setClassifyOpen}
        groupId={group.id as number}
        highlightLegId={claim.id}
      />
    </>
  );

  return {
    dialogs,
    canReclassify,
    canExclude,
    canMarkDuplicate,
    canChangeClassification: !!claim.errorTypeId,
    openReclassify: () => setReclassifyOpen(true),
    openExclude: () => setExcludeOpen(true),
    openMarkDuplicate: () => setDuplicateOpen(true),
    openClassify: () => setClassifyOpen(true),
  };
}

function ActionButtons({
  size = "sm",
  canReclassify,
  canExclude,
  canMarkDuplicate,
  openReclassify,
  openExclude,
  openMarkDuplicate,
}: {
  size?: "sm" | "xs";
  canReclassify: boolean;
  canExclude: boolean;
  canMarkDuplicate: boolean;
  openReclassify: () => void;
  openExclude: () => void;
  openMarkDuplicate: () => void;
}) {
  const iconCls = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";
  const btnCls =
    size === "xs"
      ? "h-7 gap-1 text-[11px] px-2"
      : "h-8 gap-1 text-xs px-2.5";
  return (
    <>
      {canReclassify && (
        <Button
          size="sm"
          variant="outline"
          className={btnCls}
          onClick={openReclassify}
          data-testid="v3-action-reclassify"
        >
          <Tag className={iconCls} /> Reclassify
        </Button>
      )}
      {canMarkDuplicate && (
        <Button
          size="sm"
          variant="outline"
          className={btnCls}
          onClick={openMarkDuplicate}
          data-testid="v3-action-mark-duplicate"
        >
          <Copy className={iconCls} /> Mark as duplicate
        </Button>
      )}
      {canExclude && (
        <Button
          size="sm"
          variant="outline"
          className={btnCls}
          onClick={openExclude}
          data-testid="v3-action-exclude"
        >
          <XCircle className={iconCls} /> Exclude
        </Button>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 1. WalkLandingHero — pre-walk landing card.
// Mirrors V3LandingStartWalk.tsx (mockup-sandbox). All fields pulled
// from the existing claim / group payload.
// ─────────────────────────────────────────────────────────────────────

export function WalkLandingHero({
  claim,
  group,
  onStartWalk,
  onOpenSection,
}: {
  claim: ClaimResponse;
  group: InvoiceGroupDetailResponse;
  onStartWalk: () => void;
  onOpenSection?: (section: DrawerSection) => void;
}) {
  const actions = useLegActions({ claim, group });

  const evidenceCount = (claim.evidenceFiles ?? []).length;
  const noteCount = (claim.evidenceNotes ?? "").trim().length > 0 ? 1 : 0;

  return (
    <div data-testid="v3-hero-walk-landing" className="space-y-2">
      {actions.dialogs}
      <div
        className="cc-card cc-sop-card"
        style={{
          padding: "1.125rem 1.25rem 1rem",
          maxWidth: 720,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {/* Meta row — every field already on the claim payload */}
        <div className="cc-meta text-[11px] mb-2 flex items-center gap-2 flex-wrap">
          <RefNumber value={claim.confNumber} variant="inline" />
          {claim.date && <><span>·</span><span>DOS {claim.date}</span></>}
          <HideForClerk>
            {claim.claimAmount && (
              <>
                <span>·</span>
                <span className="mono">{formatCurrency(claim.claimAmount)}</span>
              </>
            )}
          </HideForClerk>
          {claim.updatedAt && (
            <>
              <span>·</span>
              <span>Updated {relativeTime(claim.updatedAt)}</span>
            </>
          )}
        </div>

        {/* Status + classification with Change affordance */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] font-normal">
            Not started
          </Badge>
          <span className="cc-meta text-xs">·</span>
          {claim.errorTypeName ? (
            <span className="text-xs font-medium">{claim.errorTypeName}</span>
          ) : (
            <span className="text-xs italic text-muted-foreground">Not yet classified</span>
          )}
          {actions.canChangeClassification && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px]"
              onClick={actions.openClassify}
              data-testid="v3-landing-change-classification"
            >
              <Edit2 className="h-3 w-3 mr-1" /> Change
            </Button>
          )}
        </div>

        {/* Heading — generic UI copy, no invented data */}
        <h3 className="cc-sop-question text-base mt-3 font-semibold">
          Ready to walk this leg
        </h3>
        <p className="cc-meta text-xs mt-1 leading-relaxed">
          Walking the SOP confirms whether this leg is disputable. You can stop
          and resume at any time, and your answers are saved as you go.
        </p>

        {/* Group state line — pulled from the existing group payload */}
        <div
          className="text-[11px] mt-3 pt-3"
          style={{
            borderTop: "1px solid var(--cc-blue-border, var(--cc-border))",
            color: "var(--cc-muted-fg)",
          }}
        >
          Group state:{" "}
          <span className="font-medium" style={{ color: "var(--cc-fg)" }}>
            {group.status}
          </span>
        </div>

        {/* Primary CTA */}
        <div className="cc-sop-actions mt-3">
          <Button
            onClick={onStartWalk}
            size="sm"
            data-testid="v3-landing-start-walk"
          >
            Start walk <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>

        {/* Escape hatches — existing leg actions */}
        {(actions.canReclassify || actions.canMarkDuplicate || actions.canExclude) && (
          <div
            className="mt-3 pt-3 flex items-center gap-1.5 flex-wrap"
            style={{ borderTop: "1px dashed var(--cc-blue-border, var(--cc-border))" }}
          >
            <span className="cc-meta text-[11px]">
              Or, if this leg shouldn't be walked:
            </span>
            <ActionButtons
              size="xs"
              canReclassify={actions.canReclassify}
              canExclude={actions.canExclude}
              canMarkDuplicate={actions.canMarkDuplicate}
              openReclassify={actions.openReclassify}
              openExclude={actions.openExclude}
              openMarkDuplicate={actions.openMarkDuplicate}
            />
          </div>
        )}
      </div>

      {/* Counts strip — chips open the edge drawer per section */}
      {onOpenSection && (
        <div
          className="flex items-center gap-1.5 flex-wrap mt-2"
          data-testid="v3-landing-counts-strip"
        >
          <CountChip
            label="Evidence"
            count={evidenceCount}
            icon={<Paperclip className="w-3 h-3 inline mr-1" />}
            onClick={() => onOpenSection("evidence")}
          />
          <CountChip
            label="Notes"
            count={noteCount}
            icon={<FileText className="w-3 h-3 inline mr-1" />}
            onClick={() => onOpenSection("notes")}
          />
          <CountChip
            label="Comms"
            icon={<MessageSquare className="w-3 h-3 inline mr-1" />}
            onClick={() => onOpenSection("comms")}
          />
          <CountChip
            label="Activity"
            icon={<Activity className="w-3 h-3 inline mr-1" />}
            onClick={() => onOpenSection("activity")}
          />
        </div>
      )}
    </div>
  );
}

function CountChip({
  label,
  count,
  icon,
  onClick,
}: {
  label: string;
  count?: number;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cc-pill cc-pill-muted hover:opacity-80 transition-opacity"
      data-testid={`v3-counts-chip-${label.toLowerCase()}`}
    >
      {icon}
      {label}
      {count != null ? ` · ${count}` : ""}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 2. HoldExitHero — manual leg or group hold.
// SOP holds (sopOutcome === "hold") still flow through HoldTerminal
// inside SopAdvancePlayer; this hero only fires when the hold was
// placed via /hold (claim.holdReason set, or group.status === "On Hold").
// ─────────────────────────────────────────────────────────────────────

type HoldScope = "leg" | "group";

export function HoldExitHero({
  claim,
  group,
  scope,
  onOpenFullDetails,
}: {
  claim: ClaimResponse;
  group: InvoiceGroupDetailResponse;
  scope: HoldScope;
  onOpenFullDetails?: () => void;
}) {
  const qc = useQueryClient();
  const { toast: localToast } = useToast();
  const removeLegHold = useRemoveLegHold();
  const removeGroupHold = useRemoveInvoiceGroupHold();

  const reason = scope === "leg" ? claim.holdReason : (group as InvoiceGroupDetailResponse & { holdReason?: string | null }).holdReason;
  const placedAt = scope === "leg" ? claim.holdPlacedAt : (group as InvoiceGroupDetailResponse & { holdPlacedAt?: string | null }).holdPlacedAt;
  const pendingFrom = scope === "leg" ? claim.holdPendingFrom : (group as InvoiceGroupDetailResponse & { holdPendingFrom?: string | null }).holdPendingFrom;

  const isPending = scope === "leg" ? removeLegHold.isPending : removeGroupHold.isPending;

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claim.id) });
    if (claim.invoiceGroupId != null) {
      qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(claim.invoiceGroupId) });
    }
    qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
  }

  function onClear() {
    if (scope === "leg") {
      removeLegHold.mutate(
        { id: claim.id },
        {
          onSuccess: () => {
            markLocalAction(`claim:${claim.id}`);
            successToast({ title: "__VERB__", description: "Leg hold cleared — back to the SOP walk" });
            invalidate();
          },
          onError: (e: unknown) =>
            localToast({
              title: "Clear hold failed",
              description: e instanceof Error ? e.message : String(e),
              variant: "destructive",
            }),
        },
      );
    } else {
      removeGroupHold.mutate(
        { id: group.id as number },
        {
          onSuccess: () => {
            successToast({ title: "__VERB__", description: "Group hold cleared — invoice back in queue" });
            invalidate();
          },
          onError: (e: unknown) =>
            localToast({
              title: "Clear hold failed",
              description: e instanceof Error ? e.message : String(e),
              variant: "destructive",
            }),
        },
      );
    }
  }

  return (
    <div data-testid={`v3-hero-hold-exit-${scope}`} className="space-y-2">
      <div
        className="cc-card"
        style={{
          background: "var(--cc-amber-bg)",
          border: "1px solid var(--cc-amber-border, var(--cc-amber-fg))",
          padding: "1.125rem 1.25rem 1rem",
          maxWidth: 720,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {/* Scope chip + when */}
        <div className="flex items-center gap-2 mb-2">
          <Badge
            variant="outline"
            className="text-[10px] uppercase tracking-wide"
            style={{ borderColor: "var(--cc-amber-fg)", color: "var(--cc-amber-fg)" }}
          >
            {scope === "leg" ? "Leg-scoped hold" : "Group-scoped hold"}
          </Badge>
          {placedAt && (
            <span className="cc-meta text-[11px] ml-auto">
              Placed {relativeTime(placedAt)}
            </span>
          )}
        </div>

        {/* Title */}
        <div className="flex items-center gap-2.5">
          <PauseCircle
            className="w-6 h-6 flex-shrink-0"
            style={{ color: "var(--cc-amber-fg)" }}
          />
          <h3 className="text-base font-semibold m-0">
            {scope === "leg" ? "This leg is on hold" : "The whole invoice is on hold"}
          </h3>
        </div>

        {/* Reason + pending-from — already on payload */}
        {(reason || pendingFrom) && (
          <div
            className="mt-3 px-3 py-2 text-xs leading-relaxed rounded"
            style={{
              background: "var(--cc-card)",
              border: "1px solid var(--cc-amber-border, var(--cc-amber-fg))",
            }}
          >
            {reason && (
              <div>
                <span className="cc-meta text-[11px]">Reason:</span>{" "}
                <span className="font-medium">{reason}</span>
              </div>
            )}
            {pendingFrom && (
              <div className="mt-1">
                <span className="cc-meta text-[11px]">Pending from:</span>{" "}
                <span>{pendingFrom}</span>
              </div>
            )}
          </div>
        )}

        {/* Primary clear-hold CTA */}
        <div className="cc-sop-actions mt-3">
          <Button
            onClick={onClear}
            size="sm"
            disabled={isPending}
            data-testid={`v3-clear-${scope}-hold`}
          >
            {isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
            ) : (
              <Play className="w-3.5 h-3.5 mr-1" />
            )}
            Clear {scope} hold
          </Button>
        </div>

        {/* Footnote with Open details */}
        <div
          className="mt-3 pt-2 text-[11px]"
          style={{
            borderTop: "1px dashed var(--cc-amber-border, var(--cc-amber-fg))",
            color: "var(--cc-muted-fg)",
          }}
        >
          {scope === "leg"
            ? "Clearing this hold returns the leg to the SOP walk where it left off."
            : "Clearing this hold returns the whole invoice to the queue."}
          {onOpenFullDetails && (
            <>
              {" "}
              <button
                type="button"
                onClick={onOpenFullDetails}
                className="underline inline-flex items-center gap-0.5"
                data-testid={`v3-hold-open-details-${scope}`}
              >
                Open details <ArrowUpRight className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 3. EdgeDrawer — two right-edge floating cards.
//   Card A: leg-context header (classification, status, $/DOS, actions)
//   Card B: section card driven by `section` prop ("evidence" | …)
// Replaces the full-height Sheet drawer for chip-driven viewing.
// ─────────────────────────────────────────────────────────────────────

const SECTION_META: Record<DrawerSection, { label: string; icon: React.ComponentType<{ className?: string }>; hint: (claim: ClaimResponse) => string }> = {
  evidence: {
    label: "Evidence",
    icon: Paperclip,
    hint: (c) => {
      const n = (c.evidenceFiles ?? []).length;
      return `${n} file${n === 1 ? "" : "s"} attached`;
    },
  },
  notes: {
    label: "Notes",
    icon: FileText,
    hint: (c) => ((c.evidenceNotes ?? "").trim() ? "1 note on this leg" : "No notes yet"),
  },
  comms: {
    label: "Comms",
    icon: MessageSquare,
    hint: () => "Open full view to read or reply",
  },
  activity: {
    label: "Activity",
    icon: Activity,
    hint: () => "Open full view for the audit log",
  },
};

export function EdgeDrawer({
  open,
  section,
  onSectionChange,
  onClose,
  onOpenFullDetails,
  claim,
  group,
}: {
  open: boolean;
  section: DrawerSection;
  onSectionChange: (s: DrawerSection) => void;
  onClose: () => void;
  onOpenFullDetails: () => void;
  claim: ClaimResponse;
  group: InvoiceGroupDetailResponse;
}) {
  if (!open) return null;
  return (
    <div
      role="region"
      aria-label="Leg edge drawer"
      data-testid="v3-edge-drawer"
      className="hidden lg:flex"
      style={{
        position: "fixed",
        top: "50%",
        right: 0,
        transform: "translateY(-50%)",
        width: 380,
        zIndex: 40,
        flexDirection: "column",
        gap: 12,
        maxHeight: "calc(100vh - 80px)",
      }}
    >
      <LegContextHeaderCard
        claim={claim}
        group={group}
        onClose={onClose}
        onOpenFullDetails={onOpenFullDetails}
      />
      <SectionCard
        section={section}
        onSectionChange={onSectionChange}
        onClose={onClose}
        onOpenFullDetails={onOpenFullDetails}
        claim={claim}
      />
    </div>
  );
}

function LegContextHeaderCard({
  claim,
  group,
  onClose,
  onOpenFullDetails,
}: {
  claim: ClaimResponse;
  group: InvoiceGroupDetailResponse;
  onClose: () => void;
  onOpenFullDetails: () => void;
}) {
  const actions = useLegActions({ claim, group });
  const subStatus = deriveLegSubStatus(claim);
  return (
    <div
      style={{
        position: "relative",
        background: "var(--cc-card, white)",
        borderTop: "1px solid var(--cc-border)",
        borderBottom: "1px solid var(--cc-border)",
        borderLeft: "1px solid var(--cc-border)",
        borderTopLeftRadius: 8,
        borderBottomLeftRadius: 8,
        boxShadow: "-12px 0 28px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,0.06)",
        padding: "0.625rem 0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {actions.dialogs}
      {/* Title row — leg ref + close */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">
          Leg details · <RefNumber value={claim.confNumber} variant="inline" />
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 w-6 p-0"
          onClick={onClose}
          aria-label="Close edge drawer"
          data-testid="v3-edge-drawer-close-header"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Classification + meta */}
      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        {claim.errorTypeName ? (
          <Badge variant="outline" className="text-[10px] font-normal">
            {claim.errorTypeName}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] font-normal italic">
            Unclassified
          </Badge>
        )}
        {claim.date && (
          <span className="cc-meta">· DOS {claim.date}</span>
        )}
      </div>

      {/* $ + status */}
      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
        <HideForClerk>
          {claim.claimAmount && (
            <span className="text-sm font-semibold">{formatCurrency(claim.claimAmount)}</span>
          )}
        </HideForClerk>
        <Badge
          variant="outline"
          className="ml-auto text-[10px] font-normal"
          data-substatus={subStatus}
        >
          {humanizeSubStatus(subStatus)}
        </Badge>
      </div>

      {/* Quick actions */}
      {(actions.canReclassify || actions.canMarkDuplicate || actions.canExclude) && (
        <div className="flex gap-1 flex-wrap">
          <ActionButtons
            size="xs"
            canReclassify={actions.canReclassify}
            canExclude={actions.canExclude}
            canMarkDuplicate={actions.canMarkDuplicate}
            openReclassify={actions.openReclassify}
            openExclude={actions.openExclude}
            openMarkDuplicate={actions.openMarkDuplicate}
          />
        </div>
      )}

      {/* Open invoice in full view */}
      <button
        type="button"
        onClick={onOpenFullDetails}
        className="text-[11px] inline-flex items-center gap-1 text-primary hover:underline self-start"
        data-testid="v3-edge-drawer-open-full"
      >
        Open {group.invoiceNumber ?? `INV-${group.id}`} in full view
        <ArrowUpRight className="w-3 h-3" />
      </button>
    </div>
  );
}

function SectionCard({
  section,
  onSectionChange,
  onClose,
  onOpenFullDetails,
  claim,
}: {
  section: DrawerSection;
  onSectionChange: (s: DrawerSection) => void;
  onClose: () => void;
  onOpenFullDetails: () => void;
  claim: ClaimResponse;
}) {
  const meta = SECTION_META[section];
  const Icon = meta.icon;
  return (
    <div
      style={{
        position: "relative",
        background: "var(--cc-card, white)",
        borderTop: "1px solid var(--cc-border)",
        borderBottom: "1px solid var(--cc-border)",
        borderLeft: "1px solid var(--cc-border)",
        borderTopLeftRadius: 8,
        borderBottomLeftRadius: 8,
        boxShadow: "-12px 0 28px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,0.06)",
        display: "flex",
        flexDirection: "column",
        maxHeight: 420,
        overflow: "hidden",
      }}
    >
      {/* Section selector tabs (also act as the chip strip from the hero) */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 border-b"
        style={{ borderColor: "var(--cc-border)" }}
      >
        {(Object.keys(SECTION_META) as DrawerSection[]).map((key) => {
          const m = SECTION_META[key];
          const I = m.icon;
          const active = key === section;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSectionChange(key)}
              className={`text-[11px] px-2 py-1 rounded inline-flex items-center gap-1 ${
                active
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted"
              }`}
              data-testid={`v3-edge-drawer-tab-${key}`}
              aria-pressed={active}
            >
              <I className="w-3 h-3" /> {m.label}
            </button>
          );
        })}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 w-6 p-0"
          onClick={onClose}
          aria-label="Close edge drawer"
          data-testid="v3-edge-drawer-close-section"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Section header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ borderColor: "var(--cc-border)", background: "var(--cc-bg, transparent)" }}
      >
        <Icon className="w-3.5 h-3.5" />
        <span className="text-xs font-semibold">{meta.label}</span>
        <span className="cc-meta text-[11px]">{meta.hint(claim)}</span>
      </div>

      {/* Section body */}
      <div className="px-3 py-2 overflow-auto flex-1 text-xs">
        {section === "evidence" && (
          <EvidenceFileList
            urls={(claim.evidenceFiles ?? []).map((f) => f.url)}
          />
        )}
        {section === "notes" && (
          claim.evidenceNotes && claim.evidenceNotes.trim() ? (
            <div
              className="rounded border p-2 text-xs whitespace-pre-wrap"
              style={{ borderColor: "var(--cc-border)" }}
              data-testid="v3-edge-drawer-notes-body"
            >
              {claim.evidenceNotes}
            </div>
          ) : (
            <p className="text-muted-foreground italic">
              No notes on this leg yet. Open full view to add one.
            </p>
          )
        )}
        {section === "comms" && (
          <p className="text-muted-foreground">
            Conversations live in the full leg view. Open it to read the
            payor thread or send a reply.
          </p>
        )}
        {section === "activity" && (
          <p className="text-muted-foreground">
            The activity feed (audit log + system notes) lives in the
            full leg view.
          </p>
        )}
      </div>

      {/* Footer link */}
      <div
        className="flex justify-end px-3 py-1.5 border-t"
        style={{ borderColor: "var(--cc-border)", background: "var(--cc-bg, transparent)" }}
      >
        <button
          type="button"
          onClick={onOpenFullDetails}
          className="text-[11px] inline-flex items-center gap-1 text-primary hover:underline"
          data-testid="v3-edge-drawer-open-full-footer"
        >
          Open full leg details <ExternalLink className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function humanizeSubStatus(s: ReturnType<typeof deriveLegSubStatus>): string {
  switch (s) {
    case "needs_classification": return "Needs classification";
    case "investigating": return "Investigating";
    case "ready": return "Ready";
    case "blocked": return "On hold";
    case "dropped": return "Dropped";
    case "frozen": return "Frozen";
    default: return String(s);
  }
}

// Keep the `toast` import marked as used for callers that copy this
// pattern — referencing it here keeps tree-shaking honest without
// adding side effects.
export const __INTERNAL_USED_REFS__ = { buildLegResolvedIndex, toast };
