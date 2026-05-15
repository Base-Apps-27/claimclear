// One-shot neutralization (Task #648 follow-up, 2026-05-15).
//
// Marks every invoice group dated `service_date = 2026-03-30` (the
// pre-app cohort the operator imported but resolved offline) as
// `outcome='No Action Needed' / phase='closed' / status='Resolved'`
// so they neither count as a loss nor inflate a win on any
// scoreboard.
//
// Why "No Action Needed"
// ---------------------
// `dashboard.ts` excludes `outcome IN ('Withdrawn','Non-Issue','No
// Action Needed')` from every money tile (Disputed, Recovered,
// Recovery rate, Net change, At-risk, Outstanding) and from the
// recovery-rate denominator. "No Action Needed" is the system-
// asserted "closed without a dispute outcome" bucket added in Task
// #714 (see `routes/dashboard.ts:312-313, 487, 1188`). Its semantics
// match this cohort exactly: imported, never disputed in-app,
// already settled outside the system.
//
// What this does (per row)
// ------------------------
//   * UPDATE invoice_groups SET
//       outcome           = 'No Action Needed',
//       status            = 'Resolved',
//       phase             = 'closed',
//       phase_entered_at  = NOW()              (if not already 'closed')
//       closure_reason    = 'non_issue',       (vocab from group-transitions.ts)
//       closure_category  = 'non_issue'
//     WHERE id = $1
//       AND service_date = '2026-03-30'
//       AND is_tour_sample = false
//       AND outcome NOT IN ('Approved','Partially Approved','No Action Needed')
//   * Cascades: UPDATE claims SET status='Resolved', outcome='No Action
//     Needed' for child legs that are not already in a terminal positive
//     verdict (preserves any leg-level win that may have been recorded
//     in error). Mirrors the group-level guard.
//   * Per-group + per-claim audit rows tagged `backfillId =
//     'pre_app_march_30_2026_offline'`.
//
// What this does NOT do
// ---------------------
//   * Touch any group whose outcome is already 'Approved' or 'Partially
//     Approved'. The user explicitly chose to preserve those 2 rows
//     ($149.70) so the wins counter and recovered-$ tile keep crediting
//     them — the operator did the in-app review work for those.
//   * Touch tour samples.
//   * Route through `transitionInvoice` (which, for legitimate forward-
//     flow reasons at `group-transitions.ts:643`, refuses to land "No
//     Action Needed" on a group that has already been submitted to the
//     payor). This is a historical reconciliation of pre-app data, not
//     an in-app state transition; the same bypass pattern is used in
//     `oneshot-resolve-duplicate-clusters-2026-05-13.ts`.
//
// Idempotent: the candidate WHERE clause is the exact post-state
// negation, so a partial re-run only touches rows that still drift.
//
// Run:
//   DATABASE_URL=$PROD_DATABASE_URL pnpm --filter @workspace/api-server exec \
//     tsx src/scripts/oneshot-neutralize-pre-app-2026-03-30.ts --apply
//
// Without `--apply` the script does a dry run.

import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";

const BACKFILL_ID = "pre_app_march_30_2026_offline";
const ACTOR_EMAIL = "system@claimclear";
const ACTOR_NAME = "System (Task #648 follow-up — pre-app 2026-03-30 offline-resolved cohort neutralization)";
const TARGET_SERVICE_DATE = "2026-03-30";

