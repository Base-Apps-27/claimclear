// One-shot recovery (2026-05-09).
//
// After today's hotfix #635 (Re-attest CTA gate) the operator-facing
// queues were finally usable end-to-end again, but a production audit
// surfaced three pre-existing data shapes that left work invisible to
// the UI:
//
//   Bucket A — Closure stamp missing (7 groups, all bulk-reattested
//              May 5 / May 6 by Grace, plus 17 + 382 from per-group
//              clicks). Every Approved leg landed at attestation_state
//              ='completed' but the parent group was never moved to
//              Resolved/Approved/closed and `reattest_completed_at` was
//              never stamped. Result: invisible on the Completed
//              Attestation tab AND still cluttering upstream
//              "needs review" views.
//
//              Affected groups: 17, 241, 303, 304, 305, 322, 382.
//
//   Bucket B — Status column drifted (6 groups, the inverse of A,
//              same root cause as Task #543 May-8 heal). Closure stamp
//              IS set and phase IS 'closed', but legacy `status` /
//              `outcome` columns were left at 'Needs Review' /
//              'Pending' because the bulk-reattest writer stamped
//              `reattest_completed_at` directly without routing
//              through `transitionGroupStatusAndOutcome`. The May 8
//              heal (`oneshot-heal-reattest-completed-status-2026-05-08`)
//              caught the rows that existed at that moment; these 6
//              are the ones Grace/operators added on May 5–6 plus
//              backlog the prior pass missed.
//
//              Affected groups: 42, 100, 176, 235, 297, 474.
//
//   Bucket C — Leg status not synced to MAS Eligible (9 legs across
//              8 groups, all bulk-reattested May 8–9 by Emil). The
//              "early re-attest from MAS Eligible" path
//              (`engageMasEligibleAttestationCascade`) correctly
//              flipped each leg's `attestation_state` to 'queued' but
//              did not cascade leg `status` from 'New' to
//              'MAS Eligible'. The Attestation Queue route at
//              `/claims/attestation-pending` filters with
//              `attestation_state ∈ {pending,queued} AND
//              (outcome ∈ {Approved, Partially Approved} OR
//              claim.status = 'MAS Eligible')`, so legs with
//              outcome='Pending' AND status='New' fall through both
//              branches of the OR and are silently filtered out — even
//              though the operator clicked Re-attest and the data
//              correctly reflects "queued".
//
//              Affected groups: 422, 514, 540, 541, 565, 593, 600, 641
//              (group 593 has 2 such legs).
//
// What this script does
// ─────────────────────
// One unified, transactional pass with three independent branches.
// Each branch is gated by an exact-fingerprint predicate so a re-run
// is a no-op once the row is healed. Every write is paired with an
// audit row tagged `metadata.backfillId =
// 'reattest_recovery_2026_05_09'` so the entire recovery can be
// sliced out of audit history with a single uniform filter.
//
// Branch A (per group):
//   * UPDATE invoice_groups SET status='Resolved', outcome='Approved',
//     phase='closed', closure_reason='reattested',
//     reattest_completed_at = (SELECT MAX(c.attested_at) FROM claims c
//                              WHERE c.invoice_group_id = ig.id
//                                AND c.attestation_state = 'completed'),
//     phase_entered_at = COALESCE(phase_entered_at, NOW())
//   * INSERT audit_logs (group_status_and_outcome_changed)
//
// Branch B (per group, mirrors May-8 heal):
//   * UPDATE invoice_groups SET status='Resolved', outcome='Approved',
//     phase='closed' (defensive — already 'closed'),
//     closure_reason='reattested' (defensive),
//     phase_entered_at = COALESCE(phase_entered_at, NOW())
//   * INSERT audit_logs (group_status_and_outcome_changed)
//
// Branch C (per leg):
//   * UPDATE claims SET status='MAS Eligible'
//     WHERE attestation_state='queued' AND status='New'
//       AND parent group's status='MAS Eligible'
//   * INSERT audit_logs (claim_status_changed) on the leg
//
// What this script does NOT do
// ────────────────────────────
//   * Cascade legacy `status` to disputed children of branch-A/B
//     groups. The disputed-child sync backfill at boot
//     (`src/index.ts:125`) already heals child status drift
//     idempotently. Same reasoning as the May-8 heal.
//   * Mutate `outcome` on the non-issue / non-contestable partner legs
//     in branch-A/B groups. Those legs are correctly at outcome=Pending
//     with sop_outcome='non_issue' or 'cannot_dispute' — the leg-level
//     outcome stays Pending by design when the leg was dropped at
//     classification.
//   * Touch any group already at terminal status (Resolved/Denied/
//     Expired). The branch-A/B predicates explicitly exclude them.
//   * Re-engage `attestation_state` for legs that are still at
//     not_required. That's a separate problem with a separate predicate
//     (see `oneshot-promote-stuck-attestation-legs.ts`); this script
//     intentionally does not re-do that work.
//
// Idempotency
// ───────────
// All three branches re-check their predicate inside the per-row
// transaction so a concurrent operator action can't be clobbered, and
// a partial re-run only touches rows that still drift.
//
// Run (against whichever DATABASE_URL is exported in the shell;
// typically PROD_DATABASE_URL):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-reattest-recovery-2026-05-09.ts [--apply]
//
// Defaults to a dry run that prints the candidate set without
// touching any rows. Pass --apply to commit.

