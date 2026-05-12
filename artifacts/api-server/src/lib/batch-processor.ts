import { eq, and, or, isNull, isNotNull, lte, inArray, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, botActivityLogTable, claimsTable, notesTable, appSettingsTable, portalBatchRunsTable } from "@workspace/db";
import { logger } from "./logger";
import { broadcastPresenceEvent, broadcastBatchEvent } from "./sse";
import { ObjectStorageService } from "./objectStorage";
import { transitionGroupStatus } from "./group-transitions";
import { invoiceGroupsTable } from "@workspace/db";
import { scheduleRetryOrFail } from "./submission-retry";
import { createWorkerGate } from "./worker-gate";
import { portalBrowserGate } from "./portal-browser-gate";
import { primaryClaimIdForGroup } from "./group-claims";

function resolveGps(value: string, issueType: string): string {
  if (["Yes", "No", "Unknown"].includes(value)) return value;
  const isGps = issueType === "GPS Control Deviation";
  return isGps ? "Yes" : "";
}

async function getPortalDefaults() {
  const rows = await db.select().from(appSettingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value || "";
  return {
    providerName: map["portal_provider_name"] || "",
    contactEmail: map["portal_contact_email"] || "",
    contactPhone: map["portal_contact_phone"] || "",
    defaultGpsBreadcrumbs: map["portal_default_gps_breadcrumbs"] || "",
  };
}

export interface BatchJob {
  id: string;
  status: "running" | "completed" | "failed" | "aborted";
  submissionIds: number[];
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  results: { submissionId: number; status: "success" | "failed" | "skipped"; message: string }[];
  startedAt: string;
  completedAt?: string;
  triggeredBy: string;
  /** Email of the user who triggered this run (for per-user history filtering). */
  triggeredByEmail?: string | null;
  /** Display name of the user who requested an abort, set once requestBatchAbort succeeds. */
  abortRequestedBy?: string;
}

// ---------------------------------------------------------------------------
// Batch run history (DB-backed)
// ---------------------------------------------------------------------------
// Every batch run inserts a row in `portal_batch_runs` at start and updates it
// at terminal transition (completed/failed/aborted). Persisted so the Portal
// Submissions page can show a "Recent runs" panel that survives restarts and
// long after the in-memory `activeBatches` entry has been GC'd.

async function recordBatchRunStarted(job: BatchJob): Promise<void> {
  try {
    await db.insert(portalBatchRunsTable).values({
      batchId: job.id,
      status: "running",
      total: job.total,
      processed: 0,
      succeeded: 0,
      failed: 0,
      triggeredBy: job.triggeredBy,
      triggeredByEmail: job.triggeredByEmail ?? null,
      startedAt: new Date(job.startedAt),
    }).onConflictDoNothing({ target: portalBatchRunsTable.batchId });
  } catch (err) {
    logger.error({ err, batchId: job.id }, "Failed to record batch run start");
  }
}

async function recordBatchRunFinished(
  job: BatchJob,
  extras: { stoppedBy?: string | null; errorMessage?: string | null } = {},
): Promise<void> {
  try {
    await db.update(portalBatchRunsTable).set({
      status: job.status,
      total: job.total,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      completedAt: job.completedAt ? new Date(job.completedAt) : new Date(),
      stoppedBy: extras.stoppedBy ?? job.abortRequestedBy ?? null,
      errorMessage: extras.errorMessage ?? null,
    }).where(eq(portalBatchRunsTable.batchId, job.id));
  } catch (err) {
    logger.error({ err, batchId: job.id }, "Failed to record batch run completion");
  }
}

const activeBatches = new Map<string, BatchJob>();

// In-memory cancellation flags for in-flight batches. Keyed by batchId; the
// processSequentially loop polls this set between rows and exits cleanly when
// it finds its own ID. The set is cleared after the abort path runs so a
// subsequent batch with a different ID is never accidentally pre-aborted.
const abortedBatches = new Set<string>();

export type RequestBatchAbortResult =
  | { ok: true; job: BatchJob }
  | { ok: false; reason: "not_found" | "not_running" | "not_owner" };

/**
 * Flip the cancellation flag for a running batch so the worker loop exits
 * between rows. The caller must be the user who triggered the run, or an
 * admin. Returns a discriminated result so the route layer can map each
 * failure to a specific HTTP status.
 *
 * Note: the abort cannot interrupt a row that is already mid-Playwright —
 * the worker checks this flag at the top of each iteration, so the current
 * row will finish (success or failure) before the loop exits and broadcasts
 * `batch_aborted`.
 */
export function requestBatchAbort(
  batchId: string,
  requester: { displayName: string; isAdmin: boolean },
): RequestBatchAbortResult {
  const job = activeBatches.get(batchId);
  if (!job) return { ok: false, reason: "not_found" };
  if (job.status !== "running") return { ok: false, reason: "not_running" };
  const isOwner = !!requester.displayName && job.triggeredBy === requester.displayName;
  if (!isOwner && !requester.isAdmin) return { ok: false, reason: "not_owner" };
  job.abortRequestedBy = requester.displayName || (requester.isAdmin ? "Admin" : job.triggeredBy);
  abortedBatches.add(batchId);
  return { ok: true, job };
}

/** Pure predicate for tests / external callers. */
export function isBatchAbortRequested(batchId: string): boolean {
  return abortedBatches.has(batchId);
}

export function getBatchJob(batchId: string): BatchJob | undefined {
  return activeBatches.get(batchId);
}

export function listBatchJobs(): BatchJob[] {
  return Array.from(activeBatches.values()).sort((a, b) =>
    new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
}

/**
 * The currently-running batch job, if any. Used by the /active-batch
 * endpoint so a client loading the page mid-run can hydrate its UI without
 * waiting for the next SSE event.
 */
export function getActiveBatchJob(): BatchJob | undefined {
  for (const job of activeBatches.values()) {
    if (job.status === "running") return job;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// On-demand worker tracking
// ---------------------------------------------------------------------------
// The portal worker is now triggered on demand (cron, admin batch, submission
// queueing, retry sweeper) instead of polling continuously. We keep one
// at-a-time invariant via the in-process gate below so two triggers in close
// succession don't fight for the same Playwright browser.

export interface WorkerRunSummary {
  batchId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "failed" | "aborted";
  total: number;
  succeeded: number;
  failed: number;
  triggeredBy: string;
  lastError: string | null;
}

// Shared singleton — imported here AND from `lib/portal-response-sync.ts`
// so the read bot (Task #725) and the submit bot take turns on the same
// Chromium process and never collide on `bot-session/state.json`.
const workerGate = portalBrowserGate;
let lastWorkerRun: WorkerRunSummary | null = null;
const recentWorkerRuns: WorkerRunSummary[] = [];
const MAX_RECENT_RUNS = 30;

export function isWorkerRunInProgress(): boolean {
  return workerGate.isInProgress();
}

export function getLastWorkerRun(): WorkerRunSummary | null {
  return lastWorkerRun;
}

export function getRecentWorkerRuns(): WorkerRunSummary[] {
  return [...recentWorkerRuns];
}

function snapshotRun(job: BatchJob, lastError: string | null): WorkerRunSummary {
  return {
    batchId: job.id,
    startedAt: job.startedAt,
    finishedAt: job.completedAt ?? null,
    status: job.status,
    total: job.total,
    succeeded: job.succeeded,
    failed: job.failed,
    triggeredBy: job.triggeredBy,
    lastError,
  };
}

export type TriggerWorkerOutcome =
  | { kind: "started"; job: BatchJob; awaited: "completed" | "timeout" | "not_awaited" }
  | { kind: "skipped"; reason: "already_running" | "no_pending" };

/**
 * Trigger an on-demand worker run. Each call launches a fresh Playwright browser
 * via runBatchWorker, processes pending submissions sequentially, then tears down.
 * If a run is already in progress, returns { kind: "skipped" } so callers can
 * coalesce.
 *
 * `awaitCompletion: true` blocks until the run finishes (used by crons so the
 * cron-run row reflects the worker outcome).
 *
 * `awaitTimeoutMs` (only honored when awaitCompletion is true) bounds the wait.
 * If the worker has not finished within the budget the function returns with
 * `awaited: "timeout"` and the run continues in the background — the cron lane
 * is freed so the next sweep doesn't pile up behind a hung Playwright. The
 * stuck-running rollup logic (2x interval grace) will surface the orphaned
 * "running" cron row if the worker never returns.
 */
export async function triggerWorkerRun(opts: {
  triggeredBy: string;
  /** Email of the triggering user; persisted to batch run history so non-admins can see their own runs. */
  triggeredByEmail?: string | null;
  awaitCompletion?: boolean;
  awaitTimeoutMs?: number;
  /**
   * Optional explicit ID list. When omitted (or "all"), the worker processes
   * the entire pending+due queue. When provided, only those rows are
   * considered (still filtered to pending + due inside startBatchJob).
   */
  submissionIds?: number[] | "all";
}): Promise<TriggerWorkerOutcome> {
  if (workerGate.isInProgress()) {
    return { kind: "skipped", reason: "already_running" };
  }

  // Two-phase pattern: phase 1 (synchronous-ish) claims the queue and either
  // returns the job or throws "no pending"; phase 2 (the long Playwright run)
  // happens inside the gate and is awaited only when caller asks. We need
  // phase 1 to complete *before* we return from this function so callers see
  // a real job (or a "no_pending" skip), not a half-claimed run.
  const ctx: { job: BatchJob | null; err: Error | null } = { job: null, err: null };

  // We capture phase 1 completion via an explicit signal so the outer
  // function can return as soon as the queue is claimed (or "no_pending"
  // is decided), without waiting for the long Playwright run.
  const phase1Resolver: { resolve: () => void } = { resolve: () => undefined };
  const phase1Promise = new Promise<void>((resolve) => {
    phase1Resolver.resolve = resolve;
  });

  const gateOutcome = await workerGate.run(async () => {
    let job: BatchJob;
    try {
      job = await startBatchJob(opts.submissionIds ?? "all", opts.triggeredBy, opts.triggeredByEmail ?? null);
      ctx.job = job;
    } catch (err) {
      ctx.err = err instanceof Error ? err : new Error(String(err));
      phase1Resolver.resolve();
      throw err;
    }
    phase1Resolver.resolve();

    await waitForJob(job);
    const lastFailure = job.results.filter(r => r.status === "failed").slice(-1)[0]?.message ?? null;
    const summary = snapshotRun(job, lastFailure);
    lastWorkerRun = summary;
    recentWorkerRuns.unshift(summary);
    if (recentWorkerRuns.length > MAX_RECENT_RUNS) recentWorkerRuns.length = MAX_RECENT_RUNS;
  });

  if (gateOutcome.kind === "skipped") {
    // Race: someone else grabbed the gate between our pre-check and run().
    return { kind: "skipped", reason: "already_running" };
  }

  // Suppress unhandled rejection on the phase-2 promise; we surface errors
  // via lastWorkerRun.lastError instead.
  gateOutcome.result.catch((err) => {
    if (ctx.err && /no pending submissions/i.test(ctx.err.message)) return;
    logger.error({ err }, "triggerWorkerRun: worker run failed");
  });

  // Wait for phase 1 to settle so we can report no_pending vs started.
  await phase1Promise;

  if (ctx.err) {
    if (/no pending submissions/i.test(ctx.err.message)) {
      return { kind: "skipped", reason: "no_pending" };
    }
    throw ctx.err;
  }

  let awaited: "completed" | "timeout" | "not_awaited" = "not_awaited";
  if (opts.awaitCompletion) {
    if (opts.awaitTimeoutMs && opts.awaitTimeoutMs > 0) {
      // Race the worker against the watchdog; whichever wins decides whether
      // we were able to report the per-item outcome to the caller.
      const watchdog = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), opts.awaitTimeoutMs).unref();
      });
      const winner = await Promise.race([
        gateOutcome.result.then(() => "completed" as const).catch(() => "completed" as const),
        watchdog,
      ]);
      awaited = winner;
    } else {
      await gateOutcome.result.catch(() => undefined);
      awaited = "completed";
    }
  }

  return { kind: "started", job: ctx.job!, awaited };
}

