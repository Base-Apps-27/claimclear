import { test } from "node:test";
import { strict as assert } from "node:assert";

import { buildLintLegs, isNonContestable } from "../routes/portal-submissions";
import { lintDraft } from "../lib/draft-lint";
import type { Claim } from "@workspace/db";

// Regression coverage for the surface bug where a 2-leg invoice
// (1 cannot_dispute + 1 contestable) was AI-written as "both proven
// correct" because the non-contestable leg was being passed to the
// portal write-up prompt. The fix landed in commit 70becd93 and
// `isNonContestable` is the heart of the predicate that keeps it
// out of `filterRidesForSubmission`'s `candidate` bucket. These
// tests pin the predicate's behavior so future edits to the
// disposition / sopOutcome ladder can't silently regress the bug.

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 1,
    invoiceGroupId: 100,
    confNumber: "CONF-001",
    date: "2025-01-15",
    refNumber: "REF-001",
    clientNumber: "CLIENT-A",
    carNumber: "CAR-001",
    errorDetails: null,
    errorTypeId: null,
    errorTypeName: null,
    claimAmount: "10.00",
    status: "New",
    outcome: "Pending",
    disposition: "unclassified",
    approvedAmount: null,
    invoiceNumbers: null,
    payorEmail: null,
    disputeEmailSent: false,
    disputeEmailSentAt: null,
    submittedVia: null,
    importBatch: null,
    evidenceFiles: null,
    evidenceNotes: null,
    evidenceChecklist: null,
    generatedEmailSubject: null,
    generatedEmailBody: null,
    generatedEmailAt: null,
    includedInDispute: true,
    sopNodeId: null,
    sopAnswers: [],
    sopOutcome: null,
    dropReason: null,
    dropNote: null,
    droppedAt: null,
    readyAt: null,
    perLegContext: null,
    duplicateOfClaimId: null,
    masActionRequired: null,
    masActionCompletedAt: null,
    masActionCompletedBy: null,
    masActionNote: null,
    holdReason: null,
    holdPendingFrom: null,
    holdPlacedAt: null,
    triageNotes: null,
    triagedAt: null,
    closureReason: null,
    closureCategory: null,
    closureCategoryOther: null,
    closureRootCause: null,
    closureRootCauseOther: null,
    closureNarrative: null,
    closureAccountabilityTags: null,
    closureAccountabilityOther: null,
    closureDrivers: null,
    closureDispatchers: null,
    closureCommunicatedTo: null,
    closureReviewState: null,
    closureAddressedAt: null,
    closureAddressedBy: null,
    closureAddressedByEmail: null,
    closureReviewNotes: null,
    attestationState: "not_required",
    attestedAt: null,
    attestedBy: null,
    attestationNote: null,
    attestationQueuedAt: null,
    attestationQueuedBy: null,
    isOpen: true,
    isTourSample: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Claim;
}

// ---------------------------------------------------------------------------
// disposition wins (canonical column, post-Wave-D)
// ---------------------------------------------------------------------------

test("isNonContestable: disposition=disposed_withdraw → true", () => {
  const leg = makeClaim({ disposition: "disposed_withdraw", sopOutcome: null });
  assert.equal(isNonContestable(leg), true);
});

test("isNonContestable: disposition=disposed_nonissue → true", () => {
  const leg = makeClaim({ disposition: "disposed_nonissue", sopOutcome: null });
  assert.equal(isNonContestable(leg), true);
});

test("isNonContestable: disposition=disposed_portal → false (contestable, ready to submit)", () => {
  const leg = makeClaim({ disposition: "disposed_portal", sopOutcome: "portal_dispute" });
  assert.equal(isNonContestable(leg), false);
});

test("isNonContestable: disposition=disposed_email → false (contestable, direct email path)", () => {
  const leg = makeClaim({ disposition: "disposed_email", sopOutcome: "dispute" });
  assert.equal(isNonContestable(leg), false);
});

test("isNonContestable: disposition=classifying mid-walk → false", () => {
  const leg = makeClaim({ disposition: "classifying", sopOutcome: null });
  assert.equal(isNonContestable(leg), false);
});

test("isNonContestable: disposition=blocked (hold) → false", () => {
  const leg = makeClaim({ disposition: "blocked", sopOutcome: "hold" });
  assert.equal(isNonContestable(leg), false);
});

