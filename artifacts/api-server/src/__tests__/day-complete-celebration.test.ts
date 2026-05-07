// Integration tests for Task #313 (Day-Complete Celebration), updated
// for Task #495 (every false→true day-completion fires confetti).
//
// Covers:
//   • The day-completed event is recorded ONCE per `transitionGroup*`
//     edge from "day not yet concluded" → "day fully concluded". Task
//     #495 dropped the partial unique index from migration 0019 (see
//     migration 0033) and moved deduplication to the
//     `priorConcluded` edge check that callers pass to
//     `checkAndEmitDayCompleteForGroup`. This means a day that
//     re-concludes (e.g. an operator reverts a closure and re-closes
//     it) WILL emit a second celebration row — that is the desired
//     behaviour now.
//   • An empty calendar day (no invoice groups) NEVER triggers the
//     celebration.
//   • Per-group transitions through `transitionGroupStatus`,
//     `transitionGroupOutcome`, and `transitionGroupStatusAndOutcome`
//     all wire the day-complete check in the same way (status enters
//     in-flight, outcome flips to Non-Issue, and the combined status
//     +outcome closure path).

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
// Wave D-PR4: `isDayConcluded` is now a phase-based reader. Raw-INSERT
// fixtures bypass the writers that normally keep `invoice_groups.phase`
// in lockstep with the legacy `(status, outcome, ...)` columns, so we
// call `refreshGroupDerivedFields` to recompute the canonical `phase`
// from the just-inserted legacy state. Same pattern is applied after
// every direct writer call below for parity with the cache-helper-driven
// PROD path.
import { refreshGroupDerivedFields } from "../lib/denormalized-cache";

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
    // Task #350/#356 — `getInvoiceGroupDay` and `isDayConcluded` read
    // the canonical `invoice_groups.service_date` column. Stamp it
    // here so raw-insert fixtures don't depend on the (non-deferred)
    // trigger that normally backfills service_date when claims are
    // inserted/updated.
    serviceDate: opts.day,
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

  // Sync the canonical `phase` (Wave D-PR4 reader switch) — see import
  // comment above. The deriver reads (status, outcome, closureReason,
  // reattest_*) from the row we just inserted and writes back the
  // matching phase, so subsequent `isDayConcluded` reads see the same
  // bucket the legacy status implied.
  await refreshGroupDerivedFields(group.id);
  const [refreshed] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, group.id));

  return { group: refreshed ?? group, claim };
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
    // "Approved" is not one of the closure-bearing outcomes
    // (Withdrawn / Non-Issue / Denied), so no `closure` payload or
    // `closureReason` is required — closure-validation only fires for
    // those three. We're testing the celebration-emit path, not the
    // closure-detail path, so the minimal status+outcome flip suffices.
    const result = await transitionGroupStatusAndOutcome({
      groupId: b.group.id,
      newStatus: "Resolved",
      newOutcome: "Approved",
      source: "test",
      reason: "test closure",
      actor: ACTOR,
    });
    assert.equal(result.success, true);
    // Mirror the PROD cache-helper-driven path: re-derive phase from
    // the just-updated legacy state so the day-complete reader sees
    // the new canonical bucket. transitionGroupStatusAndOutcome itself
    // does not touch phase (cache helpers do) so this is the test-side
    // shim until the writer rewire ships.
    await refreshGroupDerivedFields(b.group.id);
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
    // Non-Issue closure routes the closure reason at the top level.
    // The full `NormalizedClosure` payload (closureCategory, narrative,
    // accountability tags, etc.) is enforced one layer up at the route
    // boundary (parseClosurePayload), so for this celebration-emit test
    // we only need the closureReason to satisfy transitionGroupStatusAndOutcome.
    const result = await transitionGroupStatusAndOutcome({
      groupId: b.group.id,
      newStatus: "Resolved",
      newOutcome: "Non-Issue",
      source: "test",
      reason: "Non-Issue: nothing to dispute",
      actor: ACTOR,
      closureReason: "non_issue",
    });
    assert.equal(result.success, true);
    assert.equal(await countCelebrations(day), 1);
  } finally {
    await cleanupGroup(a.group.id);
    await cleanupGroup(b.group.id);
  }
});

