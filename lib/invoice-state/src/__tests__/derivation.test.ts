import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveDispositionFromLegacy,
  derivePhaseFromLegacy,
  type LegacyClaimShape,
  type LegacyInvoiceGroupShape,
} from "../index";

function group(over: Partial<LegacyInvoiceGroupShape>): LegacyInvoiceGroupShape {
  return {
    status: "New",
    outcome: "Pending",
    reattestRequired: false,
    reattestCompletedAt: null,
    closureReason: null,
    holdReason: null,
    ...over,
  };
}

function claim(over: Partial<LegacyClaimShape>): LegacyClaimShape {
  return {
    status: "New",
    outcome: "Pending",
    sopOutcome: null,
    attestationState: "not_required",
    includedInDispute: true,
    duplicateOfClaimId: null,
    dropReason: null,
    errorTypeId: null,
    closureReason: null,
    ...over,
  };
}

describe("derivePhaseFromLegacy", () => {
  it("New / Pending → triage", () => {
    assert.equal(derivePhaseFromLegacy(group({ status: "New" })).phase, "triage");
  });

  it("Needs Evidence → triage", () => {
    assert.equal(derivePhaseFromLegacy(group({ status: "Needs Evidence" })).phase, "triage");
  });

  it("Portal Queued / Generating Email → ready_to_submit", () => {
    assert.equal(derivePhaseFromLegacy(group({ status: "Portal Queued" })).phase, "ready_to_submit");
    assert.equal(derivePhaseFromLegacy(group({ status: "Generating Email" })).phase, "ready_to_submit");
  });

  it("Awaiting Response → submitted", () => {
    assert.equal(derivePhaseFromLegacy(group({ status: "Awaiting Response" })).phase, "submitted");
  });

  it("Ready to Review → response_received", () => {
    assert.equal(derivePhaseFromLegacy(group({ status: "Ready to Review" })).phase, "response_received");
  });

  it("MAS Eligible + reattestRequired → awaiting_reattestation", () => {
    const r = derivePhaseFromLegacy(group({ status: "MAS Eligible", reattestRequired: true }));
    assert.equal(r.phase, "awaiting_reattestation");
  });

  it("reattestCompletedAt set → closed/reattested regardless of status", () => {
    const r = derivePhaseFromLegacy(
      group({ status: "MAS Eligible", reattestRequired: true, reattestCompletedAt: new Date() }),
    );
    assert.equal(r.phase, "closed");
    assert.equal(r.closureReason, "reattested");
  });

  it("Resolved + Non-Issue → closed/non_issue", () => {
    const r = derivePhaseFromLegacy(group({ status: "Resolved", outcome: "Non-Issue" }));
    assert.equal(r.phase, "closed");
    assert.equal(r.closureReason, "non_issue");
  });

  it("Expired → closed/expired", () => {
    const r = derivePhaseFromLegacy(group({ status: "Expired" }));
    assert.equal(r.phase, "closed");
    assert.equal(r.closureReason, "expired");
  });

  it("Denied → closed/denied_by_payor", () => {
    const r = derivePhaseFromLegacy(group({ status: "Denied" }));
    assert.equal(r.phase, "closed");
    assert.equal(r.closureReason, "denied_by_payor");
  });

  it("Resolved + No Action Needed → closed/non_issue (Task #648 follow-up — keeps refreshGroupDerivedFields from snapping pre-app neutralized rows back to triage)", () => {
    const r = derivePhaseFromLegacy(group({ status: "Resolved", outcome: "No Action Needed" }));
    assert.equal(r.phase, "closed");
    assert.equal(r.closureReason, "non_issue");
  });

  it("Resolved + Withdrawn carries closure_reason forward (cannot_dispute fallback)", () => {
    const a = derivePhaseFromLegacy(
      group({ status: "Resolved", outcome: "Withdrawn", closureReason: "non_issue" }),
    );
    assert.equal(a.closureReason, "non_issue");
    const b = derivePhaseFromLegacy(
      group({ status: "Resolved", outcome: "Withdrawn", closureReason: null }),
    );
    assert.equal(b.closureReason, "cannot_dispute");
  });

  it("On Hold → triage (hold is a flag, not a phase)", () => {
    assert.equal(derivePhaseFromLegacy(group({ status: "On Hold", holdReason: "evidence" })).phase, "triage");
  });
});

