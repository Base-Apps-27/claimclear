// Task #758 — Override matrix coverage for terminal-closure transitions.
//
// The override lane lets an operator close a leg or group into a terminal
// outcome (Denied, Approved, Partially Approved, Non-Issue, Withdrawn,
// No Action Needed) from any source status, including the system-controlled
// in-flight ones (Portal Queued, Generating Email, Ready to Review,
// Awaiting Response, On Hold) where the per-status outcome envelope would
// normally reject the move. This test pins down both lanes for the routes
// the dialogs hit:
//
//   1. Normal lane (target outcome ∈ source status's validOutcomes):
//      no override required; payload omits `override`; succeeds and
//      the audit log carries no override fragment.
//
//   2. Override lane (target outcome ∉ source status's validOutcomes):
//      omitting `override` 400s with the override-required error;
//      a too-short reason 400s with the too-short error; a sufficiently
//      long reason succeeds, the closure is recorded, and the audit log
//      metadata carries `override:{applied,sourceStatus,targetOutcome,reason}`
//      while the lifecycle note has the `— Override (from <status>): <reason>`
//      suffix.
//
// Covers both /claims/:id/outcome (claim writer) and
// /invoice-groups/:id/outcome (group writer). Pre-existing tests still
// stand: the normal lane behaves exactly as before.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, desc } from "drizzle-orm";

import claimsRouter from "../routes/claims";
import invoiceGroupsRouter from "../routes/invoice-groups";
import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  notesTable,
  portalResponsesTable,
  portalSubmissionsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;
const TEST_USER = { email: "override-tester@example.com", displayName: "Override Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", claimsRouter);
  app.use("/api", invoiceGroupsRouter);
  await new Promise<void>((res, rej) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) { baseUrl = `http://127.0.0.1:${addr.port}`; res(); }
      else rej(new Error("no port"));
    });
  });
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((res) => server.close(() => res()));
  await pool.end().catch(() => undefined);
});

async function fetchJson<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((res, rej) => {
    const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method: init?.method ?? "GET",
      headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString() } : {},
    }, (resp) => {
      let raw = ""; resp.setEncoding("utf8");
      resp.on("data", (c) => { raw += c; });
      resp.on("end", () => {
        try { res({ status: resp.statusCode ?? 0, json: raw ? JSON.parse(raw) : ({} as T) }); }
        catch (e) { rej(e); }
      });
    });
    req.on("error", rej);
    if (body) req.write(body);
    req.end();
  });
}

async function seedGroup(status: string): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T758G-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber, status: status as any, outcome: "Pending",
  }).returning();
  return row;
}

