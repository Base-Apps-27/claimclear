// One-shot heal — claim disposition drift (2026-05-08).
//
// Background. The 2026-05-08 prod conformance audit
// (`scripts/check-invoice-state-derivation.ts`) flagged 283
// `disposition_mismatch` rows in `claims` — the stored `disposition`
// column disagrees with what `deriveDispositionFromLegacy(claim,
// parentPhase)` would compute from the legacy mirrors. Triage of the
// violations identified two writers that wrote legacy columns without
// keeping `disposition` in lockstep:
//
//   1. `routes/import.ts` — both `db.insert(claimsTable)` sites
//      omitted `disposition`, so 185 freshly-imported rows landed at
//      the column default `'unclassified'` instead of the deriver's
//      `'classifying'` (errorTypeId set) / `'disposed_nonissue'`
//      (excluded). Same-day fix added an inline derivation.
//
//   2. `lib/group-transitions.ts → syncChildRides` — the cascade
//      updated child status/outcome but not `disposition`. The
//      response-matcher's `transitionGroupStatus({newStatus: "Ready
//      to Review"})` left ~45 children stuck at `disposed_portal /
//      disposed_email / disposed_nonissue` after the parent moved to
//      `phase=response_received` (deriver wants `awaiting_review` or
//      `verdict_*`). Same-day fix added a per-child
//      `refreshClaimDenormalizedCache` call.
//
// Both writer fixes shipped in the same deploy as this script. With
// the spigots closed, this heal makes the historical drift consistent
// in one pass so future conformance audits return 0.
//
// Heal contract (per claim row):
//   * For each claim where `claims.invoice_group_id IS NOT NULL`,
//     compute `derivedPhase = derivePhaseFromLegacy(parentGroup).phase`
//     and `derivedDisposition = deriveDispositionFromLegacy(claim,
//     derivedPhase)`. If `claim.disposition !== derivedDisposition`,
//     UPDATE the row in a single statement.
//   * Write a single `claim_disposition_healed` audit row per healed
//     claim with `metadata.backfillId =
//     'claim_disposition_drift_heal_2026_05_08'`, the from/to values,
//     and the parent phase used for derivation.
//   * Orphan claims (no parent group) are skipped — the deriver has
//     no parent phase to validate against and `refreshClaimDenormalized
//     Cache` short-circuits the same way.
//   * Parent group `phase` is NOT touched. The 3 known
//     `phase_mismatch` rows (4 Portal Queued mid-flight groups, IDs
//     15, 429, 498, 499) are intentionally preserved per the
//     2026-05-08 audit trail.
//
// Idempotent. The compare-then-update is per-row; a partial re-run
// only touches rows that still drift. Re-run after writer-fix deploy
// is the intended verification path.
//
// Run (against whichever DATABASE_URL is exported in the shell;
// typically PROD_DATABASE_URL):
//   pnpm --filter @workspace/api-server exec tsx \
//     src/scripts/oneshot-heal-claim-disposition-drift-2026-05-08.ts [--apply]
//
// Without `--apply` the script runs in dry-run mode: prints the count
// and a sample of changes that *would* be applied, then exits 0. With
// `--apply` it commits the UPDATEs and audit rows in a single tx.

import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  derivePhaseFromLegacy,
  deriveDispositionFromLegacy,
  type LegacyClaimShape,
  type LegacyInvoiceGroupShape,
  type LegacyClaimStatus,
  type LegacyOutcome,
  type LegacySopOutcome,
  type LegacyAttestationState,
  type LegacyDropReason,
} from "@workspace/invoice-state";

const BACKFILL_ID = "claim_disposition_drift_heal_2026_05_08";
const ACTOR_EMAIL = "system@claimclear";
const ACTOR_NAME =
  "System (claim disposition drift heal 2026-05-08)";

interface JoinedRow extends Record<string, unknown> {
  claim_id: number;
  invoice_group_id: number;
  stored_disposition: string;
  c_status: string;
  c_outcome: string;
  c_sop_outcome: string | null;
  c_attestation_state: string;
  c_included_in_dispute: boolean;
  c_duplicate_of_claim_id: number | null;
  c_drop_reason: string | null;
  c_error_type_id: string | null;
  c_closure_reason: string | null;
  g_status: string;
  g_outcome: string;
  g_reattest_required: boolean;
  g_reattest_completed_at: string | null;
  g_closure_reason: string | null;
  g_hold_reason: string | null;
}

interface PlannedHeal {
  claimId: number;
  invoiceGroupId: number;
  parentPhase: string;
  fromDisposition: string;
  toDisposition: string;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const rowsRes = await db.execute<JoinedRow>(sql`
    SELECT c.id                       AS claim_id,
           c.invoice_group_id         AS invoice_group_id,
           c.disposition::text        AS stored_disposition,
           c.status::text             AS c_status,
           c.outcome::text            AS c_outcome,
           c.sop_outcome::text        AS c_sop_outcome,
           c.attestation_state::text  AS c_attestation_state,
           c.included_in_dispute      AS c_included_in_dispute,
           c.duplicate_of_claim_id    AS c_duplicate_of_claim_id,
           c.drop_reason::text        AS c_drop_reason,
           c.error_type_id            AS c_error_type_id,
           c.closure_reason           AS c_closure_reason,
           g.status::text             AS g_status,
           g.outcome::text            AS g_outcome,
           g.reattest_required        AS g_reattest_required,
           g.reattest_completed_at    AS g_reattest_completed_at,
           g.closure_reason           AS g_closure_reason,
           g.hold_reason              AS g_hold_reason
      FROM claims c
      JOIN invoice_groups g ON g.id = c.invoice_group_id
     ORDER BY c.id;
  `);
  const rows = (rowsRes.rows ?? []) as JoinedRow[];

