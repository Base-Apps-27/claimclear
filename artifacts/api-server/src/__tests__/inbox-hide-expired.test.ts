// Task #644 — Hide expired groups from the Classification Inbox.
//
// `buildNeedsClassificationInbox` (the payload behind both
// `GET /invoice-groups?include=needs_classification` and the back-compat
// `GET /invoice-groups/needs-classification` route) used to bypass the
// expired-hiding rules that the regular `/invoice-groups` list already
// applied, so the Queue page's Classification Inbox surfaced groups
// whose filing deadline had already passed and counted them in the
// "N to classify" badge.
//
// This test locks the new contract:
//
//   (a) An `Expired`-status group with a `needs_classification` leg is
//       omitted from the default inbox.
//   (b) A past-effective-deadline group (service date 40d ago, status
//       `Needs Review`) is omitted from the default inbox.
//   (c) Both (a) and (b) reappear when `?includeExpired=true`.
//   (d) The `total` and `byStatus` tallies match the visible groups[]
//       set exactly in both modes.
//
// The seed is scoped via a per-run `clientNumber` tag so the parity
// assertions ignore unrelated dev-DB rows; we filter the inbox payload
// down to the seeded ids client-side, then re-tally `byStatus` against
// that scoped subset to make the parity check meaningful.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { inArray } from "drizzle-orm";

import invoiceGroupsRouter from "../routes/invoice-groups";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
const seededClaimIds: number[] = [];
const seededGroupIds: number[] = [];

const TAG = `T644-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TEST_USER = { email: "inbox-hide-expired@example.com", displayName: "Inbox Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
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
  if (seededClaimIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.claimId, seededClaimIds)).catch(() => undefined);
    await db.delete(claimsTable).where(inArray(claimsTable.id, seededClaimIds)).catch(() => undefined);
  }
  if (seededGroupIds.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.invoiceGroupId, seededGroupIds)).catch(() => undefined);
    await db.delete(invoiceGroupsTable).where(inArray(invoiceGroupsTable.id, seededGroupIds)).catch(() => undefined);
  }
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end().catch(() => undefined);
});

function getJson(path: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${baseUrl}${path}`);
    const req = http.request(
      { hostname: url.hostname, port: Number(url.port), path: `${url.pathname}${url.search}`, method: "GET" },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : {} }); }
          catch (e) { reject(e); }
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

interface SeedGroupOpts {
  status: "New" | "Needs Review" | "Needs Evidence" | "Expired";
  serviceDate: string;
  label: string;
}

async function seedGroupWithNeedsClassLeg(opts: SeedGroupOpts): Promise<number> {
  const invoiceNumber = `${TAG}-G-${opts.label}`;
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    clientNumber: TAG,
    status: opts.status,
    outcome: "Pending",
    totalAmount: "100.00",
    serviceDate: opts.serviceDate,
  }).returning();
  seededGroupIds.push(group.id);
  // Seed one child leg with no errorTypeId / no duplicateOfClaimId so
  // `deriveLegSubStatus` resolves to `needs_classification` and the
  // group becomes a Classification Inbox candidate.
  const [claim] = await db.insert(claimsTable).values({
    confNumber: `${TAG}-C-${opts.label}`,
    clientNumber: TAG,
    status: "New",
    outcome: "Pending",
    date: opts.serviceDate,
    invoiceGroupId: group.id,
    includedInDispute: true,
  }).returning();
  seededClaimIds.push(claim.id);
  return group.id;
}

// Helper: scope a returned inbox payload to the rows we seeded and
// re-derive `total` / `byStatus` from that scoped subset, mirroring the
// server's own derivation. Lets us make a parity assertion that's
// meaningful even when the dev DB carries unrelated inbox rows.
function tallyScoped(inbox: any, ids: number[]): { total: number; byStatus: Record<string, number>; rows: Array<{ id: number; status: string; needsClassificationCount: number }> } {
  const idSet = new Set(ids);
  const rows = (inbox.groups as Array<{ id: number; status: string; needsClassificationCount: number }>)
    .filter((g) => idSet.has(g.id));
  const total = rows.reduce((acc, g) => acc + g.needsClassificationCount, 0);
  const byStatus: Record<string, number> = {};
  for (const g of rows) {
    byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;
  }
  return { total, byStatus, rows };
}