async function seedClaim(opts: { status: string; withGroup?: boolean }): Promise<typeof claimsTable.$inferSelect> {
  let invoiceGroupId: number | null = null;
  if (opts.withGroup) {
    const g = await seedGroup("Needs Review");
    invoiceGroupId = g.id;
  }
  const confNumber = `T758-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [row] = await db.insert(claimsTable).values({
    confNumber, status: opts.status as any, outcome: "Pending", invoiceGroupId,
  }).returning();
  return row;
}

async function cleanupClaim(id: number) {
  const [c] = await db.select({ invoiceGroupId: claimsTable.invoiceGroupId }).from(claimsTable).where(eq(claimsTable.id, id));
  await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, id)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.claimId, id)).catch(() => undefined);
  await db.delete(claimsTable).where(eq(claimsTable.id, id)).catch(() => undefined);
  if (c?.invoiceGroupId) {
    await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, c.invoiceGroupId)).catch(() => undefined);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, c.invoiceGroupId)).catch(() => undefined);
    await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, c.invoiceGroupId)).catch(() => undefined);
  }
}

async function cleanupGroup(id: number) {
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

const LONG_REASON = "Operator confirmed offline with payor liaison; closing per ticket #4471 follow-up.";

// ---- Claim: normal lane (Awaiting Response → Withdrawn) ---------------

test("claim normal lane: Awaiting Response → Withdrawn (in validOutcomes) succeeds without override", async () => {
  const seed = await seedClaim({ status: "Awaiting Response", withGroup: false });
  try {
    const res = await fetchJson<{ outcome?: string }>(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH",
      body: {
        outcome: "Withdrawn",
        closureReason: "cannot_dispute",
        closureCategory: "operational_decision",
        closureRootCause: "out_of_scope",
        closureNarrative: "x".repeat(150),
        closureAccountabilityTags: ["our_staff"],
      },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.outcome, "Withdrawn");
    const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, seed.id)).orderBy(desc(auditLogsTable.timestamp));
    const outcomeLog = logs.find((l) => l.action === "status_and_outcome_changed" || l.action === "outcome_changed");
    assert.ok(outcomeLog, "expected an outcome audit log");
    assert.equal((outcomeLog!.metadata as any)?.override, undefined,
      "normal lane must not stamp override metadata");
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- Claim: override lane (On Hold → Non-Issue) -----------------------

test("claim override lane: On Hold → Non-Issue requires override.reason", async () => {
  const seed = await seedClaim({ status: "On Hold", withGroup: false });
  try {
    const baseClosure = {
      closureReason: "non_issue",
      closureCategory: "operational_decision",
      closureRootCause: "out_of_scope",
      closureNarrative: "x".repeat(150),
      closureAccountabilityTags: ["our_staff"],
    };
    const noOverride = await fetchJson<{ error?: string }>(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH",
      body: { outcome: "Non-Issue", ...baseClosure },
    });
    assert.equal(noOverride.status, 400, "must reject without override");
    assert.match(noOverride.json.error ?? "", /override/i,
      `expected override-required error, got: ${noOverride.json.error}`);

    const tooShort = await fetchJson<{ error?: string }>(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH",
      body: { outcome: "Non-Issue", ...baseClosure, override: { reason: "too short" } },
    });
    assert.equal(tooShort.status, 400, "must reject with too-short reason");
    assert.match(tooShort.json.error ?? "", /at least \d+/i,
      `expected too-short error, got: ${tooShort.json.error}`);

    const ok = await fetchJson<{ outcome?: string }>(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH",
      body: {
        outcome: "Non-Issue",
        closureReason: "non_issue",
        closureCategory: "operational_decision",
        closureRootCause: "out_of_scope",
        closureNarrative: "x".repeat(150),
        closureAccountabilityTags: ["our_staff"],
        override: { reason: LONG_REASON },
      },
    });
    assert.equal(ok.status, 200, `override lane must succeed, got ${ok.status} (${JSON.stringify(ok.json)})`);
    assert.equal(ok.json.outcome, "Non-Issue");

    const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, seed.id)).orderBy(desc(auditLogsTable.timestamp));
    const overrideLog = logs.find((l) => (l.metadata as any)?.override?.applied === true);
    assert.ok(overrideLog, `expected an audit log with override.applied=true; got ${JSON.stringify(logs.map((l) => l.metadata))}`);
    const md = overrideLog!.metadata as any;
    assert.equal(md.override.sourceStatus, "On Hold");
    assert.equal(md.override.targetOutcome, "Non-Issue");
    assert.equal(md.override.reason, LONG_REASON);

    const allNotes = await db.select().from(notesTable).where(eq(notesTable.claimId, seed.id));
    const overrideNote = allNotes.find((n) => (n.content ?? "").includes("Override (from On Hold)"));
    assert.ok(overrideNote, `expected a note with the override fragment; got: ${JSON.stringify(allNotes.map((n) => n.content))}`);
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("claim normal lane (system-controlled): Ready to Review → Denied with response on file succeeds without override", async () => {
  // The "Mark Denied by Payor" action in the response-review dialog
  // launches from Ready to Review (a SYSTEM_CONTROLLED status whose
  // per-status outcome envelope is empty). Under the unified terminal-
  // closure policy this is the normal lane, NOT the override lane —
  // the dialog must not be forced to surface an override panel and
  // the backend must not 400. We seed a portal_response first because
  // the per-outcome Denied response-required guard is a separate
  // semantic invariant that still applies on the normal lane.
  // (Regression coverage for Task #758 code-review feedback.)
  const seed = await seedClaim({ status: "Ready to Review", withGroup: false });
  try {
    await db.insert(portalResponsesTable).values({
      claimId: seed.id,
      source: "manual",
      responseType: "denial",
      content: "Payor denied via portal.",
    });

    const ok = await fetchJson<{ outcome?: string; status?: string }>(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH",
      body: {
        outcome: "Denied",
        closureReason: "denied_by_payor",
        closureCategory: "payor_denial",
        closureRootCause: "denied_no_recourse",
        closureNarrative: "x".repeat(150),
        closureAccountabilityTags: ["external_payor"],
      },
    });
    assert.equal(ok.status, 200, `Ready to Review → Denied must succeed without override, got ${ok.status} (${JSON.stringify(ok.json)})`);
    assert.equal(ok.json.outcome, "Denied");
    const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, seed.id)).orderBy(desc(auditLogsTable.timestamp));
    const outcomeLog = logs.find((l) => l.action === "outcome_changed" || l.action === "status_and_outcome_changed");
    assert.ok(outcomeLog, "expected an outcome audit log");
    assert.equal((outcomeLog!.metadata as any)?.override, undefined,
      "system-controlled normal lane must not stamp override metadata");
  } finally {
    await cleanupClaim(seed.id);
  }
});

test("claim Denied response-required guard still fires on system-controlled normal lane without recorded response", async () => {
  // Coverage for Task #758 review feedback: even though Ready to
  // Review enables the system-controlled normal lane for terminal
  // closures, the Denied per-outcome semantic guard ("don't claim
  // the payor denied without a recorded response") MUST still
  // reject when no portal_response is on file. Bypassing it
  // requires an explicit operator override (≥20 chars).
  const seed = await seedClaim({ status: "Ready to Review", withGroup: false });
  try {
    const noOverride = await fetchJson<{ error?: string }>(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH",
      body: {
        outcome: "Denied",
        closureReason: "denied_by_payor",
        closureCategory: "payor_denial",
        closureRootCause: "denied_no_recourse",
        closureNarrative: "x".repeat(150),
        closureAccountabilityTags: ["external_payor"],
      },
    });
    assert.equal(noOverride.status, 400, "must reject when no response is recorded");
    assert.match(noOverride.json.error ?? "", /no portal or email response/i,
      `expected response-required error, got: ${noOverride.json.error}`);

    const ok = await fetchJson<{ outcome?: string }>(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH",
      body: {
        outcome: "Denied",
        closureReason: "denied_by_payor",
        closureCategory: "payor_denial",
        closureRootCause: "denied_no_recourse",
        closureNarrative: "x".repeat(150),
        closureAccountabilityTags: ["external_payor"],
        override: { reason: LONG_REASON },
      },
    });
    assert.equal(ok.status, 200, `explicit override must succeed even without a recorded response, got ${ok.status} (${JSON.stringify(ok.json)})`);
    assert.equal(ok.json.outcome, "Denied");
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- Claim: bot-owned queue states stay on the override lane ----------

// Code-review feedback (iter-2): the system-controlled NORMAL-lane
// allowlist is intentionally limited to "Ready to Review". Closing
// into a terminal outcome from "Portal Queued" or "Generating Email"
// means the operator is stepping in around the bot mid-flight, which
// must always be deliberate. Both ends of the policy must agree:
//   - Writer: rejects without `override.reason` ≥20 chars; accepts with one.
//   - Read API: `terminalLane[<target>] === "override"` so the dialog
//     surfaces the override panel.

for (const queueStatus of ["Portal Queued", "Generating Email"] as const) {
  test(`claim override lane: ${queueStatus} → Non-Issue requires override.reason (bot-owned source)`, async () => {
    const seed = await seedClaim({ status: queueStatus, withGroup: false });
    try {
      const baseClosure = {
        closureReason: "non_issue",
        closureCategory: "operational_decision",
        closureRootCause: "out_of_scope",
        closureNarrative: "x".repeat(150),
        closureAccountabilityTags: ["our_staff"],
      };
      const noOverride = await fetchJson<{ error?: string }>(`/api/claims/${seed.id}/outcome`, {
        method: "PATCH",
        body: { outcome: "Non-Issue", ...baseClosure },
      });
      assert.equal(noOverride.status, 400,
        `${queueStatus} → Non-Issue must reject without override; got ${noOverride.status} (${JSON.stringify(noOverride.json)})`);
      assert.match(noOverride.json.error ?? "", /override/i,
        `expected override-required error, got: ${noOverride.json.error}`);

      const ok = await fetchJson<{ outcome?: string }>(`/api/claims/${seed.id}/outcome`, {
        method: "PATCH",
        body: { outcome: "Non-Issue", ...baseClosure, override: { reason: LONG_REASON } },
      });
      assert.equal(ok.status, 200, `valid override must succeed, got ${ok.status} (${JSON.stringify(ok.json)})`);
      assert.equal(ok.json.outcome, "Non-Issue");

      const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, seed.id)).orderBy(desc(auditLogsTable.timestamp));
      const overrideLog = logs.find((l) => (l.metadata as any)?.override?.applied === true);
      assert.ok(overrideLog, `expected an audit log with override.applied=true for ${queueStatus}`);
      assert.equal((overrideLog!.metadata as any).override.sourceStatus, queueStatus);
      assert.equal((overrideLog!.metadata as any).override.targetOutcome, "Non-Issue");
    } finally {
      await cleanupClaim(seed.id);
    }
  });

  test(`claim valid-transitions: ${queueStatus} returns terminalLane[Non-Issue] === "override"`, async () => {
    const seed = await seedClaim({ status: queueStatus, withGroup: false });
    try {
      const res = await fetchJson<{ terminalLane?: Record<string, string> }>(`/api/claims/valid-transitions/${seed.id}`);
      assert.equal(res.status, 200);
      assert.ok(res.json.terminalLane, "expected terminalLane in payload");
      assert.equal(res.json.terminalLane!["Non-Issue"], "override",
        `${queueStatus} must surface override lane to UI; got ${JSON.stringify(res.json.terminalLane)}`);
      // vocab-allow-next-line
      assert.equal(res.json.terminalLane!["Denied"], "override");
    } finally {
      await cleanupClaim(seed.id);
    }
  });
}

test(`claim valid-transitions: Ready to Review returns terminalLane[Denied] === "normal"`, async () => {
  const seed = await seedClaim({ status: "Ready to Review", withGroup: false });
  try {
    const res = await fetchJson<{ terminalLane?: Record<string, string> }>(`/api/claims/valid-transitions/${seed.id}`);
    assert.equal(res.status, 200);
    assert.ok(res.json.terminalLane, "expected terminalLane in payload");
    // vocab-allow-next-line
    assert.equal(res.json.terminalLane!["Denied"], "normal",
      `Ready to Review must surface normal lane to UI; got ${JSON.stringify(res.json.terminalLane)}`);
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- Normal-lane status+outcome flips must NOT demand override -------

// Regression coverage for iter-3 review feedback: an earlier rev of
// transition*StatusAndOutcome inspected only the source-status outcome
// envelope, which incorrectly threw `terminal_override_required` on
// legitimate normal flips like Needs Review → Resolved/Approved or
// Needs Evidence → Resolved/Non-Issue (where the source envelope is
// empty but the destination envelope accepts the outcome). The policy
// must mirror the writer's own status-transition + target-status
// outcome guards on the normal lane.

test("group normal lane (status+outcome): Needs Review → Resolved/Approved succeeds without override", async () => {
  const g = await seedGroup("Needs Review");
  try {
    const res = await fetchJson<{ status?: string; outcome?: string; error?: string }>(`/api/invoice-groups/${g.id}/outcome`, {
      method: "PATCH",
      body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.outcome, "Approved");
    assert.equal(res.json.status, "Resolved");
    const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, g.id)).orderBy(desc(auditLogsTable.timestamp));
    const overrideLog = logs.find((l) => (l.metadata as any)?.override?.applied === true);
    assert.equal(overrideLog, undefined,
      "normal-lane status+outcome flip must not stamp override metadata");
  } finally {
    await cleanupGroup(g.id);
  }
});

test("claim normal lane (status+outcome): Needs Review → Resolved/Approved succeeds without override", async () => {
  const seed = await seedClaim({ status: "Needs Review", withGroup: false });
  try {
    const res = await fetchJson<{ status?: string; outcome?: string; error?: string }>(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH",
      body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    assert.equal(res.status, 200, `expected 200, got ${res.status} (${JSON.stringify(res.json)})`);
    assert.equal(res.json.outcome, "Approved");
    assert.equal(res.json.status, "Resolved");
    const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.claimId, seed.id)).orderBy(desc(auditLogsTable.timestamp));
    const overrideLog = logs.find((l) => (l.metadata as any)?.override?.applied === true);
    assert.equal(overrideLog, undefined,
      "normal-lane status+outcome flip must not stamp override metadata");
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- Group: bot-owned queue states stay on the override lane ----------

test(`group override lane: Portal Queued → Non-Issue requires override.reason (bot-owned source)`, async () => {
  const g = await seedGroup("Portal Queued");
  try {
    const baseClosure = {
      closureReason: "non_issue",
      closureCategory: "operational_decision",
      closureRootCause: "out_of_scope",
      closureNarrative: "x".repeat(150),
      closureAccountabilityTags: ["our_staff"],
    };
    const noOverride = await fetchJson<{ error?: string }>(`/api/invoice-groups/${g.id}/outcome`, {
      method: "PATCH",
      body: { outcome: "Non-Issue", ...baseClosure },
    });
    assert.equal(noOverride.status, 400, "Portal Queued → Non-Issue must reject without override");
    assert.match(noOverride.json.error ?? "", /override/i);

    const ok = await fetchJson<{ outcome?: string }>(`/api/invoice-groups/${g.id}/outcome`, {
      method: "PATCH",
      body: { outcome: "Non-Issue", ...baseClosure, override: { reason: LONG_REASON } },
    });
    assert.equal(ok.status, 200, `valid override must succeed, got ${ok.status} (${JSON.stringify(ok.json)})`);
    assert.equal(ok.json.outcome, "Non-Issue");

    const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, g.id)).orderBy(desc(auditLogsTable.timestamp));
    const overrideLog = logs.find((l) => (l.metadata as any)?.override?.applied === true);
    assert.ok(overrideLog, "expected group audit log with override.applied=true");
    assert.equal((overrideLog!.metadata as any).override.sourceStatus, "Portal Queued");
  } finally {
    await cleanupGroup(g.id);
  }
});

test(`group valid-transitions: Portal Queued returns terminalLane[Non-Issue] === "override" (and is present in payload)`, async () => {
  // Doubles as a regression test for the iter-2 review finding that
  // the group endpoint omitted `terminalLane` from its JSON payload.
  const g = await seedGroup("Portal Queued");
  try {
    const res = await fetchJson<{ terminalLane?: Record<string, string> }>(`/api/invoice-groups/${g.id}/valid-transitions`);
    assert.equal(res.status, 200);
    assert.ok(res.json.terminalLane, `expected terminalLane in group payload; got: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.terminalLane!["Non-Issue"], "override");
    // vocab-allow-next-line
    assert.equal(res.json.terminalLane!["Denied"], "override");
  } finally {
    await cleanupGroup(g.id);
  }
});