import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

const BACKFILL_ID = "reattest_recovery_2026_05_09";
const ACTOR_EMAIL = "system@claimclear";
const ACTOR_NAME = "System (reattest recovery 2026-05-09)";

interface BranchACandidate extends Record<string, unknown> {
  id: number;
  invoice_number: string;
  status: string;
  outcome: string;
  phase: string | null;
  closure_reason: string | null;
  latest_attested_at: string;
}

interface BranchBCandidate extends Record<string, unknown> {
  id: number;
  invoice_number: string;
  status: string;
  outcome: string;
  phase: string | null;
  closure_reason: string | null;
  reattest_completed_at: string;
}

interface BranchCCandidate extends Record<string, unknown> {
  claim_id: number;
  conf_number: string | null;
  invoice_group_id: number;
  invoice_number: string;
  leg_status: string;
  attestation_state: string;
}

async function loadBranchACandidates(): Promise<BranchACandidate[]> {
  // Predicate: closure stamp missing, status non-terminal, every
  // Approved/Partial leg has already been attested, and at least one
  // such leg exists. Excludes groups already at Resolved/Denied/
  // Expired and groups with any approved leg still pending/queued.
  const res = await db.execute<BranchACandidate>(sql`
    SELECT ig.id,
           ig.invoice_number,
           ig.status::text  AS status,
           ig.outcome::text AS outcome,
           ig.phase,
           ig.closure_reason,
           (SELECT MAX(c.attested_at)::text
              FROM claims c
             WHERE c.invoice_group_id = ig.id
               AND c.attestation_state = 'completed') AS latest_attested_at
      FROM invoice_groups ig
     WHERE ig.reattest_completed_at IS NULL
       AND ig.status::text NOT IN ('Resolved', 'Denied', 'Expired')
       AND EXISTS (
             SELECT 1 FROM claims c
              WHERE c.invoice_group_id = ig.id
                AND c.outcome IN ('Approved', 'Partially Approved')
                AND c.attestation_state = 'completed'
           )
       AND NOT EXISTS (
             SELECT 1 FROM claims c
              WHERE c.invoice_group_id = ig.id
                AND c.outcome IN ('Approved', 'Partially Approved')
                AND c.attestation_state <> 'completed'
           )
     ORDER BY ig.id;
  `);
  return (res.rows ?? []) as BranchACandidate[];
}

async function loadBranchBCandidates(): Promise<BranchBCandidate[]> {
  // Mirror of the May-8 heal predicate.
  const res = await db.execute<BranchBCandidate>(sql`
    SELECT id,
           invoice_number,
           status::text  AS status,
           outcome::text AS outcome,
           phase,
           closure_reason,
           reattest_completed_at::text AS reattest_completed_at
      FROM invoice_groups
     WHERE reattest_completed_at IS NOT NULL
       AND status::text NOT IN ('Resolved', 'Denied', 'Expired')
     ORDER BY id;
  `);
  return (res.rows ?? []) as BranchBCandidate[];
}

async function loadBranchCCandidates(): Promise<BranchCCandidate[]> {
  // Legs queued for re-attestation under a MAS-Eligible parent group
  // whose own status was never cascaded off 'New'.
  const res = await db.execute<BranchCCandidate>(sql`
    SELECT c.id                  AS claim_id,
           c.conf_number          AS conf_number,
           c.invoice_group_id     AS invoice_group_id,
           ig.invoice_number      AS invoice_number,
           c.status::text         AS leg_status,
           c.attestation_state    AS attestation_state
      FROM claims c
      JOIN invoice_groups ig ON ig.id = c.invoice_group_id
     WHERE c.attestation_state = 'queued'
       AND c.status::text = 'New'
       AND ig.status::text = 'MAS Eligible'
     ORDER BY c.invoice_group_id, c.id;
  `);
  return (res.rows ?? []) as BranchCCandidate[];
}