interface CandidateRow extends Record<string, unknown> {
  id: number;
  invoice_number: string | null;
  outcome: string;
  phase: string;
  status: string;
  total_amount: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`[oneshot] pre-app neutralization — mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`[oneshot] backfillId: ${BACKFILL_ID}`);
  console.log(`[oneshot] target service_date: ${TARGET_SERVICE_DATE}`);

  const candidatesRes = await db.execute(sql<CandidateRow>`
    SELECT
      id,
      invoice_number,
      outcome::text       AS outcome,
      phase::text         AS phase,
      status::text        AS status,
      total_amount::text  AS total_amount
    FROM invoice_groups
    WHERE is_tour_sample = false
      AND service_date = ${TARGET_SERVICE_DATE}
      AND outcome NOT IN ('Approved','Partially Approved','No Action Needed')
    ORDER BY id;
  `);
  const candidates = (candidatesRes as unknown as { rows: CandidateRow[] }).rows
    ?? (candidatesRes as unknown as CandidateRow[]);
  console.log(`[oneshot] candidate groups: ${candidates.length}`);

  if (candidates.length === 0) {
    console.log("[oneshot] nothing to do — exiting.");
    await pool.end();
    return;
  }

  const totalDollars = candidates.reduce(
    (acc, r) => acc + (parseFloat(r.total_amount ?? "0") || 0),
    0,
  );
  console.log(
    `[oneshot] would remove $${totalDollars.toFixed(2)} of disputed-$ from the scoreboard across ${candidates.length} groups`,
  );

  const phaseTally: Record<string, number> = {};
  const outcomeTally: Record<string, number> = {};
  for (const r of candidates) {
    phaseTally[r.phase] = (phaseTally[r.phase] ?? 0) + 1;
    outcomeTally[r.outcome] = (outcomeTally[r.outcome] ?? 0) + 1;
  }
  console.log("[oneshot] candidates by current outcome:", outcomeTally);
  console.log("[oneshot] candidates by current phase:  ", phaseTally);

  if (!apply) {
    console.log("[oneshot] DRY RUN — no writes performed. Re-run with --apply to commit.");
    await pool.end();
    return;
  }

  let groupsUpdated = 0;
  let claimsUpdated = 0;
  for (const row of candidates) {
    await db.transaction(async (tx) => {
      const upd = await tx.execute(sql`
        UPDATE invoice_groups
           SET outcome          = 'No Action Needed'::claim_outcome,
               status           = 'Resolved'::claim_status,
               phase            = 'closed'::invoice_phase,
               phase_entered_at = CASE WHEN phase = 'closed'::invoice_phase
                                       THEN phase_entered_at
                                       ELSE NOW() END,
               closure_reason   = COALESCE(closure_reason, 'non_issue'),
               closure_category = COALESCE(closure_category, 'non_issue'),
               updated_at       = NOW()
         WHERE id = ${row.id}
           AND is_tour_sample = false
           AND service_date = ${TARGET_SERVICE_DATE}
           AND outcome NOT IN ('Approved','Partially Approved','No Action Needed')
       RETURNING id, outcome::text AS outcome, status::text AS status, phase::text AS phase;
      `);
      const updRows = (upd as unknown as { rows: Array<Record<string, string>> }).rows
        ?? (upd as unknown as Array<Record<string, string>>);
      if (updRows.length === 0) {
        console.log(`[oneshot] id=${row.id} skipped (lost race / no longer matches filter)`);
        return;
      }

      const claimsUpd = await tx.execute(sql`
        UPDATE claims
           SET status     = 'Resolved'::claim_status,
               outcome    = 'No Action Needed'::claim_outcome,
               updated_at = NOW()
         WHERE invoice_group_id = ${row.id}
           AND outcome NOT IN ('Approved','Partially Approved','No Action Needed')
       RETURNING id, status::text AS prev_status, outcome::text AS prev_outcome;
      `);
      const claimRows = (claimsUpd as unknown as { rows: Array<{ id: number; prev_status: string; prev_outcome: string }> }).rows
        ?? (claimsUpd as unknown as Array<{ id: number; prev_status: string; prev_outcome: string }>);
      claimsUpdated += claimRows.length;

      await tx.execute(sql`
        INSERT INTO audit_logs (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
        VALUES (
          NULL,
          ${row.id},
          'group_status_changed',
          ${`Neutralized as pre-app offline-resolved (service_date=${TARGET_SERVICE_DATE}). outcome ${row.outcome} → No Action Needed; phase ${row.phase} → closed; status ${row.status} → Resolved.`},
          ${JSON.stringify({
            backfillId: BACKFILL_ID,
            source: "oneshot:pre_app_march_30_2026_offline",
            invoiceNumber: row.invoice_number,
            serviceDate: TARGET_SERVICE_DATE,
            previousOutcome: row.outcome, newOutcome: "No Action Needed",
            previousPhase:   row.phase,   newPhase:   "closed",
            previousStatus:  row.status,  newStatus:  "Resolved",
            closureReason:   "non_issue", closureCategory: "non_issue",
            totalAmount: row.total_amount,
            childClaimsCascaded: claimRows.length,
            reason: "Pre-app cohort: invoices imported but resolved offline before going through the app. Excluded from every dashboard money tile via the existing 'No Action Needed' carve-out.",
          })}::jsonb,
          ${ACTOR_EMAIL},
          ${ACTOR_NAME}
        );
      `);

      for (const c of claimRows) {
        await tx.execute(sql`
          INSERT INTO audit_logs (claim_id, invoice_group_id, action, details, metadata, user_email, user_name)
          VALUES (
            ${c.id},
            ${row.id},
            'claim_status_changed',
            ${`Cascaded from group neutralization (pre-app offline-resolved). status ${c.prev_status} → Resolved; outcome ${c.prev_outcome} → No Action Needed.`},
            ${JSON.stringify({
              backfillId: BACKFILL_ID,
              source: "oneshot:pre_app_march_30_2026_offline",
              cascadedFromGroupId: row.id,
              previousStatus: c.prev_status,  newStatus: "Resolved",
              previousOutcome: c.prev_outcome, newOutcome: "No Action Needed",
            })}::jsonb,
            ${ACTOR_EMAIL},
            ${ACTOR_NAME}
          );
        `);
      }

      groupsUpdated += 1;
    });
  }

  console.log(`[oneshot] applied: ${groupsUpdated} / ${candidates.length} groups, ${claimsUpdated} child claims cascaded`);

  // Post-run verification.
  const verifyRes = await db.execute(sql`
    SELECT outcome::text AS outcome, phase::text AS phase, status::text AS status, COUNT(*)::int AS n,
           COALESCE(SUM(total_amount), 0)::text AS sum_total,
           COALESCE(SUM(approved_amount), 0)::text AS sum_approved
      FROM invoice_groups
     WHERE is_tour_sample = false
       AND service_date = ${TARGET_SERVICE_DATE}
     GROUP BY outcome, phase, status
     ORDER BY n DESC;
  `);
  const verifyRows = (verifyRes as unknown as { rows: Array<Record<string, unknown>> }).rows
    ?? (verifyRes as unknown as Array<Record<string, unknown>>);
  console.log("[oneshot] post-neutralization rollup for service_date=2026-03-30:");
  for (const r of verifyRows) console.log(`  ${JSON.stringify(r)}`);

  await pool.end();
}

main().catch((err) => {
  console.error("[oneshot] FAILED:", err);
  process.exit(1);
});
