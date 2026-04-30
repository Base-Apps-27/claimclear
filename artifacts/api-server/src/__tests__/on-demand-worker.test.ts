import { test } from "node:test";
import { strict as assert } from "node:assert";

import { createWorkerGate } from "../lib/worker-gate";
import { computeRollup, type CronRunRow, type KnownCronJob, type WorkerSnapshot } from "../lib/system-health-rollup";
import { isSubmissionDue, isSubmissionOverdue, jobToCronOutcome } from "../lib/batch-processor";
import { requestBatchAbort, isBatchAbortRequested } from "../lib/batch-processor";

test("workerGate.run lets the first call through and skips concurrent calls", async () => {
  const gate = createWorkerGate<string>();

  let release!: (v: string) => void;
  const blockedFn = () => new Promise<string>((resolve) => { release = resolve; });

  const first = await gate.run(blockedFn);
  assert.equal(first.kind, "started");
  assert.equal(gate.isInProgress(), true);

  const second = await gate.run(async () => "should not run");
  assert.equal(second.kind, "skipped");
  if (second.kind === "skipped") {
    assert.equal(second.reason, "already_running");
  }

  release("done");
  if (first.kind === "started") await first.result;
  assert.equal(gate.isInProgress(), false);

  const third = await gate.run(async () => "ok");
  assert.equal(third.kind, "started");
  if (third.kind === "started") await third.result;
});

test("workerGate.run with timeout: caller can race the result with a watchdog", async () => {
  const gate = createWorkerGate<void>();
  let release!: () => void;
  const longRun = () => new Promise<void>((resolve) => { release = resolve; });

  const outcome = await gate.run(longRun);
  assert.equal(outcome.kind, "started");

  const winner = await Promise.race([
    outcome.kind === "started" ? outcome.result.then(() => "completed" as const) : Promise.resolve("err" as const),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 30)),
  ]);
  assert.equal(winner, "timeout");
  assert.equal(gate.isInProgress(), true);

  const second = await gate.run(async () => undefined);
  assert.equal(second.kind, "skipped");

  release();
  if (outcome.kind === "started") await outcome.result;
  assert.equal(gate.isInProgress(), false);
});

test("workerGate releases even when the run throws", async () => {
  const gate = createWorkerGate<void>();
  const outcome = await gate.run(async () => {
    throw new Error("boom");
  });
  assert.equal(outcome.kind, "started");
  if (outcome.kind === "started") {
    await assert.rejects(outcome.result, /boom/);
  }
  assert.equal(gate.isInProgress(), false, "gate must release even on throw — otherwise the worker would jam after a single failure");

  // Confirm the next run can start
  const next = await gate.run(async () => undefined);
  assert.equal(next.kind, "started");
  if (next.kind === "started") await next.result;
});

// ---------------------------------------------------------------------------
// Rollup severity matrix
// ---------------------------------------------------------------------------

const NOW = new Date("2026-04-28T17:00:00.000Z");
// Default boot time for tests: a day before NOW. Plenty of time for any
// scheduled fire to have landed, so the new boot-aware tolerances don't
// accidentally suppress what the existing severity matrix is exercising.
const BOOT = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

function workerOk(): WorkerSnapshot {
  return {
    status: "completed",
    finishedAt: NOW.toISOString(),
    startedAt: NOW.toISOString(),
    batchId: "batch_test",
    lastError: null,
  };
}

function knownJob(
  name: string,
  prevExpected: Date | null = null,
  expectedFiresSinceBoot: Date[] = [],
): KnownCronJob {
  return { name, prevExpected, expectedFiresSinceBoot };
}

function lastRunMap(rows: CronRunRow[]): Map<string, CronRunRow> {
  const m = new Map<string, CronRunRow>();
  for (const r of rows) if (!m.has(r.jobName)) m.set(r.jobName, r);
  return m;
}

