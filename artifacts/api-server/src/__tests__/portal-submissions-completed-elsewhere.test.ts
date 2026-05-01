// Integration tests for the `completedElsewhere` enrichment on
// GET /api/portal-submissions. Mounts the router in-process and seeds
// portal_submissions rows directly.
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, inArray } from "drizzle-orm";

import portalSubmissionsRouter from "../routes/portal-submissions";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  portalSubmissionsTable,
  portalBatchRunsTable,
} from "@workspace/db";

interface CompletedElsewhere {
  submissionId: number;
  runId: number | null;
  runLabel: string | null;
  submittedAt: string | null;
}

interface SubmissionRow {
  id: number;
  invoiceGroupId: number;
  status: string;
  completedElsewhere: CompletedElsewhere | null;
}

const TEST_USER = { email: "completed-elsewhere-tester@example.com", displayName: "CE Tester" };

let server: http.Server;
let baseUrl: string;

before(async () => {
  const app: Express = express();
  app.use(express.json());

  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });

  app.use("/api", portalSubmissionsRouter);

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
  server.closeAllConnections?.();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await pool.end().catch(() => undefined);
});

async function fetchJson<T = unknown>(path: string): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET" },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            resolveReq({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : ({} as T) });
          } catch (e) { rejectReq(e); }
        });
      },
    );
    req.on("error", rejectReq);
    req.end();
  });
}

interface SeededGroup {
  groupId: number;
  claimId: number;
  submissionIds: number[];
}

async function seedGroupWithSubmissions(rows: Array<{
  status: "draft" | "pending" | "submitted" | "failed" | "cancelled";
  submittedInBatchId?: string | null;
  submittedAt?: string | null;
}>): Promise<SeededGroup> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `CE-${tag}`,
    status: "Portal Queued",
  }).returning({ id: invoiceGroupsTable.id });
  const [claim] = await db.insert(claimsTable).values({
    confNumber: `CE-CONF-${tag}`,
    status: "Portal Queued",
    invoiceGroupId: group.id,
  }).returning({ id: claimsTable.id });

  const submissionIds: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const [sub] = await db.insert(portalSubmissionsTable).values({
      invoiceGroupId: group.id,
      status: row.status,
      confNumber: `CE-${tag}-${i}`,
      submittedInBatchId: row.submittedInBatchId ?? null,
      submittedAt: row.submittedAt ?? null,
    }).returning({ id: portalSubmissionsTable.id });
    submissionIds.push(sub.id);
    await new Promise((r) => setTimeout(r, 5));
  }

  return { groupId: group.id, claimId: claim.id, submissionIds };
}

async function cleanupGroup(g: SeededGroup): Promise<void> {
  if (g.submissionIds.length > 0) {
    await db.delete(portalSubmissionsTable)
      .where(inArray(portalSubmissionsTable.id, g.submissionIds))
      .catch(() => undefined);
  }
  await db.delete(claimsTable).where(eq(claimsTable.id, g.claimId)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, g.groupId)).catch(() => undefined);
}

