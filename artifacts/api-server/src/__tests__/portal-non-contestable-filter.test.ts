import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  buildLintLegs,
  buildPortalDescriptionPrompt,
  isNonContestable,
  type GroupContext,
} from "../routes/portal-submissions";
import { buildPromptLegInputs } from "../lib/prompt-leg-inputs";
import { lintDraft } from "../lib/draft-lint";
import type { Claim, InvoiceGroup } from "@workspace/db";

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

// ---------------------------------------------------------------------------
// Regression (2026-05-14, prod): the same "Submission blocked: give it its
// own paragraph" dialog kept firing on multi-leg disputes whose legs were
// ALL contestable — a different surface of the same lint rule.
//
// `ruleMissingConfNumberPerLeg` requires every contestable leg to appear
// in at least one paragraph that does NOT name another leg's conf number,
// so the portal can attribute prose to the correct leg. The lint is
// correct — the prompt was the problem: it only told the AI "2-4
// paragraphs maximum" without explaining the attribution constraint, so
// on multi-leg disputes the model would bundle multiple confs into a
// single paragraph and the lint would block the submission.
//
// Fix: `buildPortalDescriptionPrompt` injects an explicit per-leg
// paragraph-attribution directive when there are 2+ contestable rides,
// listing each conf number that needs its own paragraph. Single-leg
// disputes don't need the directive (one paragraph trivially attributes
// to the only leg) and direct-email paths get it too.
// ---------------------------------------------------------------------------

function makeGroupForPrompt(overrides: Partial<InvoiceGroup> = {}): InvoiceGroup {
  // Minimal group fixture for the prompt builder. The full $inferSelect
  // shape has 60+ columns; the prompt only reads invoiceNumber,
  // clientNumber, errorTypeName, errorDetails, and evidenceNotes. Cast
  // through `unknown` keeps the test focused on what the prompt builder
  // actually consumes without forcing a 60-line fixture rewrite each
  // time the schema grows a column.
  return {
    id: 9001,
    invoiceNumber: "INV-9001",
    clientNumber: "C100",
    errorTypeName: "GPS Pickup Too Far from Residence",
    errorDetails: "Two legs disputed for distinct GPS-evidence reasons.",
    evidenceNotes: null,
    ...overrides,
  } as unknown as InvoiceGroup;
}

function buildPromptCtx(rides: Claim[]): GroupContext {
  return {
    group: makeGroupForPrompt(),
    rides,
    primaryClaim: rides[0],
  };
}

const promptSettings = {
  providerName: "Acme Transit",
  contactEmail: "ops@acme.example",
  contactPhone: "555-0100",
  defaultGpsBreadcrumbs: "",
  defaultDisputeInstructions: "",
};

function legInputsFor(rides: Claim[]) {
  return buildPromptLegInputs({
    legs: rides.map((r) => ({
      id: r.id,
      confNumber: r.confNumber,
      date: r.date,
      clientNumber: r.clientNumber,
      carNumber: r.carNumber,
      claimAmount: r.claimAmount,
      perLegContext: r.perLegContext,
      duplicateOfClaimId: r.duplicateOfClaimId,
      sopOutcome: r.sopOutcome,
    })),
    groupLegs: rides.map((r) => ({
      id: r.id,
      confNumber: r.confNumber,
      date: r.date,
      clientNumber: r.clientNumber,
      carNumber: r.carNumber,
      claimAmount: r.claimAmount,
      perLegContext: r.perLegContext,
      duplicateOfClaimId: r.duplicateOfClaimId,
      sopOutcome: r.sopOutcome,
    })),
  });
}

test("prompt directive: multi-leg portal write-up demands a dedicated paragraph per conf", () => {
  // Two contestable legs (the screenshot scenario: 15030369 GPS Pickup Too
  // Far from Residence + 15030371 GPS Deviation Status). The prompt MUST
  // tell the AI that each conf needs its own paragraph; otherwise the
  // model bundles them and `ruleMissingConfNumberPerLeg` blocks submit.
  const rides: Claim[] = [
    makeClaim({
      id: 15030369,
      confNumber: "15030369",
      errorTypeName: "GPS Pickup Too Far from Residence",
      disposition: "disposed_portal",
      sopOutcome: "portal_dispute",
    }),
    makeClaim({
      id: 15030371,
      confNumber: "15030371",
      errorTypeName: "GPS Deviation Status",
      disposition: "disposed_portal",
      sopOutcome: "portal_dispute",
    }),
  ];
  const { prompt } = buildPortalDescriptionPrompt({
    ctx: buildPromptCtx(rides),
    errorType: null,
    disputeReason: "GPS evidence shows the billed legs were not as filed.",
    settings: promptSettings,
    promptLegInputs: legInputsFor(rides),
    specialCircumstances: null,
  });
  assert.match(
    prompt,
    /HARD REQUIREMENT — paragraph attribution/,
    "the directive is present so the AI knows to dedicate a paragraph to each conf",
  );
  assert.match(
    prompt,
    /15030369, 15030371/,
    "both conf numbers are listed verbatim so the AI can target them",
  );
});

test("prompt directive: single-leg portal write-up does NOT inject the per-leg paragraph rule", () => {
  // A solo dispute trivially attributes prose to the only leg — the
  // directive would be noise. Pin its absence so a future refactor
  // doesn't accidentally fire it on every dispute.
  const rides: Claim[] = [
    makeClaim({
      id: 15030369,
      confNumber: "15030369",
      disposition: "disposed_portal",
      sopOutcome: "portal_dispute",
    }),
  ];
  const { prompt } = buildPortalDescriptionPrompt({
    ctx: buildPromptCtx(rides),
    errorType: null,
    disputeReason: "GPS evidence shows the billed distance is wrong.",
    settings: promptSettings,
    promptLegInputs: legInputsFor(rides),
    specialCircumstances: null,
  });
  assert.equal(
    prompt.includes("HARD REQUIREMENT — paragraph attribution"),
    false,
    "single-leg disputes don't need the multi-leg attribution rule",
  );
});

test("prompt directive: counts only contestable legs (non-issue siblings don't trigger the rule alone)", () => {
  // 2 non_issue + 1 portal_dispute → only one contestable conf, so the
  // directive must NOT fire (the contestable leg is effectively a
  // single-leg write-up and lintDraft won't demand multi-leg
  // attribution either, per `buildLintLegs`).
  const rides: Claim[] = [
    makeClaim({
      id: 14998441,
      confNumber: "14998441",
      disposition: "disposed_nonissue",
      sopOutcome: "non_issue",
    }),
    makeClaim({
      id: 15011302,
      confNumber: "15011302",
      disposition: "disposed_nonissue",
      sopOutcome: "non_issue",
    }),
    makeClaim({
      id: 15011303,
      confNumber: "15011303",
      disposition: "disposed_portal",
      sopOutcome: "portal_dispute",
    }),
  ];
  const { prompt } = buildPortalDescriptionPrompt({
    ctx: buildPromptCtx(rides),
    errorType: null,
    disputeReason: "Only one leg is actually disputed.",
    settings: promptSettings,
    promptLegInputs: legInputsFor(rides),
    specialCircumstances: null,
  });
  assert.equal(
    prompt.includes("HARD REQUIREMENT — paragraph attribution"),
    false,
    "non-contestable rides must not be counted toward the multi-leg threshold",
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