test("rollup: all-green inputs → overall ok", () => {
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [{ connectorName: "outlook", status: "healthy", lastError: null }],
    knownJobs: [knownJob("portal_batch_sweeper", new Date(NOW.getTime() - 60 * 60 * 1000))],
    lastRunByJob: lastRunMap([
      { jobName: "portal_batch_sweeper", startedAt: new Date(NOW.getTime() - 30 * 60 * 1000), status: "ok", message: "done" },
    ]),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  assert.equal(out.overall, "ok", `expected overall=ok, got ${out.overall}: ${JSON.stringify(out.components)}`);
});

test("rollup: degraded cron status from DB propagates to overall=degraded", () => {
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [knownJob("portal_batch_sweeper", new Date(NOW.getTime() - 5 * 60 * 1000))],
    lastRunByJob: lastRunMap([
      { jobName: "portal_batch_sweeper", startedAt: new Date(NOW.getTime() - 60 * 1000), status: "degraded", message: "1 failed of 3" },
    ]),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  assert.equal(out.overall, "degraded");
  const sweeper = out.components.find((c) => c.name === "cron:portal_batch_sweeper");
  assert.ok(sweeper);
  assert.equal(sweeper!.status, "degraded");
});

test("rollup: failed cron run → overall=failed (hard alert wins over partial)", () => {
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [knownJob("daily_brief", new Date(NOW.getTime() - 24 * 60 * 60 * 1000))],
    lastRunByJob: lastRunMap([
      { jobName: "daily_brief", startedAt: new Date(NOW.getTime() - 60 * 60 * 1000), status: "failed", message: "outlook 5xx" },
    ]),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  assert.equal(out.overall, "failed");
});

test("rollup: a 'running' cron row past 2x its interval is flagged as stuck", () => {
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [knownJob("portal_batch_sweeper", new Date(NOW.getTime() - 5 * 60 * 1000))],
    lastRunByJob: lastRunMap([
      { jobName: "portal_batch_sweeper", startedAt: new Date(NOW.getTime() - 30 * 60 * 1000), status: "running", message: null },
    ]),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const sweeper = out.components.find((c) => c.name === "cron:portal_batch_sweeper");
  assert.ok(sweeper);
  assert.equal(sweeper!.status, "degraded");
  assert.match(sweeper!.detail ?? "", /still "running"/);
  assert.equal(out.overall, "degraded");
});

test("rollup: a 'running' cron within the grace window stays ok", () => {
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [knownJob("portal_batch_sweeper", new Date(NOW.getTime() - 5 * 60 * 1000))],
    lastRunByJob: lastRunMap([
      { jobName: "portal_batch_sweeper", startedAt: new Date(NOW.getTime() - 60 * 1000), status: "running", message: null },
    ]),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const sweeper = out.components.find((c) => c.name === "cron:portal_batch_sweeper");
  assert.equal(sweeper!.status, "ok");
});

test("rollup: multiple consecutive missed scheduled fires → degraded with miss count", () => {
  const lastRun = new Date(NOW.getTime() - 30 * 60 * 1000);
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [knownJob(
      "portal_batch_sweeper",
      new Date(NOW.getTime() - 5 * 60 * 1000),
      [
        new Date(NOW.getTime() - 25 * 60 * 1000),
        new Date(NOW.getTime() - 15 * 60 * 1000),
        new Date(NOW.getTime() - 5 * 60 * 1000),
      ],
    )],
    lastRunByJob: lastRunMap([
      { jobName: "portal_batch_sweeper", startedAt: lastRun, status: "ok", message: "done" },
    ]),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const sweeper = out.components.find((c) => c.name === "cron:portal_batch_sweeper");
  assert.equal(sweeper!.status, "degraded");
  assert.match(sweeper!.detail ?? "", /older than previous expected/);
  assert.match(sweeper!.detail ?? "", /missed 3 consecutive/);
});

