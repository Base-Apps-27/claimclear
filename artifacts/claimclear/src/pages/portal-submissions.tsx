import { useState, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPortalSubmissions, getListPortalSubmissionsQueryKey,
  useGetSystemHealthRollup, getGetSystemHealthRollupQueryKey,
} from "@workspace/api-client-react";
import type { PortalSubmissionResponse } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ListTableHeaderStrip } from "@/components/list-table/faceted-filter";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { formatRelative, absoluteTooltip } from "@/lib/time";
import {
  Play, Loader2, Clock, AlertTriangle, CheckCircle, FlaskConical, Send, Lock, StopCircle, Ban,
  Search, Tag, Edit2, X, Sparkles, History, Bot, ChevronDown, ChevronRight, MoreVertical,
  Eye, RefreshCw, XCircle, AlertCircle, ExternalLink, Mail, Globe,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { WrapTooltip } from "@/components/info-tooltip";
import { PortalSubmissionDrawer } from "@/components/portal-submission-drawer";
import {
  getInitialCollapsedGroups,
  getCheckedDraftIds,
  selectionIsAllDrafts,
  formatCompletedElsewhereLabel,
  formatCompletedElsewhereTooltip,
  countDraftsAlreadyDoneElsewhere,
  makePillClickHandler,
  makeDiscardArmState,
  isDiscardStillArmed,
  DISCARD_ARM_TTL_MS,
  type DiscardArmState,
} from "@/lib/portal-submissions-helpers";
import { ActionsRail, ActionsRailRecommended, ActionGroup, ActionRow } from "@/components/actions-rail";
import { usePortalBatchEvents } from "@/hooks/use-portal-batch-events";
import { useAuth } from "@workspace/replit-auth-web";
import { useRole } from "@/lib/role";
import { useRetryPortalSubmission, useCancelPortalSubmission, useSandboxRunPortalSubmission, useConfirmPortalSubmission } from "@workspace/api-client-react";

const statusPillClass: Record<string, string> = {
  draft: "bg-blue-500/20 text-blue-700 border-blue-300",
  pending: "bg-amber-500/20 text-amber-700 border-amber-300",
  queued: "bg-indigo-500/20 text-indigo-700 border-indigo-300",
  in_progress: "bg-blue-500/20 text-blue-700 border-blue-300",
  submitted: "bg-green-500/20 text-green-700 border-green-300",
  failed: "bg-red-500/20 text-red-700 border-red-300",
  cancelled: "bg-gray-500/20 text-gray-700 border-gray-300",
  dry_run: "bg-purple-500/20 text-purple-700 border-purple-300",
};

// Submission stage labels live in the glossary so any rename ripples
// through here. Color tokens stay above — they're presentation, not
// vocabulary.
import { submissionStageLabel } from "@workspace/vocab";
import { StateBadge } from "@/components/state-badge";

const statusLabels: Record<string, string> = {
  draft: submissionStageLabel("draft"),
  pending: submissionStageLabel("pending"),
  queued: submissionStageLabel("queued"),
  in_progress: submissionStageLabel("in_progress"),
  submitted: submissionStageLabel("submitted"),
  failed: submissionStageLabel("failed"),
  cancelled: submissionStageLabel("cancelled"),
  dry_run: submissionStageLabel("dry_run"),
};

const FILTER_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: submissionStageLabel("draft") },
  { key: "pending", label: submissionStageLabel("pending") },
  { key: "queued", label: submissionStageLabel("queued") },
  { key: "in_progress", label: submissionStageLabel("in_progress") },
  { key: "submitted", label: submissionStageLabel("submitted") },
  { key: "failed", label: submissionStageLabel("failed") },
];

const STATUS_GROUP_ORDER = ["draft", "pending", "queued", "in_progress", "submitted", "failed", "cancelled", "dry_run"];

interface BatchJob {
  id: string;
  status: "running" | "completed" | "failed" | "aborted";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  triggeredBy: string;
  startedAt: string;
  completedAt?: string;
  results: { submissionId: number; status: string; message: string }[];
  abortRequestedBy?: string;
}

interface BatchRunHistoryEntry {
  batchId: string;
  status: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  triggeredBy: string;
  triggeredByEmail: string | null;
  stoppedBy: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

const runStatusStyles: Record<string, { label: string; badgeClass: string }> = {
  running: { label: "Running", badgeClass: "bg-blue-100 text-blue-700 border-blue-300" },
  completed: { label: "Success", badgeClass: "bg-green-100 text-green-700 border-green-300" },
  failed: { label: "Failed", badgeClass: "bg-red-100 text-red-700 border-red-300" },
  aborted: { label: "Stopped", badgeClass: "bg-amber-100 text-amber-700 border-amber-300" },
};

function RetryCountdown({ nextRetryAt }: { nextRetryAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diffMs = new Date(nextRetryAt).getTime() - now;
  if (diffMs <= 0) return <span>retrying soon</span>;
  const totalSec = Math.floor(diffMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return <span>retry in {h}h {mm}m</span>;
  }
  if (m >= 1) return <span>retry in {m}m {s.toString().padStart(2, "0")}s</span>;
  return <span>retry in {s}s</span>;
}

// Single source of truth: route every "5m ago" through the shared
// `lib/time/formatRelative` so tier wording matches the rest of the
// operator app (#562). Returns a JSX node carrying a hover-for-
// absolute-time tooltip on the relative label itself, so portal-
// submissions surfaces honour the same hover contract as Dashboard,
// detail views, and the daily brief.
function timeAgo(iso: string | undefined | null): React.ReactNode {
  if (!iso) return null;
  const rel = formatRelative(iso);
  if (!rel) return null;
  return <span title={absoluteTooltip(iso)}>{rel}</span>;
}

export default function PortalSubmissions() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { isClerk: clerk } = useRole();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => getInitialCollapsedGroups());

  const [batchTriggering, setBatchTriggering] = useState(false);
  const [completedJob, setCompletedJob] = useState<BatchJob | null>(null);
  const [recentRuns, setRecentRuns] = useState<BatchRunHistoryEntry[] | null>(null);
  const [recentRunsLoading, setRecentRunsLoading] = useState(false);

