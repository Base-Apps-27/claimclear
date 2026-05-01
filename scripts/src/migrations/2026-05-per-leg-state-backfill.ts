// One-shot backfill bridging the legacy single-claim model into the per-leg
// / per-invoice model introduced by Task #195. Reads the legacy
// `claims.workflow_progress` and `invoice_groups.workflow_progress` JSONB
// blobs (still present at backfill time) and projects them onto the new
// discrete columns and the new `claim_verdict` table.
//
// This is the verification gate that runs BEFORE the legacy JSONB columns
// are dropped. The script:
//   1. Detects whether the legacy columns still exist (re-run safety).
//   2. Backfills `invoice_groups` discrete columns from the legacy blob.
//   3. Backfills `claims` discrete columns from the legacy blob.
//   4. Walks `audit_logs` for outcome-change events and inserts an
//      append-only `claim_verdict` row per event; falls back to one summary
//      row per non-Pending claim with no audit history.
//   5. Normalizes `claims.hold_reason` to the LEG_HOLD_REASONS vocabulary.
//   6. Prints a verification report. If any data-loss candidate is found,
//      the script halts (non-zero exit) so the operator can inspect.
//
// Idempotent: every write checks the current discrete value first and only
// writes when the legacy blob unambiguously dictates a different value.
//
// Task #268 backfill-id convention: this script does NOT insert into
// `audit_logs`. It only reads from it (to project verdicts) and writes
// to `claims`, `invoice_groups`, and `claim_verdict`. There are no audit
// rows to stamp here — the entry under BACKFILL_IDS.perLegState in
// `_backfill-audit.ts` exists purely for registry completeness so the
// id is reserved if a future change starts producing audit rows.
//
// To run:
//   pnpm --filter @workspace/scripts run backfill:per-leg-state

import {
  db,
  pool,
  claimsTable,
  invoiceGroupsTable,
  claimVerdictTable,
  auditLogsTable,
  LEG_HOLD_REASONS,
  type LegHoldReason,
} from "@workspace/db";
import { eq, isNotNull, sql } from "drizzle-orm";

type LegacyWorkflowStep = {
  nodeId?: string;
  answer?: unknown;
  timestamp?: string;
  ts?: string;
  [k: string]: unknown;
};

type LegacyClaimWorkflowProgress = {
  currentNodeId?: string | null;
  history?: LegacyWorkflowStep[];
  completed?: boolean;
  resolutionType?: string;
  [k: string]: unknown;
};

type LegacyGroupWorkflowProgress = {
  groupContext?: string;
  understandingReadback?: string;
  understandingReadbackAt?: string;
  understandingReadbackBy?: string;
  generatedAt?: string;
  generatedBy?: string;
  reAttest?: {
    required?: boolean;
    completedAt?: string;
    completedBy?: string;
    note?: string;
  };
  [k: string]: unknown;
};

interface LegacyClaimRow {
  id: number;
  workflow_progress: LegacyClaimWorkflowProgress | null;
  error_type_id: string | null;
  hold_reason: string | null;
  status: string;
  outcome: string;
  updated_at: Date;
  current_included_in_dispute: boolean;
  current_sop_node_id: string | null;
  current_sop_outcome: string | null;
  current_drop_reason: string | null;
  current_dropped_at: Date | null;
  current_ready_at: Date | null;
  current_sop_answers_len: number;
}

interface LegacyGroupRow {
  id: number;
  workflow_progress: LegacyGroupWorkflowProgress | null;
  current_group_context: string | null;
  current_understanding_readback: string | null;
  current_understanding_readback_at: Date | null;
  current_preview_generated_at: Date | null;
  current_reattest_required: boolean;
  current_reattest_completed_at: Date | null;
}

