import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetClaim,
  getGetClaimQueryKey,
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  useListErrorTypes,
  useSetLegContext,
  usePlaceLegOnHold,
  useClearLegHold,
  useReclassifyLeg,
  useExcludeLeg,
  useIncludeLeg,
  useListClaimEvidence,
  getListClaimEvidenceQueryKey,
  useListClaimNotes,
  getListClaimNotesQueryKey,
  useCreateClaimNote,
  useListClaimAuditLogs,
  getListClaimAuditLogsQueryKey,
  useGetClaimEmailThread,
  getGetClaimEmailThreadQueryKey,
  useAddClaimEvidence,
} from "@workspace/api-client-react";
import type {
  ErrorTypeResponse,
  ExcludeLegBodyReason,
  AuditLogResponse,
  NoteResponse,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, ChevronLeft, PauseCircle, Play, XCircle, RotateCcw, UserPlus, Save, Edit2,
  Paperclip, Plus, Mail, ArrowUpRight, Gavel, Stamp, FileText, Activity, AlertTriangle,
  CheckCircle2, Pin, Send, Lock, Clock, RefreshCw,
} from "lucide-react";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { StatusPill } from "@/components/cohesion";
import type { Tone } from "@/components/cohesion/tone";
import { HoldReasonSelect, isHoldReasonValid } from "@/components/hold-reason-select";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import { deriveLegSubStatus, type LegHoldReason } from "@workspace/leg-state";
import { legSubStatusDisplayLabel } from "@workspace/vocab";
import type { DecisionTree } from "@/components/decision-tree/types";

// Per-leg investigation surface — densified to match LegDetailRedensified
// mockup 1:1 (Task #263). All chrome lives in the .cc-scope wrapper.

interface Props {
  claimId: number;
}

/* -------------------------- Card primitives ---------------------------- */

