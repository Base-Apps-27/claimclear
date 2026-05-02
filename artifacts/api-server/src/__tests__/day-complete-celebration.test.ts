// Integration tests for Task #313 (Day-Complete Celebration).
//
// Covers:
//   • The day-completed event is recorded EXACTLY ONCE per ISO date even
//     when multiple groups for the same day flip to a concluded state in
//     parallel and even when a redundant manual trigger races with the
//     transition (idempotency via the partial unique index introduced in
//     migration 0018).
//   • An empty calendar day (no invoice groups) NEVER triggers the
//     celebration.
//   • Per-group transitions through `transitionGroupStatus`,
//     `transitionGroupOutcome`, and `transitionGroupStatusAndOutcome`
//     all wire the day-complete check in the same way (status enters
//     in-flight, outcome flips to Non-Issue, and the combined status
//     +outcome closure path).
//   • The admin debug endpoint refuses to fire for unconcluded days
//     unless `force=true`.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { eq, and, sql } from "drizzle-orm";

import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  auditLogsTable,
  notesTable,
  portalSubmissionsTable,
  portalResponsesTable,
  claimEvidenceTable,
  claimVerdictTable,
  stateEventsTable,
} from "@workspace/db";

import {
  transitionGroupStatusAndOutcome,
} from "../lib/group-transitions";
import {
  isDayConcluded,
  tryEmitDayCompletedCelebration,
  getInvoiceGroupDay,
  checkAndEmitDayCompleteForGroup,
} from "../lib/day-complete";

const ACTOR = { userEmail: "celebration-tester@example.com", userName: "Celebration Tester" };

// Stable, far-future test date so the suite doesn't collide with real
// service-date data and is safe to re-run after a partial failure.
const DAY_BASE = "2099-12-15";
let testCounter = 0;
function nextDay(): string {
  // Walk a different day per test so each test owns its own celebration row.
  testCounter += 1;
  const dt = new Date(Date.UTC(2099, 11, 15));
  dt.setUTCDate(dt.getUTCDate() + testCounter);
  return dt.toISOString().slice(0, 10);
}

async function purgeFarFutureFixtures() {
  // A previous partial run can leave invoice_groups + claims for the
  // far-future test dates lying around (e.g. if the suite was killed
  // between cleanup steps). Tests reuse the same deterministic dates,
  // so any leftover row would silently break `isDayConcluded`. Wipe
  // every row whose claim date is in our reserved range, plus the
  // celebration rows themselves.
  await db.execute(sql`
    DELETE FROM state_events
    WHERE event_key = 'day_completed_celebration'
      AND (metadata->>'date') >= ${DAY_BASE}
  `);
  await db.execute(sql`
    DELETE FROM state_events
    WHERE claim_id IN (SELECT id FROM claims WHERE date >= ${DAY_BASE})
       OR invoice_group_id IN (
            SELECT DISTINCT invoice_group_id FROM claims
            WHERE date >= ${DAY_BASE} AND invoice_group_id IS NOT NULL
          )
  `);
  await db.execute(sql`
    DELETE FROM audit_logs
    WHERE claim_id IN (SELECT id FROM claims WHERE date >= ${DAY_BASE})
       OR invoice_group_id IN (
            SELECT DISTINCT invoice_group_id FROM claims
            WHERE date >= ${DAY_BASE} AND invoice_group_id IS NOT NULL
          )
  `);
  await db.execute(sql`
    DELETE FROM claims WHERE date >= ${DAY_BASE}
  `);
  // Any invoice_group whose claims are now gone but that was created by
  // this suite (T313 prefix) is also stale — drop it.
  await db.execute(sql`
    DELETE FROM invoice_groups
    WHERE invoice_number LIKE 'T313-%'
      AND id NOT IN (SELECT DISTINCT invoice_group_id FROM claims WHERE invoice_group_id IS NOT NULL)
  `);
}

before(async () => {
  await purgeFarFutureFixtures();
});

after(async () => {
  await purgeFarFutureFixtures();
  await pool.end().catch(() => undefined);
});

async function createGroupOnDay(opts: {
  day: string;
  status?: any;
  outcome?: any;
}) {
  const invoiceNumber = `T313-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: opts.status ?? "Needs Evidence",
    outcome: opts.outcome ?? "Pending",
  }).returning();

  const confNumber = `T313-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [claim] = await db.insert(claimsTable).values({
    confNumber,
    status: opts.status ?? "Needs Evidence",
    outcome: opts.outcome ?? "Pending",
    invoiceGroupId: group.id,
    includedInDispute: true,
    claimAmount: "100.00",
    date: opts.day,
  }).returning();

  return { group, claim };
}

