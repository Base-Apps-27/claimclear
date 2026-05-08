import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  computeRollup,
  type CronRunRow,
  type KnownCronJob,
  type RollupInput,
} from "../lib/system-health-rollup";

const NOW = new Date("2026-05-08T17:00:00.000Z");
const BOOT = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);

function makeKnownJob(name: string): KnownCronJob {
  return {
    name,
    // 1 hour ago — well within range; not used by these tests beyond
    // anchoring the missed-fire math.
    prevExpected: new Date(NOW.getTime() - 60 * 60 * 1000),
    expectedFiresSinceBoot: [],
  };
}

function makeLastRun(jobName: string, status: CronRunRow["status"]): CronRunRow {
  return {
    jobName,
    startedAt: new Date(NOW.getTime() - 5 * 60 * 1000),
    status,
    message: null,
  };
}

function baseInput(overrides: Partial<RollupInput> = {}): RollupInput {
  return {
    now: NOW,
    bootTime: BOOT,
    connectors: [],
    knownJobs: [],
    lastRunByJob: new Map(),
    overdueCount: 0,
    overdueGraceMinutes: 5,
    lastWorkerRun: {
      status: "completed",
      finishedAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
      startedAt: new Date(NOW.getTime() - 90 * 1000).toISOString(),
      batchId: "batch-1",
      lastError: null,
    },
    ...overrides,
  };
}

test("computeRollup: a cron whose last run is 'completed' rolls up as ok", () => {
  const known = makeKnownJob("daily_brief");
  const input = baseInput({
    knownJobs: [known],
    lastRunByJob: new Map([["daily_brief", makeLastRun("daily_brief", "completed")]]),
  });

  const { overall, components } = computeRollup(input);
  const cron = components.find((c) => c.name === "cron:daily_brief");
  assert.ok(cron, "cron component should be present");
  assert.equal(cron!.status, "ok");
  assert.equal(overall, "ok");
});

test("computeRollup: a cron whose last run is 'failed' rolls up as failed", () => {
  const known = makeKnownJob("daily_brief");
  const input = baseInput({
    knownJobs: [known],
    lastRunByJob: new Map([["daily_brief", makeLastRun("daily_brief", "failed")]]),
  });

  const { overall, components } = computeRollup(input);
  const cron = components.find((c) => c.name === "cron:daily_brief");
  assert.equal(cron!.status, "failed");
  assert.equal(overall, "failed");
});

test("computeRollup: every cron 'completed' + healthy connectors/worker => overall ok with zero failing components", () => {
  const jobNames = ["daily_brief", "portal_batch_sweeper", "expired_sweep"];
  const knownJobs = jobNames.map(makeKnownJob);
  const lastRunByJob = new Map<string, CronRunRow>();
  for (const n of jobNames) lastRunByJob.set(n, makeLastRun(n, "completed"));

  const input = baseInput({
    connectors: [
      { connectorName: "outlook", status: "healthy", lastError: null },
    ],
    knownJobs,
    lastRunByJob,
  });

  const { overall, components } = computeRollup(input);
  const failing = components.filter(
    (c) => c.status === "failed" || c.status === "degraded",
  );
  assert.equal(overall, "ok");
  assert.deepEqual(failing, []);
});

test("computeRollup: legacy 'ok' status still rolls up as ok (back-compat)", () => {
  const known = makeKnownJob("legacy_job");
  const input = baseInput({
    knownJobs: [known],
    lastRunByJob: new Map([["legacy_job", makeLastRun("legacy_job", "ok")]]),
  });

  const { overall, components } = computeRollup(input);
  const cron = components.find((c) => c.name === "cron:legacy_job");
  assert.equal(cron!.status, "ok");
  assert.equal(overall, "ok");
});
