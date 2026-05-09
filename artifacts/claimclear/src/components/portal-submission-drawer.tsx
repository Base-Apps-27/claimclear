import { useState, useEffect } from "react";
import DOMPurify from "dompurify";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPortalSubmission, getGetPortalSubmissionQueryKey,
  useListBotActivity, getListBotActivityQueryKey,
  useUpdatePortalSubmissionDraft,
  useRegeneratePortalSubmissionText,
  useSandboxRunPortalSubmission,
  getListPortalSubmissionsQueryKey,
} from "@workspace/api-client-react";
import type { PortalSubmissionResponse, BotActivityLogResponse, EvidenceFileRef } from "@workspace/api-client-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StateBadge } from "@/components/state-badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2, X, Send, Play, ExternalLink, FileText, Image as ImageIcon,
  FlaskConical, Sparkles, Pencil, Save, RefreshCw, ChevronRight,
  Activity, CheckCircle2, AlertTriangle, Bot, Edit2, Mail, Clock,
} from "lucide-react";
import { Link } from "wouter";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { absoluteTooltip } from "@/lib/time";
import { WrapTooltip } from "@/components/info-tooltip";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";

// Task #564 — display labels for the parent group's macro-phase chip
// shown alongside the submission stage. Mirrors the canonical 7-bucket
// MacroPhase enum from `api-server/src/lib/macro-phase.ts`. The macro
// phase is the *primary* lifecycle bucket of an invoice group; the
// submission Stage (draft / pending / submitted / …) is subordinate
// and renders as a secondary chip in the form "In-flight · Submitted".
const MACRO_PHASE_LABEL: Record<string, string> = {
  "pre-submit": "Pre-submit",
  "in-flight": "In flight",
  "response-pending": "Response pending",
  "mas-action-required": "MAS action",
  "awaiting-payout": "Awaiting payout",
  "closed": "Closed",
  "on-hold": "On hold",
};
function macroPhaseLabel(p: string | null | undefined): string {
  return p ? (MACRO_PHASE_LABEL[p] ?? p) : "";
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".heic"];

function isImageUrl(url: string): boolean {
  try {
    const path = new URL(url, "http://x").pathname.toLowerCase();
    return IMAGE_EXTENSIONS.some(ext => path.endsWith(ext));
  } catch {
    const lower = url.toLowerCase().split("?")[0];
    return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext));
  }
}

function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url, "http://x").pathname;
    const last = path.split("/").filter(Boolean).pop() || url;
    return decodeURIComponent(last);
  } catch {
    const last = url.split("?")[0].split("/").filter(Boolean).pop() || url;
    try { return decodeURIComponent(last); } catch { return last; }
  }
}