  const plan: PlannedHeal[] = [];
  for (const r of rows) {
    const parentShape: LegacyInvoiceGroupShape = {
      status: r.g_status as LegacyClaimStatus,
      outcome: r.g_outcome as LegacyOutcome,
      reattestRequired: r.g_reattest_required,
      reattestCompletedAt: r.g_reattest_completed_at,
      closureReason: r.g_closure_reason,
      holdReason: r.g_hold_reason,
    };
    const parentPhase = derivePhaseFromLegacy(parentShape).phase;

    const claimShape: LegacyClaimShape = {
      status: r.c_status as LegacyClaimStatus,
      outcome: r.c_outcome as LegacyOutcome,
      sopOutcome: (r.c_sop_outcome as LegacySopOutcome) ?? null,
      attestationState: r.c_attestation_state as LegacyAttestationState,
      includedInDispute: r.c_included_in_dispute,
      duplicateOfClaimId: r.c_duplicate_of_claim_id,
      dropReason: (r.c_drop_reason as LegacyDropReason) ?? null,
      errorTypeId: r.c_error_type_id,
      closureReason: r.c_closure_reason,
    };
    const derived = deriveDispositionFromLegacy(claimShape, parentPhase);

    if (derived !== r.stored_disposition) {
      plan.push({
        claimId: r.claim_id,
        invoiceGroupId: r.invoice_group_id,
        parentPhase,
        fromDisposition: r.stored_disposition,
        toDisposition: derived,
      });
    }
  }

  console.log(
    `[disposition-heal] Scanned ${rows.length.toLocaleString()} claim rows. ${plan.length.toLocaleString()} disposition drift(s) to heal.`,
  );

  if (plan.length === 0) {
    console.log("[disposition-heal] Nothing to do — all dispositions conformant.");
    await pool.end();
    return;
  }

  // Bucket counts so the operator can sanity-check the mix before
  // committing. Mirrors the conformance-classifier output shape.
  const byTransition = new Map<string, number>();
  for (const p of plan) {
    const k = `${p.parentPhase}:${p.fromDisposition}→${p.toDisposition}`;
    byTransition.set(k, (byTransition.get(k) ?? 0) + 1);
  }
  console.log("[disposition-heal] Distribution (parentPhase:from→to):");
  for (const [k, v] of [...byTransition.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`       ${k.padEnd(60)} ${v.toLocaleString()}`);
  }

  const sample = plan.slice(0, 10);
  console.log("[disposition-heal] First 10 planned heals:");
  for (const p of sample) {
    console.log(
      `       claim=${p.claimId} group=${p.invoiceGroupId} parentPhase=${p.parentPhase} ${p.fromDisposition} → ${p.toDisposition}`,
    );
  }

  if (!apply) {
    console.log(
      "[disposition-heal] Dry-run only. Pass --apply to commit the UPDATEs and audit rows.",
    );
    await pool.end();
    return;
  }

  // Single transaction: UPDATE every drifted row + write per-row audit.
  // Per-row UPDATEs (rather than a CASE/UNNEST batch) keep the trigger
  // (`isDispositionValidForPhase`) fail-loud per claim so a bad row
  // can't poison the whole batch.
  await db.transaction(async (tx) => {
    for (const p of plan) {
      await tx.execute(sql`
        UPDATE claims
           SET disposition = ${p.toDisposition}::claim_disposition
         WHERE id = ${p.claimId}
           AND disposition::text = ${p.fromDisposition};
      `);
      await tx.execute(sql`
        INSERT INTO audit_logs (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
        VALUES (
          ${p.claimId},
          ${p.invoiceGroupId},
          'claim_disposition_healed',
          ${`Disposition healed ${p.fromDisposition} → ${p.toDisposition} (parent phase=${p.parentPhase}) — backfill ${BACKFILL_ID}`},
          ${sql`${JSON.stringify({
            backfillId: BACKFILL_ID,
            from: p.fromDisposition,
            to: p.toDisposition,
            parentPhase: p.parentPhase,
            invoiceGroupId: p.invoiceGroupId,
          })}::jsonb`},
          ${ACTOR_EMAIL},
          ${ACTOR_NAME}
        );
      `);
    }
  });

  console.log(
    `[disposition-heal] ✅ Applied ${plan.length.toLocaleString()} disposition heal(s) + audit rows. backfillId=${BACKFILL_ID}`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("[disposition-heal] FATAL:", err);
  process.exit(1);
});