test("rollup: overdueCount > 0 escalates the portal_worker component to degraded", () => {
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [],
    lastRunByJob: new Map(),
    overdueCount: 3,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const worker = out.components.find((c) => c.name === "portal_worker");
  assert.ok(worker);
  assert.equal(worker!.status, "degraded");
  assert.match(worker!.detail ?? "", /3 pending submission\(s\) overdue/);
  assert.equal(out.overall, "degraded");
});

test("rollup: lastWorkerRun status='failed' surfaces lastError as the worker detail", () => {
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [],
    lastRunByJob: new Map(),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: {
      status: "failed",
      finishedAt: NOW.toISOString(),
      startedAt: NOW.toISOString(),
      batchId: "batch_x",
      lastError: "Playwright login timeout",
    },
  });
  const worker = out.components.find((c) => c.name === "portal_worker");
  assert.equal(worker!.status, "degraded");
  assert.equal(worker!.detail, "Playwright login timeout");
});

test("rollup: connector unhealthy → component=failed → overall=failed", () => {
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [{ connectorName: "outlook", status: "unhealthy", lastError: "401 from /me" }],
    knownJobs: [],
    lastRunByJob: new Map(),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const conn = out.components.find((c) => c.name === "connector:outlook");
  assert.equal(conn!.status, "failed");
  assert.equal(out.overall, "failed");
});

test("isSubmissionDue: pending row with no next_retry_at is due", () => {
  assert.equal(isSubmissionDue({ status: "pending", nextRetryAt: null }, NOW), true);
});

test("isSubmissionDue: pending row whose next_retry_at is in the past is due", () => {
  assert.equal(
    isSubmissionDue({ status: "pending", nextRetryAt: new Date(NOW.getTime() - 60_000) }, NOW),
    true,
  );
});

test("isSubmissionDue: pending row whose next_retry_at is in the future is not due", () => {
  assert.equal(
    isSubmissionDue({ status: "pending", nextRetryAt: new Date(NOW.getTime() + 5 * 60_000) }, NOW),
    false,
  );
});

test("isSubmissionDue: non-pending statuses are never claimed", () => {
  for (const status of ["in_progress", "completed", "failed", "cancelled"]) {
    assert.equal(isSubmissionDue({ status, nextRetryAt: null }, NOW), false);
    assert.equal(
      isSubmissionDue({ status, nextRetryAt: new Date(NOW.getTime() - 10_000) }, NOW),
      false,
    );
  }
});

const OVERDUE_CUTOFF = new Date(NOW.getTime() - 15 * 60 * 1000);

test("isSubmissionOverdue: fresh row (nextRetryAt=null, createdAt=NOW) is not overdue", () => {
  assert.equal(
    isSubmissionOverdue(
      { status: "pending", nextRetryAt: null, createdAt: NOW },
      OVERDUE_CUTOFF,
    ),
    false,
  );
});

test("isSubmissionOverdue: unscheduled row older than the cutoff is overdue", () => {
  assert.equal(
    isSubmissionOverdue(
      { status: "pending", nextRetryAt: null, createdAt: new Date(NOW.getTime() - 20 * 60 * 1000) },
      OVERDUE_CUTOFF,
    ),
    true,
  );
});

test("isSubmissionOverdue: future nextRetryAt is not overdue regardless of row age", () => {
  assert.equal(
    isSubmissionOverdue(
      {
        status: "pending",
        nextRetryAt: new Date(NOW.getTime() + 5 * 60 * 1000),
        createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      },
      OVERDUE_CUTOFF,
    ),
    false,
  );
});

test("isSubmissionOverdue: nextRetryAt past the cutoff is overdue", () => {
  assert.equal(
    isSubmissionOverdue(
      {
        status: "pending",
        nextRetryAt: new Date(NOW.getTime() - 30 * 60 * 1000),
        createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      },
      OVERDUE_CUTOFF,
    ),
    true,
  );
});

test("isSubmissionOverdue: nextRetryAt within the cutoff window is not overdue", () => {
  assert.equal(
    isSubmissionOverdue(
      {
        status: "pending",
        nextRetryAt: new Date(NOW.getTime() - 5 * 60 * 1000),
        createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      },
      OVERDUE_CUTOFF,
    ),
    false,
  );
});

