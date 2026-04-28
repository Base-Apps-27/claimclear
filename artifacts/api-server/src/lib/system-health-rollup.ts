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
  prevExpected: Date | null; // computed by caller from cron expression
}

export interface WorkerSnapshot {
  status: "running" | "completed" | "failed";
  finishedAt: string | null;
  startedAt: string;
  batchId: string;
  lastError: string | null;
}

export interface RollupComponent {
  name: string;
  status: ComponentStatus;
  detail: string | null;
}

export interface RollupInput {
  now: Date;
  connectors: ConnectorRow[];
  knownJobs: KnownCronJob[];
  lastRunByJob: Map<string, CronRunRow>;
  overdueCount: number;
  overdueThresholdMinutes: number;
  lastWorkerRun: WorkerSnapshot | null;
}

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

  for (const c of input.connectors) {
    components.push({
      name: `connector:${c.connectorName}`,
      status: mapConnectorStatus(c.status),
      detail: c.lastError ?? null,
    });
  }

  for (const known of input.knownJobs) {
    const last = input.lastRunByJob.get(known.name);
    if (!last) {
      components.push({
        name: `cron:${known.name}`,
        status: "degraded",
        detail: "No runs recorded in the last 7 days",
      });
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
      // Missed-run detection: terminal run older than the previous expected
      // fire means a scheduled execution was skipped.
      if (last.status !== "running" && last.startedAt.getTime() < known.prevExpected.getTime() - 60 * 1000) {
        if (status === "ok") status = "degraded";
        detail = `Last run ${last.startedAt.toISOString()} is older than previous expected run ${known.prevExpected.toISOString()}`;
      }
    }

    components.push({ name: `cron:${known.name}`, status, detail });
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
  components.push({ name: "portal_worker", status: workerStatus, detail: workerDetail });

  let overall: ComponentStatus = "ok";
  for (const c of components) {
    if (c.status === "failed") { overall = "failed"; break; }
    if (c.status === "degraded") overall = "degraded";
  }

  return { overall, components };
}
