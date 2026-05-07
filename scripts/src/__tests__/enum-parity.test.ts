// Enum-parity test for Wave B (2026-05-07).
//
// The hierarchical state machine has three "lockstep" enum value lists that
// must stay byte-identical or things break in subtle ways:
//
//   1. `INVOICE_PHASES` in lib/vocab/src/invoice-phase.ts
//   2. `invoicePhaseEnum` in lib/db/src/schema/invoice-groups.ts (Postgres enum)
//   3. The `invoice_phase` enum value list in
//      lib/db/migrations/0034_invoice_phase_and_disposition.sql
//
// Same for `CLAIM_DISPOSITIONS` / `claimDispositionEnum` / `claim_disposition`.
//
// This test enforces 1↔2 directly. The 2↔3 link is enforced by the
// schema-drift workflow (drizzle-kit generates the SQL from the schema TS).
// The 3↔derivation lockstep is enforced by `check-invoice-state-derivation.ts`
// after the migration runs.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { invoicePhaseEnum } from "@workspace/db/schema";
import { claimDispositionEnum } from "@workspace/db/schema";
import { INVOICE_PHASES, CLAIM_DISPOSITIONS } from "@workspace/vocab";

describe("Wave B enum parity", () => {
  it("invoicePhaseEnum.enumValues matches INVOICE_PHASES exactly", () => {
    assert.deepEqual(
      invoicePhaseEnum.enumValues,
      [...INVOICE_PHASES],
      "Postgres invoice_phase enum values must equal the TS INVOICE_PHASES tuple in the same order. " +
        "If you intentionally added a phase, update both files (and migration 0034 / spec §1).",
    );
  });

  it("claimDispositionEnum.enumValues matches CLAIM_DISPOSITIONS exactly", () => {
    assert.deepEqual(
      claimDispositionEnum.enumValues,
      [...CLAIM_DISPOSITIONS],
      "Postgres claim_disposition enum values must equal the TS CLAIM_DISPOSITIONS tuple in the same order. " +
        "If you intentionally added a disposition, update both files (and migration 0034 + the trigger's " +
        "VALID_DISPOSITIONS_BY_PHASE CASE / spec §2).",
    );
  });

  it("INVOICE_PHASES has the 7 spec phases in canonical order", () => {
    assert.deepEqual(
      [...INVOICE_PHASES],
      [
        "triage",
        "ready_to_submit",
        "submitted",
        "response_received",
        "reviewed",
        "awaiting_reattestation",
        "closed",
      ],
    );
  });

  it("CLAIM_DISPOSITIONS has the 23 spec dispositions in canonical order", () => {
    // 22 from Wave B (migration 0034) + `disposed_expired` appended
    // by Wave D-PR4 (migration 0037) for the Expired-sweep cascade.
    assert.deepEqual(
      [...CLAIM_DISPOSITIONS],
      [
        "unclassified",
        "classifying",
        "disposed_portal",
        "disposed_email",
        "disposed_withdraw",
        "disposed_nonissue",
        "blocked",
        "duplicate",
        "awaiting_review",
        "verdict_drafted",
        "verdict_approved",
        "verdict_denied",
        "verdict_partial",
        "attest_pending",
        "attest_queued",
        "attested",
        "mas_cancelled",
        "attest_not_required",
        "final_reattested",
        "final_withdrawn",
        "final_denied",
        "final_nonissue",
        "disposed_expired",
      ],
    );
  });
});