async function seedBatchRun(): Promise<{ batchId: string; runId: number }> {
  const batchId = `ce-batch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [run] = await db.insert(portalBatchRunsTable).values({
    batchId,
    status: "completed",
    total: 1,
    processed: 1,
    succeeded: 1,
    failed: 0,
    triggeredBy: "completed-elsewhere-test",
  }).returning({ id: portalBatchRunsTable.id });
  return { batchId, runId: run.id };
}

async function deleteBatchRun(batchId: string): Promise<void> {
  await db.delete(portalBatchRunsTable).where(eq(portalBatchRunsTable.batchId, batchId)).catch(() => undefined);
}

function rowFor(json: SubmissionRow[], id: number): SubmissionRow {
  const row = json.find((r) => r.id === id);
  if (!row) throw new Error(`Expected submission ${id} in response, got ${json.map((r) => r.id).join(",")}`);
  return row;
}

test("draft + failed siblings of a submitted row carry completedElsewhere; success row does not", async () => {
  const { batchId, runId } = await seedBatchRun();
  const submittedAtIso = new Date().toISOString();
  const seeded = await seedGroupWithSubmissions([
    { status: "draft" },
    { status: "submitted", submittedInBatchId: batchId, submittedAt: submittedAtIso },
    { status: "failed" },
  ]);
  const [draftId, submittedId, failedId] = seeded.submissionIds;

  try {
    const res = await fetchJson<SubmissionRow[]>("/api/portal-submissions");
    assert.equal(res.status, 200);

    const draft = rowFor(res.json, draftId);
    const submitted = rowFor(res.json, submittedId);
    const failed = rowFor(res.json, failedId);

    assert.equal(submitted.completedElsewhere, null,
      "the submitted row itself must not carry a completedElsewhere pill");

    for (const row of [draft, failed]) {
      assert.ok(row.completedElsewhere, `expected completedElsewhere on row ${row.id}`);
      assert.equal(row.completedElsewhere!.submissionId, submittedId,
        "completedElsewhere.submissionId must point at the sibling success");
      assert.equal(row.completedElsewhere!.runId, runId,
        "completedElsewhere.runId must equal portal_batch_runs.id");
      assert.equal(row.completedElsewhere!.runLabel, `#${runId}`,
        "completedElsewhere.runLabel must be the user-facing #N label");
      assert.equal(row.completedElsewhere!.submittedAt, submittedAtIso,
        "completedElsewhere.submittedAt must match the success row's submittedAt");
    }
  } finally {
    await cleanupGroup(seeded);
    await deleteBatchRun(batchId);
  }
});

test("rows on a group with no submitted sibling have completedElsewhere = null", async () => {
  const seeded = await seedGroupWithSubmissions([
    { status: "draft" },
    { status: "pending" },
  ]);
  try {
    const res = await fetchJson<SubmissionRow[]>("/api/portal-submissions");
    assert.equal(res.status, 200);
    for (const id of seeded.submissionIds) {
      const row = rowFor(res.json, id);
      assert.equal(row.completedElsewhere, null,
        `row ${id} on a sibling-less group must not carry the pill`);
    }
  } finally {
    await cleanupGroup(seeded);
  }
});

test("cancelled and failed siblings do not populate completedElsewhere on a draft", async () => {
  // Negative case: only a successful 'submitted' sibling should trigger the
  // pill. Cancelled/failed/draft siblings must be ignored even though they
  // share the invoice group.
  const seeded = await seedGroupWithSubmissions([
    { status: "draft" },
    { status: "cancelled" },
    { status: "failed" },
  ]);
  try {
    const res = await fetchJson<SubmissionRow[]>("/api/portal-submissions");
    assert.equal(res.status, 200);
    for (const id of seeded.submissionIds) {
      const row = rowFor(res.json, id);
      assert.equal(row.completedElsewhere, null,
        `row ${id} (status ${row.status}) must not carry the pill: no successful sibling exists`);
    }
  } finally {
    await cleanupGroup(seeded);
  }
});