test("Classification Inbox: hides expired-status and past-deadline groups by default; reappears under includeExpired=true", async () => {
  // Fresh, on-deadline group — must always appear.
  const okFresh = await seedGroupWithNeedsClassLeg({
    status: "Needs Review",
    serviceDate: ymdDaysAgo(5),
    label: "ok-fresh",
  });
  // (a) Expired-status group with a needs_classification leg.
  const expiredStatus = await seedGroupWithNeedsClassLeg({
    status: "Expired",
    serviceDate: ymdDaysAgo(5),
    label: "expired-status",
  });
  // (b) Past-effective-deadline group (40d ago, well past the 30d
  // window even after the weekend → Friday shift) but still in an
  // active status.
  const pastDeadline = await seedGroupWithNeedsClassLeg({
    status: "Needs Review",
    serviceDate: ymdDaysAgo(40),
    label: "past-deadline",
  });

  // --- (a) + (b): default inbox via the embedded path -------------------
  {
    const { status, json } = await getJson(
      `/api/invoice-groups?search=${TAG}&limit=0&include=needs_classification`,
    );
    assert.equal(status, 200, `default HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
    const inbox = json.needsClassificationInbox;
    assert.ok(inbox, "missing needsClassificationInbox in default response");
    const ids = (inbox.groups as Array<{ id: number }>).map((g) => g.id);
    assert.ok(ids.includes(okFresh), `default inbox missing fresh on-deadline group (id=${okFresh})`);
    assert.ok(!ids.includes(expiredStatus),
      `default inbox unexpectedly includes Expired-status group (id=${expiredStatus})`);
    assert.ok(!ids.includes(pastDeadline),
      `default inbox unexpectedly includes past-deadline group (id=${pastDeadline})`);
  }

  // --- (c): both reappear with includeExpired=true ----------------------
  {
    const { status, json } = await getJson(
      `/api/invoice-groups?search=${TAG}&limit=0&include=needs_classification&includeExpired=true`,
    );
    assert.equal(status, 200, `includeExpired HTTP ${status}: ${JSON.stringify(json).slice(0, 300)}`);
    const inbox = json.needsClassificationInbox;
    assert.ok(inbox, "missing needsClassificationInbox in includeExpired response");
    const ids = (inbox.groups as Array<{ id: number }>).map((g) => g.id);
    for (const id of [okFresh, expiredStatus, pastDeadline]) {
      assert.ok(ids.includes(id), `?includeExpired=true inbox missing seeded id=${id}`);
    }
  }

  // --- (d): tallies match the visible (scoped) row set in both modes ----
  {
    const { json: defaultJson } = await getJson(
      `/api/invoice-groups?search=${TAG}&limit=0&include=needs_classification`,
    );
    const defScoped = tallyScoped(defaultJson.needsClassificationInbox, [okFresh, expiredStatus, pastDeadline]);
    // Only `okFresh` should be in the scoped subset; tallies must agree.
    assert.equal(defScoped.rows.length, 1, `default scoped row count expected 1, got ${defScoped.rows.length}`);
    assert.equal(defScoped.total, 1, `default scoped total mismatch: ${defScoped.total}`);
    assert.deepEqual(defScoped.byStatus, { "Needs Review": 1 },
      `default scoped byStatus mismatch: ${JSON.stringify(defScoped.byStatus)}`);

    const { json: allJson } = await getJson(
      `/api/invoice-groups?search=${TAG}&limit=0&include=needs_classification&includeExpired=true`,
    );
    const allScoped = tallyScoped(allJson.needsClassificationInbox, [okFresh, expiredStatus, pastDeadline]);
    assert.equal(allScoped.rows.length, 3, `includeExpired scoped row count expected 3, got ${allScoped.rows.length}`);
    assert.equal(allScoped.total, 3, `includeExpired scoped total mismatch: ${allScoped.total}`);
    assert.deepEqual(allScoped.byStatus, { "Needs Review": 2, "Expired": 1 },
      `includeExpired scoped byStatus mismatch: ${JSON.stringify(allScoped.byStatus)}`);

    // Server-reported tally parity (unscoped): the returned `total` and
    // `byStatus` must agree with the returned `groups[]` exactly. This
    // is the internal-consistency guarantee — even with unrelated
    // dev-DB rows present, the server can never emit a `total` or
    // `byStatus` that disagrees with the inbox rows it just returned.
    for (const inbox of [defaultJson.needsClassificationInbox, allJson.needsClassificationInbox]) {
      const groups = inbox.groups as Array<{ status: string; needsClassificationCount: number }>;
      const sumFromGroups = groups.reduce((acc, g) => acc + g.needsClassificationCount, 0);
      assert.equal(inbox.total, sumFromGroups,
        `inbox.total=${inbox.total} disagrees with sum(groups[].needsClassificationCount)=${sumFromGroups}`);
      const derivedByStatus: Record<string, number> = {};
      for (const g of groups) derivedByStatus[g.status] = (derivedByStatus[g.status] ?? 0) + 1;
      assert.deepEqual(inbox.byStatus, derivedByStatus,
        `inbox.byStatus=${JSON.stringify(inbox.byStatus)} disagrees with derived=${JSON.stringify(derivedByStatus)}`);
    }
  }

  // --- back-compat route honors the same opt-in ------------------------
  {
    const { status: s1, json: j1 } = await getJson(`/api/invoice-groups/needs-classification`);
    assert.equal(s1, 200);
    const ids1 = (j1.groups as Array<{ id: number }>).map((g) => g.id);
    assert.ok(!ids1.includes(expiredStatus), "back-compat default inbox leaked Expired-status group");
    assert.ok(!ids1.includes(pastDeadline), "back-compat default inbox leaked past-deadline group");

    const { status: s2, json: j2 } = await getJson(`/api/invoice-groups/needs-classification?includeExpired=true`);
    assert.equal(s2, 200);
    const ids2 = (j2.groups as Array<{ id: number }>).map((g) => g.id);
    for (const id of [expiredStatus, pastDeadline]) {
      assert.ok(ids2.includes(id), `back-compat ?includeExpired=true missing id=${id}`);
    }
  }
});