async function waitForJob(job: BatchJob): Promise<void> {
  // Poll the in-memory job state. The batch processor mutates job.status when
  // it finishes; we just await transitions out of "running".
  while (job.status === "running") {
    await new Promise(r => setTimeout(r, 250));
  }
}

/**
 * Pure helper: turn a finished BatchJob into a cron-run severity + message.
 *
 * Severity rules (matters for the rollup banner — see system-health-rollup):
 *  - "throw"     → cron run recorded as "failed" (hard alert).
 *      Fired when (a) processSequentially itself errored out
 *      (`job.status === "failed"`) — even if no per-item failures were
 *      recorded — or (b) the entire processed queue failed
 *      (`succeeded === 0 && failed > 0`).
 *  - "degraded"  → some items failed but others succeeded; the queue moved
 *      forward, but staff still need to look at the failures.
 *  - "ok"        → all items succeeded (or the run had nothing to process).
 *
 * Without rule (a), a fatal error before any item is processed would leave
 * succeeded=0 + failed=0 and we'd silently report "ok", hiding the outage.
 */
export function jobToCronOutcome(
  job: { status: string; total: number; succeeded: number; failed: number },
  message: string,
): { kind: "throw"; message: string } | { kind: "result"; status: "ok" | "degraded"; message: string } {
  // Rule (a): processSequentially blew up — always a hard failure.
  if (job.status === "failed") return { kind: "throw", message };
  // Rule (a'): a user-initiated abort during a cron-triggered run is also a
  // hard failure — the cron didn't get to do its job.
  if (job.status === "aborted") return { kind: "throw", message };
  // Rule (b): all attempted items failed.
  if (job.total > 0 && job.succeeded === 0 && job.failed > 0) return { kind: "throw", message };
  const status: "ok" | "degraded" = job.failed > 0 ? "degraded" : "ok";
  return { kind: "result", status, message };
}