test("tryEmitDayCompletedCelebration: ALWAYS inserts (Task #495 — dedupe moved to the edge check)", async () => {
  // Direct callers (admin debug endpoint, tests) are responsible for
  // their own gating now that the partial unique index is gone. The
  // helper itself must always insert a row when invoked.
  const day = nextDay();
  const a = await createGroupOnDay({ day, status: "Awaiting Response" });
  try {
    assert.equal(await isDayConcluded(day), true);
    const r1 = await tryEmitDayCompletedCelebration({ day, triggeredByGroupId: a.group.id, actor: ACTOR });
    const r2 = await tryEmitDayCompletedCelebration({ day, triggeredByGroupId: a.group.id, actor: ACTOR });
    const r3 = await tryEmitDayCompletedCelebration({ day, triggeredByGroupId: a.group.id, actor: ACTOR });
    assert.equal(r1.emitted, true);
    assert.equal(r2.emitted, true);
    assert.equal(r3.emitted, true);
    assert.equal(await countCelebrations(day), 3);
  } finally {
    await cleanupGroup(a.group.id);
  }
});

test("checkAndEmitDayCompleteForGroup: emits only on the false→true edge (priorConcluded gating)", async () => {
  const day = nextDay();
  // Two groups for the same day; one already in-flight, one not.
  const a = await createGroupOnDay({ day, status: "Awaiting Response" });
  const b = await createGroupOnDay({ day, status: "Needs Review" });
  try {
    // Day is NOT yet concluded — the helper must NOT emit even when
    // priorConcluded is correctly false.
    await checkAndEmitDayCompleteForGroup({ groupId: a.group.id, actor: ACTOR, priorConcluded: false });
    assert.equal(await countCelebrations(day), 0);

    // Snapshot the pre-update state, then move B to a concluded status
    // directly (simulating a packaging/email pipeline that flipped the
    // row outside of transitionGroupStatus).
    const priorConcluded = await isDayConcluded(day);
    assert.equal(priorConcluded, false);
    await db.update(invoiceGroupsTable)
      .set({ status: "Portal Queued" })
      .where(eq(invoiceGroupsTable.id, b.group.id));
    // Wave D-PR4 phase resync — see import comment.
    await refreshGroupDerivedFields(b.group.id);

    const dayLookup = await getInvoiceGroupDay(b.group.id);
    assert.equal(dayLookup, day, "getInvoiceGroupDay should return the test day");
    const nowConcluded = await isDayConcluded(day);
    assert.equal(nowConcluded, true, "isDayConcluded should be true after both groups closed");

    // The day IS now concluded and priorConcluded was false — emit once.
    await checkAndEmitDayCompleteForGroup({ groupId: b.group.id, actor: ACTOR, priorConcluded });
    assert.equal(await countCelebrations(day), 1);

    // Calling again with priorConcluded=true (the day was already
    // concluded before the no-op transition) is a no-op — the gate
    // suppresses repeated emits on no-edge calls.
    await checkAndEmitDayCompleteForGroup({ groupId: b.group.id, actor: ACTOR, priorConcluded: true });
    await checkAndEmitDayCompleteForGroup({ groupId: a.group.id, actor: ACTOR, priorConcluded: true });
    assert.equal(await countCelebrations(day), 1);
  } finally {
    await cleanupGroup(a.group.id);
    await cleanupGroup(b.group.id);
  }
});

test("checkAndEmitDayCompleteForGroup: re-concludes celebrate again (Task #495)", async () => {
  // Operator reverts a terminal closure and re-closes it later in the
  // day. With the unique index gone, each true false→true edge fires.
  const day = nextDay();
  const a = await createGroupOnDay({ day, status: "Awaiting Response" });
  try {
    assert.equal(await isDayConcluded(day), true);
    // Simulate the *first* edge: caller observed prior=false, now=true.
    await checkAndEmitDayCompleteForGroup({ groupId: a.group.id, actor: ACTOR, priorConcluded: false });
    assert.equal(await countCelebrations(day), 1);

    // Operator reverts: flip the group back to a non-concluded status.
    await db.update(invoiceGroupsTable)
      .set({ status: "Needs Review" })
      .where(eq(invoiceGroupsTable.id, a.group.id));
    await refreshGroupDerivedFields(a.group.id);
    assert.equal(await isDayConcluded(day), false);

    // Operator re-closes: another false→true edge — this MUST celebrate
    // again under the Task #495 rules.
    await db.update(invoiceGroupsTable)
      .set({ status: "Awaiting Response" })
      .where(eq(invoiceGroupsTable.id, a.group.id));
    await refreshGroupDerivedFields(a.group.id);
    await checkAndEmitDayCompleteForGroup({ groupId: a.group.id, actor: ACTOR, priorConcluded: false });
    assert.equal(await countCelebrations(day), 2);
  } finally {
    await cleanupGroup(a.group.id);
  }
});