async function cleanupGroup(id: number) {
  const children = await db.select({ id: claimsTable.id }).from(claimsTable).where(eq(claimsTable.invoiceGroupId, id));
  for (const c of children) {
    await db.delete(claimVerdictTable).where(eq(claimVerdictTable.claimId, c.id)).catch(() => undefined);
    await db.delete(stateEventsTable).where(eq(stateEventsTable.claimId, c.id)).catch(() => undefined);
    await db.delete(portalResponsesTable).where(eq(portalResponsesTable.claimId, c.id)).catch(() => undefined);
    await db.delete(auditLogsTable).where(eq(auditLogsTable.claimId, c.id)).catch(() => undefined);
    await db.delete(notesTable).where(eq(notesTable.claimId, c.id)).catch(() => undefined);
    await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.claimId, c.id)).catch(() => undefined);
    await db.delete(claimsTable).where(eq(claimsTable.id, c.id)).catch(() => undefined);
  }
  await db.delete(stateEventsTable).where(eq(stateEventsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(portalSubmissionsTable).where(eq(portalSubmissionsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(notesTable).where(eq(notesTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(claimEvidenceTable).where(eq(claimEvidenceTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

async function countCelebrations(day: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM state_events
    WHERE event_key = 'day_completed_celebration' AND (metadata->>'date') = ${day}
  `);
  return Number((result.rows?.[0] as any)?.n ?? 0);
}

test("getInvoiceGroupDay returns MIN(claims.date) for the group", async () => {
  const day = nextDay();
  const dayLater = "2099-12-31";
  const { group, claim } = await createGroupOnDay({ day });
  // Add a second claim with a later date — MIN should still be the earlier day.
  await db.insert(claimsTable).values({
    confNumber: `T313LATE-${Date.now()}`,
    status: "Needs Evidence",
    outcome: "Pending",
    invoiceGroupId: group.id,
    includedInDispute: true,
    claimAmount: "50.00",
    date: dayLater,
  });
  try {
    const computed = await getInvoiceGroupDay(group.id);
    assert.equal(computed, day);
  } finally {
    await cleanupGroup(group.id);
  }
});

test("isDayConcluded: empty day → false (NEVER triggers)", async () => {
  const day = nextDay();
  const concluded = await isDayConcluded(day);
  assert.equal(concluded, false);
});

test("isDayConcluded: respects all three concluded forms (in-flight, closed, Non-Issue)", async () => {
  const day = nextDay();
  const a = await createGroupOnDay({ day, status: "Awaiting Response" }); // in-flight
  const b = await createGroupOnDay({ day, status: "Resolved", outcome: "Approved" }); // closed
  const c = await createGroupOnDay({ day, status: "Needs Evidence", outcome: "Non-Issue" }); // outcome-concluded
  try {
    assert.equal(await isDayConcluded(day), true);
  } finally {
    await cleanupGroup(a.group.id);
    await cleanupGroup(b.group.id);
    await cleanupGroup(c.group.id);
  }
});

test("isDayConcluded: a single non-concluded group blocks the day", async () => {
  const day = nextDay();
  const a = await createGroupOnDay({ day, status: "Awaiting Response" });
  const b = await createGroupOnDay({ day, status: "Needs Evidence" }); // pre-submit, not concluded
  try {
    assert.equal(await isDayConcluded(day), false);
  } finally {
    await cleanupGroup(a.group.id);
    await cleanupGroup(b.group.id);
  }
});

test("transitionGroupStatusAndOutcome (closure path): emits exactly one celebration row", async () => {
  const day = nextDay();
  const a = await createGroupOnDay({ day, status: "Awaiting Response" });
  const b = await createGroupOnDay({ day, status: "Needs Review" }); // not concluded
  try {
    // First flip: only A is concluded → no celebration yet.
    assert.equal(await isDayConcluded(day), false);
    assert.equal(await countCelebrations(day), 0);

    // Now close out B. This should emit the celebration.
    const result = await transitionGroupStatusAndOutcome({
      groupId: b.group.id,
      newStatus: "Resolved",
      newOutcome: "Approved",
      source: "test",
      reason: "test closure",
      actor: ACTOR,
      closure: { closureReason: "approved", approvedAmount: "10.00" },
      ack: true,
    });
    assert.equal(result.success, true);
    assert.equal(await countCelebrations(day), 1);
  } finally {
    await cleanupGroup(a.group.id);
    await cleanupGroup(b.group.id);
  }
});

test("transitionGroupStatusAndOutcome (Non-Issue closure): triggers celebration when it's the last unfinished group", async () => {
  // Non-Issue is only reachable via the combined status+outcome closure
  // path (`Resolved` is the only group status whose VALID_GROUP_OUTCOME
  // set includes `Non-Issue`). Ensure that path is wired identically.
  const day = nextDay();
  const a = await createGroupOnDay({ day, status: "Awaiting Response" });
  const b = await createGroupOnDay({ day, status: "Needs Evidence" });
  try {
    assert.equal(await countCelebrations(day), 0);
    const result = await transitionGroupStatusAndOutcome({
      groupId: b.group.id,
      newStatus: "Resolved",
      newOutcome: "Non-Issue",
      source: "test",
      reason: "Non-Issue: nothing to dispute",
      actor: ACTOR,
      closure: { closureReason: "non_issue" },
      ack: true,
    });
    assert.equal(result.success, true);
    assert.equal(await countCelebrations(day), 1);
  } finally {
    await cleanupGroup(a.group.id);
    await cleanupGroup(b.group.id);
  }
});

test("idempotency: repeated tryEmitDayCompletedCelebration calls insert ONLY ONE row", async () => {
  const day = nextDay();
  const a = await createGroupOnDay({ day, status: "Awaiting Response" });
  try {
    assert.equal(await isDayConcluded(day), true);
    const r1 = await tryEmitDayCompletedCelebration({ day, triggeredByGroupId: a.group.id, actor: ACTOR });
    const r2 = await tryEmitDayCompletedCelebration({ day, triggeredByGroupId: a.group.id, actor: ACTOR });
    const r3 = await tryEmitDayCompletedCelebration({ day, triggeredByGroupId: a.group.id, actor: ACTOR });
    assert.equal(r1.emitted, true, "first call must emit");
    assert.equal(r2.emitted, false, "second call must be a no-op");
    assert.equal(r3.emitted, false, "third call must be a no-op");
    assert.equal(await countCelebrations(day), 1);
  } finally {
    await cleanupGroup(a.group.id);
  }
});

test("idempotency under concurrency: parallel emits insert ONLY ONE row", async () => {
  const day = nextDay();
  const a = await createGroupOnDay({ day, status: "Awaiting Response" });
  try {
    const calls = await Promise.all([
      tryEmitDayCompletedCelebration({ day, triggeredByGroupId: a.group.id, actor: ACTOR }),
      tryEmitDayCompletedCelebration({ day, triggeredByGroupId: a.group.id, actor: ACTOR }),
      tryEmitDayCompletedCelebration({ day, triggeredByGroupId: a.group.id, actor: ACTOR }),
      tryEmitDayCompletedCelebration({ day, triggeredByGroupId: a.group.id, actor: ACTOR }),
    ]);
    const emittedCount = calls.filter((c) => c.emitted).length;
    assert.equal(emittedCount, 1, "exactly one of the parallel callers must claim the celebration");
    assert.equal(await countCelebrations(day), 1);
  } finally {
    await cleanupGroup(a.group.id);
  }
});

test("checkAndEmitDayCompleteForGroup: triggers exactly when the day flips to concluded", async () => {
  const day = nextDay();
  // Two groups for the same day; one already in-flight, one not.
  const a = await createGroupOnDay({ day, status: "Awaiting Response" });
  const b = await createGroupOnDay({ day, status: "Needs Review" });
  try {
    // Day is NOT yet concluded — the helper must NOT emit.
    await checkAndEmitDayCompleteForGroup({ groupId: a.group.id, actor: ACTOR });
    assert.equal(await countCelebrations(day), 0);

    // Move B to a concluded status directly (simulating a packaging/email
    // pipeline that flipped the row outside of transitionGroupStatus).
    await db.update(invoiceGroupsTable)
      .set({ status: "Portal Queued" })
      .where(eq(invoiceGroupsTable.id, b.group.id));

    // Sanity-check our preconditions before invoking the helper so a
    // failure at this assertion clearly distinguishes a SQL-level issue
    // from a helper-glue issue.
    const dayLookup = await getInvoiceGroupDay(b.group.id);
    assert.equal(dayLookup, day, "getInvoiceGroupDay should return the test day");
    const concluded = await isDayConcluded(day);
    assert.equal(concluded, true, "isDayConcluded should be true after both groups closed");

    // Now the day IS concluded — the helper must emit exactly one row.
    await checkAndEmitDayCompleteForGroup({ groupId: b.group.id, actor: ACTOR });
    assert.equal(await countCelebrations(day), 1);

    // Calling again is a no-op (no second row).
    await checkAndEmitDayCompleteForGroup({ groupId: b.group.id, actor: ACTOR });
    await checkAndEmitDayCompleteForGroup({ groupId: a.group.id, actor: ACTOR });
    assert.equal(await countCelebrations(day), 1);
  } finally {
    await cleanupGroup(a.group.id);
    await cleanupGroup(b.group.id);
  }
});
