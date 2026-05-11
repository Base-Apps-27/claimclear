import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { BackBar } from "@/components/back-bar";
import {
  ChipDrawerOverlay,
  MarkDuplicateDialog,
  type ChipKey,
} from "@/components/chip-drawer-overlay";
import { buildLegResolvedIndex } from "@workspace/leg-state";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useClaimEvents } from "@/hooks/use-claim-events";
import { markLocalAction } from "@/hooks/use-local-action-mark";
import { notifyClaimProcessedThisSession } from "@/hooks/use-session-milestones";
import { useActorCausedTransition } from "@/hooks/use-actor-caused-transition";
import { useTransientFlag } from "@/hooks/use-transient-flag";
import {
  useGetClaim,
  getGetClaimQueryKey,
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  useListErrorTypes,
  useReclassifyLeg,
  useExcludeLeg,
  useMarkLegDuplicate,
  useUnmarkLegDuplicate,
  useListClaimNotes,
  getListClaimNotesQueryKey,
  useCreateClaimNote,
  useListClaimAuditLogs,
  getListClaimAuditLogsQueryKey,
  useListClaimEvidence,
  getListClaimEvidenceQueryKey,
  useGetClaimEmailThread,
  getGetClaimEmailThreadQueryKey,
  useRecordLegVerdict,
  useSopRestartLeg,
  useSopBackStepLeg,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import type {
  ErrorTypeResponse,
  ExcludeLegBodyReason,
  NoteResponse,
  AuditLogResponse,
  ClaimEvidenceResponse,
  EmailThreadMessage,
  EvidenceFileRef,
  ClaimResponse,
} from "@workspace/api-client-react";
import { EMAIL_MESSAGE_MAX_BYTES } from "@workspace/api-zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, RotateCcw, AlertTriangle, RefreshCw, XCircle, FileText, Copy, Link2Off, Undo2,
  Edit2, Pin, Plus, Mail, ArrowUpRight, Lock, Activity, Paperclip,
  Gavel, Stamp, Clock, Send, CheckCircle2, ListChecks, Tag, Sparkles,
} from "lucide-react";
import { ClassifyDialog } from "@/components/classify-dialog";
import { RemoveHandledOfflineDialog } from "@/components/remove-handled-offline-dialog";
import { UndoHandledOfflineDialog } from "@/components/undo-handled-offline-dialog";
import { wasMostRecentExitHandledOffline } from "@/components/undo-handled-offline-dialog-helpers";
import { buildSopTranscript, type TranscriptLine } from "@/lib/sop-transcript";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { formatRelative, absoluteTooltip } from "@/lib/time";
import { HideForClerk } from "@/lib/role";
import { useToast, successToast } from "@/hooks/use-toast";
import { useBreath } from "@/hooks/use-breath";
import { cn } from "@/lib/utils";
import { TonePill } from "@/components/cohesion";
import { StateBadge } from "@/components/state-badge";
import { RefNumber } from "@/components/ref-number";
import { DuplicateTerminal } from "@/components/decision-tree/terminals/duplicate-terminal";
import { PerLegVerdictPicker } from "@/components/per-leg-verdict-picker";
import { deriveLegSubStatus } from "@workspace/leg-state";
import type { DecisionTree } from "@/components/decision-tree/types";
import {
  buildTripOverridingErrorTypeIds,
  findSiblingDuplicatePrimaryCandidates,
  siblingPromptEligibilityFor,
} from "@/lib/sop-sibling-eligibility";

// Per-leg processing surface. Group-scoped writes live on the group page;
// this page links out via "Open group ↗". Header actions are pre-submit
// only (reclassify / exclude / mark-or-unmark sibling duplicate).

interface Props {
  claimId: number;
  // True when rendered inside another page (queue). Only embedded mode
  // mounts the live SOP player; standalone shows a read-only transcript.
  embedded?: boolean;
  submissionSlot?: ReactNode;
}

function CcCard({
  title, action, icon, children, padded = true, testId,
}: {
  title: ReactNode; action?: ReactNode; icon?: ReactNode;
  children: ReactNode; padded?: boolean; testId?: string;
}) {
  return (
    <div className="cc-card" data-testid={testId}>
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--cc-border)" }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
        {action}
      </div>
      <div className={padded ? "p-4" : ""}>{children}</div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      className="flex items-center justify-between py-1.5 text-sm"
      style={{ borderBottom: "1px dashed var(--cc-border)" }}
    >
      <span className="text-xs uppercase tracking-wide font-medium" style={{ color: "var(--cc-muted-fg)" }}>
        {label}
      </span>
      <span className="font-medium" style={{ color: "var(--cc-fg)" }}>{value}</span>
    </div>
  );
}

function MutedNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="text-xs flex items-start gap-1.5 px-2.5 py-1.5 rounded"
      style={{ color: "var(--cc-muted-fg)", background: "var(--cc-muted)" }}
    >
      <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// #687 — RecoveryActions removed. Hold place/release now lives only in
// V3HoldExit hero (artifacts/claimclear/src/components/inline-group-workspace-mini.tsx)
// per #682d. Leg-page surfaces a read-only "On hold: <reason>" meta line in the header.

// Task #678: opens the right-edge chip drawer overlay (Evidence panel
// by default) instead of navigating to /invoice-groups/:id. Keeps the
// operator on the leg page so they don't lose their walk context.
function GoToGroupLink({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-xs font-medium inline-flex items-center gap-1 hover:underline"
      style={{ color: "var(--cc-purple-fg)" }}
      data-testid="leg-open-group-overlay"
    >
      {children}<ArrowUpRight className="w-3 h-3" />
    </button>
  );
}

function relativeTime(iso: string | Date | null | undefined): React.ReactNode {
  if (!iso) return <>—</>;
  const isoStr = typeof iso === "string" ? iso : iso.toISOString();
  const rel = formatRelative(isoStr) || "—";
  return <span title={absoluteTooltip(isoStr)}>{rel}</span>;
}

function authorInitial(name: string | null | undefined): string {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase() || "?";
}

function auditIcon(action: string) {
  const a = action.toLowerCase();
  if (a.includes("note")) return <Pin className="w-3 h-3" />;
  if (a.includes("email") || a.includes("reply")) return <Mail className="w-3 h-3" />;
  if (a.includes("evidence") || a.includes("attach")) return <Paperclip className="w-3 h-3" />;
  if (a.includes("sop") || a.includes("walk") || a.includes("submit") || a.includes("package")) return <Send className="w-3 h-3" />;
  if (a.includes("classif") || a.includes("complete") || a.includes("approve")) return <CheckCircle2 className="w-3 h-3" />;
  if (a.includes("hold") || a.includes("exclude") || a.includes("reattest")) return <AlertTriangle className="w-3 h-3" />;
  if (a.includes("context")) return <Edit2 className="w-3 h-3" />;
  if (a.includes("close") || a.includes("withdraw") || a.includes("denied")) return <XCircle className="w-3 h-3" />;
  if (a.includes("create")) return <FileText className="w-3 h-3" />;
  return <Clock className="w-3 h-3" />;
}