  const refreshRecentRuns = async () => {
    setRecentRunsLoading(true);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${base}/api/portal-submissions/batch-history?limit=10`, { credentials: "include" });
      if (res.ok) {
        const body = await res.json();
        setRecentRuns(Array.isArray(body.runs) ? body.runs : []);
      }
    } catch {
      // non-fatal
    } finally {
      setRecentRunsLoading(false);
    }
  };

  // SSE-driven shared in-flight batch (visible to all viewers).
  const sharedBatch = usePortalBatchEvents();
  const myDisplayName = user?.displayName || user?.email || "";
  const isAdmin = user?.role === "admin";
  const isMyBatch = !!sharedBatch && !!myDisplayName && sharedBatch.triggeredBy === myDisplayName;
  const canStopBatch = !!sharedBatch && (isMyBatch || isAdmin);
  const batchOwnerName = sharedBatch?.triggeredBy ?? "";
  const batchInFlight = !!sharedBatch || batchTriggering;
  const [batchAborting, setBatchAborting] = useState(false);
  const [abortConfirmOpen, setAbortConfirmOpen] = useState(false);

  // Task #738. Poll the submissions list so per-row `lastScrapedAt`
  // / `lastScrapeOutcome` / `lastScrapeError` updates from the
  // `portal_response_sync` cron surface without a manual refresh —
  // matches the WorkerHealthBanner refetch cadence (30s).
  const { data: submissions, isLoading } = useListPortalSubmissions(undefined, {
    query: {
      queryKey: getListPortalSubmissionsQueryKey(),
      refetchInterval: 30000,
    },
  });

  // Task #738. Sort control for the per-status-group rows. "Updated"
  // (the legacy default) keeps the existing newest-first ordering.
  // "Last checked" sorts by the per-submission `lastScrapedAt` so an
  // operator triaging fresh portal-scrape outcomes can pull the most
  // recently checked rows to the top of every group.
  const [sortBy, setSortBy] = useState<"updated" | "lastChecked">("updated");

  // Worker health rollup — collapsed into the one-line status strip.
  // The endpoint denies clerks; skip the query for them to avoid 403 churn.
  const { data: healthData } = useGetSystemHealthRollup({
    query: {
      queryKey: getGetSystemHealthRollupQueryKey(),
      refetchInterval: 30000,
      retry: false,
      enabled: !clerk,
    },
  });

  const retrySubmission = useRetryPortalSubmission();
  const cancelSubmission = useCancelPortalSubmission();
  const sandboxRun = useSandboxRunPortalSubmission();
  const confirmSubmission = useConfirmPortalSubmission();
  const [queueingDrafts, setQueueingDrafts] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListPortalSubmissionsQueryKey() });
  };

  // Counts per status (using normalized status — pending+claimedByBatchId => queued).
  const normalizedSubs = useMemo(() => (submissions || []).map(s => ({
    ...s,
    _displayStatus: s.status === "pending" && s.claimedByBatchId ? "queued" : s.status,
  })), [submissions]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of normalizedSubs) {
      counts[s._displayStatus] = (counts[s._displayStatus] || 0) + 1;
    }
    return counts;
  }, [normalizedSubs]);

  const totalCount = normalizedSubs.length;

  // Filter (status + search)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return normalizedSubs.filter(s => {
      if (statusFilter !== "all" && s._displayStatus !== statusFilter) return false;
      if (q) {
        const hay = `${s.confNumber || ""} ${s.subject || ""} ${s.invoiceNumber || ""} ${s.portalTicketId || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [normalizedSubs, statusFilter, search]);

  // Group by status for the list rendering. When the operator picks
  // "Last checked" as the sort, rows inside each group are reordered
  // by `lastScrapedAt` desc with un-scraped rows pushed to the
  // bottom — Task #738 sortable-Last-checked control. The default
  // "Updated" preserves the existing list order.
  const groupedSubs = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const s of filtered) {
      const k = s._displayStatus;
      if (!groups[k]) groups[k] = [];
      groups[k].push(s);
    }
    if (sortBy === "lastChecked") {
      for (const k of Object.keys(groups)) {
        groups[k] = [...groups[k]].sort((a, b) => {
          const at = a.lastScrapedAt ? new Date(a.lastScrapedAt).getTime() : 0;
          const bt = b.lastScrapedAt ? new Date(b.lastScrapedAt).getTime() : 0;
          return bt - at;
        });
      }
    }
    return groups;
  }, [filtered, sortBy]);

  const pendingSubmissions = useMemo(() => normalizedSubs.filter(s => s._displayStatus === "pending"), [normalizedSubs]);

  // Task #703: drafts no longer exist as `portal_submissions` rows.
  // Generate-preview / Save-draft / Regenerate stamp text on
  // `invoice_groups.draft*` only; the row is created at submit time
  // landing directly in `pending`. The boot-time backfill in
  // api-server's index.ts hard-deletes any leftover orphan ghost
  // drafts. We force this list empty so the "Queue N drafts" banner
  // and its underlying call to the now-410 /portal-submissions/:id/confirm
  // endpoint can never fire — a defensive rail in case a row somehow
  // sneaks in (manual seed, in-flight migration, etc.).
  const draftsReadyToQueue = useMemo<PortalSubmissionResponse[]>(() => [], []);

  const handleToggle = (id: number) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const checkedCount = checkedIds.size;
  const checkedDraftIds = useMemo(
    () => getCheckedDraftIds(normalizedSubs, checkedIds),
    [normalizedSubs, checkedIds],
  );
  const allCheckedAreDrafts = useMemo(
    () => selectionIsAllDrafts(normalizedSubs, checkedIds),
    [normalizedSubs, checkedIds],
  );

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Track in-flight batch for completion summary fetch.
  const lastBatchIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (sharedBatch) {
      lastBatchIdRef.current = sharedBatch.batchId;
      setCompletedJob(null);
      setBatchTriggering(false);
      void refreshRecentRuns();
    } else if (lastBatchIdRef.current) {
      setBatchAborting(false);
      const finishedId = lastBatchIdRef.current;
      lastBatchIdRef.current = null;
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      fetch(`${base}/api/portal-submissions/batch-status/${finishedId}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((job: BatchJob | null) => { if (job) setCompletedJob(job); })
        .catch(() => {});
      invalidate();
      void refreshRecentRuns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedBatch?.batchId, !!sharedBatch]);

  useEffect(() => { void refreshRecentRuns(); /* eslint-disable-next-line */ }, []);

  // Auto-dismiss completed-job toast strip after 30s.
  useEffect(() => {
    if (!completedJob) return;
    const t = setTimeout(() => setCompletedJob(null), 30000);
    return () => clearTimeout(t);
  }, [completedJob]);

  const handleBatchProcess = async (ids: number[] | "all") => {
    setBatchTriggering(true);
    setCompletedJob(null);
    try {
      const requestBody = ids === "all" ? {} : { submissionIds: ids };
      const res = await fetch("/api/portal-submissions/batch-process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to start batch");
      }
      const body = await res.json();
      if (body.skipped) {
        setBatchTriggering(false);
        if (body.reason === "no_pending") alert("No pending submissions to process.");
        else if (body.reason === "already_running") alert("A worker run is already in progress; this trigger was coalesced.");
        return;
      }
      setCheckedIds(new Set());
    } catch (err) {
      setBatchTriggering(false);
      alert(err instanceof Error ? err.message : "Failed to start batch processing");
    }
  };

  const handleAbortBatch = () => {
    if (!sharedBatch) return;
    setAbortConfirmOpen(true);
  };

  const confirmAbortBatch = async () => {
    setAbortConfirmOpen(false);
    if (!sharedBatch) return;
    setBatchAborting(true);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const res = await fetch(`${base}/api/portal-submissions/batch-abort/${sharedBatch.batchId}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to stop batch (HTTP ${res.status})`);
      }
    } catch (err) {
      setBatchAborting(false);
      alert(err instanceof Error ? err.message : "Failed to stop batch");
    }
  };

  const handleQueueDrafts = async (drafts: PortalSubmissionResponse[]) => {
    setQueueingDrafts(true);
    let queued = 0;
    const failed: { id: number; reason: string }[] = [];
    for (const d of drafts) {
      try {
        await confirmSubmission.mutateAsync({ id: d.id, data: { ack: true } });
        queued += 1;
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        failed.push({ id: d.id, reason });
      }
    }
    invalidate();
    setQueueingDrafts(false);
    if (failed.length === 0) {
      // Subtle, no alert if all succeeded — the row state will visibly move.
    } else if (queued === 0) {
      alert(`Could not queue drafts. First reason: ${failed[0].reason}`);
    } else {
      alert(`Queued ${queued} draft${queued === 1 ? "" : "s"}. ${failed.length} could not be queued (open them to fix).`);
    }
  };

  const handleSandboxRow = async (id: number) => {
    try {
      await sandboxRun.mutateAsync({ id });
      invalidate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Sandbox run failed");
    }
  };

  const otherUserOwnsBatch = !!sharedBatch && !isMyBatch;
  const lockedTooltip = otherUserOwnsBatch ? `Batch already running by ${batchOwnerName}` : undefined;
  const buttonsDisabled = batchInFlight;

  const drawerSubmission = drawerId ? (submissions || []).find(s => s.id === drawerId) ?? null : null;

  return (
    <div className="space-y-4">
      {/* Page header + segmented filter strip */}
      <div className="space-y-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Portal Submissions</h2>
          <p className="text-sm text-muted-foreground">The MAS portal queue. {totalCount} active item{totalCount === 1 ? "" : "s"}.</p>
        </div>
        <div className="inline-flex items-center p-1 gap-1 rounded-md bg-muted border w-fit">
          {FILTER_TABS.map(tab => {
            const count = tab.key === "all" ? totalCount : (statusCounts[tab.key] || 0);
            const active = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 text-xs rounded font-medium transition-colors flex items-center gap-1.5 ${active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                data-testid={`filter-tab-${tab.key}`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`text-[10px] px-1 rounded font-bold min-w-[14px] text-center ${active ? "bg-muted text-foreground" : "text-muted-foreground"}`}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* One-line status strip (worker health + last batch + last
          portal-scrape sweep + recent runs link). Task #738. */}
      <StatusStrip
        health={healthData}
        lastRun={recentRuns?.[0]}
        lastPortalScrape={healthData?.lastPortalScrape ?? null}
        loading={recentRunsLoading}
      />

      {/* Completed-job summary toast — auto-dismisses */}
      {!sharedBatch && completedJob && (
        <CompletedJobStrip job={completedJob} onDismiss={() => setCompletedJob(null)} />
      )}

      {/* Two-column layout: list left, sticky rail right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8 space-y-3 min-w-0" data-tour="portal-submissions-list">
          {/* Standard list-page header strip — search + matching count.
              No advanced filter categories yet (the status pill strip above
              is the primary segmentation); the Faceted Rail shell will pick
              up new categories cheaply when they're introduced. */}
          <ListTableHeaderStrip
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search conf #, subject, ticket…"
            searchTestId="input-search-submissions"
            matchingCount={filtered.length}
            matchingNoun={{ one: "submission", other: "submissions" }}
          />

          {/* Task #738. Sort control — operators triaging fresh
              portal-scrape outcomes pick "Last checked" to pull the
              most recently scraped rows to the top of every group. */}
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <label htmlFor="portal-submissions-sort">Sort by</label>
            <select
              id="portal-submissions-sort"
              data-testid="select-portal-submissions-sort"
              className="h-7 rounded-md border bg-background px-2 text-xs"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "updated" | "lastChecked")}
            >
              <option value="updated">Updated (default)</option>
              <option value="lastChecked">Last checked</option>
            </select>
          </div>

          {/* Recommendation banner — hidden for clerks (no bulk queue). */}
          {!clerk && draftsReadyToQueue.length > 0 && !batchInFlight && (
            <Card className="border-blue-200 bg-blue-50/60 dark:bg-blue-950/20">
              <CardContent className="py-3 px-4 flex items-center gap-3">
                <Sparkles className="h-4 w-4 text-blue-700 dark:text-blue-300 flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <span className="font-medium text-blue-900 dark:text-blue-100">{draftsReadyToQueue.length} draft{draftsReadyToQueue.length === 1 ? "" : "s"} ready to queue.</span>
                  <span className="text-blue-800/80 dark:text-blue-200/80"> Queue them so the bot picks them up on the next run.</span>
                </div>
                <Button size="sm" onClick={() => handleQueueDrafts(draftsReadyToQueue)} disabled={queueingDrafts} className="gap-1.5" data-testid="button-queue-drafts">
                  {queueingDrafts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Queue {draftsReadyToQueue.length} draft{draftsReadyToQueue.length === 1 ? "" : "s"}
                </Button>
              </CardContent>
            </Card>
          )}

          <SkeletonSwap
            loading={isLoading}
            skeleton={
              <div className="space-y-3" data-testid="portal-submissions-skeleton">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full" />)}
              </div>
            }
          >
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="p-0">
                {statusFilter !== "all" || search ? (
                  <EmptyState
                    icon={Search}
                    title="No submissions match this filter"
                    description={search ? "Try a different search term, or change the status filter above." : "Try a different status to see more submissions."}
                    primaryAction={{ label: "Clear filter", onClick: () => { setStatusFilter("all"); setSearch(""); } }}
                  />
                ) : (
                  <EmptyState
                    icon={Send}
                    title="No submissions yet"
                    description="Drafts you create on an invoice group show up here, ready to submit to the portal."
                    primaryAction={{ label: "Go to invoice groups", href: "/invoice-groups" }}
                  />
                )}
              </CardContent>
            </Card>
          ) : (
            STATUS_GROUP_ORDER
              .filter(k => groupedSubs[k] && groupedSubs[k].length > 0)
              .map(groupKey => (
                <StatusGroupCard
                  key={groupKey}
                  status={groupKey}
                  rows={groupedSubs[groupKey]}
                  collapsed={collapsedGroups.has(groupKey)}
                  onToggleCollapsed={() => toggleGroup(groupKey)}
                  checkedIds={checkedIds}
                  onToggle={handleToggle}
                  buttonsDisabled={buttonsDisabled}
                  lockedTooltip={lockedTooltip}
                  hideSelection={clerk}
                  onOpenRow={(id) => setDrawerId(id)}
                  onSandbox={handleSandboxRow}
                  onRetry={async (id) => { await retrySubmission.mutateAsync({ id }); invalidate(); }}
                  onDiscardDraft={async (id) => { await cancelSubmission.mutateAsync({ id }); invalidate(); }}
                  onCancel={async (id) => { await cancelSubmission.mutateAsync({ id }); invalidate(); }}
                />
              ))
          )}
          </SkeletonSwap>
        </div>

        {/* Right rail — clerks see no batch / queue / selection rail. */}
        <aside className="lg:col-span-4 space-y-4" data-tour="portal-submissions-rail">
          <div className="lg:sticky lg:top-4 space-y-4">
            {clerk ? null : sharedBatch ? (
              <InFlightRail
                sharedBatch={sharedBatch}
                isMyBatch={isMyBatch}
                canStop={canStopBatch}
                aborting={batchAborting}
                onAbort={handleAbortBatch}
              />
            ) : (
              <RunQueueRail
                pendingCount={pendingSubmissions.length}
                checkedCount={checkedCount}
                checkedDraftCount={checkedDraftIds.length}
                allCheckedAreDrafts={allCheckedAreDrafts}
                buttonsDisabled={buttonsDisabled}
                lockedTooltip={lockedTooltip}
                otherUserOwnsBatch={otherUserOwnsBatch}
                batchOwnerName={batchOwnerName}
                batchInFlight={batchInFlight}
                onProcessAll={() => handleBatchProcess("all")}
                onProcessSelected={() => handleBatchProcess(Array.from(checkedIds))}
                onSandboxSelected={async () => {
                  for (const id of Array.from(checkedIds)) { await sandboxRun.mutateAsync({ id }); }
                  invalidate();
                }}
                onCancelSelected={async () => {
                  for (const id of Array.from(checkedIds)) { await cancelSubmission.mutateAsync({ id }); }
                  setCheckedIds(new Set());
                  invalidate();
                }}
                onDiscardSelectedDrafts={async () => {
                  if (checkedDraftIds.length === 0) return;
                  for (const id of checkedDraftIds) { await cancelSubmission.mutateAsync({ id }); }
                  setCheckedIds(prev => {
                    const next = new Set(prev);
                    for (const id of checkedDraftIds) next.delete(id);
                    return next;
                  });
                  invalidate();
                }}
                onClearSelection={() => setCheckedIds(new Set())}
              />
            )}

            <RecentRunsCard runs={recentRuns} loading={recentRunsLoading} isAdmin={isAdmin} />

            <Card className="bg-muted/30">
              <CardContent className="p-3 text-xs text-muted-foreground flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>Need to reorder the queue? Cancel and recreate the draft on the invoice group page.</span>
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>

      <AlertDialog open={abortConfirmOpen} onOpenChange={setAbortConfirmOpen}>
        <AlertDialogContent data-testid="portal-submissions-abort-batch-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Stop {isMyBatch ? "this run" : `${batchOwnerName}'s run`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The current row will finish, then the worker will exit and any
              queued rows will go back to Pending.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="portal-submissions-abort-batch-cancel">
              Keep running
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmAbortBatch}
              data-testid="portal-submissions-abort-batch-confirm-btn"
            >
              Stop batch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unified drawer */}
      <PortalSubmissionDrawer
        submissionId={drawerId}
        initialSubmission={drawerSubmission}
        open={drawerId !== null}
        onOpenChange={(o) => { if (!o) setDrawerId(null); }}
        onProcessNow={(id) => { handleBatchProcess([id]); setDrawerId(null); }}
        processNowDisabled={batchInFlight}
        processNowDisabledReason={batchInFlight ? lockedTooltip ?? "A batch is already running." : undefined}
      />
    </div>
  );
}