function normalizeHoldReason(raw: string | null): LegHoldReason | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if ((LEG_HOLD_REASONS as readonly string[]).includes(v)) {
    return v as LegHoldReason;
  }
  if (v.includes("evidence")) return "evidence_pending";
  if (v.includes("member")) return "awaiting_member_response";
  if (v.includes("external") || v.includes("payor") || v.includes("vendor")) {
    return "awaiting_external_party";
  }
  if (v.includes("internal") || v.includes("review")) {
    return "awaiting_internal_review";
  }
  return "other";
}

function projectAnswers(
  history: LegacyWorkflowStep[] | undefined,
): Array<{ nodeId: string; answer: unknown; ts: string }> {
  if (!Array.isArray(history)) return [];
  return history
    .filter(h => typeof h.nodeId === "string" && h.nodeId.length > 0)
    .map(h => ({
      nodeId: h.nodeId as string,
      answer: h.answer,
      ts: h.ts ?? h.timestamp ?? new Date().toISOString(),
    }));
}

function projectClaimOutcomeToVerdict(outcome: string): string | null {
  switch (outcome) {
    case "Approved":
      return "Approved";
    case "Denied":
      return "Denied";
    case "Partially Approved":
      return "Partial";
    default:
      return null;
  }
}

async function legacyColumnExists(
  table: "claims" | "invoice_groups",
): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = $1 AND column_name = 'workflow_progress' LIMIT 1`,
    [table],
  );
  return r.rowCount !== null && r.rowCount > 0;
}

async function backfillGroups(report: BackfillReport): Promise<void> {
  const hasLegacy = await legacyColumnExists("invoice_groups");
  if (!hasLegacy) {
    console.log(
      "[groups] legacy workflow_progress already dropped — backfill is a no-op (idempotent re-run path)",
    );
    return;
  }

  const r = await pool.query<LegacyGroupRow>(`
    SELECT
      id,
      workflow_progress,
      group_context AS current_group_context,
      understanding_readback AS current_understanding_readback,
      understanding_readback_at AS current_understanding_readback_at,
      preview_generated_at AS current_preview_generated_at,
      reattest_required AS current_reattest_required,
      reattest_completed_at AS current_reattest_completed_at
    FROM invoice_groups
  `);

  let touched = 0;
  for (const g of r.rows) {
    const wp = g.workflow_progress;
    if (!wp) continue;

    // Track whether ANY recognized legacy field was found on this row,
    // independent of whether we wrote (a write may be skipped because the
    // discrete column was already populated by a prior run). A row only
    // counts as "data-loss candidate" when the legacy blob was non-null
    // AND zero recognized fields were present at all.
    let mappedAnything = false;
    const updates: Record<string, unknown> = {};

    if (wp.groupContext !== undefined) {
      mappedAnything = true;
      if (wp.groupContext && !g.current_group_context) {
        updates.group_context = wp.groupContext;
      }
    }
    if (wp.understandingReadback !== undefined) {
      mappedAnything = true;
      if (wp.understandingReadback && !g.current_understanding_readback) {
        updates.understanding_readback = wp.understandingReadback;
      }
    }
    if (wp.understandingReadbackAt !== undefined) {
      mappedAnything = true;
      if (wp.understandingReadbackAt && !g.current_understanding_readback_at) {
        updates.understanding_readback_at = new Date(wp.understandingReadbackAt);
      }
    }
    if (wp.understandingReadbackBy !== undefined) {
      mappedAnything = true;
      if (wp.understandingReadbackBy) {
        updates.understanding_readback_by = wp.understandingReadbackBy;
      }
    }
    if (wp.generatedAt !== undefined) {
      mappedAnything = true;
      if (wp.generatedAt && !g.current_preview_generated_at) {
        updates.preview_generated_at = new Date(wp.generatedAt);
      }
    }
    if (wp.generatedBy !== undefined) {
      mappedAnything = true;
      if (wp.generatedBy) {
        updates.preview_generated_by = wp.generatedBy;
      }
    }
    if (wp.reAttest !== undefined && wp.reAttest !== null) {
      mappedAnything = true;
      const required = wp.reAttest.required === true;
      if (required !== g.current_reattest_required) {
        updates.reattest_required = required;
      }
      if (wp.reAttest.completedAt) {
        report.legacyGroupReattestCompletedCount += 1;
        if (!g.current_reattest_completed_at) {
          updates.reattest_completed_at = new Date(wp.reAttest.completedAt);
        }
      }
      if (wp.reAttest.completedBy) {
        updates.reattest_completed_by = wp.reAttest.completedBy;
      }
      if (wp.reAttest.note) {
        updates.reattest_note = wp.reAttest.note;
      }
    }

    if (!mappedAnything) {
      report.unmappedGroupRows.push({
        id: g.id,
        reason: "workflow_progress non-null but no recognized fields present",
      });
    }

    if (Object.keys(updates).length === 0) continue;

    const setClause = Object.keys(updates)
      .map((col, i) => `${col} = $${i + 2}`)
      .join(", ");
    const values = [g.id, ...Object.values(updates)];
    await pool.query(
      `UPDATE invoice_groups SET ${setClause}, updated_at = now() WHERE id = $1`,
      values,
    );
    touched += 1;
  }

  report.legacyGroupRowCount = r.rowCount ?? 0;
  console.log(
    `[groups] backfilled discrete columns on ${touched}/${r.rowCount} rows`,
  );
}

async function backfillClaims(report: BackfillReport): Promise<void> {
  const hasLegacy = await legacyColumnExists("claims");
  if (!hasLegacy) {
    console.log(
      "[claims] legacy workflow_progress already dropped — backfill is a no-op (idempotent re-run path)",
    );
    return;
  }

  const r = await pool.query<LegacyClaimRow>(`
    SELECT
      id,
      workflow_progress,
      error_type_id,
      hold_reason,
      status,
      outcome,
      updated_at,
      included_in_dispute AS current_included_in_dispute,
      sop_node_id AS current_sop_node_id,
      sop_outcome AS current_sop_outcome,
      drop_reason AS current_drop_reason,
      dropped_at AS current_dropped_at,
      ready_at AS current_ready_at,
      jsonb_array_length(coalesce(sop_answers, '[]'::jsonb)) AS current_sop_answers_len
    FROM claims
  `);

  let touched = 0;
  for (const c of r.rows) {
    const wp = c.workflow_progress;
    const updates: Record<string, unknown> = {};

    // included_in_dispute: clean legs (no errorTypeId) are excluded; legs
    // with errorTypeId default to true. Edge case: legs that were
    // classified then had their errorTypeId cleared get included_in_dispute
    // = false, matching current "untriaged" behavior. We never override
    // this with `true` based on the legacy completed/dropped state — if
    // the operator cleared the errorTypeId, the leg is no longer in
    // dispute even if it has dropped/non_issue legacy progress.
    const includedInDispute = c.error_type_id != null && c.error_type_id !== "";
    if (c.current_included_in_dispute !== includedInDispute) {
      updates.included_in_dispute = includedInDispute;
    }

    if (wp) {
      report.legacyClaimRowsWithProgress += 1;

      if (wp.currentNodeId && !c.current_sop_node_id) {
        updates.sop_node_id = wp.currentNodeId;
      }

      const projected = projectAnswers(wp.history);
      if (projected.length > 0 && c.current_sop_answers_len === 0) {
        updates.sop_answers = JSON.stringify(projected);
      }

      if (wp.completed === true) {
        report.legacyClaimsCompletedCount += 1;
        const rt = wp.resolutionType;
        if (rt === "cannot_dispute" || rt === "non_issue") {
          if (!c.current_sop_outcome) updates.sop_outcome = rt;
          if (!c.current_drop_reason) updates.drop_reason = rt;
          if (!c.current_dropped_at) updates.dropped_at = c.updated_at;
        } else if (rt === "portal_dispute" || rt === "dispute") {
          if (!c.current_sop_outcome) updates.sop_outcome = rt;
          if (!c.current_ready_at) updates.ready_at = c.updated_at;
        } else if (rt === "hold") {
          if (!c.current_sop_outcome) updates.sop_outcome = "hold";
        } else {
          // completed=true but unrecognized resolutionType — flag as
          // data-loss candidate so a human can review.
          report.unmappedClaimRows.push({
            id: c.id,
            reason: `completed=true but resolutionType=${JSON.stringify(rt ?? null)} not recognized`,
          });
        }
      }
      // completed === false → leave sop_outcome null (still investigating)
    }

    // Hold reason normalization — write only if normalized differs from
    // stored. Original text was already preserved in audit history.
    const normalizedHold = normalizeHoldReason(c.hold_reason);
    if (normalizedHold && normalizedHold !== c.hold_reason) {
      updates.hold_reason = normalizedHold;
    }

    if (Object.keys(updates).length === 0) continue;

    const setClause = Object.keys(updates)
      .map((col, i) => `${col} = $${i + 2}`)
      .join(", ");
    const values = [c.id, ...Object.values(updates)];
    await pool.query(
      `UPDATE claims SET ${setClause}, updated_at = now() WHERE id = $1`,
      values,
    );
    touched += 1;
  }

  console.log(
    `[claims] backfilled discrete columns on ${touched}/${r.rowCount} rows`,
  );
}

// Walk audit_logs for outcome-change events and insert one append-only
// claim_verdict row per event. Falls back to one summary row per non-
// Pending claim with no audit history.
async function backfillVerdicts(report: BackfillReport): Promise<void> {
  // Skip claims that already have any verdict rows (idempotent re-run).
  const auditQuery = await pool.query<{
    claim_id: number;
    metadata: Record<string, unknown> | null;
    user_email: string | null;
    timestamp: Date;
    action: string;
  }>(`
    SELECT claim_id, metadata, user_email, timestamp, action
    FROM audit_logs
    WHERE claim_id IS NOT NULL
      AND action IN ('outcome_changed', 'status_and_outcome_changed')
    ORDER BY claim_id, timestamp ASC
  `);

  const claimsWithVerdicts = await pool.query<{ claim_id: number }>(
    `SELECT DISTINCT claim_id FROM claim_verdict`,
  );
  const seen = new Set(claimsWithVerdicts.rows.map(r => r.claim_id));

  let inserted = 0;
  for (const row of auditQuery.rows) {
    if (seen.has(row.claim_id)) continue;
    const md = row.metadata ?? {};
    const to =
      (md.to as string | undefined) ?? (md.toOutcome as string | undefined);
    const projected = to ? projectClaimOutcomeToVerdict(to) : null;
    if (!projected) continue;
    await pool.query(
      `INSERT INTO claim_verdict
        (claim_id, source, outcome, note, created_by, created_at)
       VALUES ($1, 'operator_confirmed', $2, $3, $4, $5)`,
      [
        row.claim_id,
        projected,
        `Backfilled from audit_logs#${row.action} (per-leg-state migration).`,
        row.user_email,
        row.timestamp,
      ],
    );
    inserted += 1;
    report.verdictRowsFromAudit += 1;
  }

  // Fallback summary rows for non-Pending claims with no audit history at
  // all. Write at most one per claim_id.
  const orphans = await pool.query<{
    id: number;
    outcome: string;
    updated_at: Date;
  }>(`
    SELECT c.id, c.outcome, c.updated_at FROM claims c
    WHERE c.outcome <> 'Pending'
      AND NOT EXISTS (SELECT 1 FROM claim_verdict v WHERE v.claim_id = c.id)
      AND NOT EXISTS (
        SELECT 1 FROM audit_logs a
        WHERE a.claim_id = c.id
          AND a.action IN ('outcome_changed', 'status_and_outcome_changed')
      )
  `);
  for (const c of orphans.rows) {
    const projected = projectClaimOutcomeToVerdict(c.outcome);
    if (!projected) continue;
    await pool.query(
      `INSERT INTO claim_verdict
        (claim_id, source, outcome, note, created_by, created_at)
       VALUES ($1, 'operator_confirmed', $2, $3, NULL, $4)`,
      [
        c.id,
        projected,
        "backfilled from current outcome — no audit history",
        c.updated_at,
      ],
    );
    inserted += 1;
    report.verdictRowsFromCurrentOutcome += 1;
  }

  console.log(
    `[verdicts] inserted ${inserted} rows ` +
      `(${report.verdictRowsFromAudit} from audit, ${report.verdictRowsFromCurrentOutcome} from current outcome)`,
  );
}