/**
 * Pure predicate: a `pending` submission is eligible for processing when it
 * has no scheduled retry, or its scheduled retry time is in the past.
 *
 * Exported so the eligibility rule has a single source of truth that we can
 * unit-test independently of Drizzle / the live DB.
 */
export function isSubmissionDue(
  row: { status: string; nextRetryAt: Date | null },
  now: Date,
): boolean {
  if (row.status !== "pending") return false;
  if (row.nextRetryAt === null) return true;
  return row.nextRetryAt.getTime() <= now.getTime();
}

/**
 * Pure predicate: a pending submission is overdue when it has *missed* its
 * expected batch cycle. The sweeper only fires at fixed scheduled times
 * (e.g. 8:00, 11:00, 14:00, 18:00 ET), so a row that's been waiting since
 * 8:20 for the next 11:00 sweep is *not* overdue — the system is behaving
 * exactly as designed. The row only becomes overdue once the next
 * scheduled sweep that should have picked it up has already fired (plus a
 * small grace window for the sweep to actually run and complete).
 *
 * Inputs:
 * - `row.createdAt` / `row.nextRetryAt` — when the row became eligible.
 * - `lastDueSweep` — the most recent expected sweeper fire whose firing
 *   was at least the configured grace period before "now". Computed by
 *   `getLastDueSweep(...)` in `lib/cron-schedule.ts` so all callers agree
 *   on the cycle definition. Pass `null` when no past sweep has had time
 *   to run yet (server brand-new) — in that case nothing is overdue.
 * - `sweepActuallyRan` — true when the most recent recorded
 *   `portal_batch_sweeper` cron run started at or after `lastDueSweep`.
 *   When the sweeper itself didn't fire, the cron-tile rollup already
 *   flags it; we deliberately don't double-count by also flagging rows on
 *   the worker tile.
 *
 * The function stays pure so it's trivially unit-testable; the caller is
 * responsible for resolving the schedule-derived inputs.
 */
export function isSubmissionOverdue(
  row: { status: string; nextRetryAt: Date | null; createdAt: Date },
  lastDueSweep: Date | null,
  sweepActuallyRan: boolean,
): boolean {
  if (row.status !== "pending") return false;
  if (lastDueSweep === null) return false;
  if (!sweepActuallyRan) return false;
  // The row is "ready" at max(createdAt, nextRetryAt ?? createdAt). A
  // retry scheduled for the future means the system is intentionally
  // holding the row; it can't be overdue until that ready time is in the
  // past. We take the max with createdAt so a (rare) nextRetryAt that
  // somehow predates createdAt — backfills, clock corrections — never
  // makes a freshly-created row look overdue retroactively.
  const candidate = row.nextRetryAt ?? row.createdAt;
  const readyAt = candidate.getTime() > row.createdAt.getTime() ? candidate : row.createdAt;
  // The row is overdue iff the relevant sweep landed STRICTLY AFTER the
  // ready time. A row created exactly at the sweep timestamp could have
  // been picked up by that sweep, but we don't punish it on the
  // boundary — the next cycle owns it.
  return readyAt.getTime() < lastDueSweep.getTime();
}

export async function startBatchJob(
  submissionIds: number[] | "all",
  triggeredBy: string,
  triggeredByEmail: string | null = null,
): Promise<BatchJob> {
  let ids: number[];

  // Only claim rows that are pending AND due. If next_retry_at is in the
  // future, the row is on backoff (set by submission-retry.ts) and must be
  // skipped — otherwise frequent triggers (create/confirm/retry + sweeper +
  // midnight) would defeat the backoff schedule and bombard the portal.
  // The DB filter here is the canonical claim; isSubmissionDue() above is
  // the same rule expressed in code so it can be unit-tested. The same
  // filter applies to explicit ID lists ("Process Selected") so a stale
  // selection can never bypass backoff or pull in non-pending rows.
  const now = new Date();
  const dueClause = and(
    eq(portalSubmissionsTable.status, "pending"),
    or(
      isNull(portalSubmissionsTable.nextRetryAt),
      lte(portalSubmissionsTable.nextRetryAt, now),
    ),
  );

  if (submissionIds === "all") {
    const pending = await db.select({ id: portalSubmissionsTable.id })
      .from(portalSubmissionsTable)
      .where(dueClause);
    ids = pending.map(s => s.id);
  } else {
    if (submissionIds.length === 0) {
      throw new Error("No pending submissions to process");
    }
    const pending = await db.select({ id: portalSubmissionsTable.id })
      .from(portalSubmissionsTable)
      .where(and(
        inArray(portalSubmissionsTable.id, submissionIds),
        dueClause,
      ));
    ids = pending.map(s => s.id);
  }

  if (ids.length === 0) {
    throw new Error("No pending submissions to process");
  }

  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const job: BatchJob = {
    id: batchId,
    status: "running",
    submissionIds: ids,
    total: ids.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    results: [],
    startedAt: new Date().toISOString(),
    triggeredBy,
    triggeredByEmail,
  };

  activeBatches.set(batchId, job);

  // Persist a "running" row to history immediately so the Recent Runs panel
  // sees the run while it's in flight (and so we have somewhere to UPDATE
  // when it finishes, even if the process restarts mid-run).
  await recordBatchRunStarted(job);

  // Mark every selected row as Queued under the triggering user so other
  // viewers of the Portal Submissions page see the row as locked to this
  // batch immediately (still status='pending' until the worker picks it up).
  // We narrow the WHERE to status='pending' to avoid clobbering any row
  // whose status raced ahead between the SELECT above and this UPDATE.
  await db.update(portalSubmissionsTable).set({
    claimedByBatchId: batchId,
    claimedByUserName: triggeredBy,
    claimedAt: new Date(),
  }).where(and(
    inArray(portalSubmissionsTable.id, ids),
    eq(portalSubmissionsTable.status, "pending"),
  ));

  broadcastBatchEvent({
    type: "batch_started",
    batchId,
    triggeredBy,
    startedAt: job.startedAt,
    total: job.total,
    submissionIds: ids,
  });
  for (const subId of ids) {
    broadcastBatchEvent({
      type: "row_status_changed",
      batchId,
      submissionId: subId,
      newStatus: "queued",
    });
  }

  processSequentially(job).catch(err => {
    logger.error({ err, batchId }, "Batch processing fatal error");
    const errMsg = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.completedAt = new Date().toISOString();
    void releaseClaimedRows(batchId).catch((releaseErr) => {
      logger.error({ err: releaseErr, batchId }, "Failed to release claimed rows after fatal error");
    });
    void recordBatchRunFinished(job, { errorMessage: errMsg });
    broadcastBatchEvent({
      type: "batch_failed",
      batchId,
      completedAt: job.completedAt,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      total: job.total,
      message: errMsg,
    });
  });

  return job;
}

