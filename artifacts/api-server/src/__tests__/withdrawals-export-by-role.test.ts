// Task #890 — route + helper tests for the per-responsibility CSV
// export. Covers:
//   • filename builder unit cases (no DB / network)
//   • party-safe row shape (no operator email / no raw enum leakage)
//   • CSV-injection prefix-quote guard regression
//   • column-set diff vs the operator CSV
//   • 403 when caller doesn't hold the requested role
//   • happy path emits ONE withdrawals_csv_exported audit row, refusal emits zero
//   • cross-filter parity (closedFrom honored same as operator CSV)
//   • empty rowset returns header-only CSV (not 204 / not HTML)
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, count, and } from "drizzle-orm";

import withdrawalsRouter from "../routes/withdrawals";
import {
  buildByRoleFilename,
  partySafeRow,
  csvCell,
  PARTY_SAFE_HEADERS,
} from "../routes/withdrawals";
import {
  db,
  pool,
  usersTable,
  claimsTable,
  auditLogsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
let currentUser: { id: string; email: string; displayName: string; role: string };

const userItCoo = {
  id: `tu890-it-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  email: `it890-${Date.now()}@example.com`,
  displayName: "IT Coord 890",
  role: "user",
  isPortalOnly: true,
};
const userContact = {
  id: `tu890-cc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  email: `cc890-${Date.now()}@example.com`,
  displayName: "Contact Center 890",
  role: "user",
  isPortalOnly: true,
};
const userAdmin = {
  id: `tu890-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  email: `admin890-${Date.now()}@example.com`,
  displayName: "Admin 890",
  role: "admin",
  isPortalOnly: false,
};

before(async () => {
  await db.insert(usersTable).values([
    { id: userItCoo.id, email: userItCoo.email, firstName: "IT", lastName: "Coord",
      role: "user", status: "approved", isPortalOnly: true,
      responsibleRoles: ["it_coordinator_or_coo"] },
    { id: userContact.id, email: userContact.email, firstName: "Contact", lastName: "Center",
      role: "user", status: "approved", isPortalOnly: true,
      responsibleRoles: ["contact_center_manager"] },
    { id: userAdmin.id, email: userAdmin.email, firstName: "Admin", lastName: "User",
      role: "admin", status: "approved",
      responsibleRoles: [] },
  ]).onConflictDoNothing();

  currentUser = userAdmin;

  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...currentUser, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", withdrawalsRouter);

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
  for (const u of [userItCoo, userContact, userAdmin]) {
    await db.delete(usersTable).where(eq(usersTable.id, u.id)).catch(() => undefined);
  }
  await pool.end().catch(() => undefined);
});

function setActor(u: typeof userItCoo) { currentUser = u; }

async function fetchRaw(path: string): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: "GET",
    }, (resp) => {
      let data = ""; resp.setEncoding("utf8");
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => resolveReq({
        status: resp.statusCode ?? 0, body: data, headers: resp.headers as any,
      }));
    });
    req.on("error", rejectReq); req.end();
  });
}

async function seedClaim(opts: { responsibility?: string; narrative?: string; closedAtDaysAgo?: number } = {}): Promise<number> {
  const [row] = await db.insert(claimsTable).values({
    confNumber: `T890-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    status: "Resolved", outcome: "Withdrawn", disposition: "disposed_withdraw",
    closureReason: "cannot_dispute",
    closureResponsibility: opts.responsibility ?? "system_error",
    closureReviewState: "pending",
    closureNarrative: opts.narrative ?? "Standard narrative",
  }).returning({ id: claimsTable.id });
  return row!.id;
}

async function cleanupClaim(id: number) {
  await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, id)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, id)).catch(() => undefined);
}

async function auditCountSince(beforeMs: number, action: string): Promise<number> {
  const all = await db.select({ id: auditLogsTable.id, ts: auditLogsTable.timestamp })
    .from(auditLogsTable).where(eq(auditLogsTable.action, action));
  return all.filter(r => new Date(r.ts as any).getTime() >= beforeMs).length;
}

// ───────── Filename builder (pure) ─────────

test("filename: no date filters → alltime…today", () => {
  const fn = buildByRoleFilename({
    role: "contact_center_manager", reasons: null,
    closedFrom: null, closedTo: null, today: "2026-05-24",
  });
  assert.equal(fn, "closures-contact-center-manager-all-alltime-to-2026-05-24.csv");
});

test("filename: both dates → iso-to-iso", () => {
  const fn = buildByRoleFilename({
    role: "contractor_relations_coordinator", reasons: ["non_issue"],
    closedFrom: "2026-05-01", closedTo: "2026-05-24", today: "2026-05-24",
  });
  assert.equal(fn, "closures-contractor-relations-non-issue-2026-05-01-to-2026-05-24.csv");
});

test("filename: all three reasons collapse to 'all'", () => {
  const fn = buildByRoleFilename({
    role: "it_coordinator_or_coo",
    reasons: ["cannot_dispute", "non_issue", "denied_by_payor"],
    closedFrom: "2026-04-01", closedTo: "2026-04-30", today: "2026-05-24",
  });
  assert.equal(fn, "closures-it-coordinator-all-2026-04-01-to-2026-04-30.csv");
});

// ───────── csvCell injection guard ─────────

test("csvCell: equation prefix gets single-quote escape", () => {
  assert.equal(csvCell("=cmd|' /C calc'!A0"), `"'=cmd|' /C calc'!A0"`);
  assert.equal(csvCell("+1234"), `"'+1234"`);
  assert.equal(csvCell("@foo"), `"'@foo"`);
});

