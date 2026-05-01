// End-to-end / runtime integration tests for the shared portal-submission
// batch view. Boots Express on a random port with the batch-jobs routes
// mounted, connects two real SSE clients over HTTP (User A + User B), and
// drives an actual batch via POST /batch-process. The Playwright bot is
// swapped out for an in-process stub via the __setBatchWorkerForTests
// seam on batch-processor.ts so we don't launch a real browser.
//
// What this catches that the pure unit tests in on-demand-worker.test.ts
// can't:
//   - SSE event ordering as observed over a real socket.
//   - The /portal-submissions/active-batch route returning the live
//     snapshot mid-run (the contract use-portal-batch-events.ts depends
//     on for any second user opening the page after the run started).
//   - Both connected clients seeing the same lifecycle events from the
//     real processSequentially loop.
//   - releaseClaimedRows broadcasting row_status_changed:"pending" for
//     rows that were claimed but never reached in_progress.
//   - clearOrphanedBatchClaims actually clearing claim columns on a real
//     DB row left over from a "prior process".
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import express, { type Express } from "express";
import { eq } from "drizzle-orm";

import batchJobsRouter from "../routes/batch-jobs";
import {
  __setBatchWorkerForTests,
  clearOrphanedBatchClaims,
  getActiveBatchJob,
  isWorkerRunInProgress,
} from "../lib/batch-processor";
import type { BatchEvent } from "../lib/sse";
import { db, pool, portalSubmissionsTable, claimsTable, invoiceGroupsTable } from "@workspace/db";

// ---- Test server boot ----------------------------------------------------
let server: http.Server;
let baseUrl: string;

before(async () => {
  // Replace the Playwright bot worker with an in-process stub. The stub
  // sleeps briefly so a mid-run /active-batch fetch has time to land, and
  // throws on a sentinel confNumber so we can drive the failure branch.
  __setBatchWorkerForTests(async (sub) => {
    await new Promise((r) => setTimeout(r, 60));
    if (sub.confNumber === "TEST_FAIL_SENTINEL") {
      throw new Error("Stubbed bot failure for test");
    }
    return { ticketId: `TEST-${sub.id}`, screenshotPath: undefined };
  });

  const app: Express = express();
  app.use(express.json());
  app.use("/api", batchJobsRouter);

  await new Promise<void>((resolveListen, rejectListen) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolveListen();
      } else {
        rejectListen(new Error("Failed to obtain test server port"));
      }
    });
  });
});

after(async () => {
  __setBatchWorkerForTests(null);
  // Force every server-side SSE socket closed so the per-request `close`
  // handler (req.on("close", cleanup)) fires and sse.ts clears its
  // setInterval keepalives.
  server.closeAllConnections?.();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await pool.end().catch(() => undefined);
});

// ---- SSE client over real HTTP ------------------------------------------
interface SSEClient {
  events: BatchEvent[];
  close: () => void;
  ready: Promise<void>;
}

function connectSSEClient(): SSEClient {
  const events: BatchEvent[] = [];
  let buffer = "";
  let req: http.ClientRequest;

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    req = http.get(`${baseUrl}/api/portal-submissions/batch-events`, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        // SSE frames are separated by blank lines (\n\n).
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const lines = block.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (eventLine === "event: batch_update" && dataLine) {
            try {
              events.push(JSON.parse(dataLine.slice("data: ".length)) as BatchEvent);
            } catch {
              // ignore malformed frame
            }
          }
        }
      });
      // Once headers arrive the server has registered our SSE client.
      resolveReady();
    });
    req.on("error", rejectReady);
  });

  return {
    events,
    ready,
    close: () => req.destroy(),
  };
}

async function fetchJson<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: init?.method ?? "GET",
        headers: body
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString() }
          : {},
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            resolveReq({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : ({} as T) });
          } catch (e) {
            rejectReq(e);
          }
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000, intervalMs = 20): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// Tests share a single in-process workerGate (we import the same
// batch-processor module). After a test sees batch_completed broadcast,
// the gate still spends a few ticks finishing post-broadcast bookkeeping
// before it releases. Wait for it to release so the next test's POST
// /batch-process doesn't get coalesced as 202 already_running.
async function waitForGateIdle(timeoutMs = 5000): Promise<void> {
  await waitFor(() => !isWorkerRunInProgress(), timeoutMs);
}

// ---- DB seeding helpers --------------------------------------------------
interface SeededRow { claimId: number; submissionId: number; invoiceGroupId: number; }

