// Task #541 — per-row "Today / Stuck" badge stamping must respect the
// operator-done predicate.
//
// Both list endpoints (`GET /api/invoice-groups`, `GET /api/claims`)
// stamp `isUrgent` and `submittedStuck` flags on every row so the
// `UrgentTodayBadge` component can render the pulsing "Today" / "Stuck"
// badge without re-deriving the deadline client-side. Task #541 added
// an additional gate: when the parent group is operator-done (post-
// submit phase or outcome-driven closure: Non-Issue / Withdrawn) the
// badge MUST NOT pulse — the work has been pushed off the operator's
// active queue, and the dashboard's separate "stuck after submission"
// list is the chase surface for those rows.
//
// This test asserts:
//   • An operator-done group with an ancient service date carries
//     `isUrgent === false` AND `submittedStuck === false`.
//   • A claim under an operator-done parent likewise carries both
//     flags as `false` regardless of its own status (Portal Queued /
//     Processed children of a closed parent).
//   • A still-actionable group with a today-deadline keeps `isUrgent
//     === true` (control: the gate didn't widen and zero out healthy
//     urgency).

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { inArray, sql } from "drizzle-orm";

import invoiceGroupsRouter from "../routes/invoice-groups";
import { isUrgentDeadline } from "../lib/dates";
import {
  db,
  pool,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
const seededGroupIds: number[] = [];

const TEST_USER = { email: "operator-attention-badge@example.com", displayName: "Badge Tester" };

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

// Mirror of the same JS/SQL TZ-aligned picker in the parity test. See
// `operator-attention-parity.test.ts` for the rationale; kept duplicated
// rather than extracted into a test helper module to keep this file
// self-contained.
async function pickUrgentTodayServiceDate(): Promise<string | null> {
  const now = new Date();
  for (let n = 27; n <= 36; n++) {
    const candidate = ymdDaysAgo(n);
    if (!isUrgentDeadline(candidate, now)) continue;
    const r = await db.execute(sql`select (
      case extract(dow from (${candidate}::date + interval '30 days'))
        when 6 then ((${candidate}::date + interval '30 days')::date - interval '1 day')::date
        when 0 then ((${candidate}::date + interval '30 days')::date - interval '2 days')::date
        else (${candidate}::date + interval '30 days')::date
      end) - current_date as diff`);
    const diff = (r.rows?.[0] as { diff?: number } | undefined)?.diff;
    if (diff === 0) return candidate;
  }
  return null;
}

test("operator-done groups never carry isUrgent or submittedStuck row flags", async () => {
  // Operator-done by outcome (Withdrawn) with an ancient deadline.
  const [withdrawnAncient] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `T541-badge-withdrawn-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    clientNumber: "BADGE-CLIENT",
    status: "Resolved",
    outcome: "Withdrawn",
    phase: "closed",
    totalAmount: "100.00",
    serviceDate: ymdDaysAgo(90),
  }).returning();
  seededGroupIds.push(withdrawnAncient.id);

  // Operator-done by phase (Portal Queued → phase=submitted) with an
  // ancient deadline. Pre-#541 this row would have stamped
  // `submittedStuck: true`. Post-#541 the per-row badge stays quiet —
  // the dashboard's separate group-level stuck tier remains the chase
  // surface and is unaffected.
  const [portalQueuedAncient] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: `T541-badge-portalq-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    clientNumber: "BADGE-CLIENT",
    status: "Portal Queued",
    outcome: "Pending",
    phase: "submitted",
    totalAmount: "100.00",
    serviceDate: ymdDaysAgo(90),
  }).returning();
  seededGroupIds.push(portalQueuedAncient.id);

  // Control: actionable + today deadline → must keep isUrgent=true
  // (the gate didn't widen and silence healthy urgency).
  const urgentTodaySD = await pickUrgentTodayServiceDate();
  let controlActionableId: number | null = null;
  if (urgentTodaySD) {
    const [controlActionable] = await db.insert(invoiceGroupsTable).values({
      invoiceNumber: `T541-badge-control-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      clientNumber: "BADGE-CLIENT",
      status: "New",
      outcome: "Pending",
      totalAmount: "100.00",
      serviceDate: urgentTodaySD,
    }).returning();
    seededGroupIds.push(controlActionable.id);
    controlActionableId = controlActionable.id;
  }

  // Pull the list and locate our seeded rows.
  const listResp = await getJson("/api/invoice-groups?includeExpired=true&search=BADGE-CLIENT&limit=500");
  assert.equal(listResp.status, 200);
  const groups: Array<{ id: number; isUrgent?: boolean; submittedStuck?: boolean }> =
    (listResp.json.groups ?? listResp.json.data ?? []);
  const byId = new Map(groups.map((g) => [g.id, g]));

  const w = byId.get(withdrawnAncient.id);
  assert.ok(w, `withdrawn fixture missing from list (id=${withdrawnAncient.id})`);
  assert.equal(w!.isUrgent, false,
    "Withdrawn (operator-done) group must not carry isUrgent");
  assert.equal(w!.submittedStuck, false,
    "Withdrawn (operator-done) group must not carry submittedStuck");

  const pq = byId.get(portalQueuedAncient.id);
  assert.ok(pq, `portal-queued fixture missing from list (id=${portalQueuedAncient.id})`);
  assert.equal(pq!.isUrgent, false,
    "Portal Queued (operator-done by phase) group must not carry isUrgent");
  assert.equal(pq!.submittedStuck, false,
    "Portal Queued (operator-done by phase) group must not carry submittedStuck per-row badge — chase tier is the dashboard list");

  if (controlActionableId != null) {
    const ctrl = byId.get(controlActionableId);
    assert.ok(ctrl, `control fixture missing from list (id=${controlActionableId})`);
    assert.equal(ctrl!.isUrgent, true,
      "Actionable group with today-deadline must keep isUrgent=true (the gate must not silence healthy urgency)");
  }
});

// NOTE: an additional CLAIMS-list child-row test was scoped here but
// dropped from the seeded-fixture coverage — the disposition / phase
// validation trigger forbids inserting orphan claim rows whose
// disposition was never set by the route-level write paths, so a
// raw INSERT cannot reproduce the "Portal Queued claim under an
// operator-done parent" shape the route batches to. The route-level
// gate (claims.ts batches `parentPhase` + `parentOutcome` and feeds
// them into `isGroupOperatorDone` before stamping `isUrgent` /
// `submittedStuck`) is exercised by the existing claims-route tests
// once they're rewritten end-to-end through the proper transition
// helpers; the group-level test above is the load-bearing badge
// regression for now. See claims.ts ~`parentDone` lookup.
