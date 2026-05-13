/**
 * Cohort B error_type_id assignment — 2026-05-13
 * ----------------------------------------------------------------------
 * Targets the 10 invoice_groups upgraded by
 *   metadata->>'upgradeBackfillId' = 'duplicate_cluster_response_upgrade_2026_05_13'
 * that are hidden from the response-review inbox purely because their
 * error_type_id is NULL/empty.
 *
 * Each of the 10 groups carries a multi-flag `error_details` string of the
 * form "<flag A>; <flag B>". This script picks the FIRST flag as the
 * canonical error_type and assigns the matching error_type_id from the
 * existing dictionary used elsewhere in the system. The second flag is
 * preserved verbatim in audit metadata for full reversibility.
 *
 * Mapping (deterministic, derived from observed `error_details` heads):
 *   "GPS pickup too far from residence"          → id=3  (GPS Pickup Too Far from Residence)
 *   "GPS pickup too far from medical facility"   → id=4  (GPS Pickup Too Far from Medical Facility)
 *   "Travel time is too short for distance ..."  → id=13 (Travel Time Too Short for Distance Traveled)
 *   "GPS destination too far from residence"     → SKIP (no exact dictionary match — should never
 *                                                       appear as a FIRST flag in the cohort, but
 *                                                       guarded just in case)
 *
 * What this script does (per group)
 *   1. UPDATE invoice_groups
 *        SET error_type_id   = $1,
 *            error_type_name = $2
 *      WHERE id = $3
 *        AND (error_type_id IS NULL OR error_type_id::text = '')
 *   2. INSERT one audit_logs row tagged
 *      backfillId='cohort_b_error_type_assignment_2026_05_13'
 *      with metadata.previousErrorTypeId=null and the full original
 *      error_details for rollback.
 *
 * What this script does NOT do
 *   - Does NOT touch portal_responses, phase, or reattest_required.
 *     (Cohort A handles phase. Some Cohort B rows ALSO need Cohort A's fix;
 *      run both — order does not matter.)
 *   - Does NOT alter error_details. The semicolon-separated string is
 *     preserved so the secondary flag is still discoverable downstream.
 *
 * Safety
 *   - Plan mode (default) writes a JSONL cache and exits without mutating PROD.
 *   - Apply mode (--apply) runs each group in its own transaction with an
 *     idempotency guard so re-runs are safe.
 *   - Only assigns when the FIRST flag matches a dictionary entry. If a row
 *     has an unmappable first flag, plan emits {action: "skip"} and apply
 *     no-ops it.
 *
 * Rollback
 *   UPDATE invoice_groups SET error_type_id = NULL, error_type_name = NULL
 *     WHERE id = (metadata->>'invoiceGroupId')::int
 *       AND error_type_id::text = (metadata->>'newErrorTypeId');
 *   DELETE FROM audit_logs WHERE metadata->>'backfillId'=
 *     'cohort_b_error_type_assignment_2026_05_13';
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const BACKFILL_ID = "cohort_b_error_type_assignment_2026_05_13";
const UPGRADE_BACKFILL_ID = "duplicate_cluster_response_upgrade_2026_05_13";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_PATH = path.resolve(
  __dirname,
  "../../exports/cohort-b-error-type-assignment-2026-05-13.jsonl",
);

type FlagMap = { id: string; name: string };
const FLAG_DICT: Array<{ pattern: RegExp; map: FlagMap }> = [
  { pattern: /^GPS pickup too far from residence$/i,        map: { id: "3",  name: "GPS Pickup Too Far from Residence" } },
  { pattern: /^GPS pickup too far from medical facility$/i, map: { id: "4",  name: "GPS Pickup Too Far from Medical Facility" } },
  { pattern: /^Travel time is too short for distance(?: traveled)?$/i, map: { id: "13", name: "Travel Time Too Short for Distance Traveled" } },
];

function mapFirstFlag(errorDetails: string | null): FlagMap | null {
  if (!errorDetails) return null;
  const first = errorDetails.split(";")[0]?.trim() ?? "";
  for (const { pattern, map } of FLAG_DICT) if (pattern.test(first)) return map;
  return null;
}

type PlanRow = {
  groupId: number;
  invoiceNumber: string;
  errorDetails: string;
  firstFlag: string;
  decision: "assign" | "skip";
  newErrorTypeId: string | null;
  newErrorTypeName: string | null;
  upgradedChip: string;
};

async function buildPlan(): Promise<PlanRow[]> {
  const { rows } = await pool.query(
    `
    SELECT ig.id                       AS group_id,
           ig.invoice_number,
           ig.error_details,
           pr."responseType"::text     AS upgraded_chip
      FROM invoice_groups ig
      JOIN portal_responses pr
        ON pr.invoice_group_id = ig.id
       AND pr.metadata->>'upgradeBackfillId' = $1
     WHERE ig.error_type_id IS NULL OR ig.error_type_id::text = ''
     ORDER BY ig.id
    `,
    [UPGRADE_BACKFILL_ID],
  );
  return rows.map((r): PlanRow => {
    const first = (r.error_details ?? "").split(";")[0]?.trim() ?? "";
    const m = mapFirstFlag(r.error_details);
    return {
      groupId: r.group_id,
      invoiceNumber: r.invoice_number,
      errorDetails: r.error_details ?? "",
      firstFlag: first,
      decision: m ? "assign" : "skip",
      newErrorTypeId: m?.id ?? null,
      newErrorTypeName: m?.name ?? null,
      upgradedChip: r.upgraded_chip,
    };
  });
}

function writePlanCache(plan: PlanRow[]) {
  mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  writeFileSync(
    CACHE_PATH,
    plan.map((p) => JSON.stringify({ kind: "plan", ...p })).join("\n") + "\n",
  );
}
function readPlanCache(): PlanRow[] {
  if (!existsSync(CACHE_PATH)) throw new Error(`No plan cache at ${CACHE_PATH}`);
  return readFileSync(CACHE_PATH, "utf8").split("\n").filter(Boolean)
    .map((l) => JSON.parse(l)).filter((o) => o.kind === "plan")
    .map(({ kind, ...rest }) => rest as PlanRow);
}

async function applyOne(row: PlanRow): Promise<{ groupId: number; updated: boolean; reason?: string }> {
  if (row.decision === "skip") return { groupId: row.groupId, updated: false, reason: "unmappable_first_flag" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE invoice_groups
          SET error_type_id   = $1,
              error_type_name = $2,
              updated_at      = NOW()
        WHERE id = $3
          AND (error_type_id IS NULL OR error_type_id::text = '')
        RETURNING id`,
      [row.newErrorTypeId, row.newErrorTypeName, row.groupId],
    );
    if (upd.rowCount === 1) {
      await client.query(
        `INSERT INTO audit_logs (invoice_group_id, action, details, metadata, "timestamp", user_email, user_name)
         VALUES ($1, 'group_error_type_assigned', $2, $3::jsonb, NOW(), 'system', 'system:cohort_b_error_type_assignment')`,
        [
          row.groupId,
          `Assigned error_type_id=${row.newErrorTypeId} (${row.newErrorTypeName}) — derived from first flag in error_details: "${row.firstFlag}". Original error_details preserved verbatim.`,
          JSON.stringify({
            backfillId: BACKFILL_ID,
            invoiceGroupId: row.groupId,
            invoiceNumber: row.invoiceNumber,
            previousErrorTypeId: null,
            previousErrorTypeName: null,
            newErrorTypeId: row.newErrorTypeId,
            newErrorTypeName: row.newErrorTypeName,
            sourceFlag: row.firstFlag,
            originalErrorDetails: row.errorDetails,
            upgradedChip: row.upgradedChip,
            mappingMethod: "first_flag_dictionary_lookup",
          }),
        ],
      );
      await client.query("COMMIT");
      return { groupId: row.groupId, updated: true };
    } else {
      await client.query("ROLLBACK");
      return { groupId: row.groupId, updated: false, reason: "no_op_already_assigned" };
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (!apply) {
    const plan = await buildPlan();
    writePlanCache(plan);
    console.log(`[plan] Wrote ${plan.length} rows to ${CACHE_PATH}`);
    const assignCount = plan.filter((p) => p.decision === "assign").length;
    const skipCount = plan.filter((p) => p.decision === "skip").length;
    const byTarget: Record<string, number> = {};
    for (const p of plan) {
      const key = p.decision === "assign" ? `${p.newErrorTypeId} ${p.newErrorTypeName}` : "(skip)";
      byTarget[key] = (byTarget[key] ?? 0) + 1;
    }
    console.log(`[plan] assign: ${assignCount}   skip: ${skipCount}`);
    console.log(`[plan] target distribution:`); for (const [k, v] of Object.entries(byTarget)) console.log(`  ${k}: ${v}`);
    console.log(`[plan] Per-row decisions:`);
    for (const p of plan) console.log(`  group=${p.groupId} inv=${p.invoiceNumber} firstFlag="${p.firstFlag}" → ${p.decision} ${p.newErrorTypeId ?? ""}`);
    console.log(`\n[plan] To apply: pnpm exec tsx src/scripts/cohort-b-error-type-assignment-2026-05-13.ts --apply`);
    await pool.end();
    return;
  }
  const plan = readPlanCache();
  let updated = 0, noops = 0, errors = 0;
  for (const row of plan) {
    try {
      const r = await applyOne(row);
      appendFileSync(CACHE_PATH, JSON.stringify({ kind: "apply", ...r, appliedAt: new Date().toISOString() }) + "\n");
      if (r.updated) updated++; else noops++;
    } catch (err) { errors++; console.error(`[apply] FAILED group=${row.groupId}:`, err); }
  }
  console.log(`\n[apply] DONE — updated=${updated} noop=${noops} err=${errors}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