async function seedPendingSubmission(opts: {
  confNumber: string;
  attempts?: number;
  maxAttempts?: number;
}): Promise<SeededRow> {
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `${opts.confNumber}-G`,
    status: "Portal Queued",
  }).returning({ id: invoiceGroupsTable.id });
  const [claim] = await db.insert(claimsTable).values({
    confNumber: opts.confNumber,
    status: "Portal Queued",
    invoiceGroupId: group.id,
  }).returning({ id: claimsTable.id });
  const [sub] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: group.id,
    status: "pending",
    confNumber: opts.confNumber,
    attempts: opts.attempts ?? 0,
    maxAttempts: opts.maxAttempts ?? 4,
  }).returning({ id: portalSubmissionsTable.id });
  return { claimId: claim.id, submissionId: sub.id, invoiceGroupId: group.id };
}

async function cleanupSeeded(rows: SeededRow[]): Promise<void> {
  for (const row of rows) {
    await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, row.submissionId)).catch(() => undefined);
    await db.delete(claimsTable).where(eq(claimsTable.id, row.claimId)).catch(() => undefined);
    if (row.invoiceGroupId) {
      await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, row.invoiceGroupId)).catch(() => undefined);
    }
  }
}

// =========================================================================
// Test 1: Two simulated users + a real batch run end-to-end.
// Verifies requirement (1) batch_started + queued events broadcast,
// (3) queued → in_progress → submitted ordering for the success row, and
// (4) batch_completed fires once.
// =========================================================================
test("two SSE clients receive batch_started, queued, in_progress, submitted, batch_completed in order from a real batch run", async () => {
  const userA = connectSSEClient();
  const userB = connectSSEClient();
  await Promise.all([userA.ready, userB.ready]);

  const seeded = await seedPendingSubmission({
    confNumber: `TEST_E2E_OK_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  });

  try {
    const res = await fetchJson<{ batchId: string; total: number }>(
      "/api/portal-submissions/batch-process",
      { method: "POST", body: { submissionIds: [seeded.submissionId] } },
    );
    assert.equal(res.status, 200, `expected 200 from /batch-process, got ${res.status}`);
    assert.equal(res.json.total, 1);
    const batchId = res.json.batchId;

    await waitFor(() => userA.events.some((e) => e.type === "batch_completed" && e.batchId === batchId), 8000);
    await waitFor(() => userB.events.some((e) => e.type === "batch_completed" && e.batchId === batchId), 8000);
    await waitForGateIdle();

    for (const client of [userA, userB]) {
      const evs = client.events.filter((e) => "batchId" in e && e.batchId === batchId);

      const rowEvents = evs.filter(
        (e): e is Extract<BatchEvent, { type: "row_status_changed" }> =>
          e.type === "row_status_changed" && e.submissionId === seeded.submissionId,
      );
      assert.deepEqual(
        rowEvents.map((e) => e.newStatus),
        ["queued", "in_progress", "submitted"],
        "client must observe row transitions queued → in_progress → submitted in order",
      );

      const started = evs.filter((e) => e.type === "batch_started");
      const completed = evs.filter((e) => e.type === "batch_completed");
      assert.equal(started.length, 1, "exactly one batch_started");
      assert.equal(completed.length, 1, "exactly one batch_completed");

      const idxStart = evs.indexOf(started[0]);
      const idxQueued = evs.findIndex((e) => e.type === "row_status_changed" && e.submissionId === seeded.submissionId && e.newStatus === "queued");
      const idxInProg = evs.findIndex((e) => e.type === "row_status_changed" && e.submissionId === seeded.submissionId && e.newStatus === "in_progress");
      const idxSubmit = evs.findIndex((e) => e.type === "row_status_changed" && e.submissionId === seeded.submissionId && e.newStatus === "submitted");
      const idxComplete = evs.indexOf(completed[0]);
      assert.ok(idxStart < idxQueued, "batch_started must precede queued");
      assert.ok(idxQueued < idxInProg, "queued must precede in_progress");
      assert.ok(idxInProg < idxSubmit, "in_progress must precede submitted");
      assert.ok(idxSubmit < idxComplete, "submitted must precede batch_completed");
    }
  } finally {
    userA.close();
    userB.close();
    await cleanupSeeded([seeded]);
  }
});

// =========================================================================
// Test 2: Mid-run hydration via GET /active-batch.
// Verifies requirement (2): a second client connecting mid-run can fetch
// /active-batch and see the in-flight batch immediately, without waiting
// for the next SSE event.
// =========================================================================
test("a second user fetching /active-batch mid-run gets the live batch snapshot", async () => {
  const userA = connectSSEClient();
  await userA.ready;

  const beforeRun = await fetchJson<{ active: boolean }>("/api/portal-submissions/active-batch");
  assert.equal(beforeRun.status, 200);
  assert.equal(beforeRun.json.active, false, "snapshot must be inactive before any run");

  const seeded = await seedPendingSubmission({
    confNumber: `TEST_MID_RUN_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  });

  try {
    const startRes = await fetchJson<{ batchId: string }>(
      "/api/portal-submissions/batch-process",
      { method: "POST", body: { submissionIds: [seeded.submissionId] } },
    );
    assert.equal(startRes.status, 200);
    const batchId = startRes.json.batchId;

    // Wait until User A has seen batch_started — guaranteeing the batch
    // is really in flight on the server before we hit /active-batch.
    await waitFor(() => userA.events.some((e) => e.type === "batch_started" && e.batchId === batchId), 5000);

    // User B is the second tab that opens the page MID-RUN — after
    // batch_started has already fired. They missed the start event on the
    // SSE channel, so the contract use-portal-batch-events.ts depends on
    // is: (1) /active-batch hydrates the in-flight state immediately, and
    // (2) the SSE connection still receives the remaining lifecycle
    // events (batch_completed at minimum). This test proves both halves.
    const userB = connectSSEClient();
    await userB.ready;

    const mid = await fetchJson<{
      active: boolean;
      batchId?: string;
      triggeredBy?: string;
      total?: number;
      submissionIds?: number[];
    }>("/api/portal-submissions/active-batch");
    assert.equal(mid.status, 200);
    assert.equal(mid.json.active, true, "mid-run snapshot must report active=true");
    assert.equal(mid.json.batchId, batchId, "mid-run snapshot must echo the running batch id");
    assert.equal(mid.json.total, 1);
    assert.deepEqual(mid.json.submissionIds, [seeded.submissionId]);
    assert.ok(typeof mid.json.triggeredBy === "string" && mid.json.triggeredBy.length > 0, "triggeredBy must be populated");

    try {
      await waitFor(() => userA.events.some((e) => e.type === "batch_completed" && e.batchId === batchId), 8000);
      await waitFor(() => userB.events.some((e) => e.type === "batch_completed" && e.batchId === batchId), 8000);
      await waitForGateIdle();

      // User B connected after batch_started, so they MUST NOT have
      // received it on the SSE channel — they have to rely on
      // /active-batch for the start info. They MUST have received the
      // post-connect lifecycle events though.
      assert.ok(
        userB.events.every((e) => !(e.type === "batch_started" && e.batchId === batchId)),
        "User B connected mid-run; should not have received batch_started over SSE",
      );
      assert.ok(
        userB.events.some((e) => e.type === "batch_completed" && e.batchId === batchId),
        "User B must receive batch_completed over SSE",
      );

      const afterRun = await fetchJson<{ active: boolean }>("/api/portal-submissions/active-batch");
      assert.equal(afterRun.json.active, false, "snapshot must be inactive after completion");
      assert.equal(getActiveBatchJob(), undefined);
    } finally {
      userB.close();
    }
  } finally {
    userA.close();
    await cleanupSeeded([seeded]);
  }
});