/**
 * Clear `claimed_by_batch_id` from any rows still attributed to this batch.
 * Called when a run completes / fails / aborts so rows that never made it to
 * `in_progress` revert to plain Pending and can be picked up by the next run.
 * Returns the IDs that were released so we can broadcast `row_status_changed`
 * for each one.
 */
async function releaseClaimedRows(batchId: string): Promise<number[]> {
  const released = await db.update(portalSubmissionsTable).set({
    claimedByBatchId: null,
    claimedByUserName: null,
    claimedAt: null,
  }).where(eq(portalSubmissionsTable.claimedByBatchId, batchId))
    .returning({ id: portalSubmissionsTable.id, status: portalSubmissionsTable.status });

  for (const row of released) {
    // Only broadcast as "pending" for rows that are actually back in pending;
    // rows that already moved to in_progress / submitted / failed have their
    // own row_status_changed broadcasts from the worker loop.
    if (row.status === "pending") {
      broadcastBatchEvent({
        type: "row_status_changed",
        batchId,
        submissionId: row.id,
        newStatus: "pending",
      });
    }
  }
  return released.map((r) => r.id);
}

/**
 * Boot-time cleanup for the persisted batch run history. Any row still marked
 * "running" in `portal_batch_runs` belonged to a prior process whose
 * in-memory job is gone, so it can never transition cleanly to completed.
 * Mark it as "failed" with a server-restart note so the Recent Runs panel
 * surfaces the outage instead of showing a stuck "Running" entry forever.
 */
export async function markOrphanedRunningBatchesAsFailed(): Promise<number> {
  const cleared = await db.update(portalBatchRunsTable).set({
    status: "failed",
    completedAt: new Date(),
    errorMessage: "Server restarted while batch was in flight",
  }).where(eq(portalBatchRunsTable.status, "running"))
    .returning({ batchId: portalBatchRunsTable.batchId });
  if (cleared.length > 0) {
    logger.info({ count: cleared.length, batchIds: cleared.map((r) => r.batchId) }, "Boot cleanup: marked orphaned running batch runs as failed");
  }
  return cleared.length;
}

export interface BatchRunHistoryEntry {
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

/**
 * List the most recent batch runs from history. Admins see every run; regular
 * users only see runs they triggered (matched by triggered_by_email — display
 * names are not unique, but emails are).
 */
export async function listBatchRunHistory(opts: {
  filterByEmail?: string | null;
  limit?: number;
}): Promise<BatchRunHistoryEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const baseQuery = db.select().from(portalBatchRunsTable);
  const rows = opts.filterByEmail
    ? await baseQuery
        .where(eq(portalBatchRunsTable.triggeredByEmail, opts.filterByEmail))
        .orderBy(desc(portalBatchRunsTable.id))
        .limit(limit)
    : await baseQuery
        .orderBy(desc(portalBatchRunsTable.id))
        .limit(limit);
  return rows.map((r) => ({
    batchId: r.batchId,
    status: r.status,
    total: r.total,
    processed: r.processed,
    succeeded: r.succeeded,
    failed: r.failed,
    triggeredBy: r.triggeredBy,
    triggeredByEmail: r.triggeredByEmail,
    stoppedBy: r.stoppedBy,
    errorMessage: r.errorMessage,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  }));
}

/**
 * Boot-time cleanup: any `claimed_by_batch_id` set in the DB is from a prior
 * process whose in-memory batch state is gone, so the rows are effectively
 * orphaned. Clear the claim so they appear as plain Pending again. Called
 * once on server start.
 */
export async function clearOrphanedBatchClaims(): Promise<number> {
  const cleared = await db.update(portalSubmissionsTable).set({
    claimedByBatchId: null,
    claimedByUserName: null,
    claimedAt: null,
  }).where(isNotNull(portalSubmissionsTable.claimedByBatchId))
    .returning({ id: portalSubmissionsTable.id });
  if (cleared.length > 0) {
    logger.info({ count: cleared.length, ids: cleared.map((r) => r.id) }, "Boot cleanup: cleared orphaned batch claims");
  }
  return cleared.length;
}