// ---------------------------------------------------------------------------
// sopOutcome fallback (older/in-flight rows whose disposition writer
// hasn't synced yet — disposition is still 'unclassified')
// ---------------------------------------------------------------------------

test("isNonContestable: disposition=unclassified + sopOutcome=cannot_dispute → true (fallback)", () => {
  const leg = makeClaim({ disposition: "unclassified", sopOutcome: "cannot_dispute" });
  assert.equal(isNonContestable(leg), true);
});

test("isNonContestable: disposition=unclassified + sopOutcome=non_issue → true (fallback)", () => {
  const leg = makeClaim({ disposition: "unclassified", sopOutcome: "non_issue" });
  assert.equal(isNonContestable(leg), true);
});

test("isNonContestable: disposition=unclassified + sopOutcome=portal_dispute → false", () => {
  const leg = makeClaim({ disposition: "unclassified", sopOutcome: "portal_dispute" });
  assert.equal(isNonContestable(leg), false);
});

test("isNonContestable: disposition=unclassified + sopOutcome=null → false (fresh leg)", () => {
  const leg = makeClaim({ disposition: "unclassified", sopOutcome: null });
  assert.equal(isNonContestable(leg), false);
});

// ---------------------------------------------------------------------------
// Priority: disposition wins over sopOutcome when both are set.
// Without this guard a stale sopOutcome could mis-route a leg whose
// disposition was deliberately re-stamped (e.g., by an admin reclass).
// ---------------------------------------------------------------------------

test("isNonContestable: disposition=disposed_portal trumps stale sopOutcome=cannot_dispute → false", () => {
  const leg = makeClaim({
    disposition: "disposed_portal",
    sopOutcome: "cannot_dispute",
  });
  assert.equal(
    isNonContestable(leg),
    false,
    "canonical disposition is contestable; the stale sopOutcome must not flip the verdict",
  );
});

test("isNonContestable: disposition=disposed_nonissue trumps stale sopOutcome=portal_dispute → true", () => {
  const leg = makeClaim({
    disposition: "disposed_nonissue",
    sopOutcome: "portal_dispute",
  });
  assert.equal(isNonContestable(leg), true);
});

// ---------------------------------------------------------------------------
// The exact regression — the 2-leg invoice from the bug report.
// One leg cannot_dispute + one leg portal_dispute. The predicate must
// split them so the filter only feeds the contestable leg into the
// AI prompt + attachments path.
// ---------------------------------------------------------------------------

test("regression: 2-leg invoice (1 cannot_dispute + 1 portal_dispute) splits cleanly", () => {
  const rides: Claim[] = [
    makeClaim({
      id: 101,
      confNumber: "CONF-101",
      disposition: "disposed_withdraw",
      sopOutcome: "cannot_dispute",
    }),
    makeClaim({
      id: 102,
      confNumber: "CONF-102",
      disposition: "disposed_portal",
      sopOutcome: "portal_dispute",
    }),
  ];

  const excluded = rides.filter(isNonContestable);
  const candidates = rides.filter((r) => !isNonContestable(r));

  assert.equal(excluded.length, 1, "exactly one non-contestable leg");
  assert.equal(excluded[0].confNumber, "CONF-101");
  assert.equal(candidates.length, 1, "exactly one candidate stays in the prompt");
  assert.equal(
    candidates[0].confNumber,
    "CONF-102",
    "only the contestable leg feeds the AI write-up",
  );
});

test("regression: all-non-contestable invoice yields zero candidates (filter would short-circuit)", () => {
  const rides: Claim[] = [
    makeClaim({ id: 201, disposition: "disposed_withdraw" }),
    makeClaim({ id: 202, disposition: "disposed_nonissue" }),
  ];
  const candidates = rides.filter((r) => !isNonContestable(r));
  assert.equal(
    candidates.length,
    0,
    "every leg is non-contestable; downstream filter must throw NoEligibleLegsError",
  );
});