// =====================================================================
// Status strip — collapses worker health + last batch + recent runs link
// =====================================================================
function StatusStrip({ health, lastRun, lastPortalScrape, loading }: {
  health?: { overall: string; overdueCount: number; overdueGraceMinutes: number; components: Array<{ name: string; status: string; detail?: string | null }> } | null;
  lastRun?: BatchRunHistoryEntry;
  // Task #738. Embedded on the rollup payload so the strip can render
  // the most recent portal_response_sync sweep inline.
  lastPortalScrape?: {
    startedAt: string;
    finishedAt?: string | null;
    status: string;
    message?: string | null;
    considered?: number | null;
    scraped?: number | null;
    skipped?: number | null;
    errored?: number | null;
    newResponses?: number | null;
  } | null;
  loading?: boolean;
}) {
  const isHealthy = !health || health.overall === "ok";
  const isFailed = health?.overall === "failed";
  const dotClass = isFailed ? "bg-red-500" : isHealthy ? "bg-green-500" : "bg-amber-500";
  const healthLabel = isFailed ? "Worker failed" : isHealthy ? "Worker healthy" : "Worker degraded";

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs px-4 py-2 rounded-md border bg-card">
      <a href="/system-health" className="flex items-center gap-1.5 hover:underline" title="Open system health">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        <span className="font-medium">{healthLabel}</span>
      </a>
      {!isHealthy && health && (
        <span className="text-amber-700 dark:text-amber-300">
          {health.overdueCount > 0 ? `${health.overdueCount} past cycle` : ""}
          {health.overdueCount > 0 ? " · " : ""}
          {health.components.filter(c => c.status !== "ok").length} component{health.components.filter(c => c.status !== "ok").length === 1 ? "" : "s"} need attention
        </span>
      )}
      {lastRun && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            Last batch <span className="text-foreground">{timeAgo(lastRun.startedAt)}</span> by <span className="text-foreground">{lastRun.triggeredBy}</span>
          </span>
          <span className="text-muted-foreground">·</span>
          <span className={lastRun.failed > 0 ? "text-amber-700" : "text-green-700"}>
            {lastRun.succeeded}/{lastRun.total} succeeded
            {lastRun.failed > 0 ? `, ${lastRun.failed} failed` : ""}
          </span>
        </>
      )}
      {/* Task #738. Per-sweep portal-scrape strip. Click-through opens
          the System Health drill-down for the same run. Hidden if the
          rollup hasn't surfaced a sweep yet (admin-gated payload
          field, so clerks won't see it either). */}
      {lastPortalScrape && (
        <>
          <span className="text-muted-foreground">·</span>
          <a
            href="/system-health#last-portal-scrape"
            className="flex items-center gap-1.5 hover:underline"
            title={lastPortalScrape.message ?? "Open the last portal scrape detail"}
            data-testid="link-last-portal-scrape"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                lastPortalScrape.status === "failed"
                  ? "bg-red-500"
                  : lastPortalScrape.status === "degraded"
                    ? "bg-amber-500"
                    : "bg-green-500"
              }`}
            />
            <span className="text-muted-foreground">
              Last scrape <span className="text-foreground">{timeAgo(lastPortalScrape.startedAt)}</span>
              {typeof lastPortalScrape.scraped === "number" && typeof lastPortalScrape.considered === "number" && (
                <> · checked <span className="text-foreground">{lastPortalScrape.scraped}/{lastPortalScrape.considered}</span></>
              )}
              {typeof lastPortalScrape.newResponses === "number" && lastPortalScrape.newResponses > 0 && (
                <>, new <span className="text-foreground">{lastPortalScrape.newResponses}</span></>
              )}
              {typeof lastPortalScrape.errored === "number" && lastPortalScrape.errored > 0 && (
                <>, errors <span className="text-amber-700 dark:text-amber-300">{lastPortalScrape.errored}</span></>
              )}
            </span>
          </a>
        </>
      )}
      {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      <a href="#recent-runs" className="ml-auto text-primary hover:underline font-medium" data-testid="link-view-recent-runs">View recent runs →</a>
    </div>
  );
}

// =====================================================================
// In-flight batch rail (replaces "Run the queue" header during batch)
// =====================================================================
function InFlightRail({ sharedBatch, isMyBatch, canStop, aborting, onAbort }: {
  sharedBatch: NonNullable<ReturnType<typeof usePortalBatchEvents>>;
  isMyBatch: boolean;
  canStop: boolean;
  aborting: boolean;
  onAbort: () => void;
}) {
  const pct = sharedBatch.total > 0 ? (sharedBatch.processed / sharedBatch.total) * 100 : 0;
  return (
    <Card className="border-2 border-blue-300 bg-blue-50/60 dark:bg-blue-950/20" data-testid="in-flight-batch-card">
      <CardContent className="py-4 space-y-3">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 text-blue-600 animate-spin flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Batch processing — in progress</p>
            <p className="text-xs text-muted-foreground truncate">
              Triggered by {sharedBatch.triggeredBy}{isMyBatch ? " (you)" : ""} · {formatDateTime(sharedBatch.startedAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="font-medium">{sharedBatch.processed} / {sharedBatch.total}</span>
          {sharedBatch.succeeded > 0 && <Badge className="bg-green-100 text-green-700 border-0">{sharedBatch.succeeded} ok</Badge>}
          {sharedBatch.failed > 0 && <Badge variant="destructive">{sharedBatch.failed} failed</Badge>}
        </div>
        <div className="bg-muted rounded-full h-2 overflow-hidden">
          <div className="bg-blue-500 h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        {canStop && (
          <WrapTooltip content={isMyBatch ? "Stop this batch — the current row will finish, then queued rows go back to Pending." : "Admin override — stop this run."}>
            <Button size="sm" variant="destructive" onClick={onAbort} disabled={aborting} data-testid="button-stop-batch" className="w-full gap-1.5">
              {aborting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Stopping…</> : <><StopCircle className="h-3.5 w-3.5" /> Stop this batch</>}
            </Button>
          </WrapTooltip>
        )}
      </CardContent>
    </Card>
  );
}

// =====================================================================
// Run-the-queue rail (resting state)
// =====================================================================
function RunQueueRail({
  pendingCount, checkedCount, checkedDraftCount, allCheckedAreDrafts,
  buttonsDisabled, lockedTooltip, otherUserOwnsBatch,
  batchOwnerName, batchInFlight,
  onProcessAll, onProcessSelected, onSandboxSelected, onCancelSelected, onDiscardSelectedDrafts, onClearSelection,
}: {
  pendingCount: number;
  checkedCount: number;
  checkedDraftCount: number;
  allCheckedAreDrafts: boolean;
  buttonsDisabled: boolean;
  lockedTooltip?: string;
  otherUserOwnsBatch: boolean;
  batchOwnerName: string;
  batchInFlight: boolean;
  onProcessAll: () => void;
  onProcessSelected: () => void;
  onSandboxSelected: () => void;
  onCancelSelected: () => void;
  onDiscardSelectedDrafts: () => void;
  onClearSelection: () => void;
}) {
  // Inline 2-step confirm for the cancel/discard bulk action — no modal,
  // just an in-rail "click again to confirm" arming that auto-disarms.
  const [bulkArm, setBulkArm] = useState<DiscardArmState | null>(null);
  useEffect(() => {
    if (!bulkArm) return;
    const t = setTimeout(() => setBulkArm(null), DISCARD_ARM_TTL_MS);
    return () => clearTimeout(t);
  }, [bulkArm]);
  // Disarm when the selection set changes underneath the user.
  useEffect(() => { setBulkArm(null); }, [checkedCount, allCheckedAreDrafts]);

  const isArmed = isDiscardStillArmed(bulkArm);
  const cancelLabelDefault = allCheckedAreDrafts && checkedDraftCount > 0
    ? `Discard selected drafts${checkedDraftCount > 0 ? ` (${checkedDraftCount})` : ""}`
    : `Cancel selected${checkedCount > 0 ? ` (${checkedCount})` : ""}`;
  const cancelLabelArmed = allCheckedAreDrafts
    ? `Click again to confirm — discard ${checkedDraftCount} draft${checkedDraftCount === 1 ? "" : "s"}`
    : `Click again to confirm — cancel ${checkedCount} submission${checkedCount === 1 ? "" : "s"}`;
  const cancelSub = allCheckedAreDrafts
    ? "Removes drafts from the queue. The underlying claims are unchanged."
    : "Cancels the selected submissions.";

  const handleCancelSelected = () => {
    if (!isArmed) {
      setBulkArm(makeDiscardArmState());
      return;
    }
    setBulkArm(null);
    if (allCheckedAreDrafts) onDiscardSelectedDrafts();
    else onCancelSelected();
  };

  const meta = checkedCount > 0 ? `${checkedCount} selected` : `${pendingCount} pending`;
  const recommendedNode = pendingCount > 0 ? (
    <ActionsRailRecommended
      label="Recommended"
      description="Estimated 4–6 minutes. One worker processes the queue at a time."
    >
      {(() => {
        const btn = (
          <Button
            size="sm"
            className="w-full gap-1.5"
            onClick={onProcessAll}
            disabled={buttonsDisabled}
            data-testid="button-process-all"
          >
            {otherUserOwnsBatch ? (
              <><Lock className="h-3.5 w-3.5" /> Locked by {batchOwnerName}</>
            ) : batchInFlight ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing…</>
            ) : (
              <><Play className="h-3.5 w-3.5" /> Process all pending ({pendingCount})</>
            )}
          </Button>
        );
        return lockedTooltip ? <WrapTooltip content={lockedTooltip}><span>{btn}</span></WrapTooltip> : btn;
      })()}
    </ActionsRailRecommended>
  ) : null;

  return (
    <ActionsRail title="Run the queue" meta={meta}>
      {recommendedNode}

      <ActionGroup label="On selection">
        <ActionRow
          icon={<Play className="h-4 w-4" />}
          label={`Process selected${checkedCount > 0 ? ` (${checkedCount})` : ""}`}
          sub="Bot fills the form and submits"
          disabled={checkedCount === 0 || buttonsDisabled}
          disabledReason={checkedCount === 0 ? "Select one or more pending submissions to enable." : lockedTooltip}
          onClick={onProcessSelected}
          testId="action-process-selected"
        />
        <ActionRow
          icon={<FlaskConical className="h-4 w-4" />}
          label="Sandbox-run selected"
          sub="Dry run — fills the form, captures a screenshot, doesn't submit"
          disabled={checkedCount === 0 || buttonsDisabled}
          disabledReason={checkedCount === 0 ? "Select one or more submissions to enable." : lockedTooltip}
          onClick={onSandboxSelected}
          testId="action-sandbox-selected"
        />
        <ActionRow
          icon={allCheckedAreDrafts ? <XCircle className="h-4 w-4" /> : <X className="h-4 w-4" />}
          label={isArmed ? cancelLabelArmed : cancelLabelDefault}
          sub={isArmed ? "Click again to confirm, or wait to cancel." : cancelSub}
          warn={isArmed}
          muted={!isArmed}
          disabled={checkedCount === 0}
          disabledReason={checkedCount === 0 ? "Select one or more submissions to enable." : undefined}
          onClick={handleCancelSelected}
          testId={allCheckedAreDrafts ? "action-discard-selected-drafts" : "action-cancel-selected"}
        />
      </ActionGroup>

      <ActionGroup label="Bulk edit">
        <ActionRow
          icon={<Tag className="h-4 w-4" />}
          label="Apply error type to selected…"
          disabled
          disabledReason="Coming soon — apply an error type across multiple selected submissions in one go."
        />
        <ActionRow
          icon={<Edit2 className="h-4 w-4" />}
          label="Edit subject for selected…"
          disabled
          disabledReason="Coming soon — set a common subject across multiple selected submissions."
        />
      </ActionGroup>

      <ActionGroup label="Selection">
        <ActionRow
          icon={<X className="h-4 w-4" />}
          label="Clear selection"
          muted
          disabled={checkedCount === 0}
          onClick={onClearSelection}
        />
      </ActionGroup>
    </ActionsRail>
  );
}

// =====================================================================
// Status group card (collapsible)
// =====================================================================
function StatusGroupCard({
  status, rows, collapsed, onToggleCollapsed, checkedIds, onToggle,
  buttonsDisabled, lockedTooltip, hideSelection, onOpenRow, onSandbox, onRetry, onCancel, onDiscardDraft,
}: {
  status: string;
  rows: (PortalSubmissionResponse & { _displayStatus: string })[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  checkedIds: Set<number>;
  onToggle: (id: number) => void;
  buttonsDisabled: boolean;
  lockedTooltip?: string;
  hideSelection?: boolean;
  onOpenRow: (id: number) => void;
  onSandbox: (id: number) => void;
  onRetry: (id: number) => void;
  onCancel: (id: number) => void;
  onDiscardDraft: (id: number) => void;
}) {
  const allChecked = rows.length > 0 && rows.every(r => checkedIds.has(r.id));
  const partiallyChecked = !allChecked && rows.some(r => checkedIds.has(r.id));
  const canBulkSelect = !hideSelection && (status === "draft" || status === "pending");
  const draftsAlreadyDoneElsewhere = status === "draft" ? countDraftsAlreadyDoneElsewhere(rows) : 0;

  return (
    <Card className="overflow-hidden" data-testid={`status-group-${status}`}>
      <div className="px-3 py-2 flex items-center gap-2 bg-muted/50 border-b">
        {canBulkSelect && (
          <WrapTooltip content={lockedTooltip ?? `Select all ${statusLabels[status].toLowerCase()} submissions in this group.`}>
            <Checkbox
              checked={allChecked || (partiallyChecked && "indeterminate")}
              onCheckedChange={() => {
                if (allChecked) {
                  rows.forEach(r => { if (checkedIds.has(r.id)) onToggle(r.id); });
                } else {
                  rows.forEach(r => { if (!checkedIds.has(r.id)) onToggle(r.id); });
                }
              }}
              disabled={buttonsDisabled}
              data-testid={`checkbox-group-${status}`}
            />
          </WrapTooltip>
        )}
        <StateBadge variant="stage" value={status} />
        <span className="text-xs font-medium text-muted-foreground">{rows.length} {rows.length === 1 ? "item" : "items"}</span>
        {status === "draft" && draftsAlreadyDoneElsewhere > 0 && (
          <span
            className="text-xs text-amber-700 dark:text-amber-300"
            data-testid="drafts-already-submitted-subtitle"
          >
            · {draftsAlreadyDoneElsewhere} of {rows.length} {rows.length === 1 ? "is" : "are"} for invoices already submitted in another run
          </span>
        )}
        <button
          className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={onToggleCollapsed}
          data-testid={`toggle-group-${status}`}
        >
          {collapsed ? <><ChevronRight className="h-3 w-3" /> Expand</> : <><ChevronDown className="h-3 w-3" /> Collapse</>}
        </button>
      </div>
      {!collapsed && rows.map(row => (
        <SubmissionRow
          key={row.id}
          sub={row}
          checked={checkedIds.has(row.id)}
          onToggle={() => onToggle(row.id)}
          buttonsDisabled={buttonsDisabled}
          lockedTooltip={lockedTooltip}
          hideSelection={hideSelection}
          onOpen={() => onOpenRow(row.id)}
          onOpenById={(id) => onOpenRow(id)}
          onSandbox={() => onSandbox(row.id)}
          onRetry={() => onRetry(row.id)}
          onCancel={() => onCancel(row.id)}
          onDiscardDraft={() => onDiscardDraft(row.id)}
        />
      ))}
    </Card>
  );
}

// =====================================================================
// One-line submission row
// =====================================================================
function SubmissionRow({
  sub, checked, onToggle, buttonsDisabled, lockedTooltip, hideSelection,
  onOpen, onOpenById, onSandbox, onRetry, onCancel, onDiscardDraft,
}: {
  sub: PortalSubmissionResponse & { _displayStatus: string };
  checked: boolean;
  onToggle: () => void;
  buttonsDisabled: boolean;
  lockedTooltip?: string;
  hideSelection?: boolean;
  onOpen: () => void;
  onOpenById: (id: number) => void;
  onSandbox: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onDiscardDraft: () => void;
}) {
  const isQueued = sub._displayStatus === "queued";
  const showCheckbox = !hideSelection && (sub.status === "pending" || sub.status === "draft");
  const canSandbox = ["draft", "pending", "failed", "dry_run"].includes(sub.status) && !isQueued;
  const canRetry = sub.status === "failed";
  const canCancel = (sub.status === "draft" || sub.status === "pending" || sub.status === "dry_run" || sub.status === "failed") && !isQueued;

  const [discardArm, setDiscardArm] = useState<DiscardArmState | null>(null);
  useEffect(() => {
    if (!discardArm) return;
    const t = setTimeout(() => setDiscardArm(null), DISCARD_ARM_TTL_MS);
    return () => clearTimeout(t);
  }, [discardArm]);
  const discardArmed = isDiscardStillArmed(discardArm);
  const onDiscardClick = () => {
    if (!discardArmed) {
      setDiscardArm(makeDiscardArmState());
      return;
    }
    setDiscardArm(null);
    onDiscardDraft();
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5 border-b last:border-b-0 hover:bg-accent/30 transition-colors cursor-pointer"
      onClick={onOpen}
      data-testid={`row-submission-${sub.id}`}
    >
      <div onClick={e => e.stopPropagation()}>
        {showCheckbox ? (
          buttonsDisabled ? (
            <WrapTooltip content={lockedTooltip ?? "Selection is locked while a batch is running."}>
              <span><Checkbox checked={checked} onCheckedChange={onToggle} disabled /></span>
            </WrapTooltip>
          ) : (
            <Checkbox checked={checked} onCheckedChange={onToggle} data-testid={`checkbox-row-${sub.id}`} />
          )
        ) : (
          <div style={{ width: 16 }} />
        )}
      </div>

      <span className="font-mono font-semibold text-xs text-primary min-w-[112px] truncate flex items-center gap-1.5" data-testid={`row-conf-${sub.id}`}>
        <span className="truncate">{sub.invoiceNumber || sub.confNumber || `#${sub.id}`}</span>
        {(() => {
          // Task #485: this row IS the group submission — show the per-leg
          // count from the `legs` JSONB so operators see at a glance how
          // many disputed legs are bundled together. Legacy pre-Task #485
          // rows have `legs == []`; we hide the pill rather than show "0
          // legs" which would be misleading.
          const legCount = sub.legs?.length ?? 0;
          if (legCount === 0) return null;
          return (
            <Badge variant="outline" className="text-[10px] h-4 px-1 font-normal flex-shrink-0" data-testid={`row-leg-count-${sub.id}`}>
              {legCount} leg{legCount === 1 ? "" : "s"}
            </Badge>
          );
        })()}
      </span>

      {/* Task #564 — phase-first row layout. The parent invoice
          group's macro phase is the primary chip; the submission
          Stage renders as a subordinate secondary chip alongside it
          ("In-flight · Submitted"). Macro phase may be null on the
          rare orphaned row — fall back to stage-only in that case. */}
      {sub.groupMacroPhase ? (
        <div className="flex items-center gap-1 flex-shrink-0" data-testid={`row-phase-stage-${sub.id}`}>
          <StateBadge
            variant="phase"
            value={sub.groupMacroPhase}
            className="text-[10px] h-5 px-1.5"
            data-testid={`row-phase-${sub.id}`}
            tooltipExtra={`Stage: ${statusLabels[sub._displayStatus] ?? sub._displayStatus}`}
          />
          <StateBadge
            variant="stage"
            value={sub._displayStatus}
            className="text-[10px] h-5 px-1.5 opacity-80"
            data-testid={`row-status-${sub.id}`}
          />
        </div>
      ) : (
        <StateBadge
          variant="stage"
          value={sub._displayStatus}
          className="text-[10px] h-5 px-1.5 flex-shrink-0"
          data-testid={`row-status-${sub.id}`}
        />
      )}

      <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
        {(sub.attempts ?? 0) > 0 && (sub.status === "pending" || sub.status === "in_progress" || sub.status === "failed") && (
          <WrapTooltip content={`Attempt ${sub.attempts} of ${sub.maxAttempts ?? 4}`}>
            <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5">
              {sub.attempts}/{sub.maxAttempts ?? 4}
            </Badge>
          </WrapTooltip>
        )}
        {sub.status === "pending" && sub.nextRetryAt && (
          // Task #564 — absolute-time tooltip. Use absoluteTooltip so the
          // hover text matches the rest of the app (date-time + display
          // timezone) and operators don't have to guess whether the
          // countdown is wall-clock or server-time.
          <WrapTooltip content={`Next retry at ${absoluteTooltip(sub.nextRetryAt)}`}>
            <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5 text-amber-700 border-amber-400">
              <Clock className="h-2.5 w-2.5 mr-1" /><RetryCountdown nextRetryAt={sub.nextRetryAt} />
            </Badge>
          </WrapTooltip>
        )}
        {sub.portalTicketId && (
          sub.issueType === "Direct Email" ? (
            // Direct-email rows reuse `portalTicketId` to store the Outlook
            // messageId (a long base64-looking string). Show a fixed-width
            // "Email Sent" pill instead so it doesn't blow the row apart;
            // the underlying messageId is still available on hover for
            // copy/debugging.
            <WrapTooltip content={`Sent via direct email — Outlook message ID: ${sub.portalTicketId}`}>
              <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5 w-[88px] justify-center bg-green-50 text-green-700 border-green-300 flex-shrink-0" data-testid={`row-email-sent-${sub.id}`}>
                <Mail className="h-2.5 w-2.5 mr-1" />Email Sent
              </Badge>
            </WrapTooltip>
          ) : (
            <WrapTooltip content="Ticket ID assigned by the MAS portal after submission.">
              <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5 font-mono bg-green-50 text-green-700 border-green-300">
                <CheckCircle className="h-2.5 w-2.5 mr-1" />{sub.portalTicketId}
              </Badge>
            </WrapTooltip>
          )
        )}
        {sub.errorMessage && (
          <WrapTooltip content={sub.errorMessage}>
            <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5 bg-red-50 text-red-700 border-red-300 max-w-[200px]">
              <AlertTriangle className="h-2.5 w-2.5 mr-1 flex-shrink-0" /><span className="truncate">{sub.errorMessage}</span>
            </Badge>
          </WrapTooltip>
        )}
        {sub.completedElsewhere && (
          <WrapTooltip content={formatCompletedElsewhereTooltip(sub.completedElsewhere)}>
            <button
              type="button"
              onClick={makePillClickHandler(sub.completedElsewhere, onOpenById)}
              className="cursor-pointer inline-flex items-center text-[10px] h-5 px-1.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              data-testid={`row-completed-elsewhere-${sub.id}`}
              aria-label={formatCompletedElsewhereLabel(sub.completedElsewhere) + " — open that submission"}
            >
              <CheckCircle className="h-2.5 w-2.5 mr-1" />
              {formatCompletedElsewhereLabel(sub.completedElsewhere)}
            </button>
          </WrapTooltip>
        )}
        {isQueued && sub.claimedByUserName && (
          <span className="text-[11px] italic text-muted-foreground">claimed by {sub.claimedByUserName}</span>
        )}
        {sub.status === "in_progress" && (
          <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
        )}
        {sub.screenshotUrl && (
          <WrapTooltip content="Sandbox dry-run screenshot available.">
            <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5 bg-purple-50 text-purple-700 border-purple-300">
              <FlaskConical className="h-2.5 w-2.5 mr-1" />sandbox verified
            </Badge>
          </WrapTooltip>
        )}
      </div>

      <span className="text-xs text-muted-foreground truncate max-w-[180px] hidden md:inline-flex items-center gap-1.5" title={sub.issueType || ""}>
        {sub.issueType === "Direct Email" ? (
          <WrapTooltip content="This dispute is sent as a direct email (bypasses the MAS portal).">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-medium leading-none">
              <Mail className="h-2.5 w-2.5" />
              Email
            </span>
          </WrapTooltip>
        ) : sub.issueType ? (
          <WrapTooltip content={`Filed via the MAS portal as: ${sub.issueType}`}>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-medium leading-none">
              <Globe className="h-2.5 w-2.5" />
              Portal
            </span>
          </WrapTooltip>
        ) : null}
        <span className="truncate">{sub.issueType || "—"}</span>
      </span>
      <span className="text-sm font-medium font-mono min-w-[64px] text-right">{formatCurrency(sub.claimAmount || "0")}</span>
      <span className="text-[11px] text-muted-foreground min-w-[56px] text-right">{timeAgo(sub.createdAt)}</span>

      {/* Task #738. "Last checked" column — always rendered so the
          column lines up across rows; "—" empty state for rows that
          have never been scraped (synthetic / no-ticket submissions).
          Outcome-coloured for scraped rows so operators can spot
          fresh replies / scrape errors without opening the drawer.
          Sortable from the header strip's "Sort by" control. */}
      <span
        className="text-[11px] min-w-[88px] text-right hidden md:inline-flex items-center justify-end gap-1 flex-shrink-0"
        data-testid={`row-last-checked-${sub.id}`}
      >
        {sub.lastScrapedAt ? (
          <WrapTooltip content={
            sub.lastScrapeOutcome === "error" && sub.lastScrapeError
              ? `Last scrape error: ${sub.lastScrapeError}`
              : `Last portal scrape · ${sub.lastScrapeOutcome ?? "unknown"} · ${absoluteTooltip(sub.lastScrapedAt)}`
          }>
            <span
              className={`cursor-help inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
                sub.lastScrapeOutcome === "new_reply"
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-300"
                  : sub.lastScrapeOutcome === "error"
                    ? "bg-rose-50 text-rose-700 border border-rose-300"
                    : "bg-stone-50 text-stone-700 border border-stone-300"
              }`}
            >
              <RefreshCw className="h-2.5 w-2.5" />
              {timeAgo(sub.lastScrapedAt)}
            </span>
          </WrapTooltip>
        ) : (
          <span className="text-muted-foreground" title="This submission has never been scraped.">—</span>
        )}
      </span>

      {sub.status === "draft" && (
        <div onClick={e => e.stopPropagation()} className="flex items-center gap-1">
          <WrapTooltip content={discardArmed
            ? "Click again within a few seconds to confirm. The underlying invoice group is unchanged."
            : "Removes this draft from the queue. The underlying invoice group is unchanged."}>
            <Button
              variant={discardArmed ? "destructive" : "ghost"}
              size="sm"
              className={discardArmed
                ? "h-7 px-2 text-xs"
                : "h-7 px-2 text-xs text-muted-foreground hover:text-destructive"}
              onClick={onDiscardClick}
              data-testid={`button-discard-draft-${sub.id}`}
              data-armed={discardArmed ? "true" : "false"}
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              {discardArmed ? "Confirm discard" : "Discard"}
            </Button>
          </WrapTooltip>
          {discardArmed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-1.5 text-xs text-muted-foreground"
              onClick={() => setDiscardArm(null)}
              data-testid={`button-discard-draft-cancel-${sub.id}`}
            >
              Cancel
            </Button>
          )}
        </div>
      )}

      <div onClick={e => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`row-menu-${sub.id}`}>
              <MoreVertical className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={onOpen}>
              <Eye className="h-3.5 w-3.5" /> Open details
            </DropdownMenuItem>
            {canSandbox && (
              <DropdownMenuItem onSelect={onSandbox} disabled={buttonsDisabled}>
                <FlaskConical className="h-3.5 w-3.5" /> {sub.screenshotUrl ? "Re-run sandbox" : "Run sandbox"}
              </DropdownMenuItem>
            )}
            {canRetry && (
              <DropdownMenuItem onSelect={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </DropdownMenuItem>
            )}
            {(canSandbox || canRetry) && canCancel && <DropdownMenuSeparator />}
            {canCancel && (
              <DropdownMenuItem onSelect={onCancel} className="text-destructive focus:text-destructive">
                <XCircle className="h-3.5 w-3.5" /> {sub.status === "draft" ? "Discard draft" : "Cancel submission"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// =====================================================================
// Recent runs card (right rail)
// =====================================================================
function RecentRunsCard({ runs, loading, isAdmin }: { runs: BatchRunHistoryEntry[] | null; loading: boolean; isAdmin: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? (runs ?? []) : (runs ?? []).slice(0, 6);
  const hasMore = (runs?.length ?? 0) > 6;
  return (
    <div id="recent-runs" className="rounded-md border bg-card overflow-hidden scroll-mt-4" data-testid="recent-runs-panel">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" /> Recent runs
          <span className="text-xs font-normal text-muted-foreground">{isAdmin ? "all" : "yours"}</span>
        </div>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>
      {runs === null && !loading ? (
        <p className="text-xs text-muted-foreground p-4">Could not load recent runs.</p>
      ) : !runs || runs.length === 0 ? (
        <p className="text-xs text-muted-foreground p-4">No batch runs yet.</p>
      ) : (
        <div>
          {visible.map(run => {
            const style = runStatusStyles[run.status] ?? { label: run.status, badgeClass: "bg-gray-100 text-gray-700 border-gray-300" };
            return (
              <div key={run.batchId} className="px-4 py-2.5 border-b last:border-b-0 flex items-start gap-2" data-testid={`run-row-${run.batchId}`}>
                <Badge variant="outline" className={`${style.badgeClass} text-[10px] flex-shrink-0`} data-testid={`run-status-${run.batchId}`}>
                  {style.label}
                </Badge>
                <div className="flex-1 min-w-0 text-xs">
                  <div className="truncate">
                    <span className="font-mono">{run.processed}/{run.total}</span>
                    {run.succeeded > 0 && <span className="text-green-700 ml-1.5">✓ {run.succeeded}</span>}
                    {run.failed > 0 && <span className="text-red-700 ml-1.5">✗ {run.failed}</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate" data-testid={`run-meta-${run.batchId}`}>
                    {timeAgo(run.startedAt)} · {run.triggeredBy}
                    {run.status === "aborted" && run.stoppedBy && (
                      <span data-testid={`run-stopped-by-${run.batchId}`}> · stopped by {run.stoppedBy}</span>
                    )}
                  </div>
                  {run.status === "failed" && run.errorMessage && (
                    <div className="text-[11px] text-red-600 mt-0.5 break-words">{run.errorMessage}</div>
                  )}
                </div>
              </div>
            );
          })}
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="w-full px-4 py-2 text-xs text-primary hover:bg-accent/40 border-t font-medium text-left flex items-center gap-1"
              data-testid="button-recent-runs-toggle"
            >
              {expanded ? "Show fewer" : `See all (${runs?.length})`} <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Completed-job toast strip (auto-dismisses)
// =====================================================================
function CompletedJobStrip({ job, onDismiss }: { job: BatchJob; onDismiss: () => void }) {
  const Icon = job.status === "completed" ? CheckCircle : job.status === "aborted" ? Ban : AlertTriangle;
  const wrapClass = job.status === "completed"
    ? "border-green-300 bg-green-50/60 dark:bg-green-950/20"
    : job.status === "aborted"
      ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20"
      : "border-red-300 bg-red-50/60 dark:bg-red-950/20";
  const iconColor = job.status === "completed" ? "text-green-600" : job.status === "aborted" ? "text-amber-600" : "text-red-600";

  return (
    <Card className={`border ${wrapClass}`}>
      <CardContent className="py-3 px-4 flex items-center gap-3">
        <Icon className={`h-4 w-4 flex-shrink-0 ${iconColor}`} />
        <div className="flex-1 text-sm min-w-0">
          <span className="font-semibold">
            Batch {job.status === "completed" ? "complete" : job.status === "aborted" ? "stopped" : "failed"} — {job.succeeded}/{job.total} succeeded
          </span>
          {job.failed > 0 && <span className="text-red-600 ml-2">{job.failed} failed</span>}
          <span className="text-muted-foreground ml-2 text-xs">
            by {job.triggeredBy}{job.abortRequestedBy ? ` · stopped by ${job.abortRequestedBy}` : ""}
          </span>
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onDismiss}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