test("csvCell: ordinary text not escaped", () => {
  assert.equal(csvCell("hello"), `"hello"`);
  assert.equal(csvCell(null), `""`);
});

// ───────── Party-safe row shape ─────────

test("partySafeRow: no operator email, no raw enum, role label resolved", () => {
  const cells = partySafeRow({
    kind: "claim", id: 1, identifier: "C-1",
    clientNumber: "M-9", errorTypeName: "GPS Deviation",
    errorDetails: "details", outcome: "Withdrawn",
    closureReason: "cannot_dispute",
    closureCategory: "Other",
    closureRootCause: null, closureNarrative: "the operator narrative",
    closureAccountabilityTags: null, amount: "12.34",
    closedAt: "2026-05-01T00:00:00Z", closedBy: null,
    closedByName: "Op Name", closedByEmail: "secret@example.com",
    closureReviewState: "pending", closureCommunicatedTo: "ops note",
    closureReviewNotes: null,
    closureAddressedAt: null, closureAddressedBy: null,
    closureAddressedByEmail: "leak@example.com",
    closureResponsibility: "agent_mistake", addressed: false,
  }, new Date("2026-05-24T00:00:00Z"));
  const joined = cells.join("|");
  assert.ok(!joined.includes("secret@example.com"), "must not leak closedByEmail");
  assert.ok(!joined.includes("leak@example.com"), "must not leak addressed-by email");
  assert.ok(!joined.includes("cannot_dispute"), "must not leak raw enum");
  assert.ok(joined.includes("Cannot dispute"), "must include label");
  assert.ok(joined.includes("Contact Center Manager"), "must include role label");
  // Category "Other" → blank
  assert.equal(cells[5], "");
});

// ───────── 403 cross-role ─────────

test("403: portal user with wrong role gets 403 and writes no audit row", async () => {
  setActor(userItCoo as any);
  const startMs = Date.now();
  const res = await fetchRaw("/api/withdrawals/export-csv/by-role?role=contact_center_manager");
  assert.equal(res.status, 403);
  // Must not write any withdrawals_csv_exported audit rows during the call.
  const written = await auditCountSince(startMs, "withdrawals_csv_exported");
  assert.equal(written, 0, "refusal path must not insert any audit row");
});

test("400: missing role parameter → 400, no audit", async () => {
  setActor(userAdmin as any);
  const startMs = Date.now();
  const res = await fetchRaw("/api/withdrawals/export-csv/by-role");
  assert.equal(res.status, 400);
  const written = await auditCountSince(startMs, "withdrawals_csv_exported");
  assert.equal(written, 0);
});

// ───────── Happy path + audit + header-only on empty + injection ─────────

test("happy path: admin pulls IT-COO CSV → 200, header-only when no rows, exactly one audit row", async () => {
  setActor(userAdmin as any);
  const startMs = Date.now();
  // Filter to a date window with no rows → header-only.
  const res = await fetchRaw("/api/withdrawals/export-csv/by-role?role=it_coordinator_or_coo&closedFrom=1990-01-01T00:00:00Z&closedTo=1990-01-02T00:00:00Z");
  assert.equal(res.status, 200);
  assert.match(String(res.headers["content-type"] ?? ""), /text\/csv/);
  // Exactly one line — the header — and it lists every party-safe column.
  const lines = res.body.split("\r\n");
  assert.equal(lines.length, 1, `expected header-only CSV, got ${lines.length} lines`);
  for (const h of PARTY_SAFE_HEADERS) {
    assert.ok(res.body.includes(`"${h}"`), `header missing column: ${h}`);
  }
  // Filename convention.
  const disp = String(res.headers["content-disposition"] ?? "");
  assert.match(disp, /closures-it-coordinator-/);
  assert.match(disp, /-1990-01-01-to-1990-01-02\.csv/);
  // Exactly one audit row was written for this call.
  const written = await auditCountSince(startMs, "withdrawals_csv_exported");
  assert.equal(written, 1, "success path must insert exactly one audit row");
});

test("external_payor scope: filename slug + admin allowed + portal user 403", async () => {
  // Filename builder accepts external_payor as a 4th role-shaped value.
  assert.equal(
    buildByRoleFilename({ role: "external_payor", reasons: null, closedFrom: null, closedTo: null, today: "2026-05-24" }),
    "closures-external-payor-all-alltime-to-2026-05-24.csv",
  );
  // Admin can request the FYI scope.
  setActor(userAdmin as any);
  const ok = await fetchRaw("/api/withdrawals/export-csv/by-role?role=external_payor");
  assert.equal(ok.status, 200);
  assert.match(String(ok.headers["content-disposition"] ?? ""), /closures-external-payor-/);
  // Portal user (even with a real role) cannot — no one "holds" external_payor.
  setActor(userItCoo as any);
  const denied = await fetchRaw("/api/withdrawals/export-csv/by-role?role=external_payor");
  assert.equal(denied.status, 403);
});

test("cross-filter + injection: narrative starting with '=' is escaped in the by-role CSV", async () => {
  setActor(userAdmin as any);
  const id = await seedClaim({
    responsibility: "system_error",
    narrative: "=cmd|' /C calc'!A0",
  });
  try {
    const res = await fetchRaw("/api/withdrawals/export-csv/by-role?role=it_coordinator_or_coo");
    assert.equal(res.status, 200);
    assert.ok(
      res.body.includes(`"'=cmd|' /C calc'!A0"`),
      "by-role CSV must apply the prefix-quote injection guard",
    );
    // And it must NOT have operator-only columns.
    assert.ok(!res.body.includes("Closed By Email"));
    assert.ok(!res.body.includes("Accountability Tags"));
  } finally {
    await cleanupClaim(id);
  }
});