// ---- Override bypasses the active-submission lock --------------------

// Task #758 review feedback: a stuck Portal Queued / Generating Email
// item with a pending/in_progress submission row must remain closable
// via explicit operator override. Otherwise the override lane's whole
// purpose (rescue stuck bot-owned states) is defeated by a guard that
// runs before policy resolution.
test("group override lane: active pending submission does not block terminal close with override", async () => {
  const g = await seedGroup("Portal Queued");
  try {
    await db.insert(portalSubmissionsTable).values({
      invoiceGroupId: g.id,
      status: "in_progress" as any,
    });
    const ok = await fetchJson<{ outcome?: string; error?: string }>(`/api/invoice-groups/${g.id}/outcome`, {
      method: "PATCH",
      body: {
        outcome: "Non-Issue",
        closureReason: "non_issue",
        closureCategory: "operational_decision",
        closureRootCause: "out_of_scope",
        closureNarrative: "x".repeat(150),
        closureAccountabilityTags: ["our_staff"],
        override: { reason: LONG_REASON },
      },
    });
    assert.equal(ok.status, 200,
      `override must bypass active-submission lock; got ${ok.status} (${JSON.stringify(ok.json)})`);
    assert.equal(ok.json.outcome, "Non-Issue");
  } finally {
    await cleanupGroup(g.id);
  }
});

