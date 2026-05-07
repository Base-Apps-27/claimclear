// Wave D-PR2c — unit tests for the inverted per-leg status projector.
//
// Pre-D-PR2c the projector was `projectLegStatus(leg, group)` and read
// `(group.status, sopOutcome, holdReason)` to produce the surfaced
// `claim.status`. After D-PR2c, `dispositionToStatus(disposition,
// parent, opts?)` is the inversion: the canonical `claims.disposition`
// is the source of truth, and `claim.status` is a derived projection
// of it. Co-located with `dispositionToLegacy` in
// `lib/leg-state/set-claim-disposition.ts`.
//
// These tests preserve the §A decision table from `.local/tasks/task-231.md`
// line-for-line, restated against the inverted projector. Each old
// `projectLegStatus` test from the pre-D-PR2c suite has a direct
// counterpart here so the parity is auditable. Pure tests — no DB.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { dispositionToStatus } from "../lib/leg-state/set-claim-disposition";
import type { ClaimDisposition, InvoicePhase } from "@workspace/vocab";

type Parent = Parameters<typeof dispositionToStatus>[1];

function parent(overrides: Partial<Parent> = {}): Parent {
  return {
    phase: "triage",
    status: "Needs Evidence",
    reattestRequired: false,
    reattestCompletedAt: null,
    ...overrides,
  };
}

// --- Rule 1: per-leg hold wins over everything --------------------------

test("legHoldReason set → On Hold regardless of disposition / parent phase", () => {
  // Pre-D-PR2c: `holdReason` could be set by the per-leg hold endpoint
  // independently of `sopOutcome=hold`. The disposition deriver does
  // NOT read `holdReason`, so the projector accepts it as an explicit
  // override to preserve the legacy Rule 1.
  const dispositions: ClaimDisposition[] = [
    "unclassified",
    "classifying",
    "disposed_portal",
    "awaiting_review",
    "verdict_approved",
    "final_reattested",
  ];
  const phases: InvoicePhase[] = [
    "triage",
    "ready_to_submit",
    "submitted",
    "response_received",
    "reviewed",
    "awaiting_reattestation",
    "closed",
  ];
  for (const disp of dispositions) {
    for (const ph of phases) {
      const out = dispositionToStatus(
        disp,
        parent({ phase: ph, status: "Needs Evidence" }),
        { legHoldReason: "missing_invoice" },
      );
      assert.equal(out, "On Hold", `disposition=${disp} phase=${ph}`);
    }
  }
});

test("disposition='blocked' (sopOutcome=hold canonical) → On Hold", () => {
  const out = dispositionToStatus(
    "blocked",
    parent({ phase: "triage", status: "Needs Evidence" }),
  );
  assert.equal(out, "On Hold");
});

// --- Rule 2a: pre-submit per-leg projection -----------------------------

test("pre-submit + disposition='disposed_portal' → Processed", () => {
  const out = dispositionToStatus(
    "disposed_portal",
    parent({ phase: "triage", status: "New" }),
  );
  assert.equal(out, "Processed");
});

test("pre-submit + disposition='disposed_email' → Processed", () => {
  const out = dispositionToStatus(
    "disposed_email",
    parent({ phase: "triage", status: "Needs Evidence" }),
  );
  assert.equal(out, "Processed");
});

test("pre-submit + disposition='disposed_withdraw' → null (preserve closed status)", () => {
  // Excluded legs already carry their authoritative closed/withdrawn
  // status from the SOP exclusion path; the projector must not stomp it.
  const out = dispositionToStatus(
    "disposed_withdraw",
    parent({ phase: "triage", status: "Needs Evidence" }),
  );
  assert.equal(out, null);
});

test("pre-submit + disposition='disposed_nonissue' → null (preserve closed status)", () => {
  const out = dispositionToStatus(
    "disposed_nonissue",
    parent({ phase: "triage", status: "New" }),
  );
  assert.equal(out, null);
});

test("pre-submit + disposition='unclassified' → mirror group (the regression-fix path)", () => {
  // Task #231: legs without an SOP outcome correctly mirror whatever
  // the group is showing (New or Needs Evidence). Pre-D-PR2c this came
  // from `sopOutcome=null`; post-D-PR2c the deriver produces
  // `unclassified` (no errorTypeId) or `classifying` (errorTypeId set).
  assert.equal(
    dispositionToStatus("unclassified", parent({ phase: "triage", status: "New" })),
    "New",
  );
  assert.equal(
    dispositionToStatus("unclassified", parent({ phase: "triage", status: "Needs Evidence" })),
    "Needs Evidence",
  );
});

test("pre-submit + disposition='classifying' → mirror group", () => {
  assert.equal(
    dispositionToStatus("classifying", parent({ phase: "ready_to_submit", status: "New" })),
    "New",
  );
  assert.equal(
    dispositionToStatus("classifying", parent({ phase: "ready_to_submit", status: "Needs Evidence" })),
    "Needs Evidence",
  );
});

