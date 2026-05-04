import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { BackBar } from "@/components/back-bar";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useClaimEvents } from "@/hooks/use-claim-events";
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
  useDeleteNote,
  useListClaimAuditLogs,
  getListClaimAuditLogsQueryKey,
  useListClaimEvidence,
  getListClaimEvidenceQueryKey,
  useGetClaimEmailThread,
  getGetClaimEmailThreadQueryKey,
} from "@workspace/api-client-react";
import type {
  ErrorTypeResponse,
  ExcludeLegBodyReason,
  NoteResponse,
  AuditLogResponse,
  ClaimEvidenceResponse,
  EmailThreadMessage,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Loader2, RotateCcw, AlertTriangle, RefreshCw, XCircle, FileText, Copy, Link2Off,
  Edit2, Pin, Plus, Mail, ArrowUpRight, Lock, Activity, Paperclip,
  Gavel, Stamp, Clock, Send, CheckCircle2, ListChecks, Trash2,
} from "lucide-react";
import { buildSopTranscript, type TranscriptLine } from "@/lib/sop-transcript";
import { isLegacyDerivedContext } from "@workspace/leg-state";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { HideForClerk } from "@/lib/role";
import { useToast } from "@/hooks/use-toast";
import { useBreath } from "@/hooks/use-breath";
import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/cohesion";
import type { Tone } from "@/components/cohesion/tone";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import { DuplicateTerminal } from "@/components/decision-tree/terminals/duplicate-terminal";
import { deriveLegSubStatus } from "@workspace/leg-state";
import { legSubStatusDisplayLabel } from "@workspace/vocab";
import type { DecisionTree } from "@/components/decision-tree/types";
import {
  buildTripOverridingErrorTypeIds,
  findSiblingDuplicatePrimaryCandidates,
  siblingPromptEligibilityFor,
} from "@/lib/sop-sibling-eligibility";

// ─────────────────────────────────────────────────────────────────────────
// Per-leg processing surface, re-densified to mirror the cohesion-sweep
// `LegDetailRedensified` mockup. The leg page is now a real workstation
// with a left-column investigation column (per-leg context, SOP walk,
// evidence, notes, communication mentions) and a right-column rail that
// mirrors group-scoped state (parent invoice, latest verdict, MAS,
// audit). All write actions on group-scoped surfaces stay on the group
// page — this page links out via "Open group ↗" affordances. The leg
// header keeps a tight set of pre-submit actions (reclassify / exclude /
// mark-or-unmark sibling duplicate) because invoice groups are the
// primary processing entity; we deliberately do NOT add reassign / hold
// here — those live on the group.
// ─────────────────────────────────────────────────────────────────────────

interface Props {
  claimId: number;
  // When true, this surface is being rendered inside another page (e.g.
  // the queue's inline leg expansion) rather than as the standalone
  // /claims/:id page. Embedded mode trims the chrome down to an
  // active-work surface:
  //   - the BackBar's "Back" button is dropped (only the breadcrumb
  //     stays so the operator can still jump to the parent invoice if
  //     they need to);
  //   - the right-rail "Parent invoice" and "Latest payor verdict"
  //     cards are hidden — they're already visible on the surrounding
  //     queue/group surface;
  //   - the outer `min-h-screen p-6` page wrapper collapses so the
  //     content sits flush inside the host card.
  // The "Internal notes" and "Activity history" labels are used in
  // both standalone and embedded modes — they were renamed globally
  // to make it explicit those fields are operator-only and never
  // surfaced to payors.
  embedded?: boolean;
  // Optional content rendered immediately below the Investigation walk
  // (worktree). The queue uses this slot to put the group-level
  // submission preview right under the active worktree, so the
  // operator's flow is "walk SOP → confirm submission preview"
  // without leaving the surface.
  submissionSlot?: ReactNode;
  // Monotonically-increasing token from the queue strip. When this
  // value increases, ClaimDetailV2 will scroll/focus the error-type
  // picker anchor as soon as it mounts (or immediately if it's
  // already mounted). This is what lets the queue strip's "Classify"
  // primary action land the operator on the picker even when the
  // embedded leg detail is still fetching at click time. See
  // LegConclusionRow.handlePrimary.
  focusErrorTypePickerSignal?: number;
}

const SUB_STATUS_TO_TONE: Record<string, Tone> = {
  needs_classification: "amber",
  investigating: "amber",
  ready: "blue",
  dropped: "muted",
  blocked: "amber",
  excluded: "muted",
  duplicate: "muted",
};

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