test("isSubmissionOverdue: non-pending statuses are never overdue", () => {
  for (const status of ["in_progress", "submitted", "failed", "cancelled"]) {
    assert.equal(
      isSubmissionOverdue(
        { status, nextRetryAt: null, createdAt: new Date(NOW.getTime() - 60 * 60 * 1000) },
        OVERDUE_CUTOFF,
      ),
      false,
    );
  }
});

test("jobToCronOutcome: all-succeeded job → result/ok", () => {
  const out = jobToCronOutcome(
    { status: "completed", total: 3, succeeded: 3, failed: 0 },
    "msg",
  );
  assert.equal(out.kind, "result");
  if (out.kind === "result") assert.equal(out.status, "ok");
});

test("jobToCronOutcome: partial failure → result/degraded (not a hard alert every 5min)", () => {
  const out = jobToCronOutcome(
    { status: "completed", total: 3, succeeded: 2, failed: 1 },
    "msg",
  );
  assert.equal(out.kind, "result");
  if (out.kind === "result") assert.equal(out.status, "degraded");
});

test("jobToCronOutcome: every item failed → throw (worker/portal outage)", () => {
  const out = jobToCronOutcome(
    { status: "completed", total: 2, succeeded: 0, failed: 2 },
    "msg",
  );
  assert.equal(out.kind, "throw");
});

test("jobToCronOutcome: job.status='failed' with zero counters → throw", () => {
  const out = jobToCronOutcome(
    { status: "failed", total: 5, succeeded: 0, failed: 0 },
    "fatal",
  );
  assert.equal(out.kind, "throw");
});

test("jobToCronOutcome: job.status='failed' with mixed counters → throw", () => {
  const out = jobToCronOutcome(
    { status: "failed", total: 4, succeeded: 2, failed: 1 },
    "fatal",
  );
  assert.equal(out.kind, "throw");
});

test("jobToCronOutcome: empty job (total=0) → result/ok (idempotent no-op trigger)", () => {
  const out = jobToCronOutcome(
    { status: "completed", total: 0, succeeded: 0, failed: 0 },
    "noop",
  );
  assert.equal(out.kind, "result");
  if (out.kind === "result") assert.equal(out.status, "ok");
});

test("isSubmissionDue: row whose next_retry_at equals exactly now is due (boundary)", () => {
  assert.equal(
    isSubmissionDue({ status: "pending", nextRetryAt: new Date(NOW.getTime()) }, NOW),
    true,
  );
});

// ---------------------------------------------------------------------------
// Batch abort
// ---------------------------------------------------------------------------

test("requestBatchAbort: unknown batch ID → not_found", () => {
  const result = requestBatchAbort("does-not-exist", { displayName: "Alice", isAdmin: false });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "not_found");
  assert.equal(isBatchAbortRequested("does-not-exist"), false, "no flag should be set when the batch isn't found");
});

test("jobToCronOutcome: job.status='aborted' → throw (cron run with manual stop is a hard alert)", () => {
  const out = jobToCronOutcome(
    { status: "aborted", total: 5, succeeded: 1, failed: 0 },
    "Stopped by Admin",
  );
  assert.equal(out.kind, "throw");
  if (out.kind === "throw") assert.match(out.message, /Stopped/);
});

test("rollup: lastWorkerRun status='aborted' surfaces stop in worker detail and degrades the component", () => {
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [],
    lastRunByJob: new Map(),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: {
      status: "aborted",
      finishedAt: NOW.toISOString(),
      startedAt: NOW.toISOString(),
      batchId: "batch_stopped",
      lastError: null,
    },
  });
  const worker = out.components.find((c) => c.name === "portal_worker");
  assert.equal(worker!.status, "degraded");
  assert.match(worker!.detail ?? "", /stopped by user/);
});