async function processSequentially(job: BatchJob): Promise<void> {
  logger.info({ batchId: job.id, total: job.total }, "Starting batch processing");

  for (const subId of job.submissionIds) {
    // User-initiated abort: check between rows so the current Playwright run
    // (if any) finishes cleanly before we exit. The abort path below handles
    // releasing remaining claimed rows and broadcasting batch_aborted.
    if (abortedBatches.has(job.id)) {
      logger.info({ batchId: job.id, processed: job.processed, total: job.total }, "Batch abort requested — exiting worker loop");
      break;
    }
    let subClaimId: number | null = null;
    try {
      const [sub] = await db.select().from(portalSubmissionsTable)
        .where(and(
          eq(portalSubmissionsTable.id, subId),
          eq(portalSubmissionsTable.status, "pending"),
        ));

      if (!sub) {
        job.results.push({ submissionId: subId, status: "skipped", message: "Not pending or not found" });
        job.processed++;
        continue;
      }
      subClaimId = await primaryClaimIdForGroup(sub.invoiceGroupId);

      await db.update(portalSubmissionsTable).set({
        status: "in_progress",
        attempts: (sub.attempts || 0) + 1,
        // Clear the queue claim — the row is now actively being worked on, so
        // the In-Progress treatment kicks in for everyone, not the Queued one.
        claimedByBatchId: null,
        claimedByUserName: null,
        claimedAt: null,
      }).where(eq(portalSubmissionsTable.id, subId));

      broadcastBatchEvent({
        type: "row_status_changed",
        batchId: job.id,
        submissionId: subId,
        newStatus: "in_progress",
      });

      await db.insert(botActivityLogTable).values({
        submissionId: subId,
        botInstanceId: null,
        action: "batch_claimed",
        success: true,
        message: `Claimed by batch job ${job.id} (triggered by ${job.triggeredBy})`,
      });

      if (subClaimId) {
        broadcastPresenceEvent({
          type: "bot_started",
          resourceType: "claim", resourceId: subClaimId,
          userName: "Batch Processor",
          userEmail: null,
          botProcess: "portal_submission",
          timestamp: new Date().toISOString(),
        });
      }

      await processViaExternalBot(sub, job.id);

      if (subClaimId) {
        broadcastPresenceEvent({
          type: "bot_completed",
          resourceType: "claim", resourceId: subClaimId,
          userName: "Batch Processor",
          userEmail: null,
          botProcess: "portal_submission",
          timestamp: new Date().toISOString(),
        });
      }

      broadcastBatchEvent({
        type: "row_status_changed",
        batchId: job.id,
        submissionId: subId,
        newStatus: "submitted",
      });

      job.results.push({ submissionId: subId, status: "success", message: "Processed successfully" });
      job.succeeded++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, submissionId: subId, batchId: job.id }, "Batch submission processing failed");

      const retryResult = await scheduleRetryOrFail({
        submissionId: subId,
        errorMessage: errMsg,
        source: `batch_processor:${job.id}`,
        userName: "Batch Processor",
      }).catch((helperErr) => {
        logger.error({ err: helperErr, submissionId: subId }, "scheduleRetryOrFail threw — falling back to direct status='failed' write");
        return null;
      });

      // Last-resort fallback: if the helper threw, the row would otherwise
      // stay stuck in `in_progress`. Force it to `failed` so the next
      // batch / stuck-reset sweep doesn't ignore it. The fallback write
      // is best-effort and never throws out of the catch block.
      if (!retryResult) {
        try {
          await db.update(portalSubmissionsTable).set({
            status: "failed",
            errorMessage: errMsg,
            nextRetryAt: null,
          }).where(eq(portalSubmissionsTable.id, subId));
        } catch (fallbackErr) {
          logger.error({ err: fallbackErr, submissionId: subId }, "Fallback status='failed' write also failed — submission may be left in in_progress");
        }
      }

      await db.insert(botActivityLogTable).values({
        submissionId: subId,
        botInstanceId: null,
        action: "batch_failed",
        success: false,
        message: retryResult?.outcome === "retry_scheduled"
          ? `${errMsg} (retry ${retryResult.attempts + 1}/${retryResult.maxAttempts} scheduled for ${retryResult.nextRetryAt!.toISOString()})`
          : retryResult?.outcome === "retries_exhausted"
            ? `${errMsg} (retries exhausted after ${retryResult.attempts}/${retryResult.maxAttempts})`
            : `${errMsg} (retry helper failed; row force-marked failed)`,
      }).catch(() => {});

      if (subClaimId) {
        broadcastPresenceEvent({
          type: "bot_completed",
          resourceType: "claim", resourceId: subClaimId,
          userName: "Batch Processor",
          userEmail: null,
          botProcess: "portal_submission",
          timestamp: new Date().toISOString(),
        });
      }

      // The retry helper may have rescheduled (status='pending' with
      // next_retry_at) or exhausted retries (status='failed'). Either way the
      // row is no longer in_progress, so emit a row_status_changed so other
      // viewers update their badges.
      broadcastBatchEvent({
        type: "row_status_changed",
        batchId: job.id,
        submissionId: subId,
        newStatus: retryResult?.outcome === "retry_scheduled" ? "pending" : "failed",
      });

      job.results.push({ submissionId: subId, status: "failed", message: errMsg });
      job.failed++;
    }

    job.processed++;

    broadcastBatchEvent({
      type: "batch_progress",
      batchId: job.id,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      total: job.total,
    });
  }

  // Release any rows that were claimed but never reached in_progress (e.g.
  // status raced ahead between SELECT and UPDATE, row was deleted, or the
  // run was aborted before the row was picked up). This is the normal
  // happy-path cleanup; the fatal-error path also calls it.
  await releaseClaimedRows(job.id).catch((err) => {
    logger.error({ err, batchId: job.id }, "Failed to release claimed rows on completion");
  });

  // If the loop exited because of an abort request, broadcast batch_aborted
  // and skip the regular batch_completed event so the in-progress card on
  // every connected client clears with the right reason.
  if (abortedBatches.has(job.id)) {
    abortedBatches.delete(job.id);
    job.status = "aborted";
    job.completedAt = new Date().toISOString();
    const message = job.abortRequestedBy
      ? `Stopped by ${job.abortRequestedBy}`
      : "Stopped by user";
    logger.info({
      batchId: job.id,
      processed: job.processed,
      total: job.total,
      abortRequestedBy: job.abortRequestedBy,
    }, "Batch processing aborted by user");
    await recordBatchRunFinished(job, { stoppedBy: job.abortRequestedBy ?? null });
    broadcastBatchEvent({
      type: "batch_aborted",
      batchId: job.id,
      completedAt: job.completedAt,
      processed: job.processed,
      succeeded: job.succeeded,
      failed: job.failed,
      total: job.total,
      message,
    });
    // .unref() so this 24h cleanup timer never blocks process shutdown
    // (graceful exits, tests). Losing the cleanup on early exit is fine
    // because the in-memory map dies with the process anyway.
    setTimeout(() => activeBatches.delete(job.id), 24 * 60 * 60 * 1000).unref();
    return;
  }

  job.status = "completed";
  job.completedAt = new Date().toISOString();
  logger.info({
    batchId: job.id,
    total: job.total,
    succeeded: job.succeeded,
    failed: job.failed,
  }, "Batch processing completed");

  await recordBatchRunFinished(job);

  broadcastBatchEvent({
    type: "batch_completed",
    batchId: job.id,
    completedAt: job.completedAt,
    processed: job.processed,
    succeeded: job.succeeded,
    failed: job.failed,
    total: job.total,
  });

  // .unref() so this 24h cleanup timer never blocks process shutdown
  // (graceful exits, tests). Losing the cleanup on early exit is fine
  // because the in-memory map dies with the process anyway.
  setTimeout(() => activeBatches.delete(job.id), 24 * 60 * 60 * 1000).unref();
}

