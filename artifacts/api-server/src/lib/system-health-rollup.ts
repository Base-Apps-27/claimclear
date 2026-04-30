// Pure rollup math, extracted from routes/system-health.ts so we can unit-test
// the severity matrix (degraded/failed propagation, stuck-cron detection,
// overdue worker signal) without spinning up the DB or Express.

export type ComponentStatus = "ok" | "degraded" | "failed";

export interface ConnectorRow {
  connectorName: string;
  status: string;            // raw DB value: "healthy" | "degraded" | "unhealthy" | ...
  lastError: string | null;
}

export interface CronRunRow {
  jobName: string;
  startedAt: Date;
  status: string;            // "ok" | "running" | "degraded" | "failed"
  message: string | null;
}

export interface KnownCronJob {
  name: string;
  prevExpected: Date | null;     // computed by caller from cron expression
  // Scheduled fire times that landed strictly after server boot and at or
  // before `now`, sorted ascending. Used to count missed-tick streaks while
  // ignoring expected fires that "should have" happened before the process
  // existed (deploys, container recycles, etc.).
  expectedFiresSinceBoot: Date[];
}

export interface WorkerSnapshot {
  status: "running" | "completed" | "failed" | "aborted";
  finishedAt: string | null;
  startedAt: string;
  batchId: string;
  lastError: string | null;
}

export interface RollupComponent {
  name: string;
  status: ComponentStatus;
  detail: string | null;
  // True when `detail` is a transient informational note from this rollup
  // (e.g. "Awaiting first scheduled run since server boot", "Skipped one
  // scheduled tick — recovering"). The UI surfaces only these as
  // informational notes, so normal "ok" runs whose `detail` is just the
  // last run's message don't get treated as alerts.
  informational?: boolean;
}

export interface RollupInput {
  now: Date;
  bootTime: Date;
  connectors: ConnectorRow[];
  knownJobs: KnownCronJob[];
  lastRunByJob: Map<string, CronRunRow>;
  overdueCount: number;
  overdueThresholdMinutes: number;
  lastWorkerRun: WorkerSnapshot | null;
  // Minimum number of consecutive missed scheduled fires before the rollup
  // flips a job to "degraded". A single skip (e.g. a brief restart) is
  // treated as a transient blip and reported as "ok with note" instead.
  // Defined here so the threshold lives in one place and is easy to tune.
  missedTickThreshold?: number;
}

export const DEFAULT_MISSED_TICK_THRESHOLD = 2;

// Tolerance for clock skew / cron-parser rounding when comparing run times
// to expected fire times. Matches the legacy 60s tolerance.
const TICK_TOLERANCE_MS = 60 * 1000;

export interface RollupOutput {
  overall: ComponentStatus;
  components: RollupComponent[];
}

function mapConnectorStatus(s: string): ComponentStatus {
  if (s === "healthy") return "ok";
  if (s === "degraded") return "degraded";
  return "failed";
}

