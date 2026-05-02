// Task #351 — typed `claims.date` (DATE) end-to-end contract.
//
// Two surfaces covered:
//   1. Importer (POST /api/import) — must accept ISO and legacy
//      M/D/YYYY / M/D/YY shapes (importer normalizes via
//      `normalizeServiceDate`), reject anything else with a structured
//      per-row reason, and never silently null an unparseable date.
//      Empty / missing dates are still allowed (land as NULL).
//   2. DB read paths — drizzle's `mode: "string"` parser must return
//      `claim.date` as a strict YYYY-MM-DD string (or null), and the
//      MIN-of-claims-date aggregate used by the dashboard / invoice
//      groups list must come back as a YYYY-MM-DD string via the
//      `MIN(date)::text` cast that replaced the old
//      `to_char(MIN(NULLIF(date,'')::date), 'YYYY-MM-DD')` wrapping.
//
// Bootstrap mirrors per-leg-state.test.ts: a tiny express app with the
// importer mounted under /api, the dev DB pool, and per-test cleanup
// keyed by the random conf number prefix.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, sql } from "drizzle-orm";

import importRouter from "../routes/import";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
const TEST_USER = { email: "typed-date-tester@example.com", displayName: "Typed Date Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", importRouter);
  await new Promise<void>((res, rej) => {
    server = app.listen(0, () => {
      const a = server.address();
      if (typeof a === "object" && a) {
        baseUrl = `http://127.0.0.1:${a.port}`;
        res();
      } else rej(new Error("could not bind test server"));
    });
  });
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((res) => server.close(() => res()));
  await pool.end().catch(() => undefined);
});

async function postJson(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload).toString() },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try { resolveReq({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : {} }); }
          catch (e) { rejectReq(e); }
        });
      },
    );
    req.on("error", rejectReq);
    req.write(payload);
    req.end();
  });
}

// Conf numbers for inserted rows are bound to a single numeric prefix
// per test so cleanup is a single-WHERE delete that doesn't accidentally
// remove rows from a parallel test or unrelated dev fixtures.
//
// MUST be numeric: the importer's row filter rejects non-numeric
// conf numbers via `isNaN(Number(confStr))`. Stamp a 9-digit prefix
// per test so the SQL `LIKE prefix%` in cleanup is unambiguous and
// the conf numbers stay parseable.
function makeConfPrefix(): string {
  // 9-digit base — large enough to collide-proof across parallel test
  // files that share the dev DB, small enough to leave room for a
  // single-digit per-row suffix without overflowing JS's safe-int
  // window when the importer Number()-checks the conf string.
  const ts = Date.now() % 1_000_000_000;
  const rand = Math.floor(Math.random() * 1_000);
  return `${ts}${rand.toString().padStart(3, "0")}`;
}

async function cleanupByConfPrefix(prefix: string): Promise<void> {
  const claims = await db
    .select({ id: claimsTable.id, invoiceGroupId: claimsTable.invoiceGroupId })
    .from(claimsTable)
    .where(sql`${claimsTable.confNumber} LIKE ${prefix + "%"}`);
  const groupIds = new Set<number>();
  for (const c of claims) {
    if (c.invoiceGroupId != null) groupIds.add(c.invoiceGroupId);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, c.id)).catch(() => undefined);
    await db.delete(claimsTable).where(eq(claimsTable.id, c.id)).catch(() => undefined);
  }
  for (const gid of groupIds) {
    await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, gid)).catch(() => undefined);
    await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, gid)).catch(() => undefined);
  }
}

// --- Importer accept/reject ----------------------------------------------

