/**
 * Cohort A visibility fix — 2026-05-13
 * ----------------------------------------------------------------------
 * Targets the 83 invoice_groups left wedged by the original duplicate-cluster
 * resolver in:    phase='submitted'  AND  reattest_required=true
 * with a synthetic portal_responses row written by the LLM-first upgrade
 * (metadata->>'upgradeBackfillId' = 'duplicate_cluster_response_upgrade_2026_05_13').
 *
 * Why this exists
 *   The original resolver:
 *     - logged a `portal_submission_cancelled` audit row but never updated
 *       portal_submissions.status from 'submitted' → 'cancelled' (state drift)
 *     - silently set invoice_groups.reattest_required=true with NO audit row
 *     - left invoice_groups.phase at 'submitted' even though a real carrier
 *       response (now classified) is sitting on the group
 *   Result: the response-review inbox filters these out via
 *       phase ∈ ('response_received','reviewed') AND reattest_required IN (NULL,false)
 *   so the operator never sees them. This script reconciles state without
 *   touching the response chip, and stays reversible via per-row audit rows
 *   that record the previous values.
 *
 * What this script does (per group)
 *   1. UPDATE invoice_groups SET phase='response_received'
 *        WHERE id=$1 AND phase='submitted'
 *      (returns previous phase via .returning for audit; skipped if phase has
 *      drifted off 'submitted' since plan-time — the WHERE keeps it idempotent)
 *   2. UPDATE portal_submissions SET status='cancelled'
 *        WHERE invoice_group_id=$1 AND status='submitted'
 *      (only if a `portal_submission_cancelled` audit row exists for the group;
 *      same idempotency guard via WHERE)
 *   3. INSERT one audit row per actual mutation, tagged backfillId=
 *      'cohort_a_visibility_fix_2026_05_13' with previous-value metadata.
 *
 * What this script does NOT do
 *   - Does NOT touch reattest_required. The operator workflow is response →
 *     reattest, so the flag is correct as-is on these groups; surfacing them
 *     on the inbox is sufficient.
 *   - Does NOT touch portal_responses. The LLM upgrade already wrote the chip.
 *   - Does NOT cascade to claims, invoices, or any other table.
 *
 * Safety
 *   - Plan mode (default) writes a JSONL cache and exits without mutating PROD.
 *   - Apply mode (--apply) runs each group in its own transaction with a
 *     guard predicate; transactions that match zero rows are no-ops with no
 *     audit row written.
 *   - Resumable: an apply run reads the JSONL cache and skips groups whose
 *     post-state already matches the target.
 *
 * Rollback
 *   For each audit row written by this script:
 *     UPDATE invoice_groups SET phase=(metadata->>'previousPhase')::invoice_phase
 *       WHERE id=(metadata->>'invoiceGroupId')::int
 *         AND phase='response_received';
 *     UPDATE portal_submissions SET status='submitted'
 *       WHERE id=(metadata->>'portalSubmissionId')::int
 *         AND status='cancelled';
 *   Then DELETE FROM audit_logs WHERE metadata->>'backfillId'=
 *     'cohort_a_visibility_fix_2026_05_13';
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const BACKFILL_ID = "cohort_a_visibility_fix_2026_05_13";
const UPGRADE_BACKFILL_ID = "duplicate_cluster_response_upgrade_2026_05_13";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_PATH = path.resolve(
  __dirname,
  "../../exports/cohort-a-visibility-fix-2026-05-13.jsonl",
);

type PlanRow = {
  groupId: number;
  invoiceNumber: string;
  currentPhase: string;
  targetPhase: "response_received";
  reattestRequired: boolean | null;
  upgradedChip: string;
  portalSubmissionId: number | null;
  portalSubmissionCurrentStatus: string | null;
  portalSubmissionTargetStatus: "cancelled" | null;
  hasCancellationAudit: boolean;
};

type ApplyResult = {
  groupId: number;
  phaseUpdated: boolean;
  submissionUpdated: boolean;
  skippedReason?: string;
  appliedAt: string;
};

async function buildPlan(): Promise<PlanRow[]> {
  const { rows } = await pool.query(
    `
    SELECT ig.id                                                AS group_id,
           ig.invoice_number,
           ig.phase::text                                       AS current_phase,
           ig.reattest_required,
           pr."responseType"::text                              AS upgraded_chip,
           ps.id                                                AS portal_submission_id,
           ps.status::text                                      AS portal_submission_status,
           EXISTS (
             SELECT 1 FROM audit_logs al
              WHERE al.invoice_group_id = ig.id
                AND al.action = 'portal_submission_cancelled'
           )                                                    AS has_cancellation_audit
      FROM invoice_groups ig
      JOIN portal_responses pr
        ON pr.invoice_group_id = ig.id
       AND pr.metadata->>'upgradeBackfillId' = $1
      LEFT JOIN LATERAL (
        SELECT * FROM portal_submissions ps2
         WHERE ps2.invoice_group_id = ig.id
         ORDER BY ps2.id DESC
         LIMIT 1
      ) ps ON true
     WHERE ig.phase::text = 'submitted'
       AND ig.reattest_required = true
     ORDER BY ig.id
    `,
    [UPGRADE_BACKFILL_ID],
  );

  return rows.map((r): PlanRow => {
    const wantSubmissionFix =
      r.has_cancellation_audit &&
      r.portal_submission_id !== null &&
      r.portal_submission_status === "submitted";
    return {
      groupId: r.group_id,
      invoiceNumber: r.invoice_number,
      currentPhase: r.current_phase,
      targetPhase: "response_received",
      reattestRequired: r.reattest_required,
      upgradedChip: r.upgraded_chip,
      portalSubmissionId: r.portal_submission_id,
      portalSubmissionCurrentStatus: r.portal_submission_status,
      portalSubmissionTargetStatus: wantSubmissionFix ? "cancelled" : null,
      hasCancellationAudit: r.has_cancellation_audit,
    };
  });
}

function writePlanCache(plan: PlanRow[]) {
  mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  writeFileSync(
    CACHE_PATH,
    plan.map((row) => JSON.stringify({ kind: "plan", ...row })).join("\n") + "\n",
  );
}

function readPlanCache(): PlanRow[] {
  if (!existsSync(CACHE_PATH)) {
    throw new Error(
      `No plan cache at ${CACHE_PATH}. Run without --apply first to build it.`,
    );
  }
  const lines = readFileSync(CACHE_PATH, "utf8").split("\n").filter(Boolean);
  return lines
    .map((l) => JSON.parse(l))
    .filter((o) => o.kind === "plan")
    .map(({ kind, ...rest }) => rest as PlanRow);
}

function appendApplyResult(result: ApplyResult) {
  appendFileSync(CACHE_PATH, JSON.stringify({ kind: "apply", ...result }) + "\n");
}

async function applyOne(row: PlanRow): Promise<ApplyResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let phaseUpdated = false;
    let submissionUpdated = false;

    // --- 1) phase: 'submitted' -> 'response_received' (idempotent guard) ---
    const phaseRes = await client.query(
      `UPDATE invoice_groups
          SET phase = 'response_received',
              phase_entered_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
          AND phase = 'submitted'
        RETURNING id, phase::text AS phase`,
      [row.groupId],
    );
    if (phaseRes.rowCount === 1) {
      phaseUpdated = true;
      await client.query(
        `INSERT INTO audit_logs (invoice_group_id, action, details, metadata, "timestamp", user_email, user_name)
         VALUES ($1, 'group_phase_changed', $2, $3::jsonb, NOW(), 'system', 'system:cohort_a_visibility_fix')`,
        [
          row.groupId,
          `Phase advanced from submitted → response_received to surface the group on Responses Awaiting Review (carrier response was already classified by upgrade ${UPGRADE_BACKFILL_ID}).`,
          JSON.stringify({
            backfillId: BACKFILL_ID,
            invoiceGroupId: row.groupId,
            invoiceNumber: row.invoiceNumber,
            previousPhase: row.currentPhase,
            newPhase: "response_received",
            upgradedChip: row.upgradedChip,
            reattestRequired: row.reattestRequired,
          }),
        ],
      );
    }

    // --- 2) portal_submissions.status: 'submitted' -> 'cancelled' (only if cancellation audit exists) ---
    if (row.portalSubmissionTargetStatus === "cancelled" && row.portalSubmissionId !== null) {
      const psRes = await client.query(
        `UPDATE portal_submissions
            SET status = 'cancelled',
                updated_at = NOW()
          WHERE id = $1
            AND invoice_group_id = $2
            AND status = 'submitted'
          RETURNING id, status::text AS status`,
        [row.portalSubmissionId, row.groupId],
      );
      if (psRes.rowCount === 1) {
        submissionUpdated = true;
        await client.query(
          `INSERT INTO audit_logs (invoice_group_id, action, details, metadata, "timestamp", user_email, user_name)
           VALUES ($1, 'portal_submission_cancelled', $2, $3::jsonb, NOW(), 'system', 'system:cohort_a_visibility_fix')`,
          [
            row.groupId,
            `portal_submissions.status reconciled from 'submitted' → 'cancelled' to match the existing portal_submission_cancelled audit row written by ${UPGRADE_BACKFILL_ID}'s upstream resolver.`,
            JSON.stringify({
              backfillId: BACKFILL_ID,
              invoiceGroupId: row.groupId,
              portalSubmissionId: row.portalSubmissionId,
              previousStatus: "submitted",
              newStatus: "cancelled",
              reasonCode: "state_drift_reconciliation",
            }),
          ],
        );
      }
    }

    await client.query("COMMIT");

    return {
      groupId: row.groupId,
      phaseUpdated,
      submissionUpdated,
      skippedReason: !phaseUpdated && !submissionUpdated ? "no_op_idempotent_guard" : undefined,
      appliedAt: new Date().toISOString(),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1] ?? "0") : 0;

  if (!apply) {
    const plan = await buildPlan();
    writePlanCache(plan);
    console.log(`[plan] Wrote ${plan.length} rows to ${CACHE_PATH}`);
    const phaseFixCount = plan.filter((p) => p.currentPhase === "submitted").length;
    const submissionFixCount = plan.filter((p) => p.portalSubmissionTargetStatus === "cancelled").length;
    const chipBreakdown: Record<string, number> = {};
    for (const p of plan) chipBreakdown[p.upgradedChip] = (chipBreakdown[p.upgradedChip] ?? 0) + 1;
    console.log(`[plan] phase fixes:           ${phaseFixCount}`);
    console.log(`[plan] submission status fix: ${submissionFixCount}`);
    console.log(`[plan] chip breakdown:        ${JSON.stringify(chipBreakdown)}`);
    console.log(`[plan] First 3 rows:`);
    for (const p of plan.slice(0, 3)) console.log(`  ${JSON.stringify(p)}`);
    console.log(`\n[plan] To apply: pnpm exec tsx src/scripts/cohort-a-visibility-fix-2026-05-13.ts --apply`);
    await pool.end();
    return;
  }

  // APPLY mode: read plan cache, apply each row.
  const plan = readPlanCache();
  const trimmed = limit > 0 ? plan.slice(0, limit) : plan;
  console.log(`[apply] Applying ${trimmed.length} rows from cached plan`);

  let phaseUpdates = 0;
  let submissionUpdates = 0;
  let noops = 0;
  let errors = 0;

  for (const row of trimmed) {
    try {
      const r = await applyOne(row);
      appendApplyResult(r);
      if (r.phaseUpdated) phaseUpdates++;
      if (r.submissionUpdated) submissionUpdates++;
      if (!r.phaseUpdated && !r.submissionUpdated) noops++;
      if ((phaseUpdates + submissionUpdates + noops) % 10 === 0) {
        console.log(`[apply] progress: phase=${phaseUpdates} sub=${submissionUpdates} noop=${noops} err=${errors}`);
      }
    } catch (err) {
      errors++;
      console.error(`[apply] FAILED group=${row.groupId}:`, err);
    }
  }

  console.log(`\n[apply] DONE — phase=${phaseUpdates} submission=${submissionUpdates} noop=${noops} err=${errors}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