describe("deriveDispositionFromLegacy — triage phase", () => {
  it("duplicate pointer wins regardless of phase", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ duplicateOfClaimId: 7 }), "triage"),
      "duplicate",
    );
    assert.equal(
      deriveDispositionFromLegacy(claim({ duplicateOfClaimId: 7, sopOutcome: "non_issue" }), "submitted"),
      "duplicate",
    );
  });

  it("sopOutcome = non_issue → disposed_nonissue", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ sopOutcome: "non_issue" }), "triage"),
      "disposed_nonissue",
    );
  });

  it("sopOutcome = cannot_dispute → disposed_withdraw", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ sopOutcome: "cannot_dispute" }), "triage"),
      "disposed_withdraw",
    );
  });

  it("sopOutcome = hold → blocked", () => {
    assert.equal(deriveDispositionFromLegacy(claim({ sopOutcome: "hold" }), "triage"), "blocked");
  });

  it("sopOutcome = portal_dispute → disposed_portal", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ sopOutcome: "portal_dispute" }), "triage"),
      "disposed_portal",
    );
  });

  it("sopOutcome = dispute (legacy email) → disposed_email", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ sopOutcome: "dispute" }), "triage"),
      "disposed_email",
    );
  });

  it("dropReason = non_issue (excluded path) collapses to disposed_nonissue", () => {
    assert.equal(
      deriveDispositionFromLegacy(
        claim({ includedInDispute: false, dropReason: "non_issue" }),
        "triage",
      ),
      "disposed_nonissue",
    );
  });

  it("dropReason = cannot_dispute (excluded path) collapses to disposed_withdraw", () => {
    assert.equal(
      deriveDispositionFromLegacy(
        claim({ includedInDispute: false, dropReason: "cannot_dispute" }),
        "triage",
      ),
      "disposed_withdraw",
    );
  });

  it("includedInDispute=false with no sopOutcome/dropReason maps to disposed_nonissue (auto-blank-sibling)", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ includedInDispute: false }), "triage"),
      "disposed_nonissue",
    );
  });

  it("error type assigned but no SOP outcome → classifying", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ errorTypeId: "RT_LATE" }), "triage"),
      "classifying",
    );
  });

  it("nothing assigned → unclassified", () => {
    assert.equal(deriveDispositionFromLegacy(claim({}), "triage"), "unclassified");
  });
});

describe("deriveDispositionFromLegacy — submitted/ready_to_submit phases (Wave B+ heal, 2026-05-07)", () => {
  it("ready_to_submit + status=Portal Queued + no sop_outcome + included → disposed_portal", () => {
    // Repro of the 2 prod legacy rows in invoice_groups 15 (Portal Queued)
    // that would otherwise fall into the triage `errorTypeId → classifying`
    // branch and violate VALID_DISPOSITIONS_BY_PHASE for ready_to_submit.
    const c = claim({
      status: "Portal Queued",
      attestationState: "not_required",
      includedInDispute: true,
      errorTypeId: "et_5",
    });
    assert.equal(deriveDispositionFromLegacy(c, "ready_to_submit"), "disposed_portal");
  });

  it("submitted + status=Awaiting Response + no sop_outcome + included → disposed_email", () => {
    // Repro of the 10 prod legacy rows whose parent groups are in
    // 'Awaiting Response' (submitted phase) without a portal-vs-email
    // claim-level signal — the email path is the conservative default.
    const c = claim({
      status: "Awaiting Response",
      attestationState: "not_required",
      includedInDispute: true,
      errorTypeId: "et_3",
    });
    assert.equal(deriveDispositionFromLegacy(c, "submitted"), "disposed_email");
  });

  it("submitted + sopOutcome=non_issue still wins over the submission-path default", () => {
    const c = claim({ status: "Awaiting Response", sopOutcome: "non_issue" });
    assert.equal(deriveDispositionFromLegacy(c, "submitted"), "disposed_nonissue");
  });

  it("submitted + sopOutcome=portal_dispute keeps disposed_portal even on email-path mirror", () => {
    const c = claim({ status: "Awaiting Response", sopOutcome: "portal_dispute" });
    assert.equal(deriveDispositionFromLegacy(c, "submitted"), "disposed_portal");
  });

  it("submitted + includedInDispute=false → disposed_nonissue", () => {
    const c = claim({ status: "Awaiting Response", includedInDispute: false });
    assert.equal(deriveDispositionFromLegacy(c, "submitted"), "disposed_nonissue");
  });

  it("ready_to_submit with sopOutcome=hold maps to blocked (sop wins over default)", () => {
    const c = claim({ status: "Portal Queued", sopOutcome: "hold" });
    assert.equal(deriveDispositionFromLegacy(c, "ready_to_submit"), "blocked");
  });
});

