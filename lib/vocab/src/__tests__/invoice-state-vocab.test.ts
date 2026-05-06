import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_DISPOSITION,
  CLAIM_DISPOSITIONS,
  CONFIRMED_VERDICT_DISPOSITIONS,
  GLOSSARY,
  INVOICE_PHASE,
  INVOICE_PHASES,
  REATTEST_REQUIRING_DISPOSITIONS,
  TERMINAL_TRIAGE_DISPOSITIONS,
  VALID_DISPOSITIONS_BY_PHASE,
  claimDispositionLabel,
  comparePhase,
  invoicePhaseLabel,
  isClaimDisposition,
  isDispositionValidForPhase,
  isInvoicePhase,
  isPhaseAtLeast,
} from "../index";

describe("invoice phase vocab", () => {
  it("every enum value has a glossary entry", () => {
    for (const p of INVOICE_PHASES) {
      assert.ok(INVOICE_PHASE[p], `missing entry for ${p}`);
      assert.equal(INVOICE_PHASE[p].domain, "invoice_phase");
    }
  });

  it("comparePhase orders the seven phases sequentially", () => {
    assert.ok(comparePhase("triage", "ready_to_submit") < 0);
    assert.ok(comparePhase("submitted", "triage") > 0);
    assert.equal(comparePhase("closed", "closed"), 0);
  });

  it("isPhaseAtLeast respects sequence", () => {
    assert.ok(isPhaseAtLeast("submitted", "triage"));
    assert.ok(isPhaseAtLeast("closed", "closed"));
    assert.equal(isPhaseAtLeast("triage", "submitted"), false);
  });

  it("isInvoicePhase guards correctly", () => {
    assert.equal(isInvoicePhase("triage"), true);
    assert.equal(isInvoicePhase("not_a_phase"), false);
  });

  it("invoicePhaseLabel returns labels for known phases and passthrough for unknown", () => {
    assert.equal(invoicePhaseLabel("triage"), "Triage");
    assert.equal(invoicePhaseLabel("unknown_phase"), "unknown_phase");
  });
});

describe("claim disposition vocab", () => {
  it("every enum value has a glossary entry", () => {
    for (const d of CLAIM_DISPOSITIONS) {
      assert.ok(CLAIM_DISPOSITION[d], `missing entry for ${d}`);
      assert.equal(CLAIM_DISPOSITION[d].domain, "claim_disposition");
    }
  });

  it("isClaimDisposition guards correctly", () => {
    assert.equal(isClaimDisposition("disposed_portal"), true);
    assert.equal(isClaimDisposition("not_a_disposition"), false);
  });

  it("claimDispositionLabel returns labels for known dispositions and passthrough for unknown", () => {
    assert.equal(claimDispositionLabel("disposed_nonissue"), "Non-issue");
    assert.equal(claimDispositionLabel("xyz"), "xyz");
  });

  it("VALID_DISPOSITIONS_BY_PHASE covers all 7 phases", () => {
    for (const p of INVOICE_PHASES) {
      const set = VALID_DISPOSITIONS_BY_PHASE[p];
      assert.ok(set && set.length > 0, `no valid set for phase ${p}`);
    }
  });

  it("every value in VALID_DISPOSITIONS_BY_PHASE is a real disposition", () => {
    for (const p of INVOICE_PHASES) {
      for (const d of VALID_DISPOSITIONS_BY_PHASE[p]) {
        assert.ok(CLAIM_DISPOSITION[d], `${p} references unknown disposition ${d}`);
      }
    }
  });

  it("isDispositionValidForPhase enforces phase membership", () => {
    assert.ok(isDispositionValidForPhase("disposed_portal", "triage"));
    assert.ok(isDispositionValidForPhase("verdict_approved", "reviewed"));
    assert.ok(isDispositionValidForPhase("verdict_approved", "awaiting_reattestation"));
    assert.equal(isDispositionValidForPhase("verdict_approved", "triage"), false);
    assert.equal(isDispositionValidForPhase("unclassified", "submitted"), false);
    assert.equal(isDispositionValidForPhase("attest_queued", "reviewed"), false);
  });

  it("terminal triage dispositions are exactly the entry condition for ready_to_submit", () => {
    const triageReady = VALID_DISPOSITIONS_BY_PHASE.ready_to_submit;
    for (const d of TERMINAL_TRIAGE_DISPOSITIONS) {
      assert.ok(triageReady.includes(d), `${d} should be valid in ready_to_submit`);
    }
  });

  it("confirmed verdict dispositions form the reviewed entry condition", () => {
    for (const d of CONFIRMED_VERDICT_DISPOSITIONS) {
      assert.ok(VALID_DISPOSITIONS_BY_PHASE.reviewed.includes(d));
    }
  });

  it("re-attest-requiring dispositions are a subset of confirmed verdicts", () => {
    for (const d of REATTEST_REQUIRING_DISPOSITIONS) {
      assert.ok(CONFIRMED_VERDICT_DISPOSITIONS.includes(d));
    }
  });
});

describe("glossary completeness", () => {
  it("includes every invoice phase", () => {
    for (const p of INVOICE_PHASES) {
      assert.ok(GLOSSARY.find((e) => e.key === `invoice_phase:${p}`));
    }
  });

  it("includes every claim disposition", () => {
    for (const d of CLAIM_DISPOSITIONS) {
      assert.ok(GLOSSARY.find((e) => e.key === `claim_disposition:${d}`));
    }
  });
});