// Test seam. When set, processViaExternalBot uses this function instead of
// dynamically importing runBatchWorker. Production code never sets this;
// only the runtime integration tests in __tests__/ assign it (via
// __setBatchWorkerForTests) so they can drive the batch loop without
// launching real Playwright. Cleared via __setBatchWorkerForTests(null).
let __batchWorkerOverride:
  | typeof import("../bot/batch-worker").runBatchWorker
  | null = null;
export function __setBatchWorkerForTests(
  fn: typeof __batchWorkerOverride,
): void {
  __batchWorkerOverride = fn;
}

async function processDirectEmail(
  sub: typeof portalSubmissionsTable.$inferSelect,
  defaults: Awaited<ReturnType<typeof getPortalDefaults>>,
  batchId?: string | null,
): Promise<void> {
  const { sendDirectEmailDispute } = await import("./direct-email-dispatch");

  // Recipient comes from app_settings — read fresh each call so admin
  // changes take effect immediately on the next run.
  const settingsRows = await db.select().from(appSettingsTable);
  const settingsMap: Record<string, string> = {};
  for (const r of settingsRows) settingsMap[r.key] = r.value || "";
  const recipientTo = settingsMap["direct_email_recipient"] || "";
  const recipientCc = settingsMap["direct_email_cc"] || "";

  const attachmentUrls = (sub.attachmentUrls ?? []).filter((u): u is string => typeof u === "string");

  const subject = sub.subject
    || `Dispute - Invoice #${sub.invoiceNumber || "N/A"} - ${sub.errorTypeName || "Claim Correction"}`;

  logger.info(
    { submissionId: sub.id, attachmentCount: attachmentUrls.length, recipientTo: recipientTo || "(unset)" },
    "processDirectEmail: dispatching",
  );

  const subClaimId = await primaryClaimIdForGroup(sub.invoiceGroupId);
  const result = await sendDirectEmailDispute(
    {
      id: sub.id,
      confNumber: sub.confNumber || "",
      subject,
      descriptionHtml: sub.descriptionHtml || "",
      attachmentUrls,
      claimId: subClaimId,
      invoiceGroupId: sub.invoiceGroupId,
    },
    { to: recipientTo, cc: recipientCc },
    {
      providerName: defaults.providerName,
      contactEmail: defaults.contactEmail,
      contactPhone: defaults.contactPhone,
    },
  );

  // Mark submitted. Reuse `portalTicketId` to store the Outlook messageId so
  // the existing UI (which surfaces ticketId on the row) shows a meaningful
  // reference for email-path submissions too. `submittedInBatchId` is set
  // here (and not cleared later) so sibling rows on the same invoice group
  // can show "Already submitted in run #N" pills.
  await db.update(portalSubmissionsTable).set({
    status: "submitted",
    portalTicketId: result.messageId,
    submittedAt: new Date().toISOString(),
    submittedInBatchId: batchId ?? null,
    // Clear any leftover error from a previous failed attempt so the row
    // does not keep showing a stale red error pill after success.
    errorMessage: null,
  }).where(eq(portalSubmissionsTable.id, sub.id));

  const submittedAtIso = new Date().toISOString();
  const reason = `Direct email dispute sent successfully${result.messageId ? ` - Message ID: ${result.messageId}` : ""}`;
  await transitionGroupStatus({
    groupId: sub.invoiceGroupId,
    newStatus: "Awaiting Response",
    source: "batch_processor",
    reason,
    actor: { userEmail: null, userName: "Batch Processor" },
    systemOverride: true,
    extraFields: {
      disputeEmailSent: true,
      disputeEmailSentAt: submittedAtIso,
    },
    // Wave D-PR5: this is the Direct-Email submission path — every
    // disputed child leg gets its `submitted_via='email'` stamp so
    // the deriver promotes the parent group to phase=`submitted`.
    childFields: { submittedVia: "email" },
  });

  await db.insert(botActivityLogTable).values({
    submissionId: sub.id,
    botInstanceId: null,
    action: "submission_complete",
    success: true,
    message: `Direct email sent successfully. Message ID: ${result.messageId || "N/A"}, attachments: ${result.attachmentCount}`,
  });

  logger.info(
    { submissionId: sub.id, messageId: result.messageId, attachmentCount: result.attachmentCount },
    "processDirectEmail: completed successfully",
  );
}

/**
 * Resolve the disputed legs for a group submission as the worker expects them.
 *
 * Source-of-truth ordering:
 *   1. `sub.legs` JSONB recorded at draft time (post-Task #485 rows). We
 *      use the recorded `legId`s to look up the matching `claims` rows so
 *      the worker still gets fresh per-leg metadata.
 *   2. Fallback for legacy rows where `legs == []` (pre-Task #485): use
 *      every claim on the invoice group. The worker is happy as long as
 *      *some* legs are passed in.
 *
 * The submission row's flat snapshot fields (`confNumber`, `serviceDate`,
 * etc.) are comma-joined for display only — they are NOT a per-leg source
 * and must not be used to synthesize a single fake leg.
 */
async function loadWorkerLegsForSubmission(
  sub: typeof portalSubmissionsTable.$inferSelect,
  defaults: { defaultGpsBreadcrumbs: string },
  issueType: string,
): Promise<import("../bot/batch-worker").GroupPortalSubmissionLeg[]> {
  const recordedLegIds = (sub.legs ?? [])
    .map((l) => l.legId)
    .filter((id): id is number => typeof id === "number");

  let claims: (typeof claimsTable.$inferSelect)[] = [];
  if (recordedLegIds.length > 0) {
    claims = await db.select().from(claimsTable)
      .where(inArray(claimsTable.id, recordedLegIds));
    // Preserve recorded order so the worker tickbox sequence matches what
    // the operator approved at draft time.
    const byId = new Map(claims.map((c) => [c.id, c]));
    claims = recordedLegIds
      .map((id) => byId.get(id))
      .filter((c): c is typeof claimsTable.$inferSelect => !!c);
  } else {
    // Legacy row — fall back to every claim on the group.
    claims = await db.select().from(claimsTable)
      .where(eq(claimsTable.invoiceGroupId, sub.invoiceGroupId))
      .orderBy(claimsTable.id);
  }

  return claims.map((c) => ({
    id: c.id,
    confNumber: c.confNumber || "",
    serviceDate: c.date ? String(c.date) : "",
    refNumber: c.refNumber || "",
    carNumber: c.carNumber || "",
    claimAmount: c.claimAmount ?? null,
    errorTypeName: c.errorTypeName || sub.errorTypeName || "",
    errorDetails: c.errorDetails || sub.errorDetails || "",
    issueType,
    gpsBreadcrumbsAvailable: resolveGps(sub.gpsBreadcrumbsAvailable || defaults.defaultGpsBreadcrumbs, issueType),
  }));
}