describe("deriveDispositionFromLegacy — response/reviewed phases", () => {
  it("response_received with no verdict yet → awaiting_review", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({}), "response_received"),
      "awaiting_review",
    );
  });

  it("response_received with Approved verdict → verdict_approved", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ outcome: "Approved" }), "response_received"),
      "verdict_approved",
    );
  });

  it("reviewed phase echoes verdict shape", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ outcome: "Partially Approved" }), "reviewed"),
      "verdict_partial",
    );
    assert.equal(
      deriveDispositionFromLegacy(claim({ outcome: "Denied" }), "reviewed"),
      "verdict_denied",
    );
  });
});

describe("deriveDispositionFromLegacy — awaiting_reattestation phase", () => {
  it("Approved + queued → attest_queued", () => {
    assert.equal(
      deriveDispositionFromLegacy(
        claim({ outcome: "Approved", attestationState: "queued" }),
        "awaiting_reattestation",
      ),
      "attest_queued",
    );
  });

  it("Approved + pending → attest_pending", () => {
    assert.equal(
      deriveDispositionFromLegacy(
        claim({ outcome: "Approved", attestationState: "pending" }),
        "awaiting_reattestation",
      ),
      "attest_pending",
    );
  });

  it("Approved + completed → attested", () => {
    assert.equal(
      deriveDispositionFromLegacy(
        claim({ outcome: "Approved", attestationState: "completed" }),
        "awaiting_reattestation",
      ),
      "attested",
    );
  });

  it("Approved + not_required → attest_not_required", () => {
    assert.equal(
      deriveDispositionFromLegacy(
        claim({ outcome: "Approved", attestationState: "not_required" }),
        "awaiting_reattestation",
      ),
      "attest_not_required",
    );
  });

  it("Denied verdict in reattest phase echoes verdict_denied (no reattest sub-state)", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ outcome: "Denied" }), "awaiting_reattestation"),
      "verdict_denied",
    );
  });
});

describe("deriveDispositionFromLegacy — closed phase", () => {
  it("closureReason=non_issue → final_nonissue", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ closureReason: "non_issue" }), "closed"),
      "final_nonissue",
    );
  });

  it("closureReason=denied_by_payor → final_denied", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ closureReason: "denied_by_payor" }), "closed"),
      "final_denied",
    );
  });

  it("closureReason=cannot_dispute → final_withdrawn", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ closureReason: "cannot_dispute" }), "closed"),
      "final_withdrawn",
    );
  });

  it("attestationState=completed (no closure reason) → final_reattested", () => {
    assert.equal(
      deriveDispositionFromLegacy(
        claim({ attestationState: "completed", outcome: "Approved" }),
        "closed",
      ),
      "final_reattested",
    );
  });

  it("approved outcome with no closure reason → final_reattested", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ outcome: "Approved" }), "closed"),
      "final_reattested",
    );
  });

  it("denied outcome with no closure reason → final_denied", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ outcome: "Denied" }), "closed"),
      "final_denied",
    );
  });

  it("withdrawn outcome with no closure reason → final_withdrawn", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ outcome: "Withdrawn" }), "closed"),
      "final_withdrawn",
    );
  });

  it("non-issue outcome with no closure reason → final_nonissue", () => {
    assert.equal(
      deriveDispositionFromLegacy(claim({ outcome: "Non-Issue" }), "closed"),
      "final_nonissue",
    );
  });
});