interface BackfillReport {
  legacyGroupRowCount: number;
  legacyGroupReattestCompletedCount: number;
  legacyClaimRowsWithProgress: number;
  legacyClaimsCompletedCount: number;
  verdictRowsFromAudit: number;
  verdictRowsFromCurrentOutcome: number;
  unmappedClaimRows: Array<{ id: number; reason: string }>;
  unmappedGroupRows: Array<{ id: number; reason: string }>;
}

function newReport(): BackfillReport {
  return {
    legacyGroupRowCount: 0,
    legacyGroupReattestCompletedCount: 0,
    legacyClaimRowsWithProgress: 0,
    legacyClaimsCompletedCount: 0,
    verdictRowsFromAudit: 0,
    verdictRowsFromCurrentOutcome: 0,
    unmappedClaimRows: [],
    unmappedGroupRows: [],
  };
}

async function verifyAndReport(report: BackfillReport): Promise<boolean> {
  console.log("\n===== VERIFICATION REPORT =====");
  let ok = true;

  // Parity check 1: legacy completed=true rows must equal exactly the
  // number of new sop_outcome IS NOT NULL rows. Strict equality — any
  // delta means the projection lost or invented data. Only meaningful
  // while the legacy column still exists.
  const claimsHasLegacy = await legacyColumnExists("claims");
  if (claimsHasLegacy) {
    const sopOutcomeCount = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM claims WHERE sop_outcome IS NOT NULL`,
    );
    const newCount = sopOutcomeCount.rows[0].n;
    console.log(
      `legacy completed=true: ${report.legacyClaimsCompletedCount} | ` +
        `new sop_outcome NOT NULL: ${newCount}`,
    );
    if (newCount !== report.legacyClaimsCompletedCount) {
      console.error(
        `  ✗ MISMATCH: legacy completed=${report.legacyClaimsCompletedCount} ≠ new sop_outcome=${newCount}`,
      );
      ok = false;
    } else {
      console.log("  ✓ sop_outcome parity OK (exact)");
    }
  }

  // Parity check 2: per-outcome bucket distribution. claims.outcome
  // (Approved/Denied/Partially Approved) must match latest-per-claim
  // claim_verdict outcome (Approved/Denied/Partial), bucket by bucket,
  // within ±1% per bucket (rounding for same-timestamp audit ties).
  const claimsOutcomeDist = await pool.query<{ outcome: string; n: number }>(
    `SELECT outcome, count(*)::int AS n FROM claims
     WHERE outcome IN ('Approved','Denied','Partially Approved')
     GROUP BY outcome`,
  );
  const verdictOutcomeDist = await pool.query<{ outcome: string; n: number }>(
    `SELECT v.outcome, count(*)::int AS n FROM (
       SELECT DISTINCT ON (claim_id) claim_id, outcome
       FROM claim_verdict
       ORDER BY claim_id, created_at DESC
     ) v GROUP BY v.outcome`,
  );
  const claimsByBucket: Record<"Approved" | "Denied" | "Partial", number> = {
    Approved: 0,
    Denied: 0,
    Partial: 0,
  };
  for (const r of claimsOutcomeDist.rows) {
    if (r.outcome === "Approved") claimsByBucket.Approved = r.n;
    else if (r.outcome === "Denied") claimsByBucket.Denied = r.n;
    else if (r.outcome === "Partially Approved") claimsByBucket.Partial = r.n;
  }
  const verdictByBucket: Record<"Approved" | "Denied" | "Partial", number> = {
    Approved: 0,
    Denied: 0,
    Partial: 0,
  };
  for (const r of verdictOutcomeDist.rows) {
    if (r.outcome === "Approved" || r.outcome === "Denied" || r.outcome === "Partial") {
      verdictByBucket[r.outcome as "Approved" | "Denied" | "Partial"] = r.n;
    }
  }
  console.log("\nper-outcome bucket parity (claims.outcome → latest-verdict):");
  for (const bucket of ["Approved", "Denied", "Partial"] as const) {
    const c = claimsByBucket[bucket];
    const v = verdictByBucket[bucket];
    const drift = Math.abs(c - v);
    const tolerance = Math.max(1, Math.ceil(c * 0.01));
    const mark = drift <= tolerance ? "✓" : "✗";
    console.log(
      `  ${mark} ${bucket}: claims=${c} verdict=${v} drift=${drift} tolerance=${tolerance}`,
    );
    if (drift > tolerance) {
      console.error(
        `  ✗ MISMATCH on bucket ${bucket}: claims=${c} ≠ verdict=${v} (drift=${drift} > tolerance=${tolerance})`,
      );
      ok = false;
    }
  }

  // Parity check 3: legacy reAttest.completedAt count must match exactly
  // the new reattest_completed_at IS NOT NULL count. Strict equality.
  const groupsHasLegacy = await legacyColumnExists("invoice_groups");
  if (groupsHasLegacy) {
    const reattestCount = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM invoice_groups WHERE reattest_completed_at IS NOT NULL`,
    );
    const newReattest = reattestCount.rows[0].n;
    console.log(
      `\nlegacy reAttest.completedAt: ${report.legacyGroupReattestCompletedCount} | ` +
        `new reattest_completed_at: ${newReattest}`,
    );
    if (newReattest !== report.legacyGroupReattestCompletedCount) {
      console.error(
        `  ✗ MISMATCH: legacy=${report.legacyGroupReattestCompletedCount} ≠ new=${newReattest}`,
      );
      ok = false;
    } else {
      console.log("  ✓ reattestation parity OK (exact)");
    }
  }

  // Data-loss candidates — halt if any.
  if (report.unmappedClaimRows.length > 0) {
    console.error(
      `\n✗ ${report.unmappedClaimRows.length} claim rows had non-null workflow_progress with no recognized mapping:`,
    );
    for (const r of report.unmappedClaimRows.slice(0, 25)) {
      console.error(`  claim#${r.id}: ${r.reason}`);
    }
    ok = false;
  }
  if (report.unmappedGroupRows.length > 0) {
    console.error(
      `\n✗ ${report.unmappedGroupRows.length} group rows had non-null workflow_progress with no recognized mapping:`,
    );
    for (const r of report.unmappedGroupRows.slice(0, 25)) {
      console.error(`  group#${r.id}: ${r.reason}`);
    }
    ok = false;
  }

  if (ok) console.log("\n✓ All verification checks passed.");
  return ok;
}

async function main(): Promise<void> {
  console.log("[backfill] starting per-leg-state backfill\n");
  const report = newReport();
  await backfillGroups(report);
  await backfillClaims(report);
  await backfillVerdicts(report);
  const ok = await verifyAndReport(report);
  if (!ok) {
    console.error(
      "\n[backfill] HALTED. Fix data-loss candidates and re-run before dropping legacy JSONB columns.",
    );
    throw new Error("backfill verification failed");
  }
  console.log("\n[backfill] done");
  // Side-effect to suppress unused-import warnings when the no-op path is
  // taken (e.g. on idempotent re-run after the legacy column is dropped).
  void claimsTable;
  void invoiceGroupsTable;
  void claimVerdictTable;
  void auditLogsTable;
  void eq;
  void isNotNull;
  void sql;
  void db;
}

main()
  .then(() => pool.end().then(() => process.exit(0)))
  .catch(err => {
    console.error("[backfill] FAILED", err);
    pool.end().finally(() => process.exit(1));
  });
