// Task #834 — contract test for the "Why this number?" drawer endpoint.
//
// Locks the invariant that GET /api/dashboard/explain/:kpiKey returns
// `rows.length === <the same count the dashboard tile renders>`. If a
// future refactor diverges the explain SQL from the summary SQL, the
// drawer would silently show a different number than the tile — that's
// the user-visible regression this test guards against.
//
// Strategy: boot a minimal Express app with the same routers the
// dashboard/web app mounts (dashboard, invoice-groups, claims), hit
// both the canonical count endpoint and the explain endpoint against
// the live DB, and assert the two numbers agree.
//
// We assert parity for the count-shaped KPIs (urgent, stuck, responses,
// reattests). `recovered` is a dollar amount on the tile, not a count,
// so for it we just lock the structural invariant that
// `value === rows.length` (already enforced in code) and that the
// endpoint shape is sound.
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express } from "express";

import dashboardRouter, {
  type DashboardExplainKpiKey,
} from "../routes/dashboard";
import invoiceGroupsRouter from "../routes/invoice-groups";
import claimsRouter from "../routes/claims";
import { pool } from "@workspace/db";

let server: http.Server;
let baseUrl: string;

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/api", dashboardRouter);
  app.use("/api", invoiceGroupsRouter);
  app.use("/api", claimsRouter);

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

interface ExplainResponse {
  kpiKey: DashboardExplainKpiKey;
  label: string;
  value: number;
  valueDisplay: string;
  amountTotal: string | null;
  predicateText: string;
  rows: Array<{
    id: number | string;
    kind: "group" | "claim";
    ref: string;
    payor: string | null;
    serviceDate: string | null;
    status: string;
    reason: string;
    href: string;
    amount: string | null;
  }>;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`);
  assert.equal(res.status, 200, `${path} → expected 200, got ${res.status}`);
  return (await res.json()) as T;
}

async function fetchExplain(kpi: DashboardExplainKpiKey): Promise<ExplainResponse> {
  return fetchJson<ExplainResponse>(`/api/dashboard/explain/${kpi}`);
}

// =========================================================================
// Structural invariants — apply to every KPI.
// =========================================================================
for (const kpi of ["urgent", "stuck", "recovered", "responses", "reattests"] as const) {
  test(`explain[${kpi}]: value === rows.length and shape is well-formed`, async () => {
    const body = await fetchExplain(kpi);
    assert.equal(body.kpiKey, kpi);
    assert.equal(typeof body.label, "string");
    assert.ok(body.label.length > 0, "label must be non-empty");
    assert.equal(typeof body.predicateText, "string");
    assert.ok(body.predicateText.length > 0, "predicateText must be non-empty");
    assert.ok(Array.isArray(body.rows), "rows must be an array");
    assert.equal(body.value, body.rows.length,
      `value (${body.value}) must equal rows.length (${body.rows.length})`);
    assert.equal(typeof body.valueDisplay, "string", "valueDisplay must be a string");
    assert.ok(body.valueDisplay.length > 0, "valueDisplay must be non-empty");
    if (kpi === "recovered") {
      assert.ok(body.valueDisplay.startsWith("$"),
        `recovered drawer must render dollars, not a row count (got '${body.valueDisplay}')`);
      assert.equal(typeof body.amountTotal, "string", "recovered.amountTotal must be present");
    } else {
      assert.equal(body.valueDisplay, String(body.value),
        `count-shaped KPI ${kpi} must render valueDisplay === String(value)`);
      assert.equal(body.amountTotal, null,
        `count-shaped KPI ${kpi} must not carry amountTotal`);
    }
    // Each row must carry the fields the drawer renders.
    for (const r of body.rows) {
      assert.ok(r.id !== undefined && r.id !== null, "row.id required");
      assert.ok(r.kind === "group" || r.kind === "claim", "row.kind enum");
      assert.equal(typeof r.ref, "string", "row.ref string");
      assert.equal(typeof r.status, "string", "row.status string");
      assert.equal(typeof r.reason, "string", "row.reason string");
      assert.equal(typeof r.href, "string", "row.href string");
      assert.ok(r.href.startsWith("/"), "row.href is a relative deep link");
    }
  });
}

test("explain: unknown kpiKey returns 400", async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/explain/bogus`);
  assert.equal(res.status, 400);
});

// =========================================================================
// Cross-endpoint parity — drawer count must match the tile count.
// =========================================================================
test("explain[urgent].rows.length === /dashboard/summary urgentCount", async () => {
  const [explain, summary] = await Promise.all([
    fetchExplain("urgent"),
    fetchJson<{ urgentCount: number }>("/api/dashboard/summary"),
  ]);
  assert.equal(
    explain.rows.length,
    summary.urgentCount,
    `urgent drawer rows (${explain.rows.length}) must match summary.urgentCount (${summary.urgentCount})`,
  );
});

test("explain[stuck].rows.length === /dashboard/summary submittedStuckCount", async () => {
  const [explain, summary] = await Promise.all([
    fetchExplain("stuck"),
    fetchJson<{ submittedStuckCount: number }>("/api/dashboard/summary"),
  ]);
  assert.equal(
    explain.rows.length,
    summary.submittedStuckCount,
    `stuck drawer rows (${explain.rows.length}) must match summary.submittedStuckCount (${summary.submittedStuckCount})`,
  );
});

test("explain[responses].rows.length === /responses/awaiting-review/count", async () => {
  const [explain, count] = await Promise.all([
    fetchExplain("responses"),
    fetchJson<{ count: number }>("/api/responses/awaiting-review/count"),
  ]);
  assert.equal(
    explain.rows.length,
    count.count,
    `responses drawer rows (${explain.rows.length}) must match awaiting-review count (${count.count})`,
  );
});

test("explain[recovered].amountTotal === /dashboard/summary amounts.recoveredAmount", async () => {
  // The Recovered $ tile renders a dollar value, not a count. The
  // drawer's contribution sum (amountTotal) and the formatted
  // valueDisplay must agree to the cent with what the dashboard
  // summary endpoint published — otherwise the drawer is "explaining"
  // a different number than the tile.
  const [explain, summary] = await Promise.all([
    fetchExplain("recovered"),
    fetchJson<{ amounts: { recoveredAmount: string } }>("/api/dashboard/summary"),
  ]);
  const drawerTotal = parseFloat(explain.amountTotal ?? "0");
  const summaryTotal = parseFloat(summary.amounts.recoveredAmount ?? "0");
  assert.equal(
    drawerTotal.toFixed(2),
    summaryTotal.toFixed(2),
    `recovered drawer Σ contributions ($${drawerTotal.toFixed(2)}) must match summary.amounts.recoveredAmount ($${summaryTotal.toFixed(2)})`,
  );
  // And the display string the drawer header renders must mirror the
  // tile (modulo formatting); both are dollar strings starting with $.
  assert.ok(
    explain.valueDisplay.startsWith("$"),
    `valueDisplay must be a dollar string, got '${explain.valueDisplay}'`,
  );
});

test("explain[reattests].rows.length === /attestation/counts pending+queued", async () => {
  const [explain, counts] = await Promise.all([
    fetchExplain("reattests"),
    fetchJson<{ pending: number; queued: number }>("/api/attestation/counts"),
  ]);
  const total = counts.pending + counts.queued;
  assert.equal(
    explain.rows.length,
    total,
    `reattests drawer rows (${explain.rows.length}) must match pending+queued (${total})`,
  );
});