test("when a group has multiple submitted rows, completedElsewhere points at the latest one", async () => {
  const earlier = await seedBatchRun();
  const later = await seedBatchRun();
  const earlierAtIso = new Date(Date.now() - 60_000).toISOString();
  const laterAtIso = new Date().toISOString();

  const seeded = await seedGroupWithSubmissions([
    { status: "submitted", submittedInBatchId: earlier.batchId, submittedAt: earlierAtIso },
    { status: "draft" },
    { status: "submitted", submittedInBatchId: later.batchId, submittedAt: laterAtIso },
  ]);
  const [earlierSubmittedId, draftId, laterSubmittedId] = seeded.submissionIds;

  try {
    const res = await fetchJson<SubmissionRow[]>("/api/portal-submissions");
    assert.equal(res.status, 200);

    const draft = rowFor(res.json, draftId);
    assert.ok(draft.completedElsewhere, "draft must carry completedElsewhere");
    assert.equal(draft.completedElsewhere!.submissionId, laterSubmittedId,
      "completedElsewhere.submissionId must point at the *later* sibling success");
    assert.equal(draft.completedElsewhere!.runId, later.runId,
      "completedElsewhere.runId must point at the later batch run");

    const earlierSubmitted = rowFor(res.json, earlierSubmittedId);
    assert.ok(earlierSubmitted.completedElsewhere,
      "earlier submitted row must carry completedElsewhere pointing at the later one");
    assert.equal(earlierSubmitted.completedElsewhere!.submissionId, laterSubmittedId);
  } finally {
    await cleanupGroup(seeded);
    await deleteBatchRun(earlier.batchId);
    await deleteBatchRun(later.batchId);
  }
});

test("latest-success ordering uses submittedAt, not createdAt — older row submitted later wins", async () => {
  // The first row is created first (older createdAt) but submitted later
  // (newer submittedAt). The second row is created second (newer createdAt)
  // but submitted earlier (older submittedAt). The pill on the draft must
  // point at the row that was *submitted* most recently, regardless of
  // when its draft was first created.
  const earlySubmit = await seedBatchRun();
  const lateSubmit = await seedBatchRun();
  const earlySubmitAtIso = new Date(Date.now() - 60_000).toISOString();
  const lateSubmitAtIso = new Date().toISOString();

  const seeded = await seedGroupWithSubmissions([
    { status: "submitted", submittedInBatchId: lateSubmit.batchId, submittedAt: lateSubmitAtIso },
    { status: "submitted", submittedInBatchId: earlySubmit.batchId, submittedAt: earlySubmitAtIso },
    { status: "draft" },
  ]);
  const [lateSubmittedRowId, , draftId] = seeded.submissionIds;

  try {
    const res = await fetchJson<SubmissionRow[]>("/api/portal-submissions");
    assert.equal(res.status, 200);

    const draft = rowFor(res.json, draftId);
    assert.ok(draft.completedElsewhere, "draft must carry completedElsewhere");
    assert.equal(draft.completedElsewhere!.submissionId, lateSubmittedRowId,
      "completedElsewhere must follow submittedAt recency, not createdAt");
    assert.equal(draft.completedElsewhere!.runId, lateSubmit.runId,
      "runId must point at the run that submitted most recently");
    assert.equal(draft.completedElsewhere!.submittedAt, lateSubmitAtIso);
  } finally {
    await cleanupGroup(seeded);
    await deleteBatchRun(earlySubmit.batchId);
    await deleteBatchRun(lateSubmit.batchId);
  }
});

test("legacy submitted row without submittedInBatchId still triggers the pill, with runId/runLabel = null", async () => {
  const submittedAtIso = new Date().toISOString();
  const seeded = await seedGroupWithSubmissions([
    { status: "draft" },
    { status: "submitted", submittedInBatchId: null, submittedAt: submittedAtIso },
  ]);
  const [draftId] = seeded.submissionIds;

  try {
    const res = await fetchJson<SubmissionRow[]>("/api/portal-submissions");
    assert.equal(res.status, 200);

    const draft = rowFor(res.json, draftId);
    assert.ok(draft.completedElsewhere,
      "legacy submitted sibling must still surface the pill on the draft");
    assert.equal(draft.completedElsewhere!.runId, null,
      "runId must be null when submittedInBatchId was never written");
    assert.equal(draft.completedElsewhere!.runLabel, null,
      "runLabel must be null when there's no run to point at");
    assert.equal(draft.completedElsewhere!.submittedAt, submittedAtIso,
      "submittedAt should still resolve from the success row");
  } finally {
    await cleanupGroup(seeded);
  }
});