async function main() {
  const apply = process.argv.includes("--apply");

  const [branchA, branchB, branchC] = await Promise.all([
    loadBranchACandidates(),
    loadBranchBCandidates(),
    loadBranchCCandidates(),
  ]);

  console.log(
    `[oneshot] Branch A (closure stamp missing): ${branchA.length} group(s).`,
  );
  for (const r of branchA) {
    console.log(
      `  - group#${r.id} inv ${r.invoice_number} status=${r.status} phase=${r.phase ?? "-"}` +
        ` latestAttestedAt=${r.latest_attested_at ?? "(null)"}`,
    );
  }

  console.log(
    `\n[oneshot] Branch B (status drifted, closure stamped): ${branchB.length} group(s).`,
  );
  for (const r of branchB) {
    console.log(
      `  - group#${r.id} inv ${r.invoice_number} status=${r.status} outcome=${r.outcome}` +
        ` phase=${r.phase ?? "-"} closureReason=${r.closure_reason ?? "-"}` +
        ` reattestCompletedAt=${r.reattest_completed_at}`,
    );
  }

  console.log(
    `\n[oneshot] Branch C (queued legs invisible on Attestation Queue): ${branchC.length} leg(s).`,
  );
  for (const r of branchC) {
    console.log(
      `  - claim#${r.claim_id} (${r.conf_number ?? "-"}) group#${r.invoice_group_id}` +
        ` inv ${r.invoice_number} legStatus=${r.leg_status} attestationState=${r.attestation_state}`,
    );
  }

  const total = branchA.length + branchB.length + branchC.length;
  if (total === 0) {
    console.log("\n[oneshot] Nothing to do. Exiting.");
    return;
  }

  if (!apply) {
    console.log(
      `\n[oneshot] Dry run. ${total} row(s) would be touched across the three branches.` +
        ` Re-run with --apply to commit.`,
    );
    return;
  }

  let aUpdated = 0;
  let bUpdated = 0;
  let cUpdated = 0;
  let auditsWritten = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Branch A ────────────────────────────────────────────────
    for (const row of branchA) {
      // Compute reattest_completed_at = MAX(attested_at) inline in the
      // UPDATE rather than from the preloaded snapshot, so a concurrent
      // attestation completion between load-time and write-time still
      // produces a correct (and never-stale) timestamp.
      const upd = await client.query<{ id: number; reattest_completed_at: string }>(
        `UPDATE invoice_groups
            SET status                = 'Resolved'::claim_status,
                outcome               = 'Approved'::claim_outcome,
                phase                 = 'closed',
                phase_entered_at      = COALESCE(phase_entered_at, NOW()),
                closure_reason        = 'reattested',
                reattest_completed_at = (
                  SELECT MAX(c.attested_at) FROM claims c
                   WHERE c.invoice_group_id = invoice_groups.id
                     AND c.attestation_state = 'completed'
                )
          WHERE id = $1
            AND reattest_completed_at IS NULL
            AND status::text NOT IN ('Resolved','Denied','Expired')
            AND EXISTS (
                  SELECT 1 FROM claims c
                   WHERE c.invoice_group_id = invoice_groups.id
                     AND c.outcome IN ('Approved','Partially Approved')
                     AND c.attestation_state = 'completed'
                )
            AND NOT EXISTS (
                  SELECT 1 FROM claims c
                   WHERE c.invoice_group_id = invoice_groups.id
                     AND c.outcome IN ('Approved','Partially Approved')
                     AND c.attestation_state <> 'completed'
                )
          RETURNING id, reattest_completed_at::text`,
        [row.id],
      );
      if (upd.rowCount === 0) continue;
      const stampedAt = upd.rows?.[0]?.reattest_completed_at ?? row.latest_attested_at;
      aUpdated += 1;

      await client.query(
        `INSERT INTO audit_logs
           (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
         VALUES (NULL, $1, $2, $3, $4::jsonb, $5, $6)`,
        [
          row.id,
          "group_status_and_outcome_changed",
          `status: ${row.status} → Resolved, outcome: ${row.outcome} → Approved, closure: Re-attested` +
            ` — heal of missing reattest closure (branch A, backfillId=${BACKFILL_ID})`,
          JSON.stringify({
            backfillId: BACKFILL_ID,
            branch: "A",
            fromStatus: row.status,
            toStatus: "Resolved",
            fromOutcome: row.outcome,
            toOutcome: "Approved",
            previousPhase: row.phase,
            previousClosureReason: row.closure_reason,
            closureReason: "reattested",
            closureReasonLabel: "Re-attested",
            reattestCompletedAt: stampedAt,
            source: "oneshot:reattest_recovery_2026_05_09",
            reason:
              "Heal: every Approved leg was attested='completed' but the parent group" +
              " was never moved to Resolved/Approved/closed and reattest_completed_at" +
              " was never stamped. Stamping reattest_completed_at = max(attested_at) and" +
              " transitioning the group to its terminal Resolved/Approved/closed/reattested" +
              " state.",
          }),
          ACTOR_EMAIL,
          ACTOR_NAME,
        ],
      );
      auditsWritten += 1;
    }

    // ── Branch B ────────────────────────────────────────────────
    for (const row of branchB) {
      const upd = await client.query(
        `UPDATE invoice_groups
            SET status           = 'Resolved'::claim_status,
                outcome          = 'Approved'::claim_outcome,
                phase            = 'closed',
                phase_entered_at = COALESCE(phase_entered_at, NOW()),
                closure_reason   = 'reattested'
          WHERE id = $1
            AND reattest_completed_at IS NOT NULL
            AND status::text NOT IN ('Resolved','Denied','Expired')
          RETURNING id`,
        [row.id],
      );
      if (upd.rowCount === 0) continue;
      bUpdated += 1;

      await client.query(
        `INSERT INTO audit_logs
           (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
         VALUES (NULL, $1, $2, $3, $4::jsonb, $5, $6)`,
        [
          row.id,
          "group_status_and_outcome_changed",
          `status: ${row.status} → Resolved, outcome: ${row.outcome} → Approved, closure: Re-attested` +
            ` — heal of pre-Task-543 reattest-complete writer (branch B, backfillId=${BACKFILL_ID})`,
          JSON.stringify({
            backfillId: BACKFILL_ID,
            branch: "B",
            fromStatus: row.status,
            toStatus: "Resolved",
            fromOutcome: row.outcome,
            toOutcome: "Approved",
            previousPhase: row.phase,
            previousClosureReason: row.closure_reason,
            closureReason: "reattested",
            closureReasonLabel: "Re-attested",
            source: "oneshot:reattest_recovery_2026_05_09",
            reason:
              "Heal: reattest_completed_at was set but legacy status/outcome were never" +
              " moved to a terminal state (sibling of Task #543 May-8 heal — these rows" +
              " were created May 5-6 by bulk-reattest before the canonical writer was" +
              " centralised).",
          }),
          ACTOR_EMAIL,
          ACTOR_NAME,
        ],
      );
      auditsWritten += 1;
    }

    // ── Branch C ────────────────────────────────────────────────
    for (const row of branchC) {
      const upd = await client.query(
        `UPDATE claims
            SET status = 'MAS Eligible'::claim_status
          WHERE id = $1
            AND status::text = 'New'
            AND attestation_state = 'queued'
            AND EXISTS (
                  SELECT 1 FROM invoice_groups ig2
                   WHERE ig2.id = claims.invoice_group_id
                     AND ig2.status::text = 'MAS Eligible'
                )
          RETURNING id`,
        [row.claim_id],
      );
      if (upd.rowCount === 0) continue;
      cUpdated += 1;

      await client.query(
        `INSERT INTO audit_logs
           (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          row.claim_id,
          row.invoice_group_id,
          "claim_status_changed",
          `status: ${row.leg_status} → MAS Eligible — heal of leg-status not synced to MAS Eligible` +
            ` after early-reattest cascade (branch C, backfillId=${BACKFILL_ID})`,
          JSON.stringify({
            backfillId: BACKFILL_ID,
            branch: "C",
            fromStatus: row.leg_status,
            toStatus: "MAS Eligible",
            attestationState: row.attestation_state,
            source: "oneshot:reattest_recovery_2026_05_09",
            reason:
              "Heal: engageMasEligibleAttestationCascade flipped leg attestation_state" +
              " to 'queued' but did not cascade leg status from 'New' to 'MAS Eligible'." +
              " The Attestation Queue route filter (`outcome ∈ {Approved, Partially Approved}" +
              " OR claim.status = 'MAS Eligible'`) silently filtered the leg out of the queue" +
              " even though it was correctly queued. Promoting leg status to match parent" +
              " group's MAS Eligible state restores visibility.",
          }),
          ACTOR_EMAIL,
          ACTOR_NAME,
        ],
      );
      auditsWritten += 1;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(
    `\n[oneshot] Done.` +
      ` Branch A: updated ${aUpdated}/${branchA.length} group(s).` +
      ` Branch B: updated ${bUpdated}/${branchB.length} group(s).` +
      ` Branch C: updated ${cUpdated}/${branchC.length} leg(s).` +
      ` Wrote ${auditsWritten} audit row(s).` +
      `\nSlice with: SELECT * FROM audit_logs WHERE metadata->>'backfillId' = '${BACKFILL_ID}';`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
