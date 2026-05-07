// Wave D-PR2b parity test (per the §5 parity-test requirement in
// `docs/architecture/state-wave-d-pr2b-handoff-prompt.md`).
//
// Asserts that for the four call-site groups the writer replaced —
//   1. excludeLegCore (reason=non_issue, mirror=derived)
//   2. excludeLegCore (reason=cannot_dispute, mirror=skip)
//   3. per-leg SOP-advance terminal step
//   4. conclude-leg / bulk SOP-advance terminal step
// the new `setClaimDisposition` writer produces the exact same
// `(disposition, sopOutcome, dropReason, includedInDispute)` tuple
// the legacy direct UPDATE would have produced. The "legacy expected
// value" column is hand-derived from the inventory in the handoff
// doc and the original code paths; if a future writer change drifts
// from those tuples this test pins the regression.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { eq } from "drizzle-orm";

import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
} from "@workspace/db";
import {
  setClaimDisposition,
  dispositionToLegacy,
  sopOutcomeToDisposition,
} from "../lib/leg-state/set-claim-disposition";

let groupId: number;

before(async () => {
  const [g] = await db
    .insert(invoiceGroupsTable)
    .values({
      invoiceNumber: `PARITY-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      status: "Needs Evidence",
      outcome: "Pending",
      phase: "triage",
    })
    .returning();
  groupId = g.id;
});

after(async () => {
  await db.delete(claimsTable).where(eq(claimsTable.invoiceGroupId, groupId));
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  await pool.end();
});

async function makeClaim(extra: Partial<typeof claimsTable.$inferInsert> = {}) {
  const [row] = await db
    .insert(claimsTable)
    .values({
      confNumber: `PARITY-C-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      status: "Needs Evidence",
      outcome: "Pending",
      invoiceGroupId: groupId,
      includedInDispute: true,
      ...extra,
    })
    .returning();
  return row;
}

async function reload(id: number) {
  const [r] = await db.select().from(claimsTable).where(eq(claimsTable.id, id));
  return r;
}

// ---------------------------------------------------------------------------
// 1. excludeLegCore (reason = non_issue, mirror=derived)
//    Legacy tuple: disposition='disposed_nonissue', sop_outcome='non_issue'
//    (only when previously null — Task #476), drop_reason untouched
//    (exclusion is NOT terminal), included_in_dispute=false.
// ---------------------------------------------------------------------------
test("parity: excludeLegCore reason=non_issue stamps tuple matching legacy direct UPDATE", async () => {
  const c = await makeClaim();
  await setClaimDisposition(c.id, "disposed_nonissue", {
    mirror: "derived",
    isTerminal: false,
    includedInDispute: false,
    onlyWhenIncluded: true,
  });
  const got = await reload(c.id);
  assert.equal(got.disposition, "disposed_nonissue");
  assert.equal(got.sopOutcome, "non_issue");
  assert.equal(got.dropReason, null);
  assert.equal(got.includedInDispute, false);
});

test("parity: excludeLegCore reason=non_issue honors Task #476 sop_outcome guard (does not clobber existing sop_outcome)", async () => {
  // sop_outcome already 'portal_dispute' from a prior SOP verdict.
  const c = await makeClaim({ sopOutcome: "portal_dispute" });
  await setClaimDisposition(c.id, "disposed_nonissue", {
    mirror: "derived",
    isTerminal: false,
    includedInDispute: false,
    onlyWhenIncluded: true,
  });
  const got = await reload(c.id);
  assert.equal(got.disposition, "disposed_nonissue");
  assert.equal(got.sopOutcome, "portal_dispute", "Task #476: sop_outcome must not be overwritten");
  assert.equal(got.includedInDispute, false);
});

// ---------------------------------------------------------------------------
// 2. excludeLegCore (reason = cannot_dispute, mirror=skip)
//    Legacy tuple: disposition='disposed_withdraw', sop_outcome
//    UNCHANGED (the legacy code only co-wrote sop_outcome for
//    non_issue), drop_reason untouched, included_in_dispute=false.
// ---------------------------------------------------------------------------
test("parity: excludeLegCore reason=cannot_dispute uses mirror=skip and leaves sop_outcome alone", async () => {
  const c = await makeClaim();
  await setClaimDisposition(c.id, "disposed_withdraw", {
    mirror: "skip",
    isTerminal: false,
    includedInDispute: false,
    onlyWhenIncluded: true,
  });
  const got = await reload(c.id);
  assert.equal(got.disposition, "disposed_withdraw");
  assert.equal(got.sopOutcome, null, "mirror=skip must not derive sop_outcome");
  assert.equal(got.dropReason, null);
  assert.equal(got.includedInDispute, false);
});

// ---------------------------------------------------------------------------
// 3. per-leg SOP-advance terminal step
//    Legacy tuple for sop_outcome='non_issue' terminal:
//      disposition='disposed_nonissue', sop_outcome='non_issue',
//      drop_reason='non_issue', included_in_dispute UNCHANGED (true).
// ---------------------------------------------------------------------------
test("parity: per-leg SOP-advance terminal non_issue produces the legacy tuple", async () => {
  const c = await makeClaim();
  const disposition = sopOutcomeToDisposition("non_issue");
  await setClaimDisposition(c.id, disposition, {
    mirror: "derived",
    isTerminal: true,
  });
  const got = await reload(c.id);
  assert.equal(got.disposition, "disposed_nonissue");
  assert.equal(got.sopOutcome, "non_issue");
  assert.equal(got.dropReason, "non_issue");
  assert.notEqual(got.droppedAt, null, "terminal exclusion stamps droppedAt");
  assert.equal(got.includedInDispute, true, "SOP terminal does not change includedInDispute");
});

test("parity: per-leg SOP-advance terminal portal_dispute produces the legacy tuple", async () => {
  const c = await makeClaim();
  const disposition = sopOutcomeToDisposition("portal_dispute");
  await setClaimDisposition(c.id, disposition, {
    mirror: "derived",
    isTerminal: true,
  });
  const got = await reload(c.id);
  assert.equal(got.disposition, "disposed_portal");
  assert.equal(got.sopOutcome, "portal_dispute");
  assert.equal(got.dropReason, null, "non-drop terminal does not stamp drop_reason");
  assert.notEqual(got.readyAt, null, "terminal disposed_portal stamps readyAt");
  assert.equal(got.includedInDispute, true);
});

// ---------------------------------------------------------------------------
// 4. conclude-leg (terminal, with explicit droppedAt override)
//    Legacy tuple for cannot_dispute conclusion:
//      disposition='disposed_withdraw', sop_outcome='cannot_dispute',
//      drop_reason='cannot_dispute', dropped_at=now,
//      included_in_dispute UNCHANGED.
// ---------------------------------------------------------------------------
test("parity: conclude-leg cannot_dispute stamps the terminal tuple with droppedAt", async () => {
  const c = await makeClaim();
  const droppedAt = new Date();
  await setClaimDisposition(c.id, sopOutcomeToDisposition("cannot_dispute"), {
    mirror: "derived",
    isTerminal: true,
    droppedAt,
  });
  const got = await reload(c.id);
  assert.equal(got.disposition, "disposed_withdraw");
  assert.equal(got.sopOutcome, "cannot_dispute");
  assert.equal(got.dropReason, "cannot_dispute");
  assert.equal(got.droppedAt?.getTime(), droppedAt.getTime());
  assert.equal(got.includedInDispute, true);
});

// ---------------------------------------------------------------------------
// dispositionToLegacy unit table — pins the §3.D inverse table
// ---------------------------------------------------------------------------
test("parity: dispositionToLegacy inverse table matches §3.D fallback", () => {
  assert.deepEqual(dispositionToLegacy("disposed_nonissue", true),  { sopOutcome: "non_issue", dropReason: "non_issue" });
  assert.deepEqual(dispositionToLegacy("disposed_nonissue", false), { sopOutcome: "non_issue" });
  assert.deepEqual(dispositionToLegacy("disposed_withdraw", true),  { sopOutcome: "cannot_dispute", dropReason: "cannot_dispute" });
  assert.deepEqual(dispositionToLegacy("disposed_withdraw", false), { sopOutcome: "cannot_dispute" });
  assert.deepEqual(dispositionToLegacy("blocked", false),           { sopOutcome: "hold" });
  assert.deepEqual(dispositionToLegacy("disposed_portal", true),    { sopOutcome: "portal_dispute" });
  assert.deepEqual(dispositionToLegacy("disposed_email", true),     { sopOutcome: "dispute" });
  assert.deepEqual(dispositionToLegacy("classifying", false),       {});
  assert.deepEqual(dispositionToLegacy("unclassified", false),      {});
});

// ---------------------------------------------------------------------------
// Idempotency — calling the writer twice with the same intent must
// not change the row or strand drop_reason/included_in_dispute.
// ---------------------------------------------------------------------------
test("parity: setClaimDisposition is idempotent on repeat calls", async () => {
  const c = await makeClaim();
  await setClaimDisposition(c.id, "disposed_nonissue", {
    mirror: "derived",
    isTerminal: true,
  });
  const first = await reload(c.id);
  await setClaimDisposition(c.id, "disposed_nonissue", {
    mirror: "derived",
    isTerminal: true,
  });
  const second = await reload(c.id);
  assert.equal(second.disposition, first.disposition);
  assert.equal(second.sopOutcome, first.sopOutcome);
  assert.equal(second.dropReason, first.dropReason);
  assert.equal(second.droppedAt?.getTime(), first.droppedAt?.getTime(),
    "idempotent re-stamp must NOT bump droppedAt");
});

// ---------------------------------------------------------------------------
// Orphan-leg guard — disposition column must NOT be stamped when
// the leg has no parent invoice group (preserves the cache helper's
// recompute invariant; see set-claim-disposition.ts §225).
// ---------------------------------------------------------------------------
test("parity: setClaimDisposition skips canonical column for orphan legs", async () => {
  const [orphan] = await db
    .insert(claimsTable)
    .values({
      confNumber: `PARITY-ORPHAN-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      status: "Needs Evidence",
      outcome: "Pending",
      invoiceGroupId: null,
      includedInDispute: true,
    })
    .returning();
  try {
    await setClaimDisposition(orphan.id, "disposed_nonissue", {
      mirror: "derived",
      isTerminal: true,
    });
    const got = await reload(orphan.id);
    assert.equal(got.disposition, "unclassified",
      "orphan legs keep the column at its default; cache helper recomputes downstream");
    // Legacy mirrors still flow — they have always been valid on orphan rows.
    assert.equal(got.sopOutcome, "non_issue");
    assert.equal(got.dropReason, "non_issue");
  } finally {
    await db.delete(claimsTable).where(eq(claimsTable.id, orphan.id));
  }
});