async function processViaExternalBot(
  sub: typeof portalSubmissionsTable.$inferSelect,
  batchId?: string | null,
): Promise<void> {
  const defaults = await getPortalDefaults();
  const issueType = sub.issueType || "Other Issue or Question";

  // Direct-email path: bypass Playwright entirely. The dispatcher downloads
  // attachments from object storage, sends via Outlook, and we mirror the
  // same DB updates / status transitions that the portal path does on
  // success so the rest of the system (drawer, history, group transitions)
  // is path-agnostic.
  if (issueType === "Direct Email") {
    await processDirectEmail(sub, defaults, batchId);
    return;
  }

  const runBatchWorker = __batchWorkerOverride
    ?? (await import("../bot/batch-worker")).runBatchWorker;

  // Task #485: this row IS the group submission. Build a multi-leg
  // GroupPortalSubmission from the real claim rows — `sub.legs` (JSONB)
  // recorded which legs were eligible at draft time; we look them up in
  // `claims` to get the per-leg fields the worker needs. Legacy rows with
  // an empty `legs` JSONB fall back to "all claims on the group" so the
  // worker still has something to tick.
  const workerLegs = await loadWorkerLegsForSubmission(sub, defaults, issueType);

  const workerSub: import("../bot/batch-worker").GroupPortalSubmission = {
    groupId: sub.invoiceGroupId,
    invoiceNumber: sub.invoiceNumber || "",
    clientNumber: sub.clientNumber || "",
    requesterEmail: sub.requesterEmail || defaults.contactEmail,
    transportationProviderName: sub.transportationProviderName || defaults.providerName,
    phoneNumber: sub.phoneNumber || defaults.contactPhone,
    subject: sub.subject || `Dispute - Invoice #${sub.invoiceNumber || "N/A"} - ${sub.errorTypeName || "Claim Correction"}`,
    descriptionHtml: sub.descriptionHtml || "",
    disputeReason: sub.disputeReason || "",
    evidenceNotes: sub.evidenceNotes || "",
    attachmentUrls: (sub.attachmentUrls ?? []).filter((u): u is string => typeof u === "string"),
    legs: workerLegs,
  };

  logger.info({ submissionId: sub.id, groupId: sub.invoiceGroupId, issueType, legCount: workerSub.legs.length, attachmentCount: workerSub.attachmentUrls.length }, "processViaExternalBot: resolved submission data");

  const dryRun = process.env.BOT_DRY_RUN === "true";
  const result = await runBatchWorker(workerSub, dryRun);

  // Persist per-leg outcomes (legId, confNumber, ticked, error) onto the
  // group submission's `legs` JSONB so the drawer can render the per-leg
  // breakdown. If any leg failed (`ticked: false`) we still surface it as
  // a submission-level failure so the existing retry path runs — partial
  // success is captured in JSONB for forensic review either way.
  const persistedLegs = workerSub.legs.map((leg) => {
    const r = result.perLeg.find((p) => p.legId === leg.id);
    return {
      legId: leg.id,
      confNumber: leg.confNumber || null,
      ticked: r?.ticked ?? false,
      error: r?.error ?? null,
    };
  });
  const failedLegs = persistedLegs.filter((l) => !l.ticked);
  if (failedLegs.length > 0) {
    await db.update(portalSubmissionsTable).set({ legs: persistedLegs })
      .where(eq(portalSubmissionsTable.id, sub.id));
    const summary = failedLegs.map((l) => `leg ${l.legId}${l.error ? `: ${l.error}` : ""}`).join("; ");
    throw new Error(`Worker reported ${failedLegs.length}/${persistedLegs.length} leg${failedLegs.length === 1 ? "" : "s"} not ticked — ${summary}`);
  }

  if (dryRun) {
    await db.update(portalSubmissionsTable).set({
      status: "dry_run",
      legs: persistedLegs,
    }).where(eq(portalSubmissionsTable.id, sub.id));

    await db.insert(botActivityLogTable).values({
      submissionId: sub.id,
      botInstanceId: null,
      action: "dry_run_complete",
      success: true,
      message: `Dry run screenshot saved: ${result.screenshotPath}`,
    });
  } else {
    await db.update(portalSubmissionsTable).set({
      status: "submitted",
      portalTicketId: result.ticketId || null,
      submittedAt: new Date().toISOString(),
      // Persist the originating batch run so other rows on the same invoice
      // group can render an "Already submitted in run #N" pill. Set once on
      // the pending → submitted transition; never cleared.
      submittedInBatchId: batchId ?? null,
      // Clear any leftover error from a previous failed attempt so the row
      // does not keep showing a stale red error pill after success.
      errorMessage: null,
      legs: persistedLegs,
    }).where(eq(portalSubmissionsTable.id, sub.id));

    const submittedAtIso = new Date().toISOString();
    await transitionGroupStatus({
      groupId: sub.invoiceGroupId,
      newStatus: "Awaiting Response",
      source: "batch_processor",
      reason: `Portal ticket submitted successfully${result.ticketId ? ` - Ticket ID: ${result.ticketId}` : ""}`,
      actor: { userEmail: null, userName: "Batch Processor" },
      systemOverride: true,
      extraFields: {
        disputeEmailSent: true,
        disputeEmailSentAt: submittedAtIso,
      },
      // Wave D-PR5: external-bot portal submission path — stamp
      // `submitted_via='portal'` on every disputed child leg so the
      // deriver promotes the parent group to phase=`submitted`.
      childFields: { submittedVia: "portal" },
    });

    await db.insert(botActivityLogTable).values({
      submissionId: sub.id,
      botInstanceId: null,
      action: "submission_complete",
      success: true,
      message: `Submitted successfully. Ticket: ${result.ticketId || "N/A"}`,
    });
  }

  logger.info({ submissionId: sub.id, ticketId: result.ticketId, dryRun }, "Batch worker completed successfully");
}