export function computeRollup(input: RollupInput): RollupOutput {
  const components: RollupComponent[] = [];
  const missedTickThreshold = input.missedTickThreshold ?? DEFAULT_MISSED_TICK_THRESHOLD;

  for (const c of input.connectors) {
    components.push({
      name: `connector:${c.connectorName}`,
      status: mapConnectorStatus(c.status),
      detail: c.lastError ?? null,
    });
  }

  for (const known of input.knownJobs) {
    let informational = false;
    const last = input.lastRunByJob.get(known.name);
    // Only count expected fires that have actually had time to land — a fire
    // scheduled within the last second hasn't really been "missed" yet.
    const dueExpectedFires = known.expectedFiresSinceBoot.filter(
      (t) => t.getTime() <= input.now.getTime() - TICK_TOLERANCE_MS,
    );

    if (!last) {
      // No runs in the last 7 days. If the server hasn't been up long enough
      // for any scheduled fire to have happened yet, that's expected silence
      // (fresh deploy / container recycle) — surface it as an informational
      // note, not a degraded banner.
      if (dueExpectedFires.length === 0) {
        components.push({
          name: `cron:${known.name}`,
          status: "ok",
          detail: "Awaiting first scheduled run since server boot",
          informational: true,
        });
      } else {
        components.push({
          name: `cron:${known.name}`,
          status: "degraded",
          detail: "No runs recorded in the last 7 days",
        });
      }
      continue;
    }

    let status: ComponentStatus =
      last.status === "ok" ? "ok"
      : last.status === "degraded" ? "degraded"
      : last.status === "running" ? "ok"   // promoted to degraded below if stuck
      : "failed";
    let detail: string | null = last.message ?? null;

    if (known.prevExpected) {
      // Stuck-run detection: a row that's still "running" past 2x the cron
      // interval is almost certainly orphaned (process died, db commit lost).
      if (last.status === "running") {
        const ageMs = input.now.getTime() - last.startedAt.getTime();
        const intervalMs = Math.max(60 * 1000, input.now.getTime() - known.prevExpected.getTime());
        if (ageMs > intervalMs * 2) {
          status = "degraded";
          detail = `Run started ${last.startedAt.toISOString()} is still "running" after ${Math.round(ageMs / 60000)} min — likely orphaned`;
        }
      }

      // Missed-run detection: count how many scheduled fires landed *after*
      // the last recorded run but before "now" (with the same 60s tolerance).
      // We require a sustained streak — a single skip is the cold-start /
      // brief-restart case and is intentionally tolerated.
      if (last.status !== "running") {
        const lastStartMs = last.startedAt.getTime();
        const missedFires = dueExpectedFires.filter(
          (t) => t.getTime() > lastStartMs + TICK_TOLERANCE_MS,
        );
        if (missedFires.length >= missedTickThreshold) {
          if (status === "ok") status = "degraded";
          detail = `Last run ${last.startedAt.toISOString()} is older than previous expected run ${known.prevExpected.toISOString()} — missed ${missedFires.length} consecutive scheduled fires`;
        } else if (missedFires.length === 1) {
          // One missed tick: keep status ok but surface a neutral note so the
          // detail page can show "we noticed, it's recovering" without raising
          // the degraded banner.
          if (status === "ok") {
            detail = `Skipped one scheduled tick at ${missedFires[0].toISOString()} — recovering`;
            informational = true;
          }
        }
      }
    }

    components.push({ name: `cron:${known.name}`, status, detail, informational });
  }

  let workerStatus: ComponentStatus = "ok";
  let workerDetail: string | null = input.lastWorkerRun
    ? `Last run ${input.lastWorkerRun.batchId} ${input.lastWorkerRun.status} at ${input.lastWorkerRun.finishedAt ?? input.lastWorkerRun.startedAt}`
    : "No worker runs since boot";
  if (input.overdueCount > 0) {
    workerStatus = "degraded";
    workerDetail = `${input.overdueCount} pending submission(s) overdue (>${input.overdueThresholdMinutes} min)`;
  }
  if (input.lastWorkerRun?.status === "failed") {
    if (workerStatus === "ok") workerStatus = "degraded";
    workerDetail = input.lastWorkerRun.lastError ?? "Last worker run failed";
  }
  if (input.lastWorkerRun?.status === "aborted") {
    // A user-initiated stop is informational — the worker is otherwise
    // healthy, but we surface the abort so dashboards don't pretend
    // everything is fine.
    if (workerStatus === "ok") workerStatus = "degraded";
    workerDetail = `Last run ${input.lastWorkerRun.batchId} stopped by user at ${input.lastWorkerRun.finishedAt ?? input.lastWorkerRun.startedAt}`;
  }
  components.push({ name: "portal_worker", status: workerStatus, detail: workerDetail });

  let overall: ComponentStatus = "ok";
  for (const c of components) {
    if (c.status === "failed") { overall = "failed"; break; }
    if (c.status === "degraded") overall = "degraded";
  }

  return { overall, components };
}
