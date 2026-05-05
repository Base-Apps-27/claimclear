// Task #440 — backend integration coverage for the post-upload "Quick
// triage" bridge query path.
//
// The bridge calls `GET /api/invoice-groups?importBatch=<id>
// &errorDetails=empty&limit=200` immediately after a successful import.
// The frontend regression that broke admin uploads was a render crash
// caused by misreading the response envelope, but the audit also flagged
// that we lacked any backend assertion that this exact query path:
//   (a) returns 200 with the documented `{ groups, total, today }`
//       envelope (and not a bare array — the bug the frontend assumed),
//   (b) honours the `importBatch` scope so the bridge never shows
//       groups from a sibling import, AND
//   (c) honours `errorDetails=empty` so groups whose errorDetails came
//       in pre-populated from the source file aren't surfaced to the
//       operator (those don't need triage).
//
// Three mixed cases — a freshly-imported empty group, a freshly-imported
// pre-classified group, and an unrelated batch — pin all three contracts.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { inArray } from "drizzle-orm";

import invoiceGroupsRouter from "../routes/invoice-groups";
import {
  db,
  pool,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
const seededGroupIds: number[] = [];

// Per-run tag: clientNumber + invoiceNumber both incorporate it so the
// assertions can scope to the seeded subset and ignore unrelated dev-DB
// rows. The two import batches below also reuse the tag.
const TAG = `T440-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const BATCH_A = `${TAG}-batchA`;
const BATCH_B = `${TAG}-batchB`;

const TEST_USER = {
  email: "post-upload-bridge@example.com",
  displayName: "Bridge Tester",
};

before(async () => {
  const app: Express = express();
  app.use(express.json());
  // Stub auth — same pattern as list-count-past-deadline-parity.test.ts.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
      debug: () => {},
    };
    next();
  });
  app.use("/api", invoiceGroupsRouter);

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      } else {
        reject(new Error("Failed to obtain test server port"));
      }
    });
  });
});

after(async () => {
  if (seededGroupIds.length) {
    await db
      .delete(auditLogsTable)
      .where(inArray(auditLogsTable.invoiceGroupId, seededGroupIds))
      .catch(() => undefined);
    await db
      .delete(invoiceGroupsTable)
      .where(inArray(invoiceGroupsTable.id, seededGroupIds))
      .catch(() => undefined);
  }
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end().catch(() => undefined);
});

function getJson(path: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: "GET",
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          raw += c;
        });
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              json: raw ? JSON.parse(raw) : {},
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function ymdDaysAgo(days: number): string {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

interface SeedOpts {
  label: string;
  importBatch: string;
  errorDetails: string | null;
}

async function seedGroup(opts: SeedOpts): Promise<number> {
  const [g] = await db
    .insert(invoiceGroupsTable)
    .values({
      invoiceNumber: `${TAG}-G-${opts.label}`,
      clientNumber: TAG,
      status: "New",
      outcome: "Pending",
      totalAmount: "100.00",
      // 5 days ago so the default past-deadline guard never hides the
      // row (the bridge call passes no includeExpired/expiring).
      serviceDate: ymdDaysAgo(5),
      importBatch: opts.importBatch,
      errorDetails: opts.errorDetails,
    })
    .returning();
  seededGroupIds.push(g.id);
  return g.id;
}

test("GET /api/invoice-groups?importBatch=…&errorDetails=empty returns the documented envelope and the just-imported untriaged groups (Task #440 bridge query path)", async () => {
  // Three rows: A1 is the untriaged group the bridge should surface;
  // A2 came in pre-classified (errorDetails populated by the source CSV)
  // and should be filtered out by `errorDetails=empty`; B1 belongs to
  // a sibling batch and should be filtered out by the `importBatch`
  // scope. If the row set ever leaked across batches we'd fail (b);
  // if errorDetails=empty leaked rows with text, we'd fail (c); and if
  // the response shape ever degenerated to a bare array we'd fail (a).
  const a1Empty = await seedGroup({
    label: "a1-empty",
    importBatch: BATCH_A,
    errorDetails: null,
  });
  const a2Present = await seedGroup({
    label: "a2-present",
    importBatch: BATCH_A,
    errorDetails: "Late filing — payor flagged",
  });
  const b1Empty = await seedGroup({
    label: "b1-empty",
    importBatch: BATCH_B,
    errorDetails: null,
  });

  const { status, json } = await getJson(
    `/api/invoice-groups?importBatch=${encodeURIComponent(BATCH_A)}&errorDetails=empty&limit=200`,
  );
  assert.equal(
    status,
    200,
    `bridge query HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`,
  );

  // (a) Envelope shape — the original frontend bug assumed a bare array.
  // Pin the shape so a regression to the contract trips this test before
  // it ever reaches an admin's browser.
  assert.equal(typeof json, "object");
  assert.ok(!Array.isArray(json), "response must be the envelope object, not a bare array");
  assert.ok(Array.isArray(json.groups), "response.groups must be an array");
  assert.equal(typeof json.total, "number");
  assert.equal(typeof json.today, "string");
  assert.match(json.today, /^\d{4}-\d{2}-\d{2}$/);

  // (b) + (c) Row-set scoping: only A1 should appear.
  const ids = (json.groups as Array<{ id: number }>).map((g) => g.id);
  assert.ok(
    ids.includes(a1Empty),
    `bridge result missing the untriaged just-imported group (id=${a1Empty})`,
  );
  assert.ok(
    !ids.includes(a2Present),
    `bridge result unexpectedly includes a pre-classified group (id=${a2Present}) — errorDetails=empty leaked`,
  );
  assert.ok(
    !ids.includes(b1Empty),
    `bridge result unexpectedly includes a sibling-batch group (id=${b1Empty}) — importBatch scope leaked`,
  );

  // total/groups parity within the seeded subset (limit > seeded count
  // so this is a single page; the test DB carries unrelated rows so we
  // assert membership not exact equality of `total`).
  const seededInResponse = ids.filter((id) => seededGroupIds.includes(id));
  assert.equal(seededInResponse.length, 1, "exactly one seeded row must match");
});

test("GET /api/invoice-groups for a batch with no matching groups returns the empty envelope (NOT 500, NOT a bare array)", async () => {
  // The bridge mounts unconditionally after every import. If the batch
  // turns up nothing (legitimate — e.g. every imported group already
  // had errorDetails from the source file) the endpoint must return
  // 200 with `groups: []`, not error out — that's exactly the "all
  // clean" empty state the frontend renders.
  const orphanBatch = `${TAG}-batch-orphan`;
  const { status, json } = await getJson(
    `/api/invoice-groups?importBatch=${encodeURIComponent(orphanBatch)}&errorDetails=empty&limit=200`,
  );
  assert.equal(
    status,
    200,
    `orphan-batch HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`,
  );
  assert.ok(Array.isArray(json.groups), "response.groups must be an array even when empty");
  assert.equal(json.groups.length, 0);
  assert.equal(json.total, 0);
  assert.equal(typeof json.today, "string");
});