test("Importer normalizes ISO + legacy M/D/YYYY + M/D/YY into the typed DATE column", async () => {
  const prefix = makeConfPrefix();
  try {
    const isoConf = `${prefix}1`;
    const usConf = `${prefix}2`;
    const us2Conf = `${prefix}3`;
    const emptyConf = `${prefix}4`;
    const res = await postJson("/api/import", {
      rows: [
        { confNumber: isoConf, date: "2026-04-02", errorTypeId: "1", errorTypeName: "X", errorDetails: "x" },
        { confNumber: usConf,  date: "4/2/2026",   errorTypeId: "1", errorTypeName: "X", errorDetails: "x" },
        { confNumber: us2Conf, date: "4/28/26",    errorTypeId: "1", errorTypeName: "X", errorDetails: "x" },
        { confNumber: emptyConf, date: "",         errorTypeId: "1", errorTypeName: "X", errorDetails: "x" },
      ],
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.created, 4, "every parseable + empty row must persist");
    assert.deepEqual(res.json.rejected, [], "no row should be rejected");

    // The DB column is DATE; drizzle `mode: "string"` returns ISO.
    const [iso] = await db.select().from(claimsTable).where(eq(claimsTable.confNumber, isoConf));
    const [us]  = await db.select().from(claimsTable).where(eq(claimsTable.confNumber, usConf));
    const [us2] = await db.select().from(claimsTable).where(eq(claimsTable.confNumber, us2Conf));
    const [emp] = await db.select().from(claimsTable).where(eq(claimsTable.confNumber, emptyConf));
    assert.equal(iso.date, "2026-04-02");
    assert.equal(us.date, "2026-04-02");
    assert.equal(us2.date, "2026-04-28");
    assert.equal(emp.date, null, "empty-string date must persist as NULL, not silently dropped");
  } finally {
    await cleanupByConfPrefix(prefix);
  }
});

test("Importer rejects unparseable dates with structured per-row reason, never silently nulls", async () => {
  const prefix = makeConfPrefix();
  try {
    const goodConf = `${prefix}1`;
    const badConf = `${prefix}2`;
    const partialConf = `${prefix}3`;
    const res = await postJson("/api/import", {
      rows: [
        { confNumber: goodConf, date: "2026-05-01", errorTypeId: "1", errorTypeName: "X", errorDetails: "x" },
        { confNumber: badConf,  date: "not-a-date", errorTypeId: "1", errorTypeName: "X", errorDetails: "x" },
        { confNumber: partialConf, date: "2026", errorTypeId: "1", errorTypeName: "X", errorDetails: "x" },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.created, 1, "only the parseable row should land");
    assert.equal(res.json.rejected.length, 2, "both unparseable rows must be reported");

    const reasons = res.json.rejected.map((r: { confNumber: string; reason: string; rawDate: string }) => r.reason);
    assert.ok(reasons.every((r: string) => r === "invalid_service_date"));
    const byConf = new Map(res.json.rejected.map((r: any) => [r.confNumber, r.rawDate]));
    assert.equal(byConf.get(badConf), "not-a-date");
    assert.equal(byConf.get(partialConf), "2026");

    // Critical: rejected rows must NOT have been inserted. The old
    // contract silently nulled their date and let them through; the
    // new contract refuses them up front.
    const surviving = await db.select({ id: claimsTable.id }).from(claimsTable)
      .where(sql`${claimsTable.confNumber} IN (${badConf}, ${partialConf})`);
    assert.equal(surviving.length, 0, "rejected rows must NOT be inserted");

    // The accepted row landed with a typed DATE value.
    const [good] = await db.select().from(claimsTable).where(eq(claimsTable.confNumber, goodConf));
    assert.equal(good.date, "2026-05-01");
  } finally {
    await cleanupByConfPrefix(prefix);
  }
});

test("Importer skipped count includes rejected rows; audit row records the rejected sample", async () => {
  const prefix = makeConfPrefix();
  try {
    const goodConf = `${prefix}1`;
    const badConf = `${prefix}2`;
    const res = await postJson("/api/import", {
      rows: [
        { confNumber: goodConf, date: "2026-05-01", errorTypeId: "1", errorTypeName: "X", errorDetails: "x" },
        { confNumber: badConf,  date: "garbage",    errorTypeId: "1", errorTypeName: "X", errorDetails: "x" },
      ],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.created, 1);
    assert.equal(res.json.rejected.length, 1);
    // total includes everything submitted; skipped covers dup/invalid
    // both — the rejected count rolls into skipped so the operator's
    // "imported X / skipped Y / total Z" totals always sum cleanly.
    assert.equal(res.json.total, 2);
    assert.ok(res.json.skipped >= 1, "skipped count must include the rejected row");

    // The audit row carries the rejected sample so the cutover is
    // discoverable later via the audit_logs feed.
    const audits = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.action, "claims_imported"));
    const ours = audits.find((a) => {
      const m = a.metadata as { batchId?: string } | null;
      return m?.batchId === res.json.batchId;
    });
    assert.ok(ours, "claims_imported audit row must exist for this batch");
    const meta = ours!.metadata as {
      rejectedCount?: number;
      rejectedSample?: Array<{ confNumber: string; reason: string; rawDate: string }>;
    };
    assert.equal(meta.rejectedCount, 1);
    assert.equal(meta.rejectedSample?.[0]?.confNumber, badConf);
    assert.equal(meta.rejectedSample?.[0]?.rawDate, "garbage");
    assert.equal(meta.rejectedSample?.[0]?.reason, "invalid_service_date");
  } finally {
    await cleanupByConfPrefix(prefix);
  }
});

// --- DB read-path contract -----------------------------------------------

test("DB returns claims.date as ISO string (drizzle mode: \"string\") and aggregates as YYYY-MM-DD via ::text", async () => {
  // Seed three claims in a single invoice group with mixed-month
  // service dates. Verifies:
  //   1. Direct column read returns ISO YYYY-MM-DD (no Date object,
  //      no to_char wrap needed).
  //   2. MIN()::text returns the calendar-earliest date as YYYY-MM-DD
  //      — not the lexically-earliest pre-typed-column shape.
  const prefix = makeConfPrefix();
  try {
    const [group] = await db.insert(invoiceGroupsTable).values({
      invoiceNumber: `${prefix}-INV`,
      status: "Needs Evidence",
      outcome: "Pending",
    }).returning();

    await db.insert(claimsTable).values([
      { confNumber: `${prefix}1`, date: "2026-04-15", invoiceGroupId: group.id, status: "New", outcome: "Pending", claimAmount: "10.00" },
      { confNumber: `${prefix}2`, date: "2026-04-02", invoiceGroupId: group.id, status: "New", outcome: "Pending", claimAmount: "10.00" },
      { confNumber: `${prefix}3`, date: "2026-10-02", invoiceGroupId: group.id, status: "New", outcome: "Pending", claimAmount: "10.00" },
    ]);

    // (1) drizzle's `mode: "string"` parser yields ISO strings.
    const rows = await db.select().from(claimsTable)
      .where(eq(claimsTable.invoiceGroupId, group.id));
    const dates = rows.map((r) => r.date).sort();
    assert.deepEqual(dates, ["2026-04-02", "2026-04-15", "2026-10-02"]);
    for (const r of rows) {
      assert.equal(typeof r.date, "string", "drizzle must return strings, not Date objects");
      assert.match(r.date!, /^\d{4}-\d{2}-\d{2}$/);
    }

    // (2) MIN(date)::text — the cast we use across dashboard, invoice-
    // groups, urgent-snapshot, day-complete — comes back as the
    // calendar-earliest date in ISO form. (Lexical text MIN of the
    // legacy '4/2/2026' / '4/15/2026' shape would have picked
    // '4/15/2026' because '1' < '2' — that bug class is gone.)
    const [agg] = await db
      .select({ earliest: sql<string | null>`MIN(${claimsTable.date})::text` })
      .from(claimsTable)
      .where(eq(claimsTable.invoiceGroupId, group.id));
    assert.equal(agg.earliest, "2026-04-02");
  } finally {
    await cleanupByConfPrefix(prefix);
  }
});