function auditTone(action: string): string {
  const a = action.toLowerCase();
  if (a.includes("email") || a.includes("reply")) return "var(--cc-purple-fg)";
  if (a.includes("hold") || a.includes("exclude") || a.includes("reattest")) return "var(--cc-warning)";
  if (a.includes("classif") || a.includes("approve") || a.includes("complete")) return "var(--cc-success)";
  if (a.includes("note") || a.includes("context") || a.includes("sop") || a.includes("submit") || a.includes("package")) return "var(--cc-blue-fg)";
  if (a.includes("denied") || a.includes("close") || a.includes("withdraw")) return "var(--cc-destructive)";
  return "var(--cc-muted-fg)";
}

function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url, "http://x").pathname;
    return decodeURIComponent(path.split("/").filter(Boolean).pop() || url);
  } catch {
    return url.split("?")[0].split("/").filter(Boolean).pop() || url;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildSizeMap(...sources: Array<EvidenceFileRef[] | null | undefined>): Map<string, number> {
  const out = new Map<string, number>();
  for (const src of sources) {
    if (!src) continue;
    for (const f of src) {
      if (f && typeof f.url === "string" && typeof f.size === "number") {
        out.set(f.url, f.size);
      }
    }
  }
  return out;
}

export function ClaimDetailV2({
  claimId,
  embedded = false,
  submissionSlot,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: claim, isLoading } = useGetClaim(claimId, {
    query: { queryKey: getGetClaimQueryKey(claimId), enabled: !!claimId },
  });

  const [classifyOpen, setClassifyOpen] = useState(false);
  // Task #678: per-leg page mounts the same right-edge ChipDrawerOverlay
  // used by the queue mini, so "Open group ↗" arrows surface group-level
  // context without leaving the leg page.
  const [chipOpen, setChipOpen] = useState<ChipKey | null>(null);
  const [drawerMarkDuplicateOpen, setDrawerMarkDuplicateOpen] = useState(false);

  const parentGroupId = claim?.invoiceGroupId ?? null;
  const { data: parentGroup } = useGetInvoiceGroup(parentGroupId ?? 0, {
    query: {
      queryKey: getGetInvoiceGroupQueryKey(parentGroupId ?? 0),
      enabled: parentGroupId !== null && parentGroupId > 0,
    },
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

  const subStatus = useMemo(
    () => (claim ? deriveLegSubStatus(claim) : "needs_classification"),
    [claim],
  );
  const { lastClaimUpdateBy } = useClaimEvents(claimId);
  const { active: justProcessed, fire: fireJustProcessed } = useTransientFlag(500);
  useActorCausedTransition({
    key: `claim:${claimId}`,
    lastUpdateBy: lastClaimUpdateBy,
    currentValue: claim?.status,
    isTransition: (_prev, next) => next === "Processed",
    onTransition: () => {
      fireJustProcessed();
      notifyClaimProcessedThisSession(claimId, claim?.updatedAt ?? null);
    },
  });

  const reclassifyMutation = useReclassifyLeg();
  const excludeMutation = useExcludeLeg();
  const markDuplicateMutation = useMarkLegDuplicate();
  const recordVerdictMutation = useRecordLegVerdict();
  const sopRestartMutation = useSopRestartLeg();
  const sopBackStepMutation = useSopBackStepLeg();
  const unmarkDuplicateMutation = useUnmarkLegDuplicate();
  const createNoteMutation = useCreateClaimNote();

  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [excludeOpen, setExcludeOpen] = useState(false);
  // Task #689 — "Remove — handled offline" exit. Reuses the
  // excludeLeg plumbing under the hood (see RemoveHandledOfflineDialog),
  // but lives next to the existing Exclude trigger so operators can
  // pick the right exit without a nested reason dropdown.
  const [removeHandledOfflineOpen, setRemoveHandledOfflineOpen] = useState(false);
  // Task #694 — counterpart "Undo — re-include leg" exit. Eligibility
  // is gated on the leg being currently `excluded` AND its most recent
  // exit-class audit row being `claim_removed_handled_offline` (the
  // server enforces the same predicate before accepting the undo).
  const [undoHandledOfflineOpen, setUndoHandledOfflineOpen] = useState(false);
  const [excludeReason, setExcludeReason] = useState<ExcludeLegBodyReason | "">("");
  const [excludeNote, setExcludeNote] = useState("");
  const excludeValid =
    excludeReason !== "" &&
    (excludeReason !== "other" || excludeNote.trim().length > 0);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicatePrimaryId, setDuplicatePrimaryId] = useState<string>("");
  const [duplicateNote, setDuplicateNote] = useState("");
  const [unmarkDuplicateOpen, setUnmarkDuplicateOpen] = useState(false);

  const transcriptLines: TranscriptLine[] = useMemo(
    () => buildSopTranscript(claim?.sopAnswers, tree),
    [claim, tree],
  );
  // Note composer state.
  const [newNote, setNewNote] = useState("");
  const noteBreath = useBreath();

  const tripOverridingErrorTypeIds = useMemo(
    () =>
      buildTripOverridingErrorTypeIds(
        (errorTypes ?? []) as Array<ErrorTypeResponse & { tripOverriding?: boolean }>,
      ),
    [errorTypes],
  );

  const duplicatePrimaryCandidates = useMemo(
    () =>
      findSiblingDuplicatePrimaryCandidates({
        selfClaimId: claimId,
        rides: parentGroup?.rides ?? null,
        tripOverridingErrorTypeIds,
      }),
    [parentGroup?.rides, claimId, tripOverridingErrorTypeIds],
  );

  const isDuplicate = claim?.duplicateOfClaimId != null;
  const primaryRef = useMemo(() => {
    if (!isDuplicate || !parentGroup?.rides) return null;
    return parentGroup.rides.find((r) => r.id === claim?.duplicateOfClaimId) ?? null;
  }, [isDuplicate, parentGroup?.rides, claim?.duplicateOfClaimId]);

  const groupIsPreSubmit = parentGroup?.macroPhase === "pre-submit";

  const bulkSiblingCount = useMemo(() => {
    if (!claim || claim.invoiceGroupId == null) return 0;
    if (!claim.sopNodeId || claim.sopOutcome != null) return 0;
    if (!parentGroup?.rides) return 0;
    return parentGroup.rides.filter((r) =>
      r.id !== claim.id &&
      r.sopNodeId === claim.sopNodeId &&
      r.sopOutcome == null &&
      r.includedInDispute === true &&
      r.duplicateOfClaimId == null,
    ).length;
  }, [claim, parentGroup?.rides]);

  const siblingPromptCandidate = useMemo(() => {
    if (!claim) return null;
    return siblingPromptEligibilityFor({
      selfClaimId: claim.id,
      selfErrorTypeId: claim.errorTypeId ?? null,
      selfDuplicateOfClaimId: claim.duplicateOfClaimId ?? null,
      groupMacroPhase: parentGroup?.macroPhase ?? null,
      rides: parentGroup?.rides ?? null,
      errorTypes: (errorTypes ?? []) as Array<ErrorTypeResponse & { tripOverriding?: boolean }>,
    });
  }, [claim, parentGroup?.macroPhase, parentGroup?.rides, errorTypes]);

  const { data: notes } = useListClaimNotes(claimId, {
    query: { queryKey: getListClaimNotesQueryKey(claimId), enabled: !!claimId },
  });
  const { data: auditLogs } = useListClaimAuditLogs(claimId, {
    query: { queryKey: getListClaimAuditLogsQueryKey(claimId), enabled: !!claimId },
  });
  const { data: evidence } = useListClaimEvidence(claimId, {
    query: { queryKey: getListClaimEvidenceQueryKey(claimId), enabled: !!claimId },
  });
  const { data: emailThread } = useGetClaimEmailThread(claimId, {
    query: { queryKey: getGetClaimEmailThreadQueryKey(claimId), enabled: !!claimId },
  });

  const visibleNotes = useMemo<NoteResponse[]>(() => {
    if (!notes) return [];
    return notes
      .filter((n) => n.type === "manual" || n.type === "system" || n.type === "bot")
      .slice()
      .sort(
        (a, b) =>
          new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      );
  }, [notes]);

  const sortedAudit = useMemo<AuditLogResponse[]>(() => {
    if (!auditLogs) return [];
    return auditLogs
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [auditLogs]);

  const evidenceList: ClaimEvidenceResponse[] = useMemo(() => {
    const e = evidence as { evidence?: ClaimEvidenceResponse[] } | ClaimEvidenceResponse[] | undefined;
    if (!e) return [];
    if (Array.isArray(e)) return e.slice();
    return Array.isArray(e.evidence) ? e.evidence.slice() : [];
  }, [evidence]);

  const evidenceSizeByUrl = useMemo<Map<string, number>>(
    () => buildSizeMap(parentGroup?.evidenceFiles, claim?.evidenceFiles),
    [parentGroup?.evidenceFiles, claim?.evidenceFiles],
  );

  const threadMessages: EmailThreadMessage[] = useMemo(() => {
    const msgs = (emailThread as { messages?: EmailThreadMessage[] } | undefined)?.messages;
    return Array.isArray(msgs) ? msgs : [];
  }, [emailThread]);

  function invalidateLeg() {
    qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
    qc.invalidateQueries({ queryKey: getListClaimNotesQueryKey(claimId) });
    qc.invalidateQueries({ queryKey: getListClaimAuditLogsQueryKey(claimId) });
    if (parentGroupId) {
      qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(parentGroupId) });
    }
    qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
  }

  function onReclassify() {
    reclassifyMutation.mutate(
      { id: claimId },
      {
        onSuccess: () => {
          markLocalAction(`claim:${claimId}`);
          successToast({ title: "__VERB__", description: "Leg reclassified — pick an error type to start over" });
          setReclassifyOpen(false);
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Reclassify failed",
          description: String((e as Error).message),
          variant: "destructive",
        }),
      },
    );
  }

  function onExclude() {
    if (!excludeValid || !excludeReason) return;
    excludeMutation.mutate(
      { id: claimId, data: { reason: excludeReason, note: excludeNote || undefined } },
      {
        onSuccess: () => {
          markLocalAction(`claim:${claimId}`);
          successToast({ title: "__VERB__", description: "Leg excluded from dispute" });
          setExcludeOpen(false);
          setExcludeReason("");
          setExcludeNote("");
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Exclude failed",
          description: String((e as Error).message),
          variant: "destructive",
        }),
      },
    );
  }

  function onMarkDuplicate() {
    const primaryId = Number(duplicatePrimaryId);
    if (!Number.isFinite(primaryId) || primaryId <= 0) return;
    markDuplicateMutation.mutate(
      { id: claimId, data: { primaryClaimId: primaryId, note: duplicateNote || null } },
      {
        onSuccess: () => {
          markLocalAction(`claim:${claimId}`);
          successToast({ title: "__VERB__", description: "Leg marked as Sibling Duplicate" });
          setDuplicateOpen(false);
          setDuplicatePrimaryId("");
          setDuplicateNote("");
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Mark as duplicate failed",
          description: String((e as Error).message),
          variant: "destructive",
        }),
      },
    );
  }

  function onUnmarkDuplicate() {
    unmarkDuplicateMutation.mutate(
      { id: claimId },
      {
        onSuccess: () => {
          markLocalAction(`claim:${claimId}`);
          successToast({ title: "__VERB__", description: "Sibling-duplicate link cleared" });
          setUnmarkDuplicateOpen(false);
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Unmark failed",
          description: String((e as Error).message),
          variant: "destructive",
        }),
      },
    );
  }

  function onSubmitNote() {
    const trimmed = newNote.trim();
    if (!trimmed || createNoteMutation.isPending) return;
    createNoteMutation.mutate(
      { id: claimId, data: { content: trimmed, type: "manual" } },
      {
        onSuccess: (created) => {
          setNewNote("");
          noteBreath.trigger();
          if (created) {
            qc.setQueryData<NoteResponse[]>(
              getListClaimNotesQueryKey(claimId),
              (prev: NoteResponse[] | undefined) => {
                const existing = Array.isArray(prev) ? prev : [];
                if (existing.some((n) => n.id === created.id)) return existing;
                return [created, ...existing];
              },
            );
          }
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Couldn't post note",
          description: String((e as Error).message),
          variant: "destructive",
        }),
      },
    );
  }

  if (isLoading || !claim) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading leg…
      </div>
    );
  }

  const hasSopOutcome = !!claim.sopOutcome;
  const canShowPlayer =
    isDuplicate ||
    hasSopOutcome ||
    subStatus === "investigating" ||
    subStatus === "ready" ||
    subStatus === "dropped";
  const playerDisabledReason = parentGroup && !groupIsPreSubmit
    ? `Leg-level edits are no longer accepted — this invoice is "${parentGroup.status}". Open the invoice thread to track progress.`
    : canShowPlayer
      ? null
      : subStatus === "blocked"
        ? "Leg is on hold — clear the hold to advance the SOP."
        : subStatus === "excluded"
          ? "Leg is excluded from the dispute."
          : subStatus === "needs_classification"
            ? "Pick an error type before walking the SOP."
            : null;

  const canReclassify =
    !isDuplicate && (
      subStatus === "investigating" ||
      subStatus === "ready" ||
      subStatus === "dropped" ||
      subStatus === "blocked"
    );

  // Task #694 — eligibility for the "Undo — re-include leg" affordance.
  // Surface only when the leg is currently `excluded` AND the most
  // recent exit-class audit row is `claim_removed_handled_offline`,
  // matching the server-side gate. Plain exclude/include legacy
  // entries stay on the existing /include path with no undo trigger.
  const canUndoHandledOffline =
    subStatus === "excluded" &&
    wasMostRecentExitHandledOffline(sortedAudit);

  const canMarkDuplicate =
    !isDuplicate &&
    groupIsPreSubmit &&
    duplicatePrimaryCandidates.length > 0 &&
    (
      subStatus === "needs_classification" ||
      subStatus === "investigating" ||
      subStatus === "blocked" ||
      subStatus === "ready" ||
      subStatus === "dropped"
    );

  const canUnmarkDuplicate = isDuplicate && groupIsPreSubmit;

  const verdict = claim.latestVerdict ?? null;
  const masRequired = claim.masActionRequired === "cancel";
  const masCompleted = !!claim.masActionCompletedAt;

  const crumbs = [
    { label: "Claims", href: "/claims" },
    ...(parentGroup
      ? [{
          label: `Invoice #${parentGroup.invoiceNumber || parentGroup.id}`,
          href: `/invoice-groups/${parentGroup.id}`,
          mono: true,
        }]
      : []),
    { label: `Leg #${claim.id}`, mono: true },
  ];

  return (
    <div
      className={embedded ? "cc-scope" : "cc-scope min-h-screen p-6"}
      data-testid="claim-detail-v2"
      data-embedded={embedded ? "true" : undefined}
    >
      <div className={embedded ? "space-y-4" : "max-w-[1180px] mx-auto space-y-4"}>
        {(claim as { isTourSample?: boolean })?.isTourSample && (
          <div
            className="text-xs px-3 py-2 rounded border flex items-center gap-2"
            style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)", borderColor: "var(--cc-border)" }}
            data-testid="tour-sample-banner"
          >
            <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              <strong>Tour sample.</strong> This is the read-only claim used by the in-app tour. Edits are disabled.
            </span>
          </div>
        )}

        {embedded ? (
          <div
            className="flex items-center gap-1.5 text-xs flex-wrap"
            style={{ color: "var(--cc-muted-fg)" }}
            data-testid="claim-embedded-crumbs"
          >
            {crumbs.map((c, i) => {
              const isLast = i === crumbs.length - 1;
              const content = c.mono ? (
                <span className="mono">{c.label}</span>
              ) : (
                <span>{c.label}</span>
              );
              return (
                <span key={`${i}-${c.label}`} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span>/</span>}
                  {isLast || !c.href ? (
                    <span style={{ color: "var(--cc-fg)" }}>{content}</span>
                  ) : (
                    <Link href={c.href} className="hover:underline">
                      {content}
                    </Link>
                  )}
                </span>
              );
            })}
          </div>
        ) : (
          <BackBar
            fallbackHref={parentGroup ? `/invoice-groups/${parentGroup.id}` : "/claims"}
            crumbs={crumbs}
            testId="claim-back-bar"
          />
        )}

        <div className="cc-card p-4" data-testid="leg-header">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div
                className="w-1 h-12 rounded flex-shrink-0"
                style={{ background: "var(--cc-blue-fg)" }}
              />
              <div className="min-w-0">
                <div
                  className="text-[11px] uppercase tracking-wide font-semibold mb-0.5"
                  style={{ color: "var(--cc-muted-fg)" }}
                >
                  Leg / claim
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold mono">
                    {claim.confNumber || `CLM-${claim.id}`}
                  </h1>
                  <StateBadge
                    variant="subStatus"
                    value={subStatus}
                    leg={claim ?? undefined}
                    justTransitioned={justProcessed}
                  />
                  {claim.errorTypeName ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                        · {claim.errorTypeName}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-xs"
                        onClick={() => setClassifyOpen(true)}
                        data-testid={`leg-change-error-type-${claim.id}`}
                      >
                        <Edit2 className="h-3 w-3 mr-1" />
                        Change
                      </Button>
                    </span>
                  ) : null}
                  <HideForClerk>
                    <span className="text-xs font-medium mono" style={{ color: "var(--cc-fg)" }}>
                      · {formatCurrency(claim.claimAmount ?? "0")}
                    </span>
                  </HideForClerk>
                  {claim.date ? (
                    <span className="text-xs mono" style={{ color: "var(--cc-muted-fg)" }}>
                      · DOS {claim.date}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs mt-1.5 flex items-center gap-1.5 flex-wrap" style={{ color: "var(--cc-muted-fg)" }}>
                  <span>
                    Updated <span className="font-medium" style={{ color: "var(--cc-fg)" }}>{relativeTime(claim.updatedAt)}</span>
                  </span>
                  {parentGroup?.status ? (
                    <>
                      <span>·</span>
                      <span>Invoice phase:</span>
                      <Link
                        href={`/invoice-groups/${parentGroup.id}`}
                        className="hover:underline"
                        data-testid="leg-header-parent-phase-jump"
                      >
                        <StateBadge variant="status" value={parentGroup.status} />
                      </Link>
                      {parentGroup.macroPhase ? (
                        <span
                          className="text-[11px]"
                          data-testid="leg-header-parent-macro-phase"
                        >
                          ({parentGroup.macroPhase})
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {/* #687 — read-only hold meta line. Place/release lives
                      in the V3HoldExit hero in A only. */}
                  {claim.holdReason ? (
                    <>
                      <span>·</span>
                      <span
                        data-testid="leg-header-hold-meta"
                        title={
                          claim.holdPlacedAt
                            ? `Placed ${formatDateTime(claim.holdPlacedAt)}${
                                claim.holdPendingFrom
                                  ? ` · pending from ${claim.holdPendingFrom}`
                                  : ""
                              }`
                            : undefined
                        }
                      >
                        On hold:{" "}
                        <span className="font-medium" style={{ color: "var(--cc-fg)" }}>
                          {claim.holdReason}
                        </span>
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {canReclassify && (
                <Dialog open={reclassifyOpen} onOpenChange={setReclassifyOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      data-testid="claim-detail-action-reclassify"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Reclassify
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        Reclassify this leg?
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2 text-sm">
                      <p>
                        This will <strong>discard the SOP walk and any drop reason</strong> on
                        this leg, returning it to <em>needs classification</em>.
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
                        data-testid="leg-reclassify-confirm"
                      >
                        {reclassifyMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        )}
                        Reset SOP and reclassify
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}

              {subStatus === "needs_classification" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1"
                  onClick={() => setRemoveHandledOfflineOpen(true)}
                  data-testid="leg-remove-handled-offline-trigger"
                  title="Remove this leg because it was already handled outside ClaimClear"
                >
                  <Link2Off className="h-3.5 w-3.5" /> Remove — handled offline
                </Button>
              )}

              {/* Task #694 — counterpart "Undo — re-include leg"
                  trigger. Mirrors the entry path: confirmation dialog
                  with required note (>=10 chars). Server enforces the
                  same audit-history gate before accepting the request. */}
              {canUndoHandledOffline && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1"
                  onClick={() => setUndoHandledOfflineOpen(true)}
                  data-testid="leg-undo-handled-offline-trigger"
                  title="Re-include this leg in the dispute (reverses the earlier handled-offline removal)"
                >
                  <Undo2 className="h-3.5 w-3.5" /> Undo — re-include leg
                </Button>
              )}

              {subStatus === "needs_classification" && (
                <Dialog open={excludeOpen} onOpenChange={setExcludeOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" data-testid="leg-exclude-trigger" className="h-8 gap-1">
                      <XCircle className="h-3.5 w-3.5" /> Exclude
                    </Button>
                  </DialogTrigger>
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
                          <SelectTrigger data-testid="leg-exclude-reason">
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
                            data-testid="leg-exclude-note"
                          />
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setExcludeOpen(false)}>Cancel</Button>
                      <Button
                        onClick={onExclude}
                        disabled={!excludeValid || excludeMutation.isPending}
                        data-testid="leg-exclude-confirm"
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
              )}

              {canMarkDuplicate && (
                <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      data-testid="leg-mark-duplicate-trigger"
                    >
                      <Copy className="h-3.5 w-3.5" /> Mark as duplicate
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Mark this leg as a Sibling Duplicate?</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Sibling Duplicates ride along with a primary leg whose
                        trip-overriding error invalidates the whole trip
                        (e.g. eligibility lapse). The primary leg's SOP and
                        verdict cover this leg, so we don't double-bill the
                        same dispute.
                      </p>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Primary leg (same invoice)</label>
                        <Select
                          value={duplicatePrimaryId}
                          onValueChange={setDuplicatePrimaryId}
                        >
                          <SelectTrigger data-testid="leg-mark-duplicate-primary">
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
                          data-testid="leg-mark-duplicate-note"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDuplicateOpen(false)}>Cancel</Button>
                      <Button
                        onClick={onMarkDuplicate}
                        disabled={!duplicatePrimaryId || markDuplicateMutation.isPending}
                        data-testid="leg-mark-duplicate-confirm"
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
              )}

              {canUnmarkDuplicate && (
                <Dialog open={unmarkDuplicateOpen} onOpenChange={setUnmarkDuplicateOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      data-testid="leg-unmark-duplicate-trigger"
                    >
                      <Link2Off className="h-3.5 w-3.5" /> Unmark duplicate
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Clear the Sibling-Duplicate link?</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2 text-sm">
                      <p>
                        The leg returns to its underlying SOP state. You'll
                        need to walk its decision tree (or exclude it) before
                        the invoice can be packaged.
                      </p>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setUnmarkDuplicateOpen(false)}>Cancel</Button>
                      <Button
                        onClick={onUnmarkDuplicate}
                        disabled={unmarkDuplicateMutation.isPending}
                        data-testid="leg-unmark-duplicate-confirm"
                      >
                        {unmarkDuplicateMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                        ) : (
                          <Link2Off className="h-3.5 w-3.5 mr-1" />
                        )}
                        Clear duplicate link
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        </div>

        {isDuplicate && (
          <div className="cc-card p-3" data-testid="leg-duplicate-banner">
            <div className="flex items-start gap-2 text-sm">
              <Copy className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: "var(--cc-muted-fg)" }} />
              <div className="space-y-1">
                <div>
                  <strong>Sibling Duplicate</strong> of
                  {primaryRef ? (
                    <>
                      {" "}
                      <Link href={`/claims/${primaryRef.id}`} className="underline mono">
                        {primaryRef.confNumber || `CLM-${primaryRef.id}`}
                      </Link>
                      {primaryRef.errorTypeName ? (
                        <span style={{ color: "var(--cc-muted-fg)" }}>
                          {" "}· {primaryRef.errorTypeName}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="mono"> CLM-{claim.duplicateOfClaimId}</span>
                  )}
                  .
                </div>
                <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                  This leg's dispute is covered by the primary's SOP and
                  verdict. No independent SOP walk is required.
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-8 space-y-4">

            <CcCard
              title="SOP walk transcript"
              icon={<ListChecks className="w-3.5 h-3.5" />}
              testId="claim-detail-walk-transcript-readonly"
            >
              {transcriptLines.length === 0 ? (
                <div className="text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  Walk hasn't started yet — answers you record below will appear here as a read-only trail.
                </div>
              ) : (
                <>
                  {transcriptLines.length > 0 && (
                    <ul className="space-y-1.5 text-sm" data-testid="sop-walk-transcript-list">
                      {transcriptLines.map((line, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2"
                          data-testid={`sop-walk-transcript-line-${i}`}
                          data-resolved={line.resolved ? "true" : "false"}
                        >
                          <span
                            className="text-xs mt-0.5"
                            style={{ color: line.resolved ? "var(--cc-muted-fg)" : "var(--cc-amber-fg)" }}
                            aria-hidden
                          >
                            •
                          </span>
                          <span className="flex-1">
                            <span
                              className={cn("text-xs", !line.resolved && "italic")}
                              style={{ color: "var(--cc-muted-fg)" }}
                            >
                              {line.question}
                              {!line.resolved && " (node removed from tree)"}
                            </span>
                            <span className="mx-1.5 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                              —
                            </span>
                            <span className="text-sm font-medium">{line.answer}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </CcCard>

            <div data-tour="claim-sop-player">
            <CcCard
              title="Investigation walk"
              icon={<FileText className="w-3.5 h-3.5" />}
              testId="leg-sop-card"
              action={
                errorType?.name ? (
                  <span
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}
                  >
                    {errorType.name}
                  </span>
                ) : undefined
              }
            >
              {isDuplicate ? (
                <DuplicateTerminal
                  leg={{
                    id: claim.id,
                    sopOutcome: claim.sopOutcome,
                    duplicateOfClaimId: claim.duplicateOfClaimId,
                  }}
                />
              ) : null}
              {!isDuplicate &&
                (subStatus === "excluded" || subStatus === "dropped" || subStatus === "frozen") && (() => {
                  const reason =
                    claim.sopOutcome === "non_issue" || claim.dropReason === "non_issue"
                      ? { label: "Non-issue", body: "This leg was marked as a non-issue. Nothing to dispute — it routes to re-attestation in the payor portal.", pill: "cc-pill-green" }
                      : claim.sopOutcome === "cannot_dispute" || claim.dropReason === "cannot_dispute"
                      ? { label: "Cannot dispute", body: "This leg is non-contestable and has been withdrawn from the dispute.", pill: "cc-pill-amber" }
                      : claim.includedInDispute === false
                      // vocab-allow-next-line — pre-existing reason-card display label; tracked for follow-up vocab entry, not a state-pill rendered through StateBadge.
                      ? { label: "Excluded", body: "This leg has been excluded from the dispute.", pill: "cc-pill-muted" }
                      : { label: "Closed", body: "This leg has reached a final state and no further SOP work is needed.", pill: "cc-pill-muted" };
                  return (
                    <div
                      className="rounded"
                      style={{
                        background: "var(--cc-card)",
                        border: "1px solid var(--cc-border)",
                        borderLeft: `3px solid var(--cc-${reason.pill === "cc-pill-green" ? "blue" : reason.pill === "cc-pill-amber" ? "amber" : "border"}-fg, var(--cc-border))`,
                        padding: "0.875rem 1rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                      }}
                      data-testid={`leg-closed-${reason.label.toLowerCase().replace(/\s+/g, "-")}-${claim.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <CheckCircle2
                          className="w-4 h-4"
                          style={{ color: reason.pill === "cc-pill-green" ? "var(--cc-blue-fg)" : reason.pill === "cc-pill-amber" ? "var(--cc-amber-fg)" : "var(--cc-meta-fg)" }}
                        />
                        <span className="text-sm font-semibold" style={{ color: "var(--cc-fg)" }}>
                          This leg is closed as {reason.label}
                        </span>
                        <span className={`cc-pill ${reason.pill} ml-auto`}>{reason.label}</span>
                      </div>
                      <p className="cc-meta text-[12px]" style={{ margin: 0, lineHeight: 1.5 }}>
                        {reason.body}
                      </p>
                      <div className="cc-meta text-[11px]">
                        Audit trail is recorded in the Activity history below.
                      </div>
                    </div>
                  );
                })()}
              {!isDuplicate && !claim.errorTypeId && subStatus === "needs_classification" && (
                <div
                  className="flex items-center justify-between gap-3 p-3 rounded"
                  style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }}
                  data-testid={`leg-classify-prompt-${claim.id}`}
                >
                  <div className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>This leg has no error type yet. Classify it to start the SOP.</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setClassifyOpen(true)}
                    data-testid={`leg-classify-this-${claim.id}`}
                    className="flex-shrink-0"
                  >
                    <Tag className="h-3.5 w-3.5 mr-1.5" />
                    Classify this leg
                  </Button>
                </div>
              )}
              {!isDuplicate && claim.errorTypeId && !tree && (
                <div
                  className="text-xs flex items-start gap-2 p-3 rounded"
                  style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    The assigned error type has no decision tree configured.{" "}
                    <Link href="/error-types" className="underline">Configure one</Link> to walk the SOP here.
                  </span>
                </div>
              )}
              {/* #687 — SopAdvancePlayer mount + RecoveryActions removed.
                   The live SOP player only mounts in A
                   (inline-group-workspace-mini.tsx) and on the
                   error-types screen now. The leg page is read-only:
                   it surfaces the transcript above and routes
                   operators to the queue via the CTA below. */}
              {!isDuplicate && parentGroup && (
                <div className="space-y-2 pt-2" style={{ borderTop: "1px dashed var(--cc-border)" }}>
                  <a
                    href={`/queue?group=${parentGroup.id}&leg=${claim.id}`}
                    className="cc-btn inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded"
                    style={{ background: "var(--cc-blue-fg)", color: "white" }}
                    data-testid="claim-detail-cta-walk-in-queue"
                  >
                    Walk this leg in the queue →
                  </a>
                  <p className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                    Walk progression, hold place/release, MAS cancel, and submission
                    happen in the queue.
                  </p>
                </div>
              )}
            </CcCard>
            </div>

            {!isDuplicate &&
              parentGroup &&
              (parentGroup.macroPhase === "response-pending" ||
                parentGroup.macroPhase === "mas-action-required" ||
                parentGroup.macroPhase === "awaiting-payout" ||
                parentGroup.macroPhase === "closed") && (
                <div data-testid="claim-detail-post-response">
                  <CcCard
                    title="Per-leg verdict"
                    icon={<Gavel className="w-3.5 h-3.5" />}
                    testId="leg-post-response-card"
                    action={
                      <GoToGroupLink onOpen={() => setChipOpen("evidence")}>
                        Commit on group
                      </GoToGroupLink>
                    }
                  >
                    <div className="text-xs mb-2" style={{ color: "var(--cc-muted-fg)" }}>
                      Pick the verdict the payor returned for this leg. Saves a draft;
                      Step 4 commit on the invoice promotes drafts to a final verdict.
                    </div>
                    <PerLegVerdictPicker
                      claim={claim}
                      latestVerdict={claim.latestVerdict ?? null}
                      latestDraft={claim.latestDraft ?? null}
                      latestSuggestion={claim.latestAiSuggestion ?? null}
                      onSelect={async (outcome) => {
                        await recordVerdictMutation.mutateAsync({
                          id: claim.id,
                          data: { source: "operator_draft", outcome },
                        });
                        invalidateLeg();
                      }}
                    />
                  </CcCard>
                </div>
              )}

            {submissionSlot ? (
              <div data-testid="claim-detail-submission-slot">{submissionSlot}</div>
            ) : null}

            <CcCard
              title={
                <>
                  Evidence
                  <span className="text-xs font-normal ml-1" style={{ color: "var(--cc-muted-fg)" }}>
                    · {evidenceList.length} {evidenceList.length === 1 ? "file" : "files"}
                  </span>
                </>
              }
              icon={<Paperclip className="w-3.5 h-3.5" />}
              testId="claim-detail-section-evidence"
              padded={evidenceList.length === 0}
              action={
                parentGroup ? (
                  <GoToGroupLink onOpen={() => setChipOpen("evidence")}>Manage on group</GoToGroupLink>
                ) : undefined
              }
            >
              {evidenceList.length === 0 ? (
                <div className="text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No evidence attached to this leg yet.
                </div>
              ) : (
                evidenceList.map((ev, i, arr) => {
                  const sizeBytes = ev.imageUrl ? evidenceSizeByUrl.get(ev.imageUrl) ?? null : null;
                  const oversize = typeof sizeBytes === "number" && sizeBytes > EMAIL_MESSAGE_MAX_BYTES;
                  return (
                    <div
                      key={ev.id}
                      className="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-[var(--cc-muted)] transition-colors"
                      style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                      data-testid={`leg-evidence-${ev.id}`}
                    >
                      <Paperclip className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--cc-muted-fg)" }} />
                      <span className="font-medium flex-1 truncate" title={ev.imageUrl ?? ev.evidenceTypeName}>
                        {ev.imageUrl ? fileNameFromUrl(ev.imageUrl) : ev.evidenceTypeName}
                      </span>
                      {ev.imageUrl ? (
                        typeof sizeBytes === "number" ? (
                          <span
                            className={cn("text-xs tabular-nums", oversize && "font-semibold")}
                            style={{
                              color: oversize ? "var(--cc-destructive)" : "var(--cc-muted-fg)",
                            }}
                            title={
                              oversize
                                ? "Over the 25 MB email cap — this file can't be attached to a reply."
                                : undefined
                            }
                            data-testid={`leg-evidence-size-${ev.id}`}
                          >
                            {formatBytes(sizeBytes)}
                            {oversize ? " · over 25 MB" : ""}
                          </span>
                        ) : (
                          <span
                            className="text-xs italic"
                            style={{ color: "var(--cc-muted-fg)" }}
                            data-testid={`leg-evidence-size-${ev.id}`}
                          >
                            size unknown
                          </span>
                        )
                      ) : null}
                      <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                        {ev.evidenceTypeName}
                      </span>
                      <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                        {ev.collectedBy ?? "—"} · {relativeTime(ev.collectedAt)}
                      </span>
                      {ev.imageUrl ? (
                        <a
                          href={ev.imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs hover:underline"
                          style={{ color: "var(--cc-blue-fg)" }}
                        >
                          Open
                        </a>
                      ) : null}
                    </div>
                  );
                })
              )}
            </CcCard>

            {/* Internal notes — leg-scoped, with composer. Renamed from
                "Notes" to make it explicit these are operator-only and
                are never surfaced to payors in any communication.
                Used in both standalone and embedded (queue inline)
                modes so the framing is consistent everywhere. */}
            <CcCard
              title={
                <>
                  Internal notes
                  <span className="text-xs font-normal ml-1" style={{ color: "var(--cc-muted-fg)" }}>
                    · {visibleNotes.length}
                  </span>
                </>
              }
              icon={<Pin className="w-3.5 h-3.5" />}
              testId="claim-detail-section-internal-notes"
            >
              {visibleNotes.length === 0 ? (
                <div className="text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No internal notes recorded for this leg yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleNotes.slice(0, 6).map((n) => (
                    <div key={n.id} className="text-sm flex gap-2 items-start group/leg-note" data-testid={`leg-note-${n.id}`}>
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
                        style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}
                      >
                        {authorInitial(n.author)}
                      </div>
                      <div className="flex-1 min-w-0 text-xs">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="font-semibold">{n.author || "Unknown"}</span>
                          <span style={{ color: "var(--cc-muted-fg)" }}>{relativeTime(n.createdAt)}</span>
                        </div>
                        <div style={{ color: "var(--cc-fg)" }}>{n.content}</div>
                      </div>
                      {/* #687 — leg-note delete control removed; notes are
                          deleted from the queue chrome only. */}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--cc-border)" }}>
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={2}
                  placeholder="Add an internal note for this leg (operators only — never shared with payors)…"
                  className="cc-input w-full text-xs"
                  style={{
                    background: "var(--cc-bg)",
                    border: "1px solid var(--cc-border)",
                    color: "var(--cc-fg)",
                    padding: "6px 8px",
                    borderRadius: 4,
                    resize: "vertical",
                  }}
                  data-testid="leg-note-textarea"
                />
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    onClick={onSubmitNote}
                    disabled={!newNote.trim() || createNoteMutation.isPending || noteBreath.breathing}
                    className={cn("cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5", noteBreath.className)}
                    style={{
                      background: "var(--cc-purple-fg)",
                      color: "white",
                      opacity:
                        !newNote.trim() || createNoteMutation.isPending || noteBreath.breathing
                          ? 0.6
                          : 1,
                    }}
                    data-testid="leg-note-submit-button"
                  >
                    {createNoteMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    Add note
                  </button>
                </div>
              </div>
            </CcCard>

            <CcCard
              title={
                <>
                  Communication
                  <span className="text-xs font-normal ml-1" style={{ color: "var(--cc-muted-fg)" }}>
                    · {threadMessages.length} {threadMessages.length === 1 ? "mention" : "mentions"} of this leg
                  </span>
                </>
              }
              icon={<Mail className="w-3.5 h-3.5" />}
              testId="leg-communication-card"
              action={
                parentGroup ? (
                  <GoToGroupLink onOpen={() => setChipOpen("evidence")}>Open invoice thread</GoToGroupLink>
                ) : undefined
              }
              padded={false}
            >
              <div
                className="px-4 py-2 text-xs flex items-start gap-1.5"
                style={{
                  background: "var(--cc-muted)",
                  color: "var(--cc-muted-fg)",
                  borderBottom: "1px solid var(--cc-border)",
                }}
              >
                <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  Conversations happen at the invoice level. This list shows messages
                  in the invoice thread that mention{" "}
                  <span className="font-mono font-semibold">
                    {claim.confNumber || `CLM-${claim.id}`}
                  </span>
                  . Reply or compose from the invoice page.
                </span>
              </div>
              {threadMessages.length === 0 ? (
                <div className="px-4 py-3 text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No messages reference this leg yet.
                </div>
              ) : (
                threadMessages.slice(0, 6).map((m, i, arr) => (
                  <div
                    key={m.id}
                    className="px-4 py-2 text-xs flex items-start gap-2"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                    data-testid={`leg-message-${m.id}`}
                  >
                    <Mail
                      className="w-3 h-3 mt-0.5 flex-shrink-0"
                      style={{ color: m.direction === "inbound" ? "var(--cc-amber-fg)" : "var(--cc-purple-fg)" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-semibold">{m.sender}</span>
                        <span style={{ color: "var(--cc-muted-fg)" }}>{formatDateTime(m.timestamp)}</span>
                      </div>
                      {m.bodyPreview ? (
                        <div className="line-clamp-2" style={{ color: "var(--cc-fg)" }}>
                          {m.bodyPreview}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </CcCard>
          </div>

          <div className="col-span-12 lg:col-span-4 space-y-4">

            {!embedded && parentGroup ? (
              <CcCard
                title="Parent invoice"
                icon={<FileText className="w-3.5 h-3.5" />}
                testId="parent-invoice-card"
                action={<GoToGroupLink onOpen={() => setChipOpen("evidence")}>Open group</GoToGroupLink>}
              >
                <div className="text-base font-bold mono mb-1">
                  {parentGroup.invoiceNumber ? (
                    <RefNumber value={parentGroup.invoiceNumber} variant="inline" />
                  ) : (
                    <span>INV-{parentGroup.id}</span>
                  )}
                </div>
                <div className="text-xs mb-3" style={{ color: "var(--cc-muted-fg)" }}>
                  {parentGroup.rideCount ?? 0} {parentGroup.rideCount === 1 ? "leg" : "legs"}
                  {parentGroup.totalAmount
                    ? <HideForClerk> · <span className="mono">{formatCurrency(parentGroup.totalAmount)}</span> total exposure</HideForClerk>
                    : null}
                </div>
                <div className="space-y-1">
                  <FieldRow
                    label="Group status"
                    value={<StateBadge variant="status" value={parentGroup.status} />}
                  />
                  {parentGroup.macroPhase ? (
                    <FieldRow label="Macro phase" value={parentGroup.macroPhase} />
                  ) : null}
                  {parentGroup.holdReason ? (
                    <FieldRow label="On hold" value={<span className="truncate max-w-[12rem] inline-block" title={parentGroup.holdReason}>{parentGroup.holdReason}</span>} />
                  ) : null}
                </div>
                <div
                  className="text-xs mt-3 p-2 rounded"
                  style={{ background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}
                >
                  Group context, evidence, and submission live on the group page.
                </div>
              </CcCard>
            ) : null}

            {!embedded && (
            <CcCard
              title="Latest payor verdict"
              icon={<Gavel className="w-3.5 h-3.5" />}
              testId="leg-verdict-card"
              action={
                parentGroup ? (
                  <GoToGroupLink onOpen={() => setChipOpen("evidence")}>Record on group</GoToGroupLink>
                ) : undefined
              }
            >
              <div className="text-xs mb-2" style={{ color: "var(--cc-muted-fg)" }}>
                Read-only on the leg page. Verdicts are recorded against the group.
              </div>
              {verdict ? (
                <>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <StateBadge variant="verdict" value={verdict.outcome} />
                    <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                      via {verdict.source} · {relativeTime(verdict.createdAt)}
                    </span>
                  </div>
                  {verdict.note ? (
                    <div className="text-xs mb-2" style={{ color: "var(--cc-fg)" }}>
                      {verdict.note}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <TonePill tone="muted">No verdict yet</TonePill>
                    <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                      Awaiting submission
                    </span>
                  </div>
                  <MutedNote>
                    When the group is submitted to portal, the payor's per-leg verdict will surface here.
                  </MutedNote>
                </>
              )}
            </CcCard>
            )}

            {masRequired ? (
              <CcCard
                title="MAS action"
                icon={<Stamp className="w-3.5 h-3.5" />}
                testId="leg-mas-card"
                action={
                  parentGroup ? (
                    <GoToGroupLink onOpen={() => setChipOpen("evidence")}>
                      {masCompleted ? "View on group" : "Manage on group"}
                    </GoToGroupLink>
                  ) : undefined
                }
              >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {masCompleted ? (
                    <>
                      <TonePill tone="green">MAS cancel complete</TonePill>
                      <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                        {relativeTime(claim.masActionCompletedAt)}
                      </span>
                    </>
                  ) : (
                    <TonePill tone="amber">Cancel required</TonePill>
                  )}
                </div>
                {claim.masActionNote ? (
                  <div className="text-xs mb-2" style={{ color: "var(--cc-fg)" }}>
                    {claim.masActionNote}
                  </div>
                ) : null}
                {/* #687 — interactive MAS-cancel checkbox removed from
                    the leg page. Operators stamp the cancel from the
                    queue chrome only; the leg page shows status only. */}
                {!masCompleted ? (
                  <MutedNote>
                    Stamp the MAS cancel for this leg from the queue.
                  </MutedNote>
                ) : null}
              </CcCard>
            ) : null}

            {parentGroup?.macroPhase === "awaiting-payout" ? (
              <CcCard
                title="Attestation"
                icon={<ListChecks className="w-3.5 h-3.5" />}
                testId="leg-attestation-card"
                action={
                  <Link
                    href="/attestation-queue"
                    className="text-xs hover:underline inline-flex items-center gap-1"
                    style={{ color: "var(--cc-blue-fg)" }}
                    data-testid="leg-attestation-queue-link"
                  >
                    Open queue <ArrowUpRight className="w-3 h-3" />
                  </Link>
                }
              >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <TonePill tone="blue">Awaiting re-attestation</TonePill>
                </div>
                <MutedNote>
                  This leg is queued for portal re-attestation. Take
                  action from the attestation queue.
                </MutedNote>
              </CcCard>
            ) : null}

            <CcCard
              title="Activity history"
              icon={<Activity className="w-3.5 h-3.5" />}
              testId="claim-detail-section-activity"
              padded={false}
            >
              {sortedAudit.length === 0 ? (
                <div className="px-4 py-3 text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No activity recorded for this leg yet.
                </div>
              ) : (
                sortedAudit.slice(0, 12).map((e, i, arr) => (
                  <div
                    key={e.id}
                    className="px-4 py-2 flex items-start gap-2 text-xs"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                    data-testid={`leg-audit-${e.id}`}
                  >
                    <div className="mt-0.5 flex-shrink-0" style={{ color: auditTone(e.action) }}>
                      {auditIcon(e.action)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div style={{ color: "var(--cc-fg)" }}>
                        {e.details || e.action}
                        {e.viaGroup && e.invoiceNumber ? (
                          <span className="ml-1 text-[10px] font-medium px-1.5 py-[1px] rounded inline-flex items-center gap-1" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}>
                            via <RefNumber value={e.invoiceNumber} variant="inline" />
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>
                        {(e.userName || e.userEmail || "system")} · {relativeTime(e.timestamp)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CcCard>
          </div>
        </div>
      </div>

      {/* #687 — leg-note delete AlertDialog removed (delete moved to
          queue chrome). */}

      {claim ? (
        <RemoveHandledOfflineDialog
          open={removeHandledOfflineOpen}
          onOpenChange={setRemoveHandledOfflineOpen}
          claimId={claim.id}
          groupId={claim.invoiceGroupId ?? null}
        />
      ) : null}

      {claim ? (
        <UndoHandledOfflineDialog
          open={undoHandledOfflineOpen}
          onOpenChange={setUndoHandledOfflineOpen}
          claimId={claim.id}
          groupId={claim.invoiceGroupId ?? null}
        />
      ) : null}

      {claim ? (
        <ClassifyDialog
          open={classifyOpen}
          onOpenChange={setClassifyOpen}
          groupId={claim.invoiceGroupId ?? 0}
          highlightLegId={claim.id}
          onCompleted={(message) => {
            successToast({ title: "__VERB__", description: message });
            qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
            if (claim.invoiceGroupId) {
              qc.invalidateQueries({
                queryKey: getGetInvoiceGroupQueryKey(claim.invoiceGroupId),
              });
            }
          }}
        />
      ) : null}

      {/* Task #678: mount the same ChipDrawerOverlay the queue mini
          uses, so the leg page's ↗ arrows surface group-level context
          without leaving the page. Uses already-fetched parentGroup
          + claim — no extra round-trip. onSelectLeg is null because
          the leg page is single-leg by URL, so the in-drawer leg
          switcher hides itself. */}
      {claim && parentGroup && chipOpen ? (
        <ChipDrawerOverlay
          openChip={chipOpen}
          leg={claim}
          detail={parentGroup as Parameters<typeof ChipDrawerOverlay>[0]["detail"]}
          rides={parentGroup.rides ?? []}
          resolvedIndex={buildLegResolvedIndex(parentGroup.rides ?? [])}
          groupId={parentGroup.id}
          onSelectLeg={null}
          onOpenClassify={() => setClassifyOpen(true)}
          onOpenMarkDuplicate={() => setDrawerMarkDuplicateOpen(true)}
          onClose={() => setChipOpen(null)}
        />
      ) : null}
      {claim && parentGroup && drawerMarkDuplicateOpen ? (
        <MarkDuplicateDialog
          open={drawerMarkDuplicateOpen}
          onOpenChange={setDrawerMarkDuplicateOpen}
          legId={claim.id}
          groupId={parentGroup.id}
          rides={(parentGroup.rides ?? []) as ClaimResponse[]}
        />
      ) : null}
    </div>
  );
}
