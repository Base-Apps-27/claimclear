import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  useGetInvoiceGroupValidTransitions,
  getGetInvoiceGroupValidTransitionsQueryKey,
  usePackageInvoiceGroup,
  useGetInvoiceGroupEmailThread,
  useReplyToInvoiceGroupEmailConversation,
  getGetInvoiceGroupEmailThreadQueryKey,
  useCheckEmailResponses,
  useCreateInvoiceGroupNote,
  useHoldInvoiceGroup,
  useRemoveInvoiceGroupHold,
  useCompleteLegMasAction,
  useCompleteGroupReattest,
} from "@workspace/api-client-react";
import { MasActionChecklist } from "@/components/mas-action-checklist";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
  PortalResponseItem,
  GroupPackagingReadiness,
  AuditLogResponse,
  NoteResponse,
} from "@workspace/api-client-react";
import {
  Loader2, ChevronLeft, ChevronRight, Edit2, Save, Plus, Paperclip, Send,
  Mail, Gavel, Stamp, FileText, Activity, Pin, AlertTriangle, CheckCircle2,
  XCircle, PauseCircle, Lock, ListChecks, Sparkles, Inbox, Clock, ClipboardCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { StatusPill } from "@/components/cohesion";
import type { Tone } from "@/components/cohesion/tone";
import { deriveLegSubStatus, type LegSubStatus } from "@workspace/leg-state";
import { legSubStatusLabel as glossarySubStatusLabel } from "@workspace/vocab";
import { ClosureActions } from "@/components/closure/closure-actions";
import { InvoiceGroupSubmissionGauntlet } from "@/components/invoice-group-submission-gauntlet";
import { GroupCommunicationThread } from "@/components/communication/group-communication-thread";
import {
  mapToGroupConversations,
  pickGroupBannerData,
  htmlBodyToPlainText,
} from "@/components/communication/group-thread-adapter";

// Invoice-group orchestration surface — densified to match
// GroupDetailRedensified mockup 1:1 (Task #263). All chrome lives in the
// .cc-scope wrapper; behavior continues to use the same hooks the prior
// shadcn-card layout did, plus shared subcomponents that the queue
// inline workspace also mounts (InvoiceGroupSubmissionGauntlet,
// GroupCommunicationThread). The detail page keeps its own densified
// inlined legs table; the queue's Panel A uses InvoiceGroupLegsList.
//
// Task #265 removed the group-aggregate-context surface — per-leg
// context now lives directly on each leg row in the queue and the
// editable AI write-up replaces the group-level narrative form.

interface Props {
  groupId: number;
}

/* -------------------------- Card primitives ---------------------------- */

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

function Kpi({ label, value, sub, tone = "neutral", testId }: {
  label: string; value: ReactNode; sub?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad"; testId?: string;
}) {
  const c =
    tone === "good" ? "var(--cc-success)" :
    tone === "warn" ? "var(--cc-warning)" :
    tone === "bad"  ? "var(--cc-destructive)" : "var(--cc-fg)";
  return (
    <div className="cc-card p-3" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wide font-semibold mb-1"
           style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className="text-xl font-bold mono" style={{ color: c }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>{sub}</div>}
    </div>
  );
}

/* --------------------------- Helpers ----------------------------------- */

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

function statusTone(status: string | undefined): Tone {
  switch (status) {
    case "Resolved":
      return "green";
    case "Denied":
      return "red";
    case "Submitted":
    case "Awaiting Response":
    case "Awaiting Payout":
      return "blue";
    case "Generating Email":
    case "Email Generated":
    case "Needs Evidence":
      return "amber";
    default:
      return "muted";
  }
}

function legSubStatusTone(s: LegSubStatus): Tone {
  switch (s) {
    case "ready": return "green";
    case "investigating": return "amber";
    case "blocked": return "red";
    case "excluded":
    case "dropped":
      return "muted";
    case "needs_classification": return "amber";
    default: return "muted";
  }
}

// Thin wrapper around the glossary so existing render call sites
// (`legSubStatusLabel(sub)`) keep working. See @workspace/vocab for the
// canonical labels.
function legSubStatusLabel(s: LegSubStatus): string {
  return glossarySubStatusLabel(s);
}

function auditIcon(action: string) {
  const a = action.toLowerCase();
  if (a.includes("note")) return <Pin className="w-3 h-3" />;
  if (a.includes("email") || a.includes("reply")) return <Mail className="w-3 h-3" />;
  if (a.includes("evidence") || a.includes("attach")) return <Paperclip className="w-3 h-3" />;
  if (a.includes("sop") || a.includes("walk") || a.includes("submit") || a.includes("package")) return <Send className="w-3 h-3" />;
  if (a.includes("classif") || a.includes("complete") || a.includes("approve")) return <CheckCircle2 className="w-3 h-3" />;
  if (a.includes("hold") || a.includes("exclude") || a.includes("reattest")) {
    return <AlertTriangle className="w-3 h-3" />;
  }
  if (a.includes("context")) return <Edit2 className="w-3 h-3" />;
  if (a.includes("close") || a.includes("withdraw") || a.includes("denied")) return <XCircle className="w-3 h-3" />;
  if (a.includes("create")) return <FileText className="w-3 h-3" />;
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
  if (a.includes("note") || a.includes("context") || a.includes("sop") || a.includes("submit") || a.includes("package")) {
    return "var(--cc-blue-fg)";
  }
  if (a.includes("denied") || a.includes("close") || a.includes("withdraw")) {
    return "var(--cc-destructive)";
  }
  return "var(--cc-muted-fg)";
}

function authorInitial(name: string | null | undefined): string {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase() || "?";
}

/* ============================== Page ================================== */

export function InvoiceGroupDetailV2({ groupId }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: group, isLoading } = useGetInvoiceGroup(groupId, {
    query: { queryKey: getGetInvoiceGroupQueryKey(groupId), enabled: !!groupId },
  });

  const packageMutation = usePackageInvoiceGroup();
  const replyMutation = useReplyToInvoiceGroupEmailConversation();
  const checkEmailMutation = useCheckEmailResponses();
  const createNoteMutation = useCreateInvoiceGroupNote();
  const holdMutation = useHoldInvoiceGroup();
  const removeHoldMutation = useRemoveInvoiceGroupHold();
  // MAS action workflow — the cancel-in-MAS chore + re-attest confirm.
  // Hooked here so the checklist can live on this page (inside the
  // re-attest modal) after the standalone "MAS action" tab on
  // Responses Awaiting Review was retired. invalidateGroup() is the
  // existing helper defined further down in this component.
  const completeMasMutation = useCompleteLegMasAction();
  const completeReattestMutation = useCompleteGroupReattest();

  /* ---- Group note composer (POST /invoice-groups/:id/notes) ---- */
  const [newNote, setNewNote] = useState("");

  /* ---- Place-on-hold reason prompt (cc-scope inline) ---- */
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState("");

  /* ---- Re-attest modal (the "I'm re-attesting now" flow). The
     MAS-cancel checklist + reattest confirm copy lives inside this
     modal so the operator gets the playbook at the moment they say
     they're doing the work, instead of as a permanent slab on the
     page. */
  const [reattestOpen, setReattestOpen] = useState(false);

  const { data: validTransitions } = useGetInvoiceGroupValidTransitions(groupId, {
    query: {
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
      enabled: groupId > 0,
    },
  });

  const detail = group as InvoiceGroupDetailResponse | undefined;
  const allRides: ClaimResponse[] = detail?.rides ?? [];
  const disputedRides = useMemo(
    () => allRides.filter((r) => r.includedInDispute !== false),
    [allRides],
  );
  const excludedCount = allRides.length - disputedRides.length;
  const isPreSubmit = group?.status === "New" || group?.status === "Needs Evidence";
  const packagingReadiness: GroupPackagingReadiness | undefined = detail?.packagingReadiness;

  /* Aggregate-context state removed in Task #265 — per-leg context lives
     on each leg row in the queue and the editable AI write-up replaces
     the group-level narrative form. */

  /* ---- KPI strip values ---- */
  const totalExposure = useMemo(() => {
    return allRides.reduce(
      (sum, r) => sum + Number(r.claimAmount ?? 0),
      0,
    );
  }, [allRides]);
  const inDisputeAmount = useMemo(() => {
    return disputedRides
      .filter((r) => r.outcome !== "Approved")
      .reduce((sum, r) => sum + Number(r.claimAmount ?? 0), 0);
  }, [disputedRides]);
  const inDisputeCount = useMemo(
    () => disputedRides.filter((r) => r.outcome !== "Approved").length,
    [disputedRides],
  );
  const excludedAmount = useMemo(() => {
    return allRides
      .filter((r) => r.includedInDispute === false)
      .reduce((sum, r) => sum + Number(r.claimAmount ?? 0), 0);
  }, [allRides]);
  const recoveredAmount = useMemo(() => {
    return allRides.reduce(
      (sum, r) => sum + Number(r.approvedAmount ?? 0),
      0,
    );
  }, [allRides]);
  const daysInQueue = useMemo(() => {
    if (!group?.createdAt) return 0;
    const ms = Date.now() - new Date(group.createdAt).getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  }, [group?.createdAt]);

  /* ---- Disputed-only filter ---- */
  const [disputedOnly, setDisputedOnly] = useState(true);
  const visibleRides = disputedOnly ? disputedRides : allRides;

  /* ---- Notes / Audit (from detail payload) ---- */
  const visibleNotes = useMemo<NoteResponse[]>(() => {
    if (!detail?.notes) return [];
    return detail.notes
      .filter((n) => n.type === "manual" || n.type === "system" || n.type === "bot")
      .slice()
      .sort(
        (a, b) =>
          new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      );
  }, [detail?.notes]);
  const sortedAudit = useMemo<AuditLogResponse[]>(() => {
    if (!detail?.auditLogs) return [];
    return detail.auditLogs
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [detail?.auditLogs]);

  /* ---- Communication thread ---- */
  const { data: emailThread } = useGetInvoiceGroupEmailThread(groupId);
  const legIdToLabel = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of allRides) {
      map.set(r.id, r.confNumber ? `${r.confNumber}` : `Leg #${r.id}`);
    }
    return map;
  }, [allRides]);
  const conversations = useMemo(
    () => mapToGroupConversations(emailThread, legIdToLabel),
    [emailThread, legIdToLabel],
  );
  const computedBanner = useMemo(
    () => pickGroupBannerData(emailThread),
    [emailThread],
  );
  const [bannerDismissedAt, setBannerDismissedAt] = useState<string | null>(null);
  const bannerData =
    computedBanner &&
    (!bannerDismissedAt || computedBanner.timestamp > bannerDismissedAt)
      ? computedBanner
      : null;

  function invalidateGroup() {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: ["invoice-groups"] });
  }

  function onClickPackage() {
    packageMutation.mutate(
      { id: groupId },
      {
        onSuccess: () => {
          toast({
            title: "Invoice packaged",
            description: "Group moved to Generating Email — draft generation will pick up from here.",
          });
          invalidateGroup();
        },
        onError: (e: unknown) => {
          let errorMsg = e instanceof Error ? e.message : String(e);
          if (e != null && typeof e === "object" && "response" in e) {
            const axiosErr = e as { response?: { data?: { error?: string } } };
            const resp = axiosErr.response?.data;
            if (resp?.error) errorMsg = resp.error;
          }
          toast({
            title: "Cannot package yet",
            description: errorMsg,
            variant: "destructive",
          });
          invalidateGroup();
        },
      },
    );
  }

  // Task #265 removed onSaveGroupContext — the group-aggregate-context
  // surface no longer exists; per-leg context lives directly on each
  // leg row in the queue.
  //
  // The communications/email-thread wiring (Task #240) and the extracted
  // submission gauntlet (Task #232) are configured higher up in this
  // component (see toast/emailThread/conversations/replyMutation setup
  // around the data-loading section).

  function onSyncInbox() {
    checkEmailMutation.mutate(
      { data: { hoursBack: 24 } },
      {
        onSuccess: () => {
          toast({ title: "Inbox synced", description: "Pulled new payor replies into the thread." });
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupEmailThreadQueryKey(groupId) });
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
        },
        onError: (e: unknown) =>
          toast({
            title: "Sync failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  function onSubmitNote() {
    const trimmed = newNote.trim();
    if (!trimmed) return;
    createNoteMutation.mutate(
      { id: groupId, data: { content: trimmed } },
      {
        onSuccess: () => {
          setNewNote("");
          toast({ title: "Group note added" });
          invalidateGroup();
        },
        onError: (e: unknown) =>
          toast({
            title: "Failed to add note",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  function onSubmitHold() {
    const trimmed = holdReason.trim();
    if (!trimmed) return;
    holdMutation.mutate(
      { id: groupId, data: { reason: trimmed } },
      {
        onSuccess: () => {
          toast({ title: "Group placed on hold" });
          setHoldOpen(false);
          setHoldReason("");
          invalidateGroup();
        },
        onError: (e: unknown) =>
          toast({
            title: "Failed to place on hold",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  function onClearHold() {
    removeHoldMutation.mutate(
      { id: groupId },
      {
        onSuccess: () => {
          toast({ title: "Hold cleared" });
          invalidateGroup();
        },
        onError: (e: unknown) =>
          toast({
            title: "Failed to clear hold",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  if (isLoading || !group || !detail) {
    return (
      <div className="cc-scope min-h-screen p-6" style={{ background: "var(--cc-bg)", color: "var(--cc-fg)" }}>
        <div className="flex items-center justify-center h-64 gap-2" style={{ color: "var(--cc-muted-fg)" }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading invoice group…
        </div>
      </div>
    );
  }

  const isAlreadyClosed = group.status === "Resolved" || group.status === "Denied";

  return (
    <div className="cc-scope min-h-screen p-6" style={{ background: "var(--cc-bg)", color: "var(--cc-fg)" }} data-testid="invoice-group-detail-v2">
      <div className="max-w-[1180px] mx-auto space-y-4">

        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--cc-muted-fg)" }}>
          <Link href="/" className="hover:underline inline-flex items-center gap-1">
            <ChevronLeft className="w-3 h-3" /> Invoice groups
          </Link>
          <span>/</span>
          <span style={{ color: "var(--cc-fg)" }} className="mono">
            {group.invoiceNumber || `#${group.id}`}
          </span>
        </div>

        {/* Accent header */}
        <div className="cc-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-1 h-12 rounded" style={{ background: "var(--cc-purple-fg)" }} />
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide font-semibold mb-0.5"
                     style={{ color: "var(--cc-muted-fg)" }}>
                  Invoice group
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold mono">{group.invoiceNumber || `#${group.id}`}</h1>
                  <StatusPill tone={statusTone(group.status)}>{group.status}</StatusPill>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>·</span>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                    {group.errorTypeName ? <>{group.errorTypeName} · </> : null}
                    <span className="font-medium mono" style={{ color: "var(--cc-fg)" }}>
                      {allRides.length} leg{allRides.length === 1 ? "" : "s"}
                    </span>
                    {" · "}
                    <span className="font-medium mono" style={{ color: "var(--cc-fg)" }}>
                      {formatCurrency(group.totalAmount ?? "0")}
                    </span>
                  </span>
                </div>
                <div className="text-xs mt-1.5" style={{ color: "var(--cc-muted-fg)" }}>
                  {group.updatedAt ? (
                    <>Updated <span className="font-medium" style={{ color: "var(--cc-fg)" }}>{relativeTime(group.updatedAt)}</span> · </>
                  ) : null}
                  {daysInQueue}d in queue
                  {inDisputeCount > 0
                    ? ` · ${inDisputeCount} of ${allRides.length} legs in dispute`
                    : null}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {group?.status === "On Hold" ? (
                <button
                  className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                  style={{ border: "1px solid var(--cc-border)" }}
                  onClick={onClearHold}
                  disabled={removeHoldMutation.isPending}
                  data-testid="header-clear-hold-button"
                >
                  {removeHoldMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PauseCircle className="w-3.5 h-3.5" />
                  )}
                  Clear hold
                </button>
              ) : (
                <button
                  className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                  style={{ border: "1px solid var(--cc-border)" }}
                  onClick={() => setHoldOpen(true)}
                  disabled={holdMutation.isPending}
                  data-testid="header-hold-button"
                >
                  <PauseCircle className="w-3.5 h-3.5" /> Place group on hold
                </button>
              )}
              {isPreSubmit && packagingReadiness && (
                <button
                  className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                  style={{ background: "var(--cc-purple-fg)", color: "white" }}
                  onClick={onClickPackage}
                  disabled={!packagingReadiness.ready || packageMutation.isPending}
                  title={packagingReadiness.ready ? undefined : packagingReadiness.reason ?? undefined}
                  data-testid="header-ready-to-package-button"
                >
                  {packageMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  Ready to package
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Response-received banner */}
        {bannerData && (
          <a
            href="#invoice-thread"
            className="cc-card block no-underline hover:shadow-sm transition-shadow"
            style={{
              background: "var(--cc-amber-bg)",
              border: "1px solid var(--cc-amber-fg)",
              borderLeftWidth: "4px",
              color: "var(--cc-fg)",
              padding: "10px 14px",
            }}
            data-testid="response-received-banner"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                   style={{ background: "var(--cc-amber-fg)", color: "white" }}>
                <Mail className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-bold" style={{ color: "var(--cc-amber-fg)" }}>
                    New response from payor
                  </span>
                  {bannerData.subject && (
                    <>
                      <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>·</span>
                      <span className="text-xs font-medium" style={{ color: "var(--cc-fg)" }}>
                        {bannerData.subject}
                      </span>
                    </>
                  )}
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>·</span>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                    {relativeTime(bannerData.timestamp)}
                  </span>
                </div>
                {bannerData.preview && (
                  <div className="text-xs mt-0.5 truncate" style={{ color: "var(--cc-fg)" }}>
                    "{bannerData.preview}"
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span
                  className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5 font-semibold"
                  style={{ background: "var(--cc-amber-fg)", color: "white" }}
                >
                  Jump to thread
                </span>
                <button
                  title="Mark read"
                  className="w-7 h-7 rounded inline-flex items-center justify-center"
                  style={{ color: "var(--cc-muted-fg)" }}
                  onClick={(e) => {
                    e.preventDefault();
                    setBannerDismissedAt(computedBanner?.timestamp ?? null);
                  }}
                  data-testid="response-received-banner-dismiss"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </a>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-5 gap-3">
          <Kpi
            label="Total exposure"
            value={formatCurrency(totalExposure.toFixed(2))}
            sub={`${allRides.length} leg${allRides.length === 1 ? "" : "s"}`}
            testId="kpi-total-exposure"
          />
          <Kpi
            label="In dispute"
            value={formatCurrency(inDisputeAmount.toFixed(2))}
            sub={`${inDisputeCount} leg${inDisputeCount === 1 ? "" : "s"}`}
            tone="warn"
            testId="kpi-in-dispute"
          />
          <Kpi
            label="Non-issue"
            value={formatCurrency(excludedAmount.toFixed(2))}
            sub={excludedCount > 0 ? `${excludedCount} leg${excludedCount === 1 ? "" : "s"}` : "—"}
            testId="kpi-excluded"
          />
          <Kpi
            label="Recovered"
            value={formatCurrency(recoveredAmount.toFixed(2))}
            sub={recoveredAmount > 0 ? "approved" : "—"}
            tone="good"
            testId="kpi-recovered"
          />
          <Kpi
            label="Days in queue"
            value={String(daysInQueue)}
            tone={daysInQueue > 12 ? "warn" : "neutral"}
            testId="kpi-days-in-queue"
          />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-12 gap-4">

          {/* LEFT — orchestration body (8 cols) */}
          <div className="col-span-8 space-y-4">

            {/* Group-aggregate-context card removed in Task #265 — per-leg
                context lives on each leg row in the queue and the editable
                AI write-up replaces the group-level narrative form. */}

            {/* Group details + Evidence */}
            <div className="grid grid-cols-2 gap-4">
              <CcCard
                title="Group details"
                icon={<FileText className="w-3.5 h-3.5" />}
                testId="group-details-card"
                action={
                  <Link
                    href={`/invoice-groups/${groupId}`}
                    className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                    style={{ border: "1px solid var(--cc-border)" }}
                  >
                    <Edit2 className="w-3 h-3" /> Edit
                  </Link>
                }
              >
                <div className="space-y-0">
                  <FieldRow label="Invoice #" value={<span className="mono">{group.invoiceNumber || `#${group.id}`}</span>} />
                  <FieldRow label="Payor" value={group.payorEmail || <span style={{ color: "var(--cc-muted-fg)" }}>—</span>} />
                  <FieldRow label="Plan" value={group.clientNumber || <span style={{ color: "var(--cc-muted-fg)" }}>—</span>} />
                  <FieldRow
                    label="Submitted"
                    value={
                      group.disputeEmailSentAt
                        ? <span className="mono">{formatDateTime(group.disputeEmailSentAt)}</span>
                        : <span style={{ color: "var(--cc-muted-fg)" }}>—</span>
                    }
                  />
                  <FieldRow
                    label="Error type"
                    value={group.errorTypeName || <span style={{ color: "var(--cc-muted-fg)" }}>—</span>}
                  />
                  <FieldRow
                    label="Closure reason"
                    value={
                      group.closureReason
                        ? group.closureReason
                        : <span style={{ color: "var(--cc-muted-fg)" }}>n/a</span>
                    }
                  />
                </div>
              </CcCard>

              <CcCard
                title={
                  <>
                    Group evidence
                    {detail.evidenceFiles && Object.keys(detail.evidenceFiles).length > 0 && (
                      <span className="text-xs font-normal ml-1" style={{ color: "var(--cc-muted-fg)" }}>
                        · {Object.keys(detail.evidenceFiles).length} file
                        {Object.keys(detail.evidenceFiles).length === 1 ? "" : "s"}
                      </span>
                    )}
                  </>
                }
                icon={<Paperclip className="w-3.5 h-3.5" />}
                testId="group-evidence-card"
                padded={false}
              >
                {(() => {
                  const filesObj = detail.evidenceFiles ?? {};
                  const fileNames = Object.keys(filesObj);
                  if (fileNames.length === 0) {
                    return (
                      <div className="px-3 py-3 text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                        No evidence attached yet.
                      </div>
                    );
                  }
                  return fileNames.map((name, i) => (
                    <div
                      key={name}
                      className="px-3 py-1.5 text-xs flex items-center gap-2"
                      style={{ borderBottom: i < fileNames.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                    >
                      <Paperclip className="w-3 h-3 flex-shrink-0" style={{ color: "var(--cc-muted-fg)" }} />
                      <span className="font-medium flex-1 truncate">{name}</span>
                    </div>
                  ));
                })()}
              </CcCard>
            </div>

            {/* Rides / legs table */}
            <CcCard
              title={
                <>
                  Rides &amp; legs
                  <span className="text-xs font-normal ml-1" style={{ color: "var(--cc-muted-fg)" }}>
                    · {allRides.length} ride{allRides.length === 1 ? "" : "s"} · {inDisputeCount} disputed
                  </span>
                </>
              }
              icon={<ListChecks className="w-3.5 h-3.5" />}
              testId="rides-legs-card"
              action={
                <div className="flex items-center gap-1.5">
                  <button
                    className="cc-btn text-xs px-2 py-1"
                    style={
                      disputedOnly
                        ? { border: "1px solid var(--cc-border)" }
                        : { background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }
                    }
                    onClick={() => setDisputedOnly(false)}
                    data-testid="filter-all"
                  >
                    All
                  </button>
                  <button
                    className="cc-btn text-xs px-2 py-1"
                    style={
                      disputedOnly
                        ? { background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }
                        : { border: "1px solid var(--cc-border)" }
                    }
                    onClick={() => setDisputedOnly(true)}
                    data-testid="filter-disputed"
                  >
                    Disputed only
                  </button>
                </div>
              }
              padded={false}
            >
              <div
                className="text-[11px] uppercase tracking-wide font-semibold grid grid-cols-12 px-4 py-2"
                style={{ background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }}
              >
                <div className="col-span-3">Leg / member</div>
                <div className="col-span-3">Service date</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-2">Sub-status</div>
                <div className="col-span-2 text-right">Action</div>
              </div>
              {visibleRides.length === 0 ? (
                <div className="px-4 py-3 text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No legs to show.
                </div>
              ) : (
                visibleRides.map((r, i) => {
                  const sub = deriveLegSubStatus(r);
                  const included = r.includedInDispute !== false;
                  return (
                    <div
                      key={r.id}
                      className={`grid grid-cols-12 px-4 py-2.5 text-sm items-center hover:bg-[var(--cc-muted)] ${!included ? "opacity-60" : ""}`}
                      style={{ borderBottom: i < visibleRides.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                      data-testid={`legs-queue-row-${r.id}`}
                    >
                      <div className="col-span-3">
                        <div className="font-mono font-semibold text-xs" style={{ color: "var(--cc-purple-fg)" }}>
                          {r.confNumber || `#${r.id}`}
                        </div>
                        <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>
                          Leg #{r.id}
                        </div>
                      </div>
                      <div className="col-span-3 text-xs mono" style={{ color: "var(--cc-fg)" }}>
                        {r.date ? formatDateTime(r.date) : "—"}
                      </div>
                      <div className="col-span-2 text-right mono font-semibold">
                        {formatCurrency(r.claimAmount ?? "0")}
                      </div>
                      <div className="col-span-2">
                        <StatusPill tone={legSubStatusTone(sub)}>{legSubStatusLabel(sub)}</StatusPill>
                      </div>
                      <div className="col-span-2 flex items-center justify-end gap-1.5">
                        <Link
                          href={`/claims/${r.id}`}
                          className="cc-btn text-[11px] inline-flex items-center gap-0.5 px-1.5 py-1"
                          style={{ color: "var(--cc-purple-fg)" }}
                          data-testid={`legs-queue-open-${r.id}`}
                        >
                          Open <ChevronRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })
              )}
            </CcCard>

            {/* Submission preview & gauntlet (preserves real submit/readback/preview UX).
                Only render while the group is still in the pre-submit window
                (New / Needs Evidence) — once it's past pre-submit the surface
                has nothing actionable, so we hide the whole card per Task #289. */}
            {isPreSubmit && (
              <CcCard
                title="Submission preview"
                icon={<Sparkles className="w-3.5 h-3.5" />}
                testId="submission-preview-card"
              >
                <InvoiceGroupSubmissionGauntlet group={detail} groupId={groupId} bare />
              </CcCard>
            )}

            {/* Communication thread */}
            <div id="invoice-thread" />
            <CcCard
              title={
                <>
                  Communication
                  <span className="text-xs font-normal ml-1" style={{ color: "var(--cc-muted-fg)" }}>
                    · {conversations.reduce((acc, c) => acc + c.messages.length, 0)} message{conversations.reduce((acc, c) => acc + c.messages.length, 0) === 1 ? "" : "s"}
                  </span>
                </>
              }
              icon={<Mail className="w-3.5 h-3.5" />}
              testId="communication-card"
              padded={false}
            >
              <GroupCommunicationThread
                bare
                conversations={conversations}
                groupInvoiceNumber={group.invoiceNumber || `#${group.id}`}
                isSyncing={checkEmailMutation.isPending}
                isSending={replyMutation.isPending}
                onSyncInbox={onSyncInbox}
                onReply={async (input) => {
                  try {
                    await replyMutation.mutateAsync({
                      id: groupId,
                      conversationId: input.conversationId,
                      data: {
                        subject: input.subject,
                        bodyText: htmlBodyToPlainText(input.bodyHtml),
                        to: input.to,
                        cc: input.cc.length > 0 ? input.cc : undefined,
                      },
                    });
                    toast({
                      title: "Reply sent",
                      description: `Sent to ${input.to.join(", ")}`,
                    });
                    await qc.invalidateQueries({
                      queryKey: getGetInvoiceGroupEmailThreadQueryKey(groupId),
                    });
                    await qc.invalidateQueries({
                      queryKey: getGetInvoiceGroupQueryKey(groupId),
                    });
                  } catch (err) {
                    toast({
                      title: "Failed to send reply",
                      description: err instanceof Error ? err.message : "Please try again.",
                      variant: "destructive",
                    });
                    throw err;
                  }
                }}
              />
            </CcCard>

            {/* Post-submit verdict + responses */}
            <CcCard
              title="Payor responses & per-leg verdict"
              icon={<Gavel className="w-3.5 h-3.5" />}
              testId="group-response-summary-card"
            >
              {isPreSubmit ? (
                <div
                  className="flex items-center gap-2 text-xs p-2.5 rounded"
                  style={{ background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>
                    Activates after this group is submitted to portal.
                    Per-leg verdicts are recorded here and surface read-only on each leg page.
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: "var(--cc-muted-fg)" }}>
                      Group verdict
                    </div>
                    {group.outcome && group.outcome !== "Pending" ? (
                      <div className="text-sm space-y-1 p-3 rounded" style={{ background: "var(--cc-muted)" }}>
                        <div className="flex items-center gap-2">
                          <StatusPill tone={statusTone(group.status)}>
                            <span data-testid="group-verdict-outcome">{group.outcome}</span>
                          </StatusPill>
                          {group.closureReason && (
                            <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                              · {group.closureReason}
                            </span>
                          )}
                        </div>
                        {group.approvedAmount && (
                          <p className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                            Approved amount: {formatCurrency(group.approvedAmount)}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm italic" style={{ color: "var(--cc-muted-fg)" }} data-testid="group-verdict-empty">
                        No verdict recorded yet.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: "var(--cc-muted-fg)" }}>
                      Payor responses
                    </div>
                    {(() => {
                      const responses = detail.responses ?? [];
                      if (responses.length === 0) {
                        return (
                          <p className="text-sm italic" style={{ color: "var(--cc-muted-fg)" }} data-testid="group-responses-empty">
                            No responses received yet.
                          </p>
                        );
                      }
                      return (
                        <ul className="space-y-2">
                          {responses.slice(0, 5).map((r: PortalResponseItem) => (
                            <li
                              key={r.id}
                              className="rounded p-2.5 text-sm"
                              style={{ border: "1px solid var(--cc-border)", background: "var(--cc-muted)" }}
                              data-testid={`group-response-${r.id}`}
                            >
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}>
                                  {r.responseType}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ border: "1px solid var(--cc-border)", color: "var(--cc-muted-fg)" }}>
                                  {r.source}
                                </span>
                                {r.subject && (
                                  <span className="text-xs font-medium truncate">{r.subject}</span>
                                )}
                                <span className="text-xs ml-auto" style={{ color: "var(--cc-muted-fg)" }}>
                                  {r.senderName || r.senderEmail || "Unknown sender"}
                                </span>
                              </div>
                              {r.aiSummary && (
                                <p className="text-xs line-clamp-2" style={{ color: "var(--cc-muted-fg)" }}>
                                  {r.aiSummary}
                                </p>
                              )}
                            </li>
                          ))}
                          {responses.length > 5 && (
                            <li className="text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                              +{responses.length - 5} more — see legacy page for the full thread.
                            </li>
                          )}
                        </ul>
                      );
                    })()}
                  </div>
                </div>
              )}
            </CcCard>
          </div>

          {/* RIGHT — rail (4 cols) */}
          <div className="col-span-4 space-y-4">

            {/* MAS action card — opens the re-attest modal. The modal
                holds the cancel-in-MAS checklist and the reattest
                confirm step so the operator gets the playbook only
                when they say they're doing the work. */}
            {group.reattestRequired && (
              <CcCard
                title="MAS action"
                icon={<Stamp className="w-3.5 h-3.5" />}
                testId="group-reattest-summary-card"
                action={
                  <span
                    className="text-xs px-2 py-0.5 rounded font-semibold"
                    style={
                      group.reattestCompletedAt
                        ? { background: "var(--cc-green-bg)", color: "var(--cc-green-fg)" }
                        : { background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }
                    }
                  >
                    {group.reattestCompletedAt ? "Reattest complete" : "Reattest required"}
                  </span>
                }
              >
                {group.reattestCompletedAt ? (
                  <div className="space-y-2" data-testid="group-reattest-complete">
                    <p className="text-xs" style={{ color: "var(--cc-fg)" }}>
                      Reattestation complete · <span className="mono">{formatDateTime(group.reattestCompletedAt)}</span>
                      {group.reattestCompletedBy ? ` by ${group.reattestCompletedBy}` : ""}
                    </p>
                    {group.reattestNote && (
                      <p className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{group.reattestNote}</p>
                    )}
                  </div>
                ) : (
                  <div data-testid="group-reattest-pending" className="space-y-2">
                    <p className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                      Cancel each affected leg in MAS, re-attest with the corrected
                      info, then confirm here so the dashboard and audit trail line
                      up.
                    </p>
                    <Dialog open={reattestOpen} onOpenChange={setReattestOpen}>
                      <DialogTrigger asChild>
                        <button
                          className="cc-btn w-full justify-center text-xs gap-1 inline-flex items-center py-2"
                          style={{ background: "var(--cc-amber-fg)", color: "white" }}
                          data-testid="button-open-reattest-modal"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> I'm re-attesting now
                        </button>
                      </DialogTrigger>
                      <DialogContent
                        className="max-w-2xl max-h-[85vh] overflow-y-auto"
                        data-testid="reattest-modal"
                      >
                        <DialogHeader>
                          <DialogTitle>Re-attest in MAS</DialogTitle>
                          <DialogDescription>
                            Walk through the cancel-and-re-attest steps for this
                            invoice. Tick each leg as you cancel it in MAS, then
                            confirm the re-attest at the bottom — that releases the
                            group for resubmission.
                          </DialogDescription>
                        </DialogHeader>
                        {detail && (
                          <MasActionChecklist
                            group={detail}
                            onCompleteLegMasAction={async (claimId, body) => {
                              await completeMasMutation.mutateAsync({ id: claimId, data: body });
                              invalidateGroup();
                              toast({ title: "MAS cancellation recorded", duration: 3000 });
                            }}
                            onCompleteGroupReattest={async (body) => {
                              await completeReattestMutation.mutateAsync({ id: groupId, data: body });
                              invalidateGroup();
                              setReattestOpen(false);
                              toast({
                                title: "Re-attest confirmed",
                                description: "Group is now awaiting payout.",
                                duration: 3000,
                              });
                            }}
                          />
                        )}
                      </DialogContent>
                    </Dialog>
                  </div>
                )}
              </CcCard>
            )}

            {/* Ready to package — surfaced separately when readiness payload exists */}
            {isPreSubmit && packagingReadiness && (
              <CcCard
                title="Ready to package"
                icon={<ClipboardCheck className="w-3.5 h-3.5" />}
                testId="ready-to-package-card"
              >
                <div className="text-xs mb-2" style={{ color: "var(--cc-muted-fg)" }}>
                  Move this invoice out of pre-submit once every leg's worktree is done.
                </div>
                <div className="flex flex-wrap gap-1 mb-2 text-[10px]">
                  <span className="px-1.5 py-0.5 rounded" style={{ border: "1px solid var(--cc-border)" }} data-testid="readiness-count-processed">
                    {packagingReadiness.processedLegCount} processed
                  </span>
                  <span className="px-1.5 py-0.5 rounded" style={{ border: "1px solid var(--cc-border)" }} data-testid="readiness-count-unprocessed">
                    {packagingReadiness.unprocessedLegCount} unprocessed
                  </span>
                  <span className="px-1.5 py-0.5 rounded" style={{ border: "1px solid var(--cc-border)" }} data-testid="readiness-count-excluded">
                    {packagingReadiness.excludedLegCount} excluded
                  </span>
                  <span className="px-1.5 py-0.5 rounded" style={{ border: "1px solid var(--cc-border)" }} data-testid="readiness-count-held">
                    {packagingReadiness.heldLegCount} on hold
                  </span>
                </div>
                <p
                  className="text-xs mb-2"
                  style={{ color: packagingReadiness.ready ? "var(--cc-success)" : "var(--cc-muted-fg)" }}
                  data-testid="readiness-reason"
                >
                  {packagingReadiness.ready
                    ? "All worktree review complete. Click to advance into draft generation."
                    : packagingReadiness.reason}
                </p>
                <button
                  onClick={onClickPackage}
                  disabled={!packagingReadiness.ready || packageMutation.isPending}
                  title={packagingReadiness.ready ? undefined : packagingReadiness.reason ?? undefined}
                  className="cc-btn w-full justify-center text-xs gap-1 inline-flex items-center py-2"
                  style={{ background: "var(--cc-purple-fg)", color: "white" }}
                  data-testid="ready-to-package-button"
                >
                  {packageMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  Ready to package
                </button>
              </CcCard>
            )}

            {/* Notes */}
            <CcCard
              title={
                <>
                  Notes
                  <span className="text-xs font-normal ml-1" style={{ color: "var(--cc-muted-fg)" }}>
                    · {visibleNotes.length}
                  </span>
                </>
              }
              icon={<Pin className="w-3.5 h-3.5" />}
              testId="notes-card"
            >
              {visibleNotes.length === 0 ? (
                <div className="text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No notes recorded for this group yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleNotes.slice(0, 6).map((n) => (
                    <div key={n.id} className="text-sm flex gap-2 items-start" data-testid={`note-${n.id}`}>
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
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--cc-border)" }}>
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={2}
                  placeholder="Add a note for this invoice group…"
                  className="cc-input w-full text-xs"
                  style={{
                    background: "var(--cc-bg)",
                    border: "1px solid var(--cc-border)",
                    color: "var(--cc-fg)",
                    padding: "6px 8px",
                    borderRadius: 4,
                    resize: "vertical",
                  }}
                  data-testid="group-note-textarea"
                />
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    onClick={onSubmitNote}
                    disabled={!newNote.trim() || createNoteMutation.isPending}
                    className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                    style={{
                      background: "var(--cc-purple-fg)",
                      color: "white",
                      opacity: !newNote.trim() || createNoteMutation.isPending ? 0.6 : 1,
                    }}
                    data-testid="group-note-submit-button"
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

            {/* Audit timeline */}
            <CcCard
              title="Audit timeline"
              icon={<Activity className="w-3.5 h-3.5" />}
              testId="audit-timeline-card"
              padded={false}
            >
              {sortedAudit.length === 0 ? (
                <div className="px-4 py-3 text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No audit events yet.
                </div>
              ) : (
                sortedAudit.slice(0, 12).map((e, i, arr) => (
                  <div
                    key={e.id}
                    className="px-4 py-2 flex items-start gap-2 text-xs"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                    data-testid={`audit-${e.id}`}
                  >
                    <div className="mt-0.5 flex-shrink-0" style={{ color: auditTone(e.action) }}>
                      {auditIcon(e.action)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div style={{ color: "var(--cc-fg)" }}>{e.details || e.action}</div>
                      <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>
                        {(e.userName || e.userEmail || "system")} · {relativeTime(e.timestamp)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CcCard>

            {/* Close this group */}
            <CcCard
              title="Close this group"
              icon={<XCircle className="w-3.5 h-3.5" />}
              testId="group-closure-card"
            >
              <div className="text-xs mb-3" style={{ color: "var(--cc-muted-fg)" }}>
                Close after the payor has issued a final decision on every disputed leg.
              </div>
              {isAlreadyClosed ? (
                <p className="text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  Already closed — outcome <strong>{group.outcome}</strong>
                  {group.closureReason ? ` · ${group.closureReason}` : ""}.
                </p>
              ) : (
                <ClosureActions
                  target={{ kind: "invoice_group", id: groupId }}
                  outcome={group.outcome}
                  closureReason={group.closureReason}
                  triggers={[
                    {
                      reason: "denied_by_payor",
                      label: "Denied by Payor",
                      sub: "Payor formally denied — recorded response required",
                      disabled: !validTransitions?.hasResponse,
                      disabledReason: validTransitions?.hasResponse
                        ? "Close because the payor formally denied this group."
                        : "Disabled because no portal or email response has been recorded yet.",
                      testId: "v2-group-close-denied-by-payor",
                    },
                    ...(validTransitions?.hasBeenSubmitted
                      ? []
                      : [{
                          reason: "cannot_dispute" as const,
                          label: "Withdraw — Cannot Dispute",
                          sub: "No clear path to recover",
                          disabledReason: "Close because we decided not to dispute (no clear path to recover).",
                          testId: "v2-group-close-cannot-dispute",
                        }]),
                  ]}
                  onAfterSuccess={invalidateGroup}
                />
              )}
            </CcCard>

            {/* Footer hint surfacing the inbox-sync action also in the rail */}
            <div className="text-[11px] text-center" style={{ color: "var(--cc-muted-fg)" }}>
              <button
                onClick={onSyncInbox}
                disabled={checkEmailMutation.isPending}
                className="cc-btn text-[11px] gap-1 inline-flex items-center px-2 py-1"
                style={{ border: "1px solid var(--cc-border)" }}
                data-testid="rail-sync-inbox"
              >
                {checkEmailMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Inbox className="w-3 h-3" />
                )}
                Sync inbox
              </button>
            </div>
          </div>
        </div>
      </div>

      {holdOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setHoldOpen(false)}
          data-testid="hold-dialog-backdrop"
        >
          <div
            className="cc-card w-full max-w-md p-4"
            style={{ background: "var(--cc-bg)", border: "1px solid var(--cc-border)" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            data-testid="hold-dialog"
          >
            <div className="font-semibold text-sm mb-1">Place group on hold</div>
            <div className="text-xs mb-3" style={{ color: "var(--cc-muted-fg)" }}>
              Add a reason so teammates know why this invoice group is parked.
            </div>
            <textarea
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
              rows={3}
              placeholder="Reason for hold…"
              className="cc-input w-full text-xs"
              style={{
                background: "var(--cc-bg)",
                border: "1px solid var(--cc-border)",
                color: "var(--cc-fg)",
                padding: "6px 8px",
                borderRadius: 4,
                resize: "vertical",
              }}
              autoFocus
              data-testid="hold-reason-textarea"
            />
            <div className="flex justify-end gap-1.5 mt-3">
              <button
                type="button"
                onClick={() => {
                  setHoldOpen(false);
                  setHoldReason("");
                }}
                className="cc-btn text-xs px-2.5 py-1.5"
                style={{ border: "1px solid var(--cc-border)" }}
                data-testid="hold-dialog-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSubmitHold}
                disabled={!holdReason.trim() || holdMutation.isPending}
                className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                style={{
                  background: "var(--cc-purple-fg)",
                  color: "white",
                  opacity: !holdReason.trim() || holdMutation.isPending ? 0.6 : 1,
                }}
                data-testid="hold-dialog-confirm"
              >
                {holdMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <PauseCircle className="w-3.5 h-3.5" />
                )}
                Place on hold
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