function GoToGroupLink({ groupId, children }: { groupId: number; children: ReactNode }) {
  return (
    <Link
      href={`/invoice-groups/${groupId}`}
      className="text-xs font-medium inline-flex items-center gap-1 hover:underline"
      style={{ color: "var(--cc-purple-fg)" }}
    >
      {children}<ArrowUpRight className="w-3 h-3" />
    </Link>
  );
}

function relativeTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
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

function groupStatusTone(status: string | undefined): Tone {
  switch (status) {
    case "Resolved": return "green";
    case "Submitted":
    case "Awaiting Response":
    case "Awaiting Payout":
    case "Portal Queued":
      return "blue";
    case "Needs Evidence":
    case "Generating Email":
    case "Email Generated":
      return "amber";
    case "On Hold":
      return "red";
    default: return "muted";
  }
}

export function ClaimDetailV2({
  claimId,
  embedded = false,
  submissionSlot,
  focusErrorTypePickerSignal,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: claim, isLoading } = useGetClaim(claimId, {
    query: { queryKey: getGetClaimQueryKey(claimId), enabled: !!claimId },
  });

  // Owns the "land the operator on the error-type picker" effect for
  // the queue strip's Classify primary action. We watch for the parent
  // bumping `focusErrorTypePickerSignal` AND for the picker anchor
  // being in the DOM (which only happens once `claim` has loaded and
  // `!claim.errorTypeId`). Doing it here instead of from the strip
  // means we can't lose the race against async data — the effect will
  // fire as soon as both conditions hold, even seconds after the
  // click.
  const lastHandledFocusSignal = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (focusErrorTypePickerSignal === undefined) return;
    if (lastHandledFocusSignal.current === focusErrorTypePickerSignal) return;
    if (!claim) return; // wait for fetch to settle
    if (claim.errorTypeId) return; // picker only renders when no errorType
    const anchorId = `leg-error-type-picker-${claim.id}`;
    const tryFocus = (attempt = 0) => {
      const el = document.getElementById(anchorId);
      if (el) {
        lastHandledFocusSignal.current = focusErrorTypePickerSignal;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (typeof (el as HTMLElement).focus === "function") {
          (el as HTMLElement).focus({ preventScroll: true });
        }
        return;
      }
      // Cap retries at ~3s to avoid leaking a long-lived loop if the
      // picker never mounts (e.g. claim flips to errorTypeId mid-flight).
      if (attempt < 60) {
        window.setTimeout(() => tryFocus(attempt + 1), 50);
      }
    };
    window.requestAnimationFrame(() => tryFocus(0));
  }, [focusErrorTypePickerSignal, claim]);

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
  const subStatusTone: Tone = SUB_STATUS_TO_TONE[subStatus] ?? SUB_STATUS_TO_TONE.needs_classification;
  const subStatusLabel = legSubStatusDisplayLabel(subStatus, claim ?? undefined);

  // ─────────────────────────────────────────────────────────────────────
  // "You finished a thing" microinteraction (Task #315). When this leg's
  // top-level status flips to `Processed` while the page is mounted —
  // either because the operator's own SOP-advance mutation just landed,
  // or because the SSE stream broadcast their action back to this tab —
  // briefly draw a check inside the status pill. Suppressed when the
  // change came from a different operator.
  // ─────────────────────────────────────────────────────────────────────
  const { user } = useAuth();
  const { lastClaimUpdateBy } = useClaimEvents(claimId);
  const prevStatusRef = useRef<string | null | undefined>(undefined);
  const [justProcessed, setJustProcessed] = useState(false);
  useEffect(() => {
    const newStatus = claim?.status;
    if (newStatus === undefined) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = newStatus;
    if (prev === undefined) return;
    if (prev === newStatus) return;
    if (newStatus !== "Processed") return;
    const lastBy = lastClaimUpdateBy.current?.email ?? null;
    if (lastBy && user?.email && lastBy !== user.email) return;
    setJustProcessed(true);
    const t = setTimeout(() => setJustProcessed(false), 500);
    return () => clearTimeout(t);
  }, [claim?.status, user?.email, lastClaimUpdateBy]);

  const reclassifyMutation = useReclassifyLeg();
  const excludeMutation = useExcludeLeg();
  const markDuplicateMutation = useMarkLegDuplicate();
  const unmarkDuplicateMutation = useUnmarkLegDuplicate();
  const createNoteMutation = useCreateClaimNote();
  const deleteNoteMutation = useDeleteNote();
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<number | null>(null);

  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excludeReason, setExcludeReason] = useState<ExcludeLegBodyReason | "">("");
  const [excludeNote, setExcludeNote] = useState("");
  const excludeValid =
    excludeReason !== "" &&
    (excludeReason !== "other" || excludeNote.trim().length > 0);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicatePrimaryId, setDuplicatePrimaryId] = useState<string>("");
  const [duplicateNote, setDuplicateNote] = useState("");
  const [unmarkDuplicateOpen, setUnmarkDuplicateOpen] = useState(false);

  // Task #372: per-leg unique context moved out of the top-of-leg
  // editor and into the end-of-walk Include terminal (with an AI
  // clarification gate). The leg page now renders a read-only SOP
  // walk transcript in this slot — derived purely from `sopAnswers`
  // + the loaded decision tree by `buildSopTranscript`. A legacy
  // pre-#372 derived "• Q — A" perLegContext (when present) renders
  // beneath the transcript as a migration trail so nothing is lost.
  // sopAnswers is a jsonb column on the leg row, declared on the
  // OpenAPI ClaimResponse schema (Task #378) so the generated type
  // carries the field directly. `buildSopTranscript` still accepts
  // `unknown` and rejects malformed payloads at the helper boundary.
  const transcriptLines: TranscriptLine[] = useMemo(
    () => buildSopTranscript(claim?.sopAnswers, tree),
    [claim, tree],
  );
  const legacyDerivedTrail =
    claim?.perLegContext && isLegacyDerivedContext(claim.perLegContext)
      ? claim.perLegContext
      : null;

  // Note composer state.
  const [newNote, setNewNote] = useState("");
  const noteBreath = useBreath();

  // Trip-overriding error type lookup for the sibling-duplicate picker.
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

  // ───── Right-rail / surrounding data sources ─────
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

  const threadMessages: EmailThreadMessage[] = useMemo(() => {
    const msgs = (emailThread as { messages?: EmailThreadMessage[] } | undefined)?.messages;
    return Array.isArray(msgs) ? msgs : [];
  }, [emailThread]);

  function invalidateLeg() {
    qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
    qc.invalidateQueries({ queryKey: getListClaimNotesQueryKey(claimId) });
    qc.invalidateQueries({ queryKey: getListClaimAuditLogsQueryKey(claimId) });
    qc.invalidateQueries({ queryKey: ["claims"] });
    if (parentGroupId) {
      qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(parentGroupId) });
      qc.invalidateQueries({ queryKey: ["invoice-groups"] });
    }
  }

  function onReclassify() {
    reclassifyMutation.mutate(
      { id: claimId },
      {
        onSuccess: () => {
          toast({ title: "Leg reclassified — pick an error type to start over" });
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
          toast({ title: "Leg excluded from dispute" });
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
          toast({ title: "Leg marked as Sibling Duplicate" });
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
          toast({ title: "Sibling-duplicate link cleared" });
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
        // Task #411 audit, Tier 4: render the new note locally from
        // the mutation response BEFORE the SSE invalidate fires, so
        // the operator sees the note appear instantly without the
        // "submit → empty list briefly → note appears" flicker.
        // We still invalidate afterward to reconcile with whatever
        // the server thinks the canonical list is (e.g. system rows
        // emitted as a side effect of posting).
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

  function onConfirmDeleteNote() {
    const noteId = pendingDeleteNoteId;
    if (noteId == null || deleteNoteMutation.isPending) return;
    deleteNoteMutation.mutate(
      { id: noteId },
      {
        onSuccess: () => {
          // Optimistically drop the row from the cached list so the
          // operator sees it disappear without waiting for an
          // invalidate round-trip.
          qc.setQueryData<NoteResponse[]>(
            getListClaimNotesQueryKey(claimId),
            (prev: NoteResponse[] | undefined) =>
              Array.isArray(prev) ? prev.filter((n) => n.id !== noteId) : prev,
          );
          setPendingDeleteNoteId(null);
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Couldn't delete note",
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
  // `canShowPlayer` is intentionally OR'd with `isDuplicate` so the legacy
  // disabled-reason ladder below stays quiet for duplicate legs. The
  // duplicate render itself is owned exclusively by the short-circuit
  // branch in JSX, which mounts the terminal directly without going
  // through `SopAdvancePlayer` — that way `mark as duplicate` works even
  // before an error type / decision tree is assigned.
  const canShowPlayer =
    isDuplicate ||
    hasSopOutcome ||
    subStatus === "investigating" ||
    subStatus === "ready" ||
    subStatus === "dropped";
  // Reason ladder for disabling the SOP player + every terminal
  // (Include / Hold / Closed / Duplicate). Order matters — the most
  // operator-actionable reason wins:
  //
  //   1. Presence/activity lock — "someone else is editing", actionable
  //      by waiting or coordinating directly.
  //   2. Group phase has advanced past `pre-submit` — every leg-level
  //      mutation endpoint (per-leg-context, per-leg-context-readback,
  //      change-error-type, set-hold, etc.) refuses with HTTP 409 once
  //      the parent group is in `in-flight` / `response-pending` /
  //      `closed` / `on-hold` / etc. Without this guard the
  //      `PerLegContextEditor` (rendered inline during the SOP walk
  //      and on the inline "Ready" surface) stayed fully active on a
  //      packaged group: operator typed a note, clicked "Check with
  //      AI", got a generic "AI clarification failed" toast that hid
  //      the real phase-mismatch 409 underneath. Lock it explicitly
  //      with the group's actual status so the operator can see why.
  //      (The retired Include-terminal "I'm done — hand off" screen
  //      had the same failure mode.)
  //   3. Substatus gates that pre-empt the SOP entirely (no error type,
  //      hold, excluded). These only apply when `canShowPlayer` is false.
  //
  // The result is forwarded to `SopAdvancePlayer` as `disabledReason`
  // further down, which propagates into every terminal's CTAs and inputs.
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

  // Breadcrumb trail used in both standalone and embedded modes. In
  // embedded mode we drop the BackBar's "Back" button (the operator is
  // already inside the queue / invoice group surface — a Back button
  // navigates them out of their own work) but keep the crumbs as a
  // jump-to-parent affordance.
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

        {embedded ? (
          // Crumb-only nav for embedded use. No "Back" button — the
          // operator is already inside the queue and clicking Back
          // would yank them out of the very work surface they just
          // opened. The crumb still links to the parent invoice for
          // anyone who needs to jump out of the leg.
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
          // Standalone /claims/:id page — keep the full BackBar (Back
          // button + crumb) since the user might have arrived here
          // from a deep link or a search and needs a clear way out.
          <BackBar
            fallbackHref={parentGroup ? `/invoice-groups/${parentGroup.id}` : "/claims"}
            crumbs={crumbs}
            testId="claim-back-bar"
          />
        )}

        {/* Header — accent bar, eyebrow, identification + tight action set.
            Actions stay limited (reclassify / exclude / mark-or-unmark
            duplicate). Reassign / hold live on the invoice group page —
            invoice groups are the primary processing entity. */}
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
                  <StatusPill tone={subStatusTone} justTransitioned={justProcessed}>
                    {subStatusLabel}
                  </StatusPill>
                  {claim.errorTypeName ? (
                    <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                      · {claim.errorTypeName}
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
                <div className="text-xs mt-1.5" style={{ color: "var(--cc-muted-fg)" }}>
                  Updated <span className="font-medium" style={{ color: "var(--cc-fg)" }}>{relativeTime(claim.updatedAt)}</span>
                  {parentGroup?.status ? (
                    <>
                      {" · "}Group state:{" "}
                      <span className="font-medium" style={{ color: "var(--cc-fg)" }}>
                        {parentGroup.status}
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
                      data-testid="leg-reclassify"
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

        {/* Sibling-duplicate banner — first thing the operator sees so the
            SOP card stays disabled. */}
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

        {/* Two-column layout: workspace (left, 8 cols) + group rail (right, 4 cols) */}
        <div className="grid grid-cols-12 gap-4">

          {/* LEFT — investigation workspace */}
          <div className="col-span-12 lg:col-span-8 space-y-4">

            {/* Task #372: SOP walk transcript — read-only "Question →
                Answer" trail derived from the persisted sopAnswers and
                the live decision tree. This replaces the editable
                per-leg-context card; the optional unique-context input
                lives at the end-of-walk Include terminal now, gated by
                the AI-clarification readback. */}
            <CcCard
              title="SOP walk transcript"
              icon={<ListChecks className="w-3.5 h-3.5" />}
              testId="sop-walk-transcript-card"
            >
              {transcriptLines.length === 0 && !legacyDerivedTrail ? (
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
                  {legacyDerivedTrail && (
                    <div
                      className="mt-3 pt-3 text-xs space-y-1"
                      style={{ borderTop: "1px dashed var(--cc-border)" }}
                      data-testid="sop-walk-transcript-legacy-trail"
                    >
                      <div className="font-medium" style={{ color: "var(--cc-muted-fg)" }}>
                        Legacy auto-derived per-leg context (pre-#372 migration)
                      </div>
                      <pre
                        className="whitespace-pre-wrap"
                        style={{ color: "var(--cc-muted-fg)", fontFamily: "inherit" }}
                      >
                        {legacyDerivedTrail}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </CcCard>

            {/* Investigation walk (SOP) — the entire purpose of this surface */}
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
              {!isDuplicate && !claim.errorTypeId && (
                // Stable anchor (`leg-error-type-picker-<id>`) so the
                // queue strip's "Classify" primary action can scroll
                // and focus the operator straight onto the entry point
                // for picking an error type. See LegConclusionRow's
                // focusErrorTypePicker for the consumer side.
                <div
                  id={`leg-error-type-picker-${claim.id}`}
                  tabIndex={-1}
                  className="text-xs flex items-start gap-2 p-3 rounded scroll-mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }}
                  data-testid={`leg-error-type-picker-${claim.id}`}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>This leg has no error type yet. Pick one from the queue or use the legacy classifier.</span>
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
              {!isDuplicate && tree && canShowPlayer && (
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
                  // Forward the phase-based disable so the player and
                  // its terminals (Hand off, Hold, Duplicate, Closed)
                  // surface the "this invoice is past pre-submit"
                  // tooltip and refuse to fire mutations that would
                  // 409 server-side. Presence is intentionally NOT a
                  // source for this — see the queue.tsx comment on
                  // `usePresence` for context.
                  disabledReason={playerDisabledReason}
                  onAdvanced={invalidateLeg}
                  errorType={
                    errorType
                      ? { useDirectEmail: errorType.useDirectEmail ?? null }
                      : null
                  }
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
              {!isDuplicate && tree && !canShowPlayer && playerDisabledReason && (
                <div
                  className="text-xs flex items-start gap-1.5 px-2.5 py-1.5 rounded"
                  style={{ color: "var(--cc-muted-fg)", background: "var(--cc-muted)" }}
                >
                  <FileText className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{playerDisabledReason}</span>
                </div>
              )}
            </CcCard>

            {/* Submission preview slot — embedded mode (queue inline
                expansion) drops the group-level submission preview in
                here so the operator's eye flows worktree → submission
                preview without scrolling past evidence/notes. */}
            {submissionSlot ? (
              <div data-testid="claim-detail-submission-slot">{submissionSlot}</div>
            ) : null}

            {/* Evidence — read-only list. Attachment workflows live on the
                invoice group (we never collect leg-level evidence except
                via SOP-walk evidence collectors). */}
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
              testId="leg-evidence-card"
              padded={evidenceList.length === 0}
              action={
                parentGroup ? (
                  <GoToGroupLink groupId={parentGroup.id}>Manage on group</GoToGroupLink>
                ) : undefined
              }
            >
              {evidenceList.length === 0 ? (
                <div className="text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No evidence attached to this leg yet.
                </div>
              ) : (
                evidenceList.map((ev, i, arr) => (
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
                ))
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
              testId="leg-notes-card"
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
                      {/* Task #411 audit, Tier 5: notes had a working
                          DELETE /api/notes/:id endpoint with no UI to
                          call it. The trash affordance now wires that
                          endpoint into the per-note hover state, gated
                          by an AlertDialog confirm so an accidental
                          click can't nuke an audit-bearing note. */}
                      {n.type === "manual" && (
                        <button
                          type="button"
                          aria-label="Delete note"
                          onClick={() => setPendingDeleteNoteId(n.id)}
                          disabled={deleteNoteMutation.isPending}
                          className="opacity-0 group-hover/leg-note:opacity-100 transition-opacity p-1 rounded hover:bg-red-50"
                          style={{ color: "var(--cc-muted-fg)" }}
                          data-testid={`leg-note-delete-${n.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
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

            {/* Communication — read-only mentions of this leg from the invoice
                conversation. Conversations themselves happen at the
                invoice level; reply / compose lives on the invoice page. */}
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
                  <GoToGroupLink groupId={parentGroup.id}>Open invoice thread</GoToGroupLink>
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

          {/* RIGHT — group rail (read-only mirrors of group-level state).
              Embedded mode hides the Parent invoice and Latest payor
              verdict cards since both are already shown on the
              surrounding queue / invoice group surface — repeating
              them inside the worktree just turns an active workspace
              into a data-review screen. */}
          <div className="col-span-12 lg:col-span-4 space-y-4">

            {/* Parent invoice */}
            {!embedded && parentGroup ? (
              <CcCard
                title="Parent invoice"
                icon={<FileText className="w-3.5 h-3.5" />}
                testId="parent-invoice-card"
                action={<GoToGroupLink groupId={parentGroup.id}>Open group</GoToGroupLink>}
              >
                <div className="text-base font-bold mono mb-1">
                  {parentGroup.invoiceNumber || `INV-${parentGroup.id}`}
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
                    value={<StatusPill tone={groupStatusTone(parentGroup.status)}>{parentGroup.status}</StatusPill>}
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

            {/* Latest payor verdict (read-only) — hidden in embedded
                (queue inline) mode; the verdict is already visible on
                the invoice group page. */}
            {!embedded && (
            <CcCard
              title="Latest payor verdict"
              icon={<Gavel className="w-3.5 h-3.5" />}
              testId="leg-verdict-card"
              action={
                parentGroup ? (
                  <GoToGroupLink groupId={parentGroup.id}>Record on group</GoToGroupLink>
                ) : undefined
              }
            >
              <div className="text-xs mb-2" style={{ color: "var(--cc-muted-fg)" }}>
                Read-only on the leg page. Verdicts are recorded against the group.
              </div>
              {verdict ? (
                <>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <StatusPill tone={verdict.outcome === "Approved" ? "green" : verdict.outcome === "Denied" ? "red" : "muted"}>
                      {verdict.outcome}
                    </StatusPill>
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
                    <StatusPill tone="muted">No verdict yet</StatusPill>
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

            {/* MAS action (read-only) */}
            {masRequired ? (
              <CcCard
                title="MAS action"
                icon={<Stamp className="w-3.5 h-3.5" />}
                testId="leg-mas-card"
                action={
                  parentGroup && !masCompleted ? (
                    <GoToGroupLink groupId={parentGroup.id}>Complete on group</GoToGroupLink>
                  ) : undefined
                }
              >
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {masCompleted ? (
                    <>
                      <StatusPill tone="green">MAS completed</StatusPill>
                      <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                        {relativeTime(claim.masActionCompletedAt)}
                      </span>
                    </>
                  ) : (
                    <StatusPill tone="amber">Cancel required</StatusPill>
                  )}
                </div>
                {claim.masActionNote ? (
                  <div className="text-xs mb-2" style={{ color: "var(--cc-fg)" }}>
                    {claim.masActionNote}
                  </div>
                ) : null}
                {!masCompleted && (
                  <MutedNote>
                    Mark MAS complete from the group's MAS card.
                  </MutedNote>
                )}
              </CcCard>
            ) : null}

            {/* Activity history — was "Audit timeline". Renamed to read
                like a standard per-claim activity feed (what happened,
                when, by whom) instead of a system-audit log. Used in
                both standalone and embedded (queue inline) modes. The
                data shape is unchanged — same audit-log entries, same
                ordering — only the framing is operator-friendly. */}
            <CcCard
              title="Activity history"
              icon={<Activity className="w-3.5 h-3.5" />}
              testId="leg-audit-timeline-card"
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
                          <span className="ml-1 text-[10px] font-medium px-1.5 py-[1px] rounded" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}>
                            via {e.invoiceNumber}
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

      <AlertDialog
        open={pendingDeleteNoteId != null}
        onOpenChange={(open) => { if (!open) setPendingDeleteNoteId(null); }}
      >
        <AlertDialogContent data-testid="leg-note-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this note?</AlertDialogTitle>
            <AlertDialogDescription>
              The note will be removed from the leg and an audit row
              will record who deleted it. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="leg-note-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDeleteNote}
              disabled={deleteNoteMutation.isPending}
              data-testid="leg-note-delete-confirm-action"
            >
              {deleteNoteMutation.isPending ? "Deleting…" : "Delete note"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
