import { pool } from "@workspace/db";
import {
  derivePhaseFromLegacy,
  deriveDispositionFromLegacy,
  type LegacyClaimShape,
  type LegacyInvoiceGroupShape,
} from "@workspace/invoice-state";
import { isDispositionValidForPhase, type InvoicePhase } from "@workspace/vocab";

interface InvoiceRow extends LegacyInvoiceGroupShape {
  id: number;
  phase: InvoicePhase;
  updated_at: Date;
}
interface ClaimRow extends LegacyClaimShape {
  id: number;
  invoice_group_id: number | null;
  disposition: string;
  updated_at: Date;
}

interface Violation {
  kind: "phase_mismatch" | "disposition_mismatch" | "invalid_for_phase";
  table: "invoice_groups" | "claims";
  rowId: number;
  groupId: number | null;
  stored: string;
  derived: string;
  parentPhase: string | null;
  status: string | null;
  outcome: string | null;
  sopOutcome: string | null;
  dropReason: string | null;
  updatedAt: Date;
}

async function main() {
  const client = await pool.connect();
  try {
    const groups = (
      await client.query<InvoiceRow & Record<string, unknown>>(
        `SELECT id, status, outcome,
                reattest_required AS "reattestRequired",
                reattest_completed_at AS "reattestCompletedAt",
                closure_reason AS "closureReason",
                hold_reason AS "holdReason",
                phase, updated_at
           FROM invoice_groups`,
      )
    ).rows;

    const claims = (
      await client.query<ClaimRow & Record<string, unknown>>(
        `SELECT id, invoice_group_id, status, outcome,
                sop_outcome AS "sopOutcome",
                attestation_state AS "attestationState",
                included_in_dispute AS "includedInDispute",
                duplicate_of_claim_id AS "duplicateOfClaimId",
                drop_reason AS "dropReason",
                error_type_id AS "errorTypeId",
                closure_reason AS "closureReason",
                disposition, updated_at
           FROM claims`,
      )
    ).rows;

    const phaseById = new Map<number, InvoicePhase>();
    for (const g of groups) phaseById.set(g.id, g.phase);

    const violations: Violation[] = [];

    for (const g of groups) {
      const expected = derivePhaseFromLegacy(g);
      if (g.phase !== expected.phase) {
        violations.push({
          kind: "phase_mismatch",
          table: "invoice_groups",
          rowId: g.id,
          groupId: g.id,
          stored: g.phase,
          derived: expected.phase,
          parentPhase: null,
          status: g.status,
          outcome: g.outcome,
          sopOutcome: null,
          dropReason: null,
          updatedAt: g.updated_at,
        });
      }
    }

    for (const c of claims) {
      const parent = c.invoice_group_id != null ? phaseById.get(c.invoice_group_id) : undefined;
      if (parent == null) continue;

      const expected = deriveDispositionFromLegacy(c, parent);
      if (c.disposition !== expected) {
        violations.push({
          kind: "disposition_mismatch",
          table: "claims",
          rowId: c.id,
          groupId: c.invoice_group_id,
          stored: c.disposition,
          derived: expected,
          parentPhase: parent,
          status: c.status,
          outcome: c.outcome,
          sopOutcome: c.sopOutcome ?? null,
          dropReason: c.dropReason ?? null,
          updatedAt: c.updated_at,
        });
      }
      if (!isDispositionValidForPhase(c.disposition as never, parent)) {
        violations.push({
          kind: "invalid_for_phase",
          table: "claims",
          rowId: c.id,
          groupId: c.invoice_group_id,
          stored: c.disposition,
          derived: "(no valid)",
          parentPhase: parent,
          status: c.status,
          outcome: c.outcome,
          sopOutcome: c.sopOutcome ?? null,
          dropReason: c.dropReason ?? null,
          updatedAt: c.updated_at,
        });
      }
    }

    console.log(JSON.stringify({ totalViolations: violations.length }));

    const buckets = new Map<string, Violation[]>();
    for (const v of violations) {
      const key =
        v.kind === "phase_mismatch"
          ? `${v.kind} | ${v.stored}→${v.derived} | status=${v.status} outcome=${v.outcome}`
          : `${v.kind} | ${v.stored}→${v.derived} | parent=${v.parentPhase} sopOutcome=${v.sopOutcome} outcome=${v.outcome} dropReason=${v.dropReason}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(v);
    }

    console.log("\n=== Violation patterns (count, pattern, oldest→newest updated_at, sample row ids) ===");
    const sorted = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [key, vs] of sorted) {
      const sortedByTime = [...vs].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
      const oldest = sortedByTime[0].updatedAt.toISOString();
      const newest = sortedByTime[sortedByTime.length - 1].updatedAt.toISOString();
      const sampleIds = sortedByTime.slice(0, 5).map(v => v.rowId);
      console.log(`\n  [${vs.length}] ${key}`);
      console.log(`        updated_at range: ${oldest}  →  ${newest}`);
      console.log(`        sample ids: ${sampleIds.join(", ")}`);
    }

    const now = Date.now();
    const recencyBuckets = {
      lt_1h: 0,
      lt_24h: 0,
      lt_7d: 0,
      lt_30d: 0,
      older: 0,
    };
    for (const v of violations) {
      const ageMs = now - v.updatedAt.getTime();
      if (ageMs < 60 * 60 * 1000) recencyBuckets.lt_1h++;
      else if (ageMs < 24 * 60 * 60 * 1000) recencyBuckets.lt_24h++;
      else if (ageMs < 7 * 24 * 60 * 60 * 1000) recencyBuckets.lt_7d++;
      else if (ageMs < 30 * 24 * 60 * 60 * 1000) recencyBuckets.lt_30d++;
      else recencyBuckets.older++;
    }
    console.log("\n=== Recency of violating rows (by updated_at) ===");
    console.log(JSON.stringify(recencyBuckets, null, 2));

    const allClaimRowIds = violations.filter(v => v.table === "claims").map(v => v.rowId);
    const allGroupRowIds = violations.filter(v => v.table === "invoice_groups").map(v => v.rowId);
    const allClaimGroupIds = [...new Set(violations.filter(v => v.table === "claims").map(v => v.groupId).filter((x): x is number => x != null))];

    if (allClaimRowIds.length > 0 || allGroupRowIds.length > 0 || allClaimGroupIds.length > 0) {
      console.log("\n=== Last audit_log activity per violating group (top 10 most-recently-touched) ===");
      const groupIdsForAudit = [...new Set([...allGroupRowIds, ...allClaimGroupIds])];
      if (groupIdsForAudit.length > 0) {
        const recentAudit = await client.query<{
          invoice_group_id: number;
          last_action: string;
          last_at: Date;
          n_actions: number;
        }>(
          `SELECT invoice_group_id,
                  (ARRAY_AGG(action ORDER BY timestamp DESC))[1] AS last_action,
                  MAX(timestamp) AS last_at,
                  COUNT(*)::int AS n_actions
             FROM audit_logs
            WHERE invoice_group_id = ANY($1::int[])
              AND timestamp > NOW() - INTERVAL '7 days'
            GROUP BY invoice_group_id
            ORDER BY MAX(timestamp) DESC
            LIMIT 10`,
          [groupIdsForAudit],
        );
        for (const r of recentAudit.rows) {
          console.log(`  group=${r.invoice_group_id}  last_at=${r.last_at.toISOString()}  last_action=${r.last_action}  n_in_7d=${r.n_actions}`);
        }
      }

      console.log("\n=== Action vocabulary in audit_logs touching violating groups (last 7d) ===");
      const actionMix = await client.query<{ action: string; n: number }>(
        `SELECT action, COUNT(*)::int AS n
           FROM audit_logs
          WHERE invoice_group_id = ANY($1::int[])
            AND timestamp > NOW() - INTERVAL '7 days'
          GROUP BY action
          ORDER BY n DESC`,
        [groupIdsForAudit],
      );
      for (const r of actionMix.rows) console.log(`  ${r.n.toString().padStart(5)}  ${r.action}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