test("claim override lane: active pending submission does not block terminal close with override", async () => {
  const seed = await seedClaim({ status: "Portal Queued", withGroup: true });
  try {
    await db.insert(portalSubmissionsTable).values({
      invoiceGroupId: seed.invoiceGroupId!,
      status: "in_progress" as any,
    });
    const ok = await fetchJson<{ outcome?: string; error?: string }>(`/api/claims/${seed.id}/outcome`, {
      method: "PATCH",
      body: {
        outcome: "Non-Issue",
        closureReason: "non_issue",
        closureCategory: "operational_decision",
        closureRootCause: "out_of_scope",
        closureNarrative: "x".repeat(150),
        closureAccountabilityTags: ["our_staff"],
        override: { reason: LONG_REASON },
      },
    });
    assert.equal(ok.status, 200,
      `override must bypass active-submission lock; got ${ok.status} (${JSON.stringify(ok.json)})`);
    assert.equal(ok.json.outcome, "Non-Issue");
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- valid-transitions terminalLane mirrors writer (status+outcome) ---

// Task #758 review feedback: terminalLane previously inspected only the
// source-status outcome envelope, which disagreed with the writer's
// combined status+outcome policy on legitimate normal flips like
// Needs Review → Resolved/Approved. The UI gate must match the writer
// so dialogs don't surface the override panel where the backend would
// happily accept a normal close.
test("group valid-transitions: Needs Review reports Approved/Denied as normal lane", async () => {
  const g = await seedGroup("Needs Review");
  try {
    const res = await fetchJson<{ terminalLane?: Record<string, string> }>(`/api/invoice-groups/${g.id}/valid-transitions`);
    assert.equal(res.status, 200);
    assert.equal(res.json.terminalLane!["Approved"], "normal");
    // vocab-allow-next-line
    assert.equal(res.json.terminalLane!["Denied"], "normal");
    assert.equal(res.json.terminalLane!["Non-Issue"], "normal");
  } finally {
    await cleanupGroup(g.id);
  }
});

test("claim valid-transitions: Needs Review reports Approved/Denied as normal lane", async () => {
  const seed = await seedClaim({ status: "Needs Review", withGroup: false });
  try {
    const res = await fetchJson<{ terminalLane?: Record<string, string> }>(`/api/claims/valid-transitions/${seed.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.terminalLane!["Approved"], "normal");
    // vocab-allow-next-line
    assert.equal(res.json.terminalLane!["Denied"], "normal");
    assert.equal(res.json.terminalLane!["Non-Issue"], "normal");
  } finally {
    await cleanupClaim(seed.id);
  }
});

// ---- Group: Awaiting Response → Resolved/Approved is normal lane ------

// Per Task #758 iter-4 review feedback, the writer's normal-lane policy
// for combined status+outcome flips mirrors the writer's own
// status-transition + target-status outcome envelope. Awaiting Response
// → Resolved is in VALID_GROUP_STATUS_TRANSITIONS, and Resolved →
// Approved is in VALID_GROUP_OUTCOME_BY_STATUS, so this is a normal
// closure that must NOT demand an override reason.
test("group normal lane (status+outcome): Awaiting Response → Resolved/Approved succeeds without override", async () => {
  const g = await seedGroup("Awaiting Response");
  try {
    const ok = await fetchJson<{ status?: string; outcome?: string; error?: string }>(`/api/invoice-groups/${g.id}/outcome`, {
      method: "PATCH",
      body: { outcome: "Approved", approvedAmount: "100.00" },
    });
    assert.equal(ok.status, 200, `expected 200, got ${ok.status} (${JSON.stringify(ok.json)})`);
    assert.equal(ok.json.outcome, "Approved");
    assert.equal(ok.json.status, "Resolved");
    const logs = await db.select().from(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, g.id)).orderBy(desc(auditLogsTable.timestamp));
    const overrideLog = logs.find((l) => (l.metadata as any)?.override?.applied === true);
    assert.equal(overrideLog, undefined,
      "normal-lane Awaiting Response → Resolved/Approved must not stamp override metadata");
  } finally {
    await cleanupGroup(g.id);
  }
});