test("rollup: a known cron with zero recorded runs but server up long enough → degraded with explicit message", () => {
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [knownJob(
      "portal_batch_sweeper",
      null,
      [
        new Date(NOW.getTime() - 6 * 60 * 60 * 1000),
        new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
      ],
    )],
    lastRunByJob: new Map(),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const cron = out.components.find((c) => c.name === "cron:portal_batch_sweeper");
  assert.equal(cron!.status, "degraded");
  assert.match(cron!.detail ?? "", /No runs recorded/);
});

// ---------------------------------------------------------------------------
// New: boot-aware tolerances for transient blips
// ---------------------------------------------------------------------------

test("rollup: server just booted with no runs yet → cron is ok with 'awaiting first run' note", () => {
  // Boot was 30 seconds ago — too new for any scheduled fire to have landed.
  const recentBoot = new Date(NOW.getTime() - 30 * 1000);
  const out = computeRollup({
    now: NOW,
    bootTime: recentBoot,
    connectors: [],
    knownJobs: [knownJob("daily_brief", null, [])],
    lastRunByJob: new Map(),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const cron = out.components.find((c) => c.name === "cron:daily_brief");
  assert.equal(cron!.status, "ok", `expected ok, got ${cron!.status}: ${cron!.detail}`);
  assert.match(cron!.detail ?? "", /Awaiting first scheduled run/);
  assert.equal(cron!.informational, true, "expected informational flag set on awaiting-first-run note");
  assert.equal(out.overall, "ok");
});

test("rollup: one missed scheduled tick → ok with 'recovering' note (transient blip)", () => {
  const lastRun = new Date(NOW.getTime() - 45 * 60 * 1000);
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [knownJob(
      "response_tracker",
      new Date(NOW.getTime() - 5 * 60 * 1000),
      // Only one expected fire landed since lastRun + tolerance.
      [new Date(NOW.getTime() - 15 * 60 * 1000)],
    )],
    lastRunByJob: lastRunMap([
      { jobName: "response_tracker", startedAt: lastRun, status: "ok", message: "0 checked" },
    ]),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const cron = out.components.find((c) => c.name === "cron:response_tracker");
  assert.equal(cron!.status, "ok", `expected ok, got ${cron!.status}: ${cron!.detail}`);
  assert.match(cron!.detail ?? "", /Skipped one scheduled tick/);
  assert.equal(cron!.informational, true, "expected informational flag set on single-skip note");
  assert.equal(out.overall, "ok");
});

test("rollup: long uptime + persistent recent misses still degrades (no false 'ok' from windowing)", () => {
  // Boot was 60 days ago — long enough that the route-level enumeration
  // window slides off the boot. The rollup should still flip to degraded
  // when it's given recent missed fires after the last successful run.
  const ancientBoot = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000);
  const lastRun = new Date(NOW.getTime() - 90 * 60 * 1000);
  const recentMisses = [
    new Date(NOW.getTime() - 75 * 60 * 1000),
    new Date(NOW.getTime() - 60 * 60 * 1000),
    new Date(NOW.getTime() - 45 * 60 * 1000),
    new Date(NOW.getTime() - 30 * 60 * 1000),
    new Date(NOW.getTime() - 15 * 60 * 1000),
  ];
  const out = computeRollup({
    now: NOW,
    bootTime: ancientBoot,
    connectors: [],
    knownJobs: [knownJob(
      "outlook_heartbeat",
      new Date(NOW.getTime() - 5 * 60 * 1000),
      recentMisses,
    )],
    lastRunByJob: lastRunMap([
      { jobName: "outlook_heartbeat", startedAt: lastRun, status: "ok", message: "0 checked" },
    ]),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const cron = out.components.find((c) => c.name === "cron:outlook_heartbeat");
  assert.equal(cron!.status, "degraded", `expected degraded for persistent misses, got ${cron!.status}: ${cron!.detail}`);
  assert.match(cron!.detail ?? "", /missed \d+ consecutive scheduled fires/);
  assert.equal(out.overall, "degraded");
});

test("rollup: missed ticks all fall before server boot → cron stays ok (no blame for downtime)", () => {
  // Server booted 2 minutes ago. The "missed" expected fires are all from
  // before the boot, so they shouldn't count against the job.
  const recentBoot = new Date(NOW.getTime() - 2 * 60 * 1000);
  const lastRun = new Date(NOW.getTime() - 6 * 60 * 60 * 1000);
  const out = computeRollup({
    now: NOW,
    bootTime: recentBoot,
    connectors: [],
    knownJobs: [knownJob(
      "response_tracker",
      new Date(NOW.getTime() - 5 * 60 * 1000),
      // No expected fires since boot — too soon.
      [],
    )],
    lastRunByJob: lastRunMap([
      { jobName: "response_tracker", startedAt: lastRun, status: "ok", message: "ok" },
    ]),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const cron = out.components.find((c) => c.name === "cron:response_tracker");
  assert.equal(cron!.status, "ok", `expected ok, got ${cron!.status}: ${cron!.detail}`);
  assert.equal(out.overall, "ok");
});

test("rollup: missed-tick threshold is configurable (threshold=3 keeps 2 misses as ok)", () => {
  const lastRun = new Date(NOW.getTime() - 90 * 60 * 1000);
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    missedTickThreshold: 3,
    connectors: [],
    knownJobs: [knownJob(
      "response_tracker",
      new Date(NOW.getTime() - 5 * 60 * 1000),
      [
        new Date(NOW.getTime() - 60 * 60 * 1000),
        new Date(NOW.getTime() - 30 * 60 * 1000),
      ],
    )],
    lastRunByJob: lastRunMap([
      { jobName: "response_tracker", startedAt: lastRun, status: "ok", message: "ok" },
    ]),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const cron = out.components.find((c) => c.name === "cron:response_tracker");
  // 2 missed ticks but threshold is 3 → still ok (no recovering note since
  // we only attach one for exactly-1 misses, but degraded is the contract).
  assert.equal(cron!.status, "ok");
});

test("rollup: stuck-running detection still fires even with boot-aware tolerances", () => {
  // Sanity check that the new tolerances don't undermine real signals.
  const out = computeRollup({
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [knownJob(
      "portal_batch_sweeper",
      new Date(NOW.getTime() - 5 * 60 * 1000),
      [],
    )],
    lastRunByJob: lastRunMap([
      { jobName: "portal_batch_sweeper", startedAt: new Date(NOW.getTime() - 30 * 60 * 1000), status: "running", message: null },
    ]),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  const cron = out.components.find((c) => c.name === "cron:portal_batch_sweeper");
  assert.equal(cron!.status, "degraded");
  assert.match(cron!.detail ?? "", /still "running"/);
});

test("rollup: connector failure stays failed regardless of boot-aware tolerances", () => {
  const recentBoot = new Date(NOW.getTime() - 30 * 1000);
  const out = computeRollup({
    now: NOW,
    bootTime: recentBoot,
    connectors: [{ connectorName: "outlook", status: "unhealthy", lastError: "401" }],
    knownJobs: [knownJob("daily_brief", null, [])],
    lastRunByJob: new Map(),
    overdueCount: 0,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  assert.equal(out.overall, "failed");
});

test("rollup: overdue submissions stay degraded even right after boot", () => {
  const recentBoot = new Date(NOW.getTime() - 30 * 1000);
  const out = computeRollup({
    now: NOW,
    bootTime: recentBoot,
    connectors: [],
    knownJobs: [],
    lastRunByJob: new Map(),
    overdueCount: 4,
    overdueThresholdMinutes: 15,
    lastWorkerRun: workerOk(),
  });
  assert.equal(out.overall, "degraded");
  const worker = out.components.find((c) => c.name === "portal_worker");
  assert.match(worker!.detail ?? "", /4 pending submission\(s\) overdue/);
});