// `attachmentUrls` is the bot worker's flat URL list. Task #389 tightened
// the OpenAPI / Drizzle types to `string[] | null`, so we just need to
// guard against null and empty entries.
function extractAttachmentUrls(raw: string[] | null | undefined): string[] {
  if (!raw) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function findSizeForUrl(evidenceFiles: EvidenceFileRef[] | null | undefined, url: string): number | null {
  if (!evidenceFiles) return null;
  for (const f of evidenceFiles) {
    if (f.url === url && typeof f.size === "number") return f.size;
  }
  return null;
}

function formatSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const statusPillStyles: Record<string, string> = {
  draft: "bg-blue-500/20 text-blue-700 border-blue-300",
  pending: "bg-amber-500/20 text-amber-700 border-amber-300",
  queued: "bg-indigo-500/20 text-indigo-700 border-indigo-300",
  in_progress: "bg-blue-500/20 text-blue-700 border-blue-300",
  submitted: "bg-green-500/20 text-green-700 border-green-300",
  failed: "bg-red-500/20 text-red-700 border-red-300",
  cancelled: "bg-gray-500/20 text-gray-700 border-gray-300",
  dry_run: "bg-purple-500/20 text-purple-700 border-purple-300",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  queued: "Queued",
  in_progress: "In Progress",
  submitted: "Submitted",
  failed: "Failed",
  cancelled: "Cancelled",
  dry_run: "Dry Run",
};

interface DrawerSectionProps {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

function DrawerSection({ title, action, children }: DrawerSectionProps) {
  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between border-b bg-card">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

interface PortalSubmissionDrawerProps {
  submissionId: number | null;
  initialSubmission?: PortalSubmissionResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the footer "Process now" button calls this. */
  onProcessNow?: (id: number) => void;
  processNowDisabled?: boolean;
  processNowDisabledReason?: string;
}

const ISSUE_TYPE_OPTIONS = [
  "GPS Control Deviation",
  "Other Issue or Question",
  "Custom Payment Request",
  "MAS Trips App Issue",
  "Vehicle, Driver, or TPP",
  "Zip Code Block",
];

export function PortalSubmissionDrawer({
  submissionId,
  initialSubmission,
  open,
  onOpenChange,
  onProcessNow,
  processNowDisabled,
  processNowDisabledReason,
}: PortalSubmissionDrawerProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"payload" | "sandbox" | "activity">("payload");
  const [editingFields, setEditingFields] = useState(false);
  const [fieldEdits, setFieldEdits] = useState<Record<string, string>>({});
  const [savingFields, setSavingFields] = useState(false);
  const [saveFieldsError, setSaveFieldsError] = useState("");
  const [editingDisputeText, setEditingDisputeText] = useState(false);
  const [editedText, setEditedText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [sandboxRunning, setSandboxRunning] = useState(false);
  const [sandboxError, setSandboxError] = useState("");

  const { data: fetched, isLoading: subLoading } = useGetPortalSubmission(submissionId || 0, {
    query: { queryKey: getGetPortalSubmissionQueryKey(submissionId || 0), enabled: !!submissionId && open },
  });
  const submission = fetched ?? initialSubmission ?? null;

  const { data: activityLogs } = useListBotActivity(submissionId || 0, {
    query: { queryKey: getListBotActivityQueryKey(submissionId || 0), enabled: !!submissionId && open },
  });

  const updateDraft = useUpdatePortalSubmissionDraft();
  const regenerateText = useRegeneratePortalSubmissionText();
  const sandboxRun = useSandboxRunPortalSubmission();

  // Reset transient state whenever we open a different submission.
  useEffect(() => {
    if (!open) return;
    setTab("payload");
    setEditingFields(false);
    setEditingDisputeText(false);
    setSaveFieldsError("");
    setSandboxError("");
  }, [submissionId, open]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListPortalSubmissionsQueryKey() });
    if (submissionId) {
      queryClient.invalidateQueries({ queryKey: getGetPortalSubmissionQueryKey(submissionId) });
      queryClient.invalidateQueries({ queryKey: getListBotActivityQueryKey(submissionId) });
    }
  };

  if (!submission && !subLoading) {
    // Drawer requested but no data yet — render nothing to avoid flash.
    if (!open) return null;
  }

  const isEditable = submission ? ["draft", "pending", "failed", "dry_run"].includes(submission.status) : false;
  const canSandbox = submission ? ["draft", "pending", "failed", "dry_run"].includes(submission.status) : false;
  const showProcessNow = !!onProcessNow;
  const processNowReason = !submission ? "Loading…"
    : submission.status === "draft" ? "Confirm this draft on the invoice group page first to queue it."
    : submission.status === "in_progress" ? "Already processing."
    : submission.status === "submitted" ? "Already submitted."
    : submission.status === "failed" ? "Failed submissions retry automatically — use Retry from the row menu to override."
    : submission.status === "cancelled" ? "This submission has been cancelled."
    : submission.claimedByBatchId ? "Currently claimed by a running batch."
    : processNowDisabledReason;
  const processNowAvailable = submission?.status === "pending" && !submission.claimedByBatchId;

  const attachments = extractAttachmentUrls(submission?.attachmentUrls ?? null);
  const description = submission?.descriptionHtml || "";
  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(description);
  const sanitizedHtml = looksLikeHtml
    ? DOMPurify.sanitize(description, {
        ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "b", "i", "ul", "ol", "li", "a", "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6", "span", "div"],
        ALLOWED_ATTR: ["href", "target", "rel"],
      })
    : "";

  const handleSaveFields = async () => {
    if (!submission) return;
    setSavingFields(true);
    setSaveFieldsError("");
    try {
      await updateDraft.mutateAsync({ id: submission.id, data: fieldEdits });
      invalidate();
      setEditingFields(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save. Please try again.";
      setSaveFieldsError(msg);
    } finally {
      setSavingFields(false);
    }
  };

  const handleSaveDisputeText = async () => {
    if (!submission) return;
    setSavingEdit(true);
    try {
      await updateDraft.mutateAsync({ id: submission.id, data: { descriptionHtml: editedText } });
      invalidate();
      setEditingDisputeText(false);
    } catch {
      // best-effort; field edit error already surfaces saveFieldsError; keep this silent
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRegenerate = async () => {
    if (!submission) return;
    setRegenerating(true);
    try {
      await regenerateText.mutateAsync({ id: submission.id });
      invalidate();
    } catch {
      // non-fatal
    } finally {
      setRegenerating(false);
    }
  };

  const handleSandboxRun = async () => {
    if (!submission) return;
    setSandboxRunning(true);
    setSandboxError("");
    try {
      await sandboxRun.mutateAsync({ id: submission.id });
      invalidate();
    } catch (err: unknown) {
      setSandboxError(err instanceof Error ? err.message : "Sandbox run failed");
    } finally {
      setSandboxRunning(false);
    }
  };

  const startEditFields = () => {
    if (!submission) return;
    setFieldEdits({
      issueType: submission.issueType || "",
      subject: submission.subject || "",
      requesterEmail: submission.requesterEmail || "",
      transportationProviderName: submission.transportationProviderName || "",
      phoneNumber: submission.phoneNumber || "",
      invoiceNumber: submission.invoiceNumber || "",
      gpsBreadcrumbsAvailable: submission.gpsBreadcrumbsAvailable || "",
    });
    setEditingFields(true);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl p-0 flex flex-col overflow-hidden gap-0"
        data-testid="portal-submission-drawer"
      >
        {/* Top accent + header */}
        <div className="h-[3px] bg-blue-600 flex-shrink-0" />
        <div className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Badge className="bg-blue-600 text-white border-0 text-[10px] tracking-wider px-1.5 py-0.5 gap-1 flex-shrink-0">
                <Send className="h-2.5 w-2.5" /> SUBMISSION
              </Badge>
              <span className="font-mono font-bold text-sm truncate">
                {submission?.invoiceNumber || submission?.confNumber || `#${submissionId}`}
              </span>
              {/* Task #564: phase-first chip layout — the macro phase of
                  the parent invoice group is the *primary* state chip,
                  the submission Stage is subordinate (rendered as a
                  smaller secondary chip below), so operators read this
                  surface invoice-first. */}
              {submission?.groupMacroPhase && (
                <StateBadge
                  variant="phase"
                  value={submission.groupMacroPhase}
                  data-testid="drawer-macro-phase-chip"
                  tooltipExtra={`Stage: ${statusLabels[submission.status] ?? submission.status}`}
                />
              )}
            </div>
          </div>
          {submission && (
            <>
              <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
                {/* Phase · Stage line — secondary, subordinate to the
                    primary macro-phase chip above. */}
                <span data-testid="drawer-phase-stage-summary">
                  {macroPhaseLabel(submission.groupMacroPhase) || "—"}
                  <span className="mx-1.5 text-muted-foreground/60">·</span>
                  <StateBadge
                    variant="stage"
                    value={submission.status}
                    className="text-[10px] h-4 px-1.5 align-middle"
                  />
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                <span>{formatCurrency(submission.claimAmount || "0")}</span>
                <span>·</span>
                <span className="truncate">{submission.issueType || "—"}</span>
                <span>·</span>
                <span>attempt {submission.attempts}/{submission.maxAttempts ?? 4}</span>
                {submission.portalTicketId && (
                  <>
                    <span>·</span>
                    {submission.issueType === "Direct Email" ? (
                      <WrapTooltip content={`Outlook message ID: ${submission.portalTicketId}`}>
                        <span className="cursor-help">Email Sent</span>
                      </WrapTooltip>
                    ) : (
                      <span className="font-mono">Ticket {submission.portalTicketId}</span>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <SkeletonSwap
          loading={!submission || subLoading}
          className="flex-1 flex flex-col min-h-0"
          skeleton={
            <div className="flex-1 p-6 space-y-3" data-testid="portal-submission-drawer-skeleton">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          }
        >
        {submission && !subLoading && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex-1 flex flex-col min-h-0">
            <TabsList className="rounded-none border-b bg-muted/30 h-auto p-0 w-full justify-stretch">
              {(["payload", "sandbox", "activity"] as const).map((t) => {
                const labels: Record<string, { label: string; hint: string; Icon: typeof FileText }> = {
                  payload:  { label: "Payload",  hint: "What we'll send", Icon: FileText },
                  sandbox:  { label: "Sandbox",  hint: "Dry-run proof",   Icon: FlaskConical },
                  activity: { label: "Activity", hint: "Bot timeline",    Icon: Activity },
                };
                const { label, hint, Icon } = labels[t];
                return (
                  <TabsTrigger
                    key={t}
                    value={t}
                    className="flex-1 flex-col items-start rounded-none border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-background px-3 py-2.5 text-left h-auto shadow-none data-[state=active]:shadow-none"
                    data-testid={`drawer-tab-${t}`}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </span>
                    <span className="text-[10px] mt-0.5 text-muted-foreground font-normal">{hint}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/10 min-h-0">
              <TabsContent value="payload" className="m-0 space-y-3 data-[state=inactive]:hidden">
                {/* Task #564 — invoice context banner. Portal submissions
                    are group-scoped after the Task #199 cutover; if an
                    operator landed here looking for invoice context (legs,
                    deadlines, evidence), surface the parent invoice group
                    link prominently at the top of the drawer rather than
                    only as a footer link. */}
                <Link
                  href={`/invoice-groups/${submission.invoiceGroupId}`}
                  className="block rounded border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900 p-2.5 text-[11px] hover:bg-blue-100 dark:hover:bg-blue-950/40 transition-colors"
                  data-testid="drawer-invoice-context-banner"
                >
                  <span className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                    <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="flex-1">
                      This submission belongs to invoice group <span className="font-mono font-semibold">#{submission.invoiceGroupId}</span>{submission.invoiceNumber ? <> · invoice <span className="font-mono">{submission.invoiceNumber}</span></> : null}. Open it for legs, deadlines, and evidence.
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
                  </span>
                </Link>

                <div className="rounded p-2.5 text-[11px] flex items-start gap-2 bg-muted text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>The exact payload the bot will paste into the MAS portal form. Editing here updates the draft — nothing is sent until you click <strong>Process now</strong>.</span>
                </div>

                <DrawerSection
                  title="Form fields"
                  action={isEditable && !editingFields ? (
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={startEditFields} data-testid="drawer-edit-fields">
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                  ) : undefined}
                >
                  {editingFields ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Issue Type</label>
                          <select className="w-full rounded-md border px-2 py-1.5 text-sm bg-background" value={fieldEdits.issueType || ""} onChange={e => setFieldEdits(p => ({ ...p, issueType: e.target.value }))}>
                            <option value="">Select…</option>
                            {ISSUE_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Subject</label>
                          <input className="w-full rounded-md border px-2 py-1.5 text-sm bg-background" value={fieldEdits.subject || ""} onChange={e => setFieldEdits(p => ({ ...p, subject: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Email</label>
                          <input className="w-full rounded-md border px-2 py-1.5 text-sm bg-background" value={fieldEdits.requesterEmail || ""} onChange={e => setFieldEdits(p => ({ ...p, requesterEmail: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Provider Name</label>
                          <input className="w-full rounded-md border px-2 py-1.5 text-sm bg-background" value={fieldEdits.transportationProviderName || ""} onChange={e => setFieldEdits(p => ({ ...p, transportationProviderName: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Phone</label>
                          <input className="w-full rounded-md border px-2 py-1.5 text-sm bg-background" value={fieldEdits.phoneNumber || ""} onChange={e => setFieldEdits(p => ({ ...p, phoneNumber: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Invoice #</label>
                          <input className="w-full rounded-md border px-2 py-1.5 text-sm bg-background" value={fieldEdits.invoiceNumber || ""} onChange={e => setFieldEdits(p => ({ ...p, invoiceNumber: e.target.value }))} />
                        </div>
                        {fieldEdits.issueType === "GPS Control Deviation" && (
                          <div>
                            <label className="text-xs text-muted-foreground mb-1 block">GPS Breadcrumbs</label>
                            <select className="w-full rounded-md border px-2 py-1.5 text-sm bg-background" value={fieldEdits.gpsBreadcrumbsAvailable || ""} onChange={e => setFieldEdits(p => ({ ...p, gpsBreadcrumbsAvailable: e.target.value }))}>
                              <option value="">Select…</option>
                              <option value="Yes">Yes</option>
                              <option value="No">No</option>
                              <option value="Unknown">Unknown</option>
                            </select>
                          </div>
                        )}
                      </div>
                      {saveFieldsError && <p className="text-xs text-red-600 text-right">{saveFieldsError}</p>}
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { setEditingFields(false); setSaveFieldsError(""); }}>
                          <X className="h-3 w-3" /> Cancel
                        </Button>
                        <Button size="sm" className="h-7 text-xs gap-1" disabled={savingFields} onClick={handleSaveFields} data-testid="drawer-save-fields">
                          {savingFields ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <FieldDisplay label="Issue Type" value={submission.issueType} required />
                      <FieldDisplay label="Subject" value={submission.subject} required />
                      <FieldDisplay label="Email" value={submission.requesterEmail} required />
                      <FieldDisplay label="Provider" value={submission.transportationProviderName} required />
                      <FieldDisplay label="Phone" value={submission.phoneNumber} required />
                      <FieldDisplay label="Invoice #" value={submission.invoiceNumber} />
                      {submission.issueType === "GPS Control Deviation" && (
                        <FieldDisplay label="GPS Breadcrumbs" value={submission.gpsBreadcrumbsAvailable} />
                      )}
                      <FieldDisplay label="Service Date" value={submission.serviceDate} />
                      <FieldDisplay label="Conf #" value={submission.confNumber} mono />
                    </div>
                  )}
                </DrawerSection>

                <DrawerSection
                  title="Dispute narrative"
                  action={isEditable && !editingDisputeText ? (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" disabled={regenerating} onClick={handleRegenerate} data-testid="drawer-regenerate">
                        {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Regenerate
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { setEditedText(submission.descriptionHtml || ""); setEditingDisputeText(true); }} data-testid="drawer-edit-narrative">
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                    </div>
                  ) : undefined}
                >
                  {editingDisputeText ? (
                    <div className="space-y-2">
                      <Textarea value={editedText} onChange={(e) => setEditedText(e.target.value)} className="min-h-[200px] text-sm font-mono" />
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setEditingDisputeText(false)}>
                          <X className="h-3 w-3" /> Cancel
                        </Button>
                        <Button size="sm" className="h-7 text-xs gap-1" disabled={savingEdit} onClick={handleSaveDisputeText}>
                          {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                        </Button>
                      </div>
                    </div>
                  ) : description ? (
                    looksLikeHtml ? (
                      <div className="text-xs leading-relaxed prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
                    ) : (
                      <div className="text-xs whitespace-pre-wrap leading-relaxed">{description}</div>
                    )
                  ) : (
                    <div className="text-xs text-muted-foreground italic">No dispute narrative generated yet.</div>
                  )}
                  {submission.descriptionEditorName && !editingDisputeText && (
                    <p className="text-[10px] text-muted-foreground mt-2">Last edited by {submission.descriptionEditorName}</p>
                  )}
                </DrawerSection>

                {/* Task #564 — Ready-at-submission snapshot. The list of
                    legs that were already in the `ready` sub-status at the
                    moment this submission was frozen (i.e. claims.ready_at
                    is non-null AND <= submission.createdAt). These are the
                    legs that actually went into the dispute payload — the
                    `Legs` section below shows the broader per-leg breakdown
                    including any legs added after freeze for visibility,
                    but the snapshot below is the authoritative "what was
                    ready when we hit submit" view operators ask for during
                    response review. Sourced from the per-leg `readyAt`
                    field added to PortalSubmissionResponse for Task #564. */}
                {(() => {
                  const snapshotLegs = (submission.legs ?? []).filter(
                    (l) => (l as { wasReadyAtSubmission?: boolean }).wasReadyAtSubmission,
                  );
                  return (
                    <DrawerSection
                      title={`Ready-at-submission snapshot (${snapshotLegs.length})`}
                    >
                      <p className="text-[10px] text-muted-foreground mb-2">
                        Legs that were already in the <span className="font-medium">ready</span> sub-status when this submission was frozen at {submission.createdAt ? formatDateTime(submission.createdAt) : "draft time"}.
                      </p>
                      {snapshotLegs.length === 0 ? (
                        <div className="text-xs text-muted-foreground italic" data-testid="drawer-snapshot-empty">
                          No legs were stamped <span className="font-medium">ready</span> at the moment this submission was frozen.
                        </div>
                      ) : (
                        <div className="space-y-1.5" data-testid="drawer-snapshot-list">
                          {snapshotLegs.map((leg) => {
                            const readyAt = (leg as { readyAt?: string | null }).readyAt;
                            return (
                              <div
                                key={`snap-${leg.legId}`}
                                className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted"
                                data-testid={`drawer-snapshot-leg-${leg.legId}`}
                              >
                                <LegSubStatusPill subStatus="ready" className="text-[10px] h-4 px-1.5 flex-shrink-0" />
                                <span className="font-mono flex-shrink-0">
                                  {leg.confNumber || `Leg #${leg.legId}`}
                                </span>
                                {readyAt && (
                                  <span
                                    className="ml-auto text-[10px] text-muted-foreground cursor-help"
                                    title={absoluteTooltip(readyAt)}
                                  >
                                    ready {formatDateTime(readyAt)}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </DrawerSection>
                  );
                })()}

                <DrawerSection title={`Legs (${submission.legs?.length ?? 0})`}>
                  {/* Task #485: per-leg breakdown sourced from `legs` JSONB
                      on the submission row. One entry per disputed leg, in
                      the order they were eligible at draft time. `ticked`
                      flips to true after the worker successfully selects
                      that leg's checkbox in the portal session; on failure,
                      `error` carries the per-leg reason. Legacy pre-Task
                      #485 rows are enriched server-side from the invoice
                      group's claims (with ticked=false), so this list is
                      always populated for any group with at least one leg. */}
                  {(submission.legs?.length ?? 0) === 0 ? (
                    <div className="text-xs text-muted-foreground italic" data-testid="drawer-legs-empty">
                      No legs found on this submission's invoice group.
                    </div>
                  ) : (
                    <div className="space-y-1.5" data-testid="drawer-legs-list">
                      {submission.legs!.map((leg) => (
                        <div
                          key={leg.legId}
                          className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted"
                          data-testid={`drawer-leg-${leg.legId}`}
                        >
                          {leg.ticked ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                          ) : leg.error ? (
                            <AlertTriangle className="h-3.5 w-3.5 text-red-600 flex-shrink-0" />
                          ) : (
                            <Clock className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          )}
                          <span className="font-mono flex-shrink-0">
                            {leg.confNumber || `Leg #${leg.legId}`}
                          </span>
                          <span className="flex-1 min-w-0 truncate text-muted-foreground">
                            {leg.ticked
                              ? "Ticked in portal"
                              : leg.error
                                ? leg.error
                                : "Pending — not yet submitted"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </DrawerSection>

                <DrawerSection title={`Attachments (${attachments.length})`}>
                  {attachments.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic">No attachments will be uploaded.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {attachments.map((url, i) => {
                        const name = fileNameFromUrl(url);
                        const image = isImageUrl(url);
                        const size = formatSize(findSizeForUrl(submission.evidenceFiles, url));
                        return (
                          <a
                            key={`${url}-${i}`}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={name}
                            className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-muted hover:bg-accent transition-colors"
                          >
                            {image ? <ImageIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" /> : <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                            <span className="flex-1 truncate font-mono">{name}</span>
                            {size && <span className="text-muted-foreground">{size}</span>}
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </a>
                        );
                      })}
                    </div>
                  )}
                </DrawerSection>
              </TabsContent>

              <TabsContent value="sandbox" className="m-0 space-y-3 data-[state=inactive]:hidden">
                <div className="rounded p-2.5 text-[11px] flex items-start gap-2 bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-300">
                  <FlaskConical className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span><strong>Dry run.</strong> Logs in to MAS, fills the form, captures a screenshot — does <em>not</em> click Submit. Use this to verify the payload looks right on the actual portal before processing.</span>
                </div>

                <DrawerSection
                  title={submission.screenshotUrl ? "Last sandbox run" : "Sandbox"}
                  action={canSandbox ? (
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" disabled={sandboxRunning} onClick={handleSandboxRun} data-testid="drawer-sandbox-run">
                      {sandboxRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : submission.screenshotUrl ? <RefreshCw className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      {submission.screenshotUrl ? "Re-run sandbox" : "Run sandbox now"}
                    </Button>
                  ) : undefined}
                >
                  {sandboxError && <p className="text-xs text-red-600 mb-2">{sandboxError}</p>}
                  {submission.screenshotUrl ? (
                    <>
                      <div className="flex items-center gap-2 text-xs mb-2 text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                        <span>
                          Captured {submission.submittedAt ? formatDateTime(submission.submittedAt) : "recently"}
                        </span>
                      </div>
                      <div className="border rounded-md overflow-hidden bg-muted/30">
                        <img
                          key={submission.screenshotUrl + (submission.updatedAt || "")}
                          src={`/api/storage${submission.screenshotUrl}?t=${new Date(submission.updatedAt || submission.submittedAt || "").getTime() || Date.now()}`}
                          alt="Sandbox run screenshot of the filled portal form"
                          className="w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(`/api/storage${submission.screenshotUrl}`, "_blank")}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Click to open full-size in a new tab.</p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">No sandbox run captured yet. Click <strong>Run sandbox now</strong> to fill the form on the real portal and capture a screenshot — without submitting.</p>
                  )}
                </DrawerSection>
              </TabsContent>

              <TabsContent value="activity" className="m-0 space-y-3 data-[state=inactive]:hidden">
                <div className="rounded p-2.5 text-[11px] flex items-start gap-2 bg-muted text-muted-foreground">
                  <Bot className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>Step-by-step trace of what the bot did for this submission. Green = succeeded, red = error.</span>
                </div>

                <DrawerSection title="Bot timeline">
                  {activityLogs && activityLogs.length > 0 ? (
                    <div className="space-y-2.5">
                      {activityLogs.map((log: BotActivityLogResponse, i: number) => (
                        <div key={log.id} className="flex gap-2 text-xs">
                          <div className="flex flex-col items-center pt-0.5">
                            <div className={`w-2 h-2 rounded-full ${log.success ? "bg-green-600" : "bg-red-600"}`} />
                            {i < activityLogs.length - 1 && <div className="flex-1 w-px mt-1 bg-border" />}
                          </div>
                          <div className="flex-1 pb-1.5">
                            <div className="font-medium break-words">{log.action}</div>
                            {log.message && <div className="text-[11px] mt-0.5 text-muted-foreground break-words">{log.message}</div>}
                            {log.screenshotPath && log.screenshotPath.startsWith("/objects/") && (
                              <a
                                href={`/api/storage${log.screenshotPath}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 mt-0.5"
                              >
                                <ImageIcon className="h-3 w-3" /> View screenshot
                              </a>
                            )}
                            <div className="text-[10px] mt-0.5 text-muted-foreground">{log.createdAt ? formatDateTime(log.createdAt) : ""}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
                  )}
                </DrawerSection>

                {(submission.portalTicketId || submission.errorMessage) && (
                  <DrawerSection title="Result">
                    {submission.portalTicketId ? (
                      <>
                        <div className="flex items-center gap-2 text-sm">
                          {submission.issueType === "Direct Email" ? (
                            <>
                              <Mail className="h-4 w-4 text-green-600" />
                              <WrapTooltip content={`Outlook message ID: ${submission.portalTicketId}`}>
                                <span className="cursor-help">Email Sent</span>
                              </WrapTooltip>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                              <span>Submitted — ticket <span className="font-mono font-semibold">{submission.portalTicketId}</span></span>
                            </>
                          )}
                        </div>
                        {submission.submittedAt && (
                          <div className="text-[11px] mt-1 text-muted-foreground">{formatDateTime(submission.submittedAt)}</div>
                        )}
                      </>
                    ) : submission.errorMessage ? (
                      <div className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                        <span className="break-words text-red-700">{submission.errorMessage}</span>
                      </div>
                    ) : null}
                  </DrawerSection>
                )}
              </TabsContent>
            </div>

            {/* Footer — stable structure across all statuses */}
            <div className="flex items-center gap-2 px-4 py-3 border-t bg-card flex-shrink-0">
              {showProcessNow && (
                processNowAvailable && !processNowDisabled ? (
                  <Button size="sm" className="gap-1.5" onClick={() => onProcessNow?.(submission.id)} data-testid="drawer-process-now">
                    <Play className="h-3.5 w-3.5" /> Process now
                  </Button>
                ) : (
                  <WrapTooltip content={processNowReason || "Not available for this status."}>
                    <span tabIndex={0}>
                      <Button size="sm" disabled className="gap-1.5" data-testid="drawer-process-now">
                        <Play className="h-3.5 w-3.5" /> Process now
                      </Button>
                    </span>
                  </WrapTooltip>
                )
              )}
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onOpenChange(false)} data-testid="drawer-close">
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
              <Link href={`/invoice-groups/${submission.invoiceGroupId}`} className="ml-auto text-xs flex items-center gap-1 text-primary hover:underline" data-testid="drawer-open-invoice-group">
                Open invoice group <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </Tabs>
        )}
        </SkeletonSwap>
      </SheetContent>
    </Sheet>
  );
}

function FieldDisplay({ label, value, required, mono }: { label: string; value: string | null | undefined; required?: boolean; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xs mt-0.5 ${mono ? "font-mono" : ""} ${value ? "" : required ? "text-red-600 italic" : "text-muted-foreground italic"}`}>
        {value || (required ? "Not set" : "—")}
      </div>
    </div>
  );
}