export async function runSandboxForSubmission(subId: number): Promise<typeof portalSubmissionsTable.$inferSelect> {
  const [sub] = await db.select().from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.id, subId));

  if (!sub) throw new Error("Submission not found");

  const allowedStatuses = ["draft", "pending", "failed", "dry_run"];
  if (!allowedStatuses.includes(sub.status)) {
    throw new Error(`Cannot sandbox-run a submission in "${sub.status}" status`);
  }

  const previousStatus = sub.status;

  await db.update(portalSubmissionsTable).set({
    status: "in_progress",
    attempts: (sub.attempts || 0) + 1,
  }).where(eq(portalSubmissionsTable.id, subId));

  broadcastPresenceEvent({
    type: "bot_started",
    resourceType: "invoice_group", resourceId: sub.invoiceGroupId,
    userName: "Sandbox Runner",
    userEmail: null,
    botProcess: "portal_sandbox",
    timestamp: new Date().toISOString(),
  });

  try {
    const { runBatchWorker } = await import("../bot/batch-worker");
    const defaults = await getPortalDefaults();

    const issueType = sub.issueType || "Other Issue or Question";

    // Sandbox runs use the same multi-leg shape as production so the
    // sandboxed Playwright session matches the real submission path.
    const workerLegs = await loadWorkerLegsForSubmission(sub, defaults, issueType);
    const workerSub: import("../bot/batch-worker").GroupPortalSubmission = {
      groupId: sub.invoiceGroupId,
      invoiceNumber: sub.invoiceNumber || "",
      clientNumber: sub.clientNumber || "",
      requesterEmail: sub.requesterEmail || defaults.contactEmail,
      transportationProviderName: sub.transportationProviderName || defaults.providerName,
      phoneNumber: sub.phoneNumber || defaults.contactPhone,
      subject: sub.subject || `Dispute - Invoice #${sub.invoiceNumber || "N/A"} - ${sub.errorTypeName || "Claim Correction"}`,
      descriptionHtml: sub.descriptionHtml || "",
      disputeReason: sub.disputeReason || "",
      evidenceNotes: sub.evidenceNotes || "",
      attachmentUrls: (sub.attachmentUrls ?? []).filter((u): u is string => typeof u === "string"),
      legs: workerLegs,
    };

    logger.info({ submissionId: sub.id, groupId: sub.invoiceGroupId, issueType, legCount: workerSub.legs.length, attachmentCount: workerSub.attachmentUrls.length }, "runSandboxForSubmission: resolved submission data");

    const result = await runBatchWorker(workerSub, true);
    const failedLegs = workerSub.legs
      .map((leg) => ({ leg, r: result.perLeg.find((p) => p.legId === leg.id) }))
      .filter((x) => x.r && !x.r.ticked);
    if (failedLegs.length > 0) {
      const summary = failedLegs.map((x) => `leg ${x.leg.id}${x.r?.error ? `: ${x.r.error}` : ""}`).join("; ");
      throw new Error(`Worker reported ${failedLegs.length}/${workerSub.legs.length} leg${failedLegs.length === 1 ? "" : "s"} not ticked — ${summary}`);
    }

    let screenshotUrl: string | null = null;
    if (result.screenshotPath) {
      try {
        const storage = new ObjectStorageService();
        screenshotUrl = await storage.uploadLocalFile(result.screenshotPath, "image/png");
        const fs = await import("fs");
        try { fs.unlinkSync(result.screenshotPath); } catch {}
      } catch (uploadErr) {
        logger.warn({ err: uploadErr, submissionId: subId }, "Failed to upload sandbox screenshot to object storage");
      }
    }

    const [updated] = await db.update(portalSubmissionsTable).set({
      status: "dry_run",
      screenshotUrl,
      submittedAt: new Date().toISOString(),
      errorMessage: null,
    }).where(eq(portalSubmissionsTable.id, subId)).returning();

    await db.insert(botActivityLogTable).values({
      submissionId: subId,
      botInstanceId: null,
      action: "sandbox_run_complete",
      success: true,
      message: `Sandbox dry run completed${screenshotUrl ? " — screenshot saved" : ""}`,
      screenshotPath: screenshotUrl || result.screenshotPath || null,
    });

    broadcastPresenceEvent({
      type: "bot_completed",
      resourceType: "invoice_group", resourceId: sub.invoiceGroupId,
      userName: "Sandbox Runner",
      userEmail: null,
      botProcess: "portal_sandbox",
      timestamp: new Date().toISOString(),
    });

    return updated;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, submissionId: subId }, "Sandbox run failed");

    let updated: typeof portalSubmissionsTable.$inferSelect;
    let activityMessage = errMsg;

    if (previousStatus === "dry_run") {
      // Sandbox-only re-run from a prior dry_run; do not consume retry budget.
      [updated] = await db.update(portalSubmissionsTable).set({
        status: "dry_run",
        errorMessage: `Sandbox run failed: ${errMsg}`,
      }).where(eq(portalSubmissionsTable.id, subId)).returning();
    } else {
      const retryResult = await scheduleRetryOrFail({
        submissionId: subId,
        errorMessage: `Sandbox run failed: ${errMsg}`,
        source: "sandbox_runner",
        userName: "Sandbox Runner",
      }).catch((helperErr) => {
        logger.error({ err: helperErr, submissionId: subId }, "scheduleRetryOrFail threw in sandbox runner");
        return null;
      });

      if (retryResult?.updated) {
        updated = retryResult.updated;
        activityMessage = retryResult.outcome === "retry_scheduled"
          ? `${errMsg} (retry ${retryResult.attempts + 1}/${retryResult.maxAttempts} scheduled for ${retryResult.nextRetryAt!.toISOString()})`
          : `${errMsg} (retries exhausted after ${retryResult.attempts}/${retryResult.maxAttempts})`;
      } else {
        // Helper failed — fall back to direct status write so we never leave the row in_progress.
        [updated] = await db.update(portalSubmissionsTable).set({
          status: "failed",
          errorMessage: `Sandbox run failed: ${errMsg}`,
        }).where(eq(portalSubmissionsTable.id, subId)).returning();
      }
    }

    await db.insert(botActivityLogTable).values({
      submissionId: subId,
      botInstanceId: null,
      action: "sandbox_run_failed",
      success: false,
      message: activityMessage,
    });

    broadcastPresenceEvent({
      type: "bot_completed",
      resourceType: "invoice_group", resourceId: sub.invoiceGroupId,
      userName: "Sandbox Runner",
      userEmail: null,
      botProcess: "portal_sandbox",
      timestamp: new Date().toISOString(),
    });

    return updated;
  }
}