// =========================================================================
// Test 3: Failure path. Verifies requirement (3) that the failure branch
// emits row_status_changed → "failed", and that batch_completed still
// fires once.
// =========================================================================
test("two SSE clients see queued → in_progress → failed when the bot throws and retries are exhausted", async () => {
  const userA = connectSSEClient();
  const userB = connectSSEClient();
  await Promise.all([userA.ready, userB.ready]);

  // attempts=3, maxAttempts=4: processSequentially increments to 4 before
  // calling the bot, so when the bot throws scheduleRetryOrFail sees
  // attemptsSoFar=4 >= maxAttempts=4 and marks the row failed (no retry).
  const seeded = await seedPendingSubmission({
    confNumber: "TEST_FAIL_SENTINEL",
    attempts: 3,
    maxAttempts: 4,
  });

  try {
    const startRes = await fetchJson<{ batchId: string }>(
      "/api/portal-submissions/batch-process",
      { method: "POST", body: { submissionIds: [seeded.submissionId] } },
    );
    assert.equal(startRes.status, 200);
    const batchId = startRes.json.batchId;

    await waitFor(() => userA.events.some((e) => e.type === "batch_completed" && e.batchId === batchId), 8000);
    await waitFor(() => userB.events.some((e) => e.type === "batch_completed" && e.batchId === batchId), 8000);
    await waitForGateIdle();

    for (const client of [userA, userB]) {
      const rowEvents = client.events.filter(
        (e): e is Extract<BatchEvent, { type: "row_status_changed" }> =>
          e.type === "row_status_changed" && e.submissionId === seeded.submissionId,
      );
      assert.deepEqual(
        rowEvents.map((e) => e.newStatus),
        ["queued", "in_progress", "failed"],
        "client must observe queued → in_progress → failed when retries are exhausted",
      );
    }
  } finally {
    userA.close();
    userB.close();
    await cleanupSeeded([seeded]);
  }
});