// ---------------------------------------------------------------------------
// Regression (2026-05-14): the draft-lint structural rules (notably
// `ruleMissingConfNumberPerLeg` from Task #708) only filter by
// `includedInDispute !== false`. A leg that SOP terminated as
// `non_issue` / `cannot_dispute` (and so is correctly omitted from the
// AI prompt and the bot upload set by `filterRidesForSubmission`) was
// still reaching `lintDraft` because `buildLintLegs` was building from
// the unfiltered `rides` list. The lint then demanded a paragraph for
// the non-issue leg's conf number and showed "Submission blocked: give
// it its own paragraph" to operators.
//
// Fix: `buildLintLegs` now mirrors `filterRidesForSubmission` and drops
// non-contestable rides at the source so every structural rule sees the
// same set the bot will file.
// ---------------------------------------------------------------------------

test("buildLintLegs: non-contestable rides are dropped before lint sees them", async () => {
  const rides: Claim[] = [
    makeClaim({
      id: 14998441,
      confNumber: "14998441",
      errorTypeId: null,
      errorTypeName: "GPS Deviation Status",
      disposition: "disposed_nonissue",
      sopOutcome: "non_issue",
    }),
    makeClaim({
      id: 15011302,
      confNumber: "15011302",
      errorTypeId: null,
      errorTypeName: "GPS Deviation Status",
      disposition: "disposed_nonissue",
      sopOutcome: "non_issue",
    }),
    makeClaim({
      id: 15011303,
      confNumber: "15011303",
      errorTypeId: null,
      errorTypeName: "Incomplete GPS",
      disposition: "disposed_portal",
      sopOutcome: "portal_dispute",
    }),
  ];
  const legs = await buildLintLegs(rides);
  assert.equal(
    legs.length,
    1,
    "only the contestable leg should reach the lint",
  );
  assert.equal(legs[0].confNumber, "15011303");
});

test("end-to-end regression: mixed group, draft mentions only the contestable leg → lint passes", async () => {
  // The exact shape of the user-reported failure (screenshot 2026-05-14):
  // 2 GPS Deviation Status legs that operator marked non-issue + 1
  // contestable leg. The AI write-up correctly mentions only the
  // contestable conf. Pre-fix, lintDraft demanded paragraphs for the
  // two non-issue legs and surfaced "Submission blocked: give it its
  // own paragraph". Post-fix, buildLintLegs drops them at the source
  // and the lint must pass cleanly.
  const rides: Claim[] = [
    makeClaim({
      id: 14998441,
      confNumber: "14998441",
      errorTypeId: null,
      errorTypeName: "GPS Deviation Status",
      disposition: "disposed_nonissue",
      sopOutcome: "non_issue",
    }),
    makeClaim({
      id: 15011302,
      confNumber: "15011302",
      errorTypeId: null,
      errorTypeName: "GPS Deviation Status",
      disposition: "disposed_nonissue",
      sopOutcome: "non_issue",
    }),
    makeClaim({
      id: 15011303,
      confNumber: "15011303",
      errorTypeId: null,
      errorTypeName: "Incomplete GPS",
      disposition: "disposed_portal",
      sopOutcome: "portal_dispute",
    }),
  ];
  const lintLegs = await buildLintLegs(rides);
  const results = lintDraft(
    {
      descriptionHtml:
        "<p>Conf #15011303 — disputing per attached GPS evidence.</p>",
      confNumber: "15011303",
      attachmentUrls: [],
    },
    { confNumber: "15011303", claimAmount: "10.00" },
    [],
    { legs: lintLegs },
  );
  const offending = results.filter((r) =>
    r.ruleKey.startsWith("missing_conf_number_for_leg:"),
  );
  assert.deepEqual(
    offending,
    [],
    "no per-leg conf-coverage fail should fire — non-issue legs were filtered out",
  );
});

test("buildLintLegs: all-non-contestable invoice yields zero lint legs", async () => {
  const rides: Claim[] = [
    makeClaim({
      id: 14998441,
      confNumber: "14998441",
      errorTypeId: null,
      disposition: "disposed_nonissue",
      sopOutcome: "non_issue",
    }),
    makeClaim({
      id: 15011302,
      confNumber: "15011302",
      errorTypeId: null,
      disposition: "disposed_withdraw",
      sopOutcome: "cannot_dispute",
    }),
  ];
  const legs = await buildLintLegs(rides);
  assert.equal(
    legs.length,
    0,
    "an all-non-contestable invoice must not emit any per-leg lint findings",
  );
});
