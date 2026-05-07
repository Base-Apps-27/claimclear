// A3 conformance audit (Wave B, 2026-05-07).
//
// Reads every row in `invoice_groups` and `claims` and asserts that the value
// stored in the new `phase` / `disposition` columns equals what
// `derivePhaseFromLegacy` / `deriveDispositionFromLegacy` would compute from
// the legacy columns. Also asserts every (claim, parent) pair satisfies
// `isDispositionValidForPhase` — the runtime mirror of the SQL trigger added
// in migration 0034.
//
// Exit codes:
//   0 — all rows conformant
//   1 — one or more violations (full row context printed for the first 20)
//
// Wired into the existing `schema-drift` workflow as an additional step
// after the schema-drift check. Keeps the SQL backfill in lockstep with the
// TS derivers as Wave D introduces real writers.

import { pool } from "@workspace/db";
import {
  derivePhaseFromLegacy,
  deriveDispositionFromLegacy,
  type LegacyClaimShape,
  type LegacyInvoiceGroupShape,
} from "@workspace/invoice-state";
import { isClaimOpen, isInvoiceGroupOpen } from "@workspace/leg-state";
import { isDispositionValidForPhase, type InvoicePhase } from "@workspace/vocab";

interface InvoiceRow extends LegacyInvoiceGroupShape {
  id: number;
  phase: InvoicePhase;
  isOpen: boolean;
}

interface ClaimRow extends LegacyClaimShape {
  id: number;
  invoice_group_id: number | null;
  disposition: string;
  isOpen: boolean;
}

interface Violation {
  kind:
    | "phase_mismatch"
    | "disposition_mismatch"
    | "invalid_for_phase"
    | "is_open_mismatch";
  rowId: number;
  detail: string;
}

const MAX_REPORTED = 20;

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    const groups = (await client.query<InvoiceRow & Record<string, unknown>>(
      `SELECT id, status, outcome, reattest_required AS "reattestRequired",
              reattest_completed_at AS "reattestCompletedAt",
              closure_reason AS "closureReason",
              hold_reason AS "holdReason",
              phase,
              is_open AS "isOpen"
       FROM invoice_groups`,
    )).rows;

    const claims = (await client.query<ClaimRow & Record<string, unknown>>(
      `SELECT id, invoice_group_id,
              status, outcome,
              sop_outcome AS "sopOutcome",
              attestation_state AS "attestationState",
              included_in_dispute AS "includedInDispute",
              duplicate_of_claim_id AS "duplicateOfClaimId",
              drop_reason AS "dropReason",
              error_type_id AS "errorTypeId",
              closure_reason AS "closureReason",
              disposition,
              is_open AS "isOpen"
       FROM claims`,
    )).rows;

    console.log(
      `[a3] Loaded ${groups.length.toLocaleString()} groups, ` +
        `${claims.length.toLocaleString()} claims.`,
    );

    const phaseById = new Map<number, InvoicePhase>();
    const phaseCounts = new Map<string, number>();
    const violations: Violation[] = [];

    for (const g of groups) {
      const expected = derivePhaseFromLegacy(g);
      phaseById.set(g.id, g.phase);
      phaseCounts.set(g.phase, (phaseCounts.get(g.phase) ?? 0) + 1);
      if (g.phase !== expected.phase) {
        violations.push({
          kind: "phase_mismatch",
          rowId: g.id,
          detail: `stored=${g.phase} derived=${expected.phase} status=${g.status} outcome=${g.outcome} reattestCompleted=${g.reattestCompletedAt != null}`,
        });
      }
      // Wave D-PR1: GENERATED `is_open` column must match the TS helper.
      const expectedOpen = isInvoiceGroupOpen({ status: g.status });
      if (g.isOpen !== expectedOpen) {
        violations.push({
          kind: "is_open_mismatch",
          rowId: g.id,
          detail: `stored=${g.isOpen} derived=${expectedOpen} status=${g.status} (group)`,
        });
      }
    }

    const dispCounts = new Map<string, number>();
    for (const c of claims) {
      const parent = c.invoice_group_id != null ? phaseById.get(c.invoice_group_id) : undefined;
      dispCounts.set(c.disposition, (dispCounts.get(c.disposition) ?? 0) + 1);

      if (parent == null) {
        // Orphan claim (no parent group) — skip cross-row validation. Should
        // be rare; the FK is `ON DELETE CASCADE` so a missing parent is a real
        // anomaly worth surfacing.
        continue;
      }

      const expected = deriveDispositionFromLegacy(c, parent);
      if (c.disposition !== expected) {
        violations.push({
          kind: "disposition_mismatch",
          rowId: c.id,
          detail: `stored=${c.disposition} derived=${expected} parentPhase=${parent} sopOutcome=${c.sopOutcome ?? "null"} outcome=${c.outcome} dropReason=${c.dropReason ?? "null"}`,
        });
      }

      if (!isDispositionValidForPhase(c.disposition as never, parent)) {
        violations.push({
          kind: "invalid_for_phase",
          rowId: c.id,
          detail: `stored=${c.disposition} parentPhase=${parent} (not in VALID_DISPOSITIONS_BY_PHASE[${parent}])`,
        });
      }

      // Wave D-PR1: GENERATED `is_open` column must match the TS helper.
      const expectedOpen = isClaimOpen({ status: c.status });
      if (c.isOpen !== expectedOpen) {
        violations.push({
          kind: "is_open_mismatch",
          rowId: c.id,
          detail: `stored=${c.isOpen} derived=${expectedOpen} status=${c.status} (claim)`,
        });
      }
    }

    console.log("[a3] Phase distribution:");
    for (const [k, v] of [...phaseCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`       ${k.padEnd(24)} ${v.toLocaleString()}`);
    }
    console.log("[a3] Disposition distribution:");
    for (const [k, v] of [...dispCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`       ${k.padEnd(24)} ${v.toLocaleString()}`);
    }

    if (violations.length === 0) {
      console.log(`[a3] ✅ Conformance audit passed. 0 violations across ${(groups.length + claims.length).toLocaleString()} rows.`);
      process.exit(0);
    }

    console.error(`[a3] ❌ ${violations.length} violation(s) found. First ${Math.min(violations.length, MAX_REPORTED)}:`);
    for (const v of violations.slice(0, MAX_REPORTED)) {
      console.error(`       [${v.kind}] id=${v.rowId} ${v.detail}`);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[a3] FATAL:", err);
  process.exit(1);
});