test("pre-submit + disposition='duplicate' → null (preserve dup-marking status)", () => {
  const out = dispositionToStatus(
    "duplicate",
    parent({ phase: "triage", status: "Needs Evidence" }),
  );
  assert.equal(out, null);
});

// --- Rule 2b: in-flight collapses to Awaiting Response ------------------

test("in-flight (phase=submitted) → Awaiting Response (regardless of disposition)", () => {
  const dispositions: ClaimDisposition[] = [
    "disposed_portal",
    "disposed_email",
    "disposed_nonissue",
    "disposed_withdraw",
  ];
  for (const disp of dispositions) {
    const out = dispositionToStatus(
      disp,
      parent({ phase: "submitted", status: "Awaiting Response" }),
    );
    assert.equal(out, "Awaiting Response", `disposition=${disp}`);
  }
});

test("in-flight + Generating Email + Portal Queued group statuses → Awaiting Response", () => {
  assert.equal(
    dispositionToStatus(
      "disposed_portal",
      parent({ phase: "submitted", status: "Generating Email" }),
    ),
    "Awaiting Response",
  );
  assert.equal(
    dispositionToStatus(
      "disposed_portal",
      parent({ phase: "submitted", status: "Portal Queued" }),
    ),
    "Awaiting Response",
  );
});

// --- Rule 2c: response-pending mirrors group ----------------------------

test("response-pending (phase=response_received) mirrors group (Ready to Review / Needs Review)", () => {
  assert.equal(
    dispositionToStatus(
      "awaiting_review",
      parent({ phase: "response_received", status: "Ready to Review" }),
    ),
    "Ready to Review",
  );
  assert.equal(
    dispositionToStatus(
      "awaiting_review",
      parent({ phase: "response_received", status: "Needs Review" }),
    ),
    "Needs Review",
  );
});

test("response-pending verdict dispositions mirror group", () => {
  assert.equal(
    dispositionToStatus(
      "verdict_approved",
      parent({ phase: "reviewed", status: "Ready to Review" }),
    ),
    "Ready to Review",
  );
});

// --- Rule 2d: closed family mirrors group -------------------------------

test("closed group → leg mirrors group status", () => {
  for (const closedStatus of ["Resolved", "Denied"]) {
    const out = dispositionToStatus(
      "final_reattested",
      parent({ phase: "closed", status: closedStatus }),
    );
    assert.equal(out, closedStatus, `closed status ${closedStatus} should mirror`);
  }
});

test("mas-action-required (phase=awaiting_reattestation) mirrors group (MAS Eligible)", () => {
  const out = dispositionToStatus(
    "attest_pending",
    parent({ phase: "awaiting_reattestation", status: "MAS Eligible" }),
  );
  assert.equal(out, "MAS Eligible");
});

// --- Rule 2e: explicit on-hold group ------------------------------------

test("group On Hold → leg On Hold (even without per-leg hold or blocked disposition)", () => {
  const out = dispositionToStatus(
    "unclassified",
    parent({ phase: "triage", status: "On Hold" }),
  );
  assert.equal(out, "On Hold");
});

// --- Defensive fallback: unmirrorable group status → null ---------------

test("group status outside mirrorable set (e.g. Expired) → null (preserve leg status)", () => {
  const out = dispositionToStatus(
    "unclassified",
    parent({ phase: "triage", status: "Expired" }),
  );
  assert.equal(out, null);
});

// --- Mixed-pre-submit invariant (the headline regression) ---------------

test("mixed pre-submit invoice: Processed leg, unprocessed leg, excluded leg, held leg", () => {
  // Single group, four legs that mirror the spec's worked example. Each
  // call is independent (the projector is per-leg) — this test
  // demonstrates that the four legs surface four distinct statuses
  // instead of all collapsing to the same value. Disposition values
  // chosen to match what `deriveDispositionFromLegacy` would produce
  // for each leg state under phase=triage:
  //   • portal_dispute leg → disposed_portal
  //   • null sopOutcome / no errorTypeId → unclassified
  //   • cannot_dispute exclusion → disposed_withdraw
  //   • holdReason set, no sopOutcome → unclassified + legHoldReason override
  const p = parent({ phase: "triage", status: "Needs Evidence" });

  const processedLeg = dispositionToStatus("disposed_portal", p);
  const unprocessedLeg = dispositionToStatus("unclassified", p);
  const excludedLeg = dispositionToStatus("disposed_withdraw", p);
  const heldLeg = dispositionToStatus("unclassified", p, { legHoldReason: "ask_payor" });

  assert.equal(processedLeg, "Processed");
  assert.equal(unprocessedLeg, "Needs Evidence");
  assert.equal(excludedLeg, null);
  assert.equal(heldLeg, "On Hold");
});