// =========================================================================
// Test 4: Stale-claim release path. Verifies the second half of
// requirement (4): a row that was claimed by the batch but never reached
// in_progress is released when the batch ends, and both connected
// clients see exactly one row_status_changed:"pending" event for that
// row. Exercises lines 426-447 of batch-processor.ts (releaseClaimedRows
// + the `if (row.status === "pending") broadcast` branch).
// =========================================================================
test("a row left claimed-but-pending at batch end is released and broadcast as row_status_changed: pending", async () => {
  const userA = connectSSEClient();
  const userB = connectSSEClient();
  await Promise.all([userA.ready, userB.ready]);

  const rowA = await seedPendingSubmission({
    confNumber: `TEST_RELEASE_A_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  });
  const rowB = await seedPendingSubmission({
    confNumber: `TEST_RELEASE_B_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  });

  try {
    const startRes = await fetchJson<{ batchId: string }>(
      "/api/portal-submissions/batch-process",
      { method: "POST", body: { submissionIds: [rowA.submissionId] } },
    );
    assert.equal(startRes.status, 200);
    const batchId = startRes.json.batchId;

    // Wait for batch_started so we have the batch id; then attach row B's
    // claimedByBatchId to this batch. startBatchJob's UPDATE is narrowed
    // to the explicit submissionIds so it does not touch row B, but
    // releaseClaimedRows (WHERE claimedByBatchId = batchId) does.
    await waitFor(() => userA.events.some((e) => e.type === "batch_started" && e.batchId === batchId), 5000);
    await db.update(portalSubmissionsTable).set({
      claimedByBatchId: batchId,
      claimedByUserName: "TestStaleClaim",
      claimedAt: new Date(),
    }).where(eq(portalSubmissionsTable.id, rowB.submissionId));

    await waitFor(() => userA.events.some((e) => e.type === "batch_completed" && e.batchId === batchId), 8000);
    await waitFor(() => userB.events.some((e) => e.type === "batch_completed" && e.batchId === batchId), 8000);
    await waitForGateIdle();

    for (const client of [userA, userB]) {
      const rowBPendingEvents = client.events.filter(
        (e): e is Extract<BatchEvent, { type: "row_status_changed" }> =>
          e.type === "row_status_changed" &&
          e.submissionId === rowB.submissionId &&
          e.newStatus === "pending" &&
          e.batchId === batchId,
      );
      assert.equal(rowBPendingEvents.length, 1, "exactly one release broadcast for row B");

      const idxStart = client.events.findIndex((e) => e.type === "batch_started" && e.batchId === batchId);
      const idxRelease = client.events.indexOf(rowBPendingEvents[0]);
      const idxCompleted = client.events.findIndex((e) => e.type === "batch_completed" && e.batchId === batchId);
      assert.ok(idxStart < idxRelease, "release event must come after batch_started");
      assert.ok(idxRelease < idxCompleted, "release event must come before batch_completed");
    }

    const [persistedB] = await db.select({
      claimedByBatchId: portalSubmissionsTable.claimedByBatchId,
      claimedByUserName: portalSubmissionsTable.claimedByUserName,
      claimedAt: portalSubmissionsTable.claimedAt,
      status: portalSubmissionsTable.status,
    }).from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, rowB.submissionId));
    assert.equal(persistedB.claimedByBatchId, null);
    assert.equal(persistedB.claimedByUserName, null);
    assert.equal(persistedB.claimedAt, null);
    assert.equal(persistedB.status, "pending");
  } finally {
    userA.close();
    userB.close();
    await cleanupSeeded([rowA, rowB]);
  }
});