function CcCard({
  title, action, icon, children, padded = true, dense = false, testId,
}: {
  title: ReactNode; action?: ReactNode; icon?: ReactNode;
  children: ReactNode; padded?: boolean; dense?: boolean; testId?: string;
}) {
  return (
    <div className="cc-card" data-testid={testId}>
      <div
        className={`px-4 ${dense ? "py-2" : "py-3"} flex items-center justify-between`}
        style={{ borderBottom: "1px solid var(--cc-border)" }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</div>
        {action}
      </div>
      <div className={padded ? "p-4" : ""}>{children}</div>
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

function GoToGroupLink({ groupId, children }: { groupId: number | null; children: ReactNode }) {
  if (!groupId) return null;
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

/* --------------------------- Helpers ----------------------------------- */

// Tone mapping owns *color only*; labels come from @workspace/vocab via
// `legSubStatusDisplayLabel(subStatus, claim)` so a dropped-via-
// cannot_dispute leg renders as "Non-contestable".
const SUB_STATUS_TO_TONE: Record<string, Tone> = {
  needs_classification: "amber",
  investigating: "amber",
  ready: "blue",
  dropped: "muted",
  blocked: "amber",
  excluded: "muted",
};

function relativeTime(iso: string | null | undefined): string {
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

function auditIcon(action: string) {
  const a = action.toLowerCase();
  if (a.includes("note")) return <Pin className="w-3 h-3" />;
  if (a.includes("email") || a.includes("reply")) return <Mail className="w-3 h-3" />;
  if (a.includes("evidence") || a.includes("attach")) return <Paperclip className="w-3 h-3" />;
  if (a.includes("sop") || a.includes("walk")) return <Send className="w-3 h-3" />;
  if (a.includes("classif") || a.includes("error")) return <CheckCircle2 className="w-3 h-3" />;
  if (a.includes("hold") || a.includes("exclude") || a.includes("reattest")) {
    return <AlertTriangle className="w-3 h-3" />;
  }
  if (a.includes("context")) return <Edit2 className="w-3 h-3" />;
  return <Clock className="w-3 h-3" />;
}

function auditTone(action: string): string {
  const a = action.toLowerCase();
  if (a.includes("email") || a.includes("reply")) return "var(--cc-purple-fg)";
  if (a.includes("hold") || a.includes("exclude") || a.includes("reattest")) {
    return "var(--cc-warning)";
  }
  if (a.includes("classif") || a.includes("approve") || a.includes("complete")) {
    return "var(--cc-success)";
  }
  if (a.includes("note") || a.includes("context") || a.includes("sop")) {
    return "var(--cc-blue-fg)";
  }
  return "var(--cc-muted-fg)";
}

/* ============================== Page ================================== */

export function ClaimDetailV2({ claimId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: claim, isLoading } = useGetClaim(claimId, {
    query: { queryKey: getGetClaimQueryKey(claimId), enabled: !!claimId },
  });

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

  const [legContext, setLegContext] = useState<string>("");
  useEffect(() => {
    setLegContext(claim?.perLegContext ?? "");
  }, [claim?.perLegContext]);

  const groupIsPreSubmit = !parentGroup
    || parentGroup.status === "New"
    || parentGroup.status === "Needs Evidence";

  const { data: collectedEvidence } = useListClaimEvidence(claimId, {
    query: { queryKey: getListClaimEvidenceQueryKey(claimId), enabled: !!claimId },
  });
  const evidenceItems = useMemo(() => {
    const raw = collectedEvidence?.evidence;
    return Array.isArray(raw) ? raw : [];
  }, [collectedEvidence]);

  const { data: notesData } = useListClaimNotes(claimId, {
    query: { queryKey: getListClaimNotesQueryKey(claimId), enabled: !!claimId },
  });
  const visibleNotes = useMemo<NoteResponse[]>(() => {
    if (!notesData) return [];
    return notesData
      .filter((n) => n.type === "manual" || n.type === "system" || n.type === "bot")
      .slice()
      .sort(
        (a, b) =>
          new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      );
  }, [notesData]);

  const { data: auditLogs } = useListClaimAuditLogs(claimId, {
    query: { queryKey: getListClaimAuditLogsQueryKey(claimId), enabled: !!claimId },
  });
  const sortedAudit = useMemo<AuditLogResponse[]>(() => {
    if (!auditLogs) return [];
    return auditLogs
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [auditLogs]);

  // Per-leg email thread: dedicated server endpoint walks every conversation
  // tied to this claimId and pulls in sibling-claim messages that share the
  // thread. We treat every message in that thread as a "leg mention" — it's
  // by definition a message that touches this leg.
  const { data: claimThread } = useGetClaimEmailThread(claimId, {
    query: {
      queryKey: getGetClaimEmailThreadQueryKey(claimId),
      enabled: !!claimId,
    },
  });
  const legMentions = useMemo(() => {
    if (!claimThread?.messages) return [];
    return claimThread.messages
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8);
  }, [claimThread]);

  /* ----------- Mutations & local UI state ----------- */

  const setLegContextMutation = useSetLegContext();
  const placeHoldMutation = usePlaceLegOnHold();
  const clearHoldMutation = useClearLegHold();
  const reclassifyMutation = useReclassifyLeg();
  const excludeMutation = useExcludeLeg();
  const includeMutation = useIncludeLeg();
  const createNoteMutation = useCreateClaimNote();
  const addEvidenceMutation = useAddClaimEvidence();
  const [isUploadingEvidence, setIsUploadingEvidence] = useState(false);

  async function handleEvidenceFileSelected(file: File) {
    setIsUploadingEvidence(true);
    try {
      const reqRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!reqRes.ok) throw new Error("Could not get upload URL");
      const { uploadURL, objectPath } = await reqRes.json();
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload failed");
      await addEvidenceMutation.mutateAsync({
        claimId,
        data: {
          evidenceTypeName: file.name,
          imageUrl: objectPath,
        },
      });
      toast({ title: "Evidence attached", description: file.name });
      qc.invalidateQueries({ queryKey: getListClaimEvidenceQueryKey(claimId) });
      qc.invalidateQueries({ queryKey: getGetClaimQueryKey(claimId) });
    } catch (e) {
      toast({
        title: "Attach failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setIsUploadingEvidence(false);
    }
  }

  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState<LegHoldReason | "">("");
  const [holdNote, setHoldNote] = useState("");
  const holdValid = isHoldReasonValid(holdReason, holdNote);

  const [reclassifyOpen, setReclassifyOpen] = useState(false);

  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excludeReason, setExcludeReason] = useState<ExcludeLegBodyReason | "">("");
  const [excludeNote, setExcludeNote] = useState("");
  const excludeValid =
    excludeReason !== "" &&
    (excludeReason !== "other" || excludeNote.trim().length > 0);

  const [newNote, setNewNote] = useState("");

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

  function onSaveLegContext() {
    setLegContextMutation.mutate(
      { id: claimId, data: { context: legContext } },
      {
        onSuccess: () => {
          toast({ title: "Per-leg context saved" });
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Save failed",
          description: String((e as Error).message),
          variant: "destructive",
        }),
      },
    );
  }

  function onPostNote() {
    const text = newNote.trim();
    if (!text) return;
    createNoteMutation.mutate(
      { id: claimId, data: { content: text, type: "manual" } },
      {
        onSuccess: () => {
          toast({ title: "Note posted" });
          setNewNote("");
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Post failed",
          description: String((e as Error).message),
          variant: "destructive",
        }),
      },
    );
  }

  function onPlaceHold() {
    if (!holdValid || !holdReason) return;
    placeHoldMutation.mutate(
      { id: claimId, data: { reason: holdReason, note: holdNote || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Leg placed on hold" });
          setHoldOpen(false);
          setHoldReason("");
          setHoldNote("");
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Hold failed",
          description: String((e as Error).message),
          variant: "destructive",
        }),
      },
    );
  }

  function onClearHold() {
    clearHoldMutation.mutate(
      { id: claimId },
      {
        onSuccess: () => {
          toast({ title: "Hold cleared" });
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Clear hold failed",
          description: String((e as Error).message),
          variant: "destructive",
        }),
      },
    );
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

  function onInclude() {
    includeMutation.mutate(
      { id: claimId, data: {} },
      {
        onSuccess: () => {
          toast({ title: "Leg re-included in dispute" });
          invalidateLeg();
        },
        onError: (e: unknown) => toast({
          title: "Include failed",
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
    hasSopOutcome ||
    subStatus === "investigating" ||
    subStatus === "ready" ||
    subStatus === "dropped";
  const playerDisabledReason = canShowPlayer
    ? null
    : subStatus === "blocked"
      ? "Leg is on hold — clear the hold to advance the SOP."
      : subStatus === "excluded"
        ? "Leg is excluded from the dispute."
        : subStatus === "needs_classification"
          ? "Pick an error type before walking the SOP."
          : null;

  const groupRideCount = parentGroup?.rideCount ?? 1;
  const legPosition = (() => {
    if (!parentGroup) return null;
    return { count: groupRideCount };
  })();

  return (
    <div className="cc-scope min-h-screen p-6" data-testid="claim-detail-v2">
      <div className="max-w-[1180px] mx-auto space-y-4">

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
          <Link href="/queue" className="hover:underline">Claims</Link>
          {parentGroup && (
            <>
              <span>/</span>
              <Link
                href={`/invoice-groups/${parentGroup.id}`}
                className="hover:underline inline-flex items-center gap-1"
                data-testid="leg-back-to-group"
              >
                <ChevronLeft className="w-3 h-3" /> Invoice #{parentGroup.invoiceNumber || parentGroup.id}
              </Link>
            </>
          )}
          <span>/</span>
          <span style={{ color: "var(--cc-fg)" }}>
            Leg #{claim.id}{legPosition ? ` of ${legPosition.count}` : ""}
          </span>
        </div>

        {/* Header */}
        <div className="cc-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-1 h-12 rounded" style={{ background: "var(--cc-blue-fg)" }} />
              <div className="min-w-0">
                <div
                  className="text-[11px] uppercase tracking-wide font-semibold mb-0.5"
                  style={{ color: "var(--cc-muted-fg)" }}
                >
                  Leg / claim
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold mono">{claim.confNumber || `CLM-${claim.id}`}</h1>
                  <StatusPill tone={subStatusTone}>{subStatusLabel}</StatusPill>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>·</span>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                    {claim.date ? (
                      <>Pickup <span className="font-medium mono" style={{ color: "var(--cc-fg)" }}>{formatDate(claim.date)}</span> · </>
                    ) : null}
                    {claim.errorTypeName ? (
                      <>{claim.errorTypeName} · </>
                    ) : null}
                    <span className="font-medium mono" style={{ color: "var(--cc-fg)" }}>
                      {formatCurrency(claim.claimAmount ?? "0")}
                    </span>
                  </span>
                </div>
                <div className="text-xs mt-1.5" style={{ color: "var(--cc-muted-fg)" }}>
                  Updated <span className="font-medium" style={{ color: "var(--cc-fg)" }}>{relativeTime(claim.updatedAt)}</span>
                  {parentGroup ? (
                    <> · Group state: <span className="font-medium" style={{ color: "var(--cc-fg)" }}>{parentGroup.status}</span></>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                style={{ border: "1px solid var(--cc-border)" }}
                disabled
                title="Reassignment is managed from the queue"
              >
                <UserPlus className="w-3.5 h-3.5" /> Reassign
              </button>

              {subStatus === "blocked" ? (
                <Button
                  size="sm" variant="outline"
                  onClick={onClearHold}
                  disabled={clearHoldMutation.isPending}
                  data-testid="leg-clear-hold"
                  className="h-8"
                >
                  <Play className="h-3.5 w-3.5 mr-1" /> Clear hold
                </Button>
              ) : (
                subStatus !== "excluded" && (
                  <Dialog open={holdOpen} onOpenChange={setHoldOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" data-testid="leg-hold-trigger" className="h-8">
                        <PauseCircle className="h-3.5 w-3.5 mr-1" /> Hold
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Place leg on hold</DialogTitle>
                      </DialogHeader>
                      <HoldReasonSelect
                        reason={holdReason}
                        note={holdNote}
                        onReasonChange={setHoldReason}
                        onNoteChange={setHoldNote}
                      />
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setHoldOpen(false)}>Cancel</Button>
                        <Button
                          onClick={onPlaceHold}
                          disabled={!holdValid || placeHoldMutation.isPending}
                          data-testid="leg-hold-confirm"
                        >
                          {placeHoldMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          ) : (
                            <PauseCircle className="h-3.5 w-3.5 mr-1" />
                          )}
                          Place on hold
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )
              )}

              {subStatus === "needs_classification" && (
                <Dialog open={excludeOpen} onOpenChange={setExcludeOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" data-testid="leg-exclude-trigger" className="h-8">
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Exclude leg
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

              {subStatus === "excluded" && groupIsPreSubmit && (
                <Button
                  size="sm" variant="outline"
                  onClick={onInclude}
                  disabled={includeMutation.isPending}
                  data-testid="leg-include"
                  className="h-8"
                >
                  {includeMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  )}
                  Include in dispute
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-12 gap-4">

          {/* LEFT — Investigation workspace (8 cols) */}
          <div className="col-span-8 space-y-4">

            {/* Per-leg context */}
            <CcCard
              title="Per-leg context"
              icon={<Edit2 className="w-3.5 h-3.5" />}
              testId="leg-context-section"
              action={
                <button
                  className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                  style={{ background: "var(--cc-blue-fg)", color: "white" }}
                  onClick={onSaveLegContext}
                  disabled={
                    !groupIsPreSubmit ||
                    setLegContextMutation.isPending ||
                    legContext === (claim.perLegContext ?? "")
                  }
                  data-testid="leg-context-save"
                >
                  {setLegContextMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  Save
                </button>
              }
            >
              <textarea
                rows={3}
                value={legContext}
                onChange={(e) => setLegContext(e.target.value)}
                readOnly={!groupIsPreSubmit}
                className="cc-textarea"
                style={{ resize: "vertical" }}
                placeholder="Narrative for this leg that the dispute write-up will pick up. Empty clears the field."
                data-testid="leg-context-input"
              />
              <div className="text-xs mt-2" style={{ color: "var(--cc-muted-fg)" }}>
                {groupIsPreSubmit
                  ? "Legs-only context. The group context is shared by all legs and edited on the group page."
                  : "Read-only — the parent group has already moved past pre-submit."}
              </div>
            </CcCard>

            {/* SOP walk */}
            <CcCard
              title="Investigation walk"
              icon={<FileText className="w-3.5 h-3.5" />}
              action={
                errorType ? (
                  <span
                    className="text-xs px-2 py-0.5 rounded"
                    style={{ background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}
                  >
                    {errorType.name} · SOP
                  </span>
                ) : null
              }
            >
              {!claim.errorTypeId && (
                <div
                  className="text-xs flex items-start gap-2 p-2 rounded"
                  style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>This leg has no error type yet. Pick one from the queue or use the legacy classifier.</span>
                </div>
              )}
              {claim.errorTypeId && !tree && (
                <div
                  className="text-xs flex items-start gap-2 p-2 rounded"
                  style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    The assigned error type has no decision tree configured.
                    {" "}
                    <Link href="/error-types" className="underline">Configure one</Link> to walk the SOP here.
                  </span>
                </div>
              )}
              {tree && canShowPlayer && (
                <SopAdvancePlayer
                  leg={{
                    id: claim.id,
                    errorTypeId: claim.errorTypeId,
                    sopNodeId: claim.sopNodeId,
                    sopOutcome: claim.sopOutcome,
                    dropReason: claim.dropReason,
                    invoiceGroupId: claim.invoiceGroupId,
                  }}
                  tree={tree}
                  onAdvanced={invalidateLeg}
                />
              )}
              {tree && !canShowPlayer && playerDisabledReason && (
                <MutedNote>{playerDisabledReason}</MutedNote>
              )}
            </CcCard>

            {/* Reclassify */}
            {(subStatus === "investigating" ||
              subStatus === "ready" ||
              subStatus === "dropped" ||
              subStatus === "blocked") && (
              <CcCard
                title={
                  <>
                    Error type ·{" "}
                    <span className="font-normal" style={{ color: "var(--cc-muted-fg)" }}>
                      {claim.errorTypeName || "—"}
                    </span>
                  </>
                }
                icon={<AlertTriangle className="w-3.5 h-3.5" />}
                action={
                  <Dialog open={reclassifyOpen} onOpenChange={setReclassifyOpen}>
                    <DialogTrigger asChild>
                      <button
                        className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                        style={{
                          border: "1px solid var(--cc-destructive)",
                          color: "var(--cc-destructive)",
                        }}
                        data-testid="leg-reclassify"
                      >
                        <RotateCcw className="w-3 h-3" /> Reclassify…
                      </button>
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
                          This will <strong>discard the SOP walk and any drop reason</strong> on this leg,
                          returning it to <em>needs classification</em>. Saved per-leg context is preserved.
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
                }
              >
                <div className="text-xs flex items-start gap-2" style={{ color: "var(--cc-muted-fg)" }}>
                  <AlertTriangle
                    className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                    style={{ color: "var(--cc-warning)" }}
                  />
                  <span>
                    Reclassifying discards the SOP walk above and resets the drop reason. Pre-submit only.
                  </span>
                </div>
              </CcCard>
            )}

            {/* Evidence */}
            <CcCard
              title={
                <>
                  Evidence{" "}
                  <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>
                    · {evidenceItems.length} file{evidenceItems.length === 1 ? "" : "s"}
                  </span>
                </>
              }
              icon={<Paperclip className="w-3.5 h-3.5" />}
              testId="leg-evidence-section"
              action={
                <label
                  className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1 cursor-pointer"
                  style={{
                    border: "1px solid var(--cc-border)",
                    opacity: isUploadingEvidence ? 0.6 : 1,
                    pointerEvents: isUploadingEvidence ? "none" : "auto",
                  }}
                  data-testid="leg-evidence-attach-button"
                >
                  {isUploadingEvidence ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                  Attach file
                  <input
                    type="file"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        handleEvidenceFileSelected(f);
                        e.target.value = "";
                      }
                    }}
                    disabled={isUploadingEvidence}
                    data-testid="leg-evidence-file-input"
                  />
                </label>
              }
              padded={false}
            >
              {evidenceItems.length === 0 ? (
                <div
                  className="px-4 py-3 text-sm italic"
                  style={{ color: "var(--cc-muted-fg)" }}
                  data-testid="leg-evidence-empty"
                >
                  No evidence attached to this leg yet.
                </div>
              ) : (
                evidenceItems.map((ev, i) => {
                  const item = ev as {
                    id?: number;
                    label?: string | null;
                    fileName?: string | null;
                    sourceType?: string | null;
                    fileSize?: number | null;
                    createdAt?: string | null;
                  };
                  const isLast = i === evidenceItems.length - 1;
                  return (
                    <div
                      key={item.id ?? i}
                      className="px-4 py-2.5 flex items-center gap-3 text-sm"
                      style={{ borderBottom: isLast ? "none" : "1px solid var(--cc-border)" }}
                      data-testid={`leg-evidence-item-${item.id ?? "x"}`}
                    >
                      <Paperclip
                        className="w-3.5 h-3.5 flex-shrink-0"
                        style={{ color: "var(--cc-muted-fg)" }}
                      />
                      <span className="font-medium flex-1 truncate">
                        {item.label || item.fileName || "Untitled evidence"}
                      </span>
                      {item.sourceType && (
                        <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                          {item.sourceType}
                        </span>
                      )}
                      {item.createdAt && (
                        <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                          {formatDateTime(item.createdAt)}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </CcCard>

            {/* Notes */}
            <CcCard
              title={
                <>
                  Notes{" "}
                  <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>
                    · {visibleNotes.length}
                  </span>
                </>
              }
              icon={<Pin className="w-3.5 h-3.5" />}
              testId="leg-notes-section"
            >
              {visibleNotes.length === 0 ? (
                <p className="text-sm italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No notes on this leg yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {visibleNotes.slice(0, 8).map((n) => {
                    const author = n.author || "—";
                    const initial = author.charAt(0).toUpperCase() || "?";
                    return (
                      <div key={n.id} className="text-sm flex gap-2.5 items-start">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                          style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}
                        >
                          {initial}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-semibold text-xs">{author}</span>
                            <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                              {relativeTime(n.createdAt)}
                            </span>
                          </div>
                          <div style={{ color: "var(--cc-fg)" }}>{n.content}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--cc-border)" }}>
                <textarea
                  rows={2}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add a note for this leg…"
                  className="cc-textarea"
                  style={{ resize: "vertical" }}
                  data-testid="leg-note-input"
                />
                <div className="flex justify-end mt-2">
                  <button
                    className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                    style={{ background: "var(--cc-blue-fg)", color: "white" }}
                    onClick={onPostNote}
                    disabled={!newNote.trim() || createNoteMutation.isPending}
                    data-testid="leg-note-post"
                  >
                    {createNoteMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                    Post note
                  </button>
                </div>
              </div>
            </CcCard>

            {/* Communication mentions (read-only) */}
            <CcCard
              title={
                <>
                  Communication{" "}
                  <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>
                    · {legMentions.length} mention{legMentions.length === 1 ? "" : "s"} of this leg
                  </span>
                </>
              }
              icon={<Mail className="w-3.5 h-3.5" />}
              action={<GoToGroupLink groupId={parentGroupId}>Open invoice thread</GoToGroupLink>}
              padded={false}
              testId="leg-communication-mentions"
            >
              <div
                className="px-4 py-2 text-xs flex items-start gap-1.5"
                style={{
                  background: "var(--cc-muted)", color: "var(--cc-muted-fg)",
                  borderBottom: "1px solid var(--cc-border)",
                }}
              >
                <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>
                  Conversations happen at the invoice level. This list shows messages in the invoice thread that
                  mention <span className="font-mono font-semibold">{claim.confNumber || `#${claim.id}`}</span>.
                  Reply or compose from the invoice page.
                </span>
              </div>
              {legMentions.length === 0 ? (
                <div className="px-4 py-3 text-sm italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No messages in the invoice thread mention this leg yet.
                </div>
              ) : (
                legMentions.map((m, i, arr) => (
                  <div
                    key={m.id}
                    className="px-4 py-2 text-xs flex items-start gap-2"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                  >
                    <Mail
                      className="w-3 h-3 mt-0.5 flex-shrink-0"
                      style={{
                        color:
                          m.direction === "inbound"
                            ? "var(--cc-amber-fg)"
                            : "var(--cc-purple-fg)",
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold">{m.sender}</span>
                        <span style={{ color: "var(--cc-muted-fg)" }}>{formatDateTime(m.timestamp)}</span>
                      </div>
                      <div className="truncate" style={{ color: "var(--cc-fg)" }}>
                        {m.subject || m.bodyPreview || "(no subject)"}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CcCard>
          </div>

          {/* RIGHT — Group rail (4 cols) */}
          <div className="col-span-4 space-y-4">

            {/* Parent group context */}
            {parentGroup && (
              <CcCard
                title="Parent invoice"
                icon={<FileText className="w-3.5 h-3.5" />}
                action={<GoToGroupLink groupId={parentGroupId}>Open group</GoToGroupLink>}
              >
                <div className="text-base font-bold mono mb-1">
                  {parentGroup.invoiceNumber || `INV-${parentGroup.id}`}
                </div>
                <div className="text-xs mb-3" style={{ color: "var(--cc-muted-fg)" }}>
                  {parentGroup.payorEmail || "Payor"}
                  {claim.date ? ` · DOS ${formatDate(claim.date)}` : ""}
                  {" · "}{parentGroup.rideCount} leg{parentGroup.rideCount === 1 ? "" : "s"} ·{" "}
                  <span className="mono">{formatCurrency(parentGroup.totalAmount ?? "0")}</span> total
                </div>
                <div className="space-y-1">
                  <FieldRow
                    label="Group status"
                    value={<StatusPill tone="amber">{parentGroup.status}</StatusPill>}
                  />
                  <FieldRow
                    label="Days in queue"
                    value={
                      <span className="mono">
                        {(() => {
                          const d = Math.max(
                            0,
                            Math.floor(
                              (Date.now() - new Date(parentGroup.createdAt ?? Date.now()).getTime()) /
                                (1000 * 60 * 60 * 24),
                            ),
                          );
                          return `${d}d`;
                        })()}
                      </span>
                    }
                  />
                </div>
                <div
                  className="text-xs mt-3 p-2 rounded"
                  style={{ background: "var(--cc-blue-bg)", color: "var(--cc-blue-fg)" }}
                >
                  Group context, evidence, and submission live on the group page.
                </div>
              </CcCard>
            )}

            {/* Latest verdict (read-only) */}
            <CcCard
              title="Latest payor verdict"
              icon={<Gavel className="w-3.5 h-3.5" />}
              action={<GoToGroupLink groupId={parentGroupId}>Record on group</GoToGroupLink>}
              testId="leg-verdict-section"
            >
              <div className="text-xs mb-2" style={{ color: "var(--cc-muted-fg)" }}>
                Read-only on the leg page. Verdicts are recorded against the group.
              </div>
              {claim.outcome && claim.outcome !== "Pending" ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <StatusPill
                      tone={
                        claim.outcome === "Approved"
                          ? "green"
                          : claim.outcome === "Denied"
                            ? "red"
                            : "amber"
                      }
                    >
                      {claim.outcome}
                    </StatusPill>
                    {claim.closureReason && (
                      <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                        {claim.closureReason}
                      </span>
                    )}
                  </div>
                  {claim.approvedAmount && (
                    <div className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                      Approved amount:{" "}
                      <span className="font-mono font-medium" style={{ color: "var(--cc-fg)" }}>
                        {formatCurrency(claim.approvedAmount)}
                      </span>
                    </div>
                  )}
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

            {/* MAS card (read-only) */}
            <CcCard
              title="MAS action"
              icon={<Stamp className="w-3.5 h-3.5" />}
              action={<GoToGroupLink groupId={parentGroupId}>Complete on group</GoToGroupLink>}
              testId="leg-mas-section"
            >
              {claim.masActionRequired && claim.masActionRequired !== "none" ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <StatusPill tone="amber">Reattest required</StatusPill>
                  </div>
                  <div className="text-xs mb-2" style={{ color: "var(--cc-fg)" }}>
                    Required action:{" "}
                    <code className="font-mono">{claim.masActionRequired}</code>
                  </div>
                  <MutedNote>Mark MAS complete from the group's MAS card.</MutedNote>
                </>
              ) : (
                <p className="text-sm italic" style={{ color: "var(--cc-muted-fg)" }} data-testid="leg-mas-empty">
                  No MAS action required.
                </p>
              )}
            </CcCard>

            {/* Audit timeline */}
            <CcCard
              title="Audit timeline"
              icon={<Activity className="w-3.5 h-3.5" />}
              padded={false}
              testId="leg-audit-section"
            >
              {sortedAudit.length === 0 ? (
                <div className="px-4 py-3 text-sm italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No audit events yet.
                </div>
              ) : (
                sortedAudit.slice(0, 10).map((e, i, arr) => (
                  <div
                    key={e.id}
                    className="px-4 py-2 flex items-start gap-2 text-xs"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                  >
                    <div className="mt-0.5 flex-shrink-0" style={{ color: auditTone(e.action) }}>
                      {auditIcon(e.action)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div style={{ color: "var(--cc-fg)" }}>{e.details || e.action}</div>
                      <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>
                        {(e.userName || e.userEmail || "system")} · {relativeTime(e.timestamp)}
                        {e.viaGroup ? " · via group" : ""}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CcCard>
          </div>
        </div>
      </div>
    </div>
  );
}