// =========================================================================
// Test 5: Boot-time clearOrphanedBatchClaims (requirement 5). Hermetic:
// only asserts on the seeded row's columns; does not assume the database
// is otherwise empty.
// =========================================================================
test("clearOrphanedBatchClaims clears the claim columns on a row left flagged by a prior process", async () => {
  const sentinelBatchId = `test_orphan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const seeded = await seedPendingSubmission({ confNumber: `TEST_ORPHAN_${Date.now()}` });

  await db.update(portalSubmissionsTable).set({
    claimedByBatchId: sentinelBatchId,
    claimedByUserName: "Crashed Process",
    claimedAt: new Date(),
  }).where(eq(portalSubmissionsTable.id, seeded.submissionId));

  try {
    const cleared = await clearOrphanedBatchClaims();
    assert.ok(cleared >= 1, `expected at least 1 row cleared, got ${cleared}`);

    const [afterRow] = await db.select({
      claimedByBatchId: portalSubmissionsTable.claimedByBatchId,
      claimedByUserName: portalSubmissionsTable.claimedByUserName,
      claimedAt: portalSubmissionsTable.claimedAt,
      status: portalSubmissionsTable.status,
    }).from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, seeded.submissionId));

    assert.equal(afterRow.claimedByBatchId, null, "claimedByBatchId must be cleared");
    assert.equal(afterRow.claimedByUserName, null, "claimedByUserName must be cleared");
    assert.equal(afterRow.claimedAt, null, "claimedAt must be cleared");
    assert.equal(afterRow.status, "pending", "status must remain 'pending' so the row can be re-picked up");
  } finally {
    await cleanupSeeded([seeded]);
  }
});

test("clearOrphanedBatchClaims is idempotent: a second call leaves the seeded row clean", async () => {
  const seeded = await seedPendingSubmission({ confNumber: `TEST_ORPHAN_IDEM_${Date.now()}` });
  await db.update(portalSubmissionsTable).set({
    claimedByBatchId: `test_orphan_idem_${Date.now()}`,
    claimedByUserName: "Crashed",
    claimedAt: new Date(),
  }).where(eq(portalSubmissionsTable.id, seeded.submissionId));

  try {
    await clearOrphanedBatchClaims();
    const secondPass = await clearOrphanedBatchClaims();
    assert.equal(typeof secondPass, "number");

    const [row] = await db.select({
      claimedByBatchId: portalSubmissionsTable.claimedByBatchId,
    }).from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, seeded.submissionId));
    assert.equal(row.claimedByBatchId, null, "seeded row must remain cleared after a second call");
  } finally {
    await cleanupSeeded([seeded]);
  }
});

// =========================================================================
// Test 6: Cross-file invariant. The React hook listens for `batch_update`
// SSE events and dispatches by `data.type`; if the server adds a new
// BatchEvent variant without updating the hook, no behavior breaks at
// runtime — the UI just silently misses the update. Pinning the type
// union catches that drift at build time.
// =========================================================================
test("server BatchEvent union and client PortalBatchEvent union enumerate the same event types", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const repoSrc = resolve(__dirname, "..");
  const serverSrc = readFileSync(resolve(repoSrc, "lib/sse.ts"), "utf8");
  const clientPath = resolve(repoSrc, "../../claimclear/src/hooks/use-portal-batch-events.ts");
  const clientSrc = readFileSync(clientPath, "utf8");

  function collectTypes(src: string, anchor: string): Set<string> {
    const i = src.indexOf(anchor);
    assert.notEqual(i, -1, `expected to find ${anchor}`);
    const tail = src.slice(i);
    const end = tail.indexOf("};\n");
    const block = end === -1 ? tail : tail.slice(0, end + 2);
    return new Set(
      [...block.matchAll(/type:\s*["']([a-z_|" ]+?)["']/g)]
        .flatMap((m) => m[1].split("|").map((s) => s.trim().replace(/["']/g, "")))
        .filter(Boolean),
    );
  }

  const serverTypes = collectTypes(serverSrc, "export type BatchEvent");
  const clientTypes = collectTypes(clientSrc, "export type PortalBatchEvent");

  for (const t of serverTypes) {
    assert.ok(clientTypes.has(t), `client hook missing handler for server-emitted type "${t}"`);
  }
});
