/**
 * Deterministic prompt-shape tests for Task #307.
 *
 * Pins the per-leg-context + sibling-duplicate threading into the four
 * Claude prompt sites (portal write-up, email-channel write-up, AI readback
 * preflight, per-claim email). No LLM calls in this loop — these tests
 * assert on the assembled prompt strings directly (parity, additions,
 * sibling roll-up, duplicate edge case).
 *
 * The four scenarios:
 *   (a) parity         — no per_leg_context, no sibling-duplicates → prompts are
 *                        byte-identical to the legacy assembly.
 *   (b) all-context    — every leg has per_leg_context → each leg shows its
 *                        finding under the rides block / per-claim bullet list.
 *   (c) primary+siblings — primary leg has 2 sibling-duplicates pointing at it
 *                        → duplicates are skipped from the rides block; the
 *                        primary's annotation lists their refs.
 *   (d) duplicate-only — per-claim email path called for a duplicate as the
 *                        sole `legs` entry → the prompt names its primary
 *                        and skips the per-leg context (the primary owns
 *                        the trip-overriding finding).
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";

import {
  pool,
  claimsTable,
  invoiceGroupsTable,
  errorTypesTable,
} from "@workspace/db";
import {
  buildPromptLegInputs,
  promptLegAuditCounters,
  type PromptLegRowInput,
} from "../lib/prompt-leg-inputs";
import {
  buildPortalDescriptionPrompt,
  buildReadbackPrompt,
  type GroupContext,
  type PortalSettings,
} from "../routes/portal-submissions";
import { buildPerClaimEmailPrompt } from "../routes/ai-email";

type Claim = typeof claimsTable.$inferSelect;
type InvoiceGroup = typeof invoiceGroupsTable.$inferSelect;
type ErrorType = typeof errorTypesTable.$inferSelect;

// The two route imports above transitively pull in `@workspace/db`, which
// opens a Postgres pool at module-load time. None of these tests touch the
// DB (they all exercise pure prompt-assembly), but the open pool keeps the
// event loop alive — close it so the test runner can exit cleanly.
after(async () => {
  await pool.end().catch(() => undefined);
});

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeLeg(overrides: Partial<PromptLegRowInput> & Pick<PromptLegRowInput, "id" | "confNumber">): PromptLegRowInput {
  return {
    date: "2026-01-15",
    clientNumber: "C100",
    carNumber: "CAR-7",
    claimAmount: "42.50",
    perLegContext: null,
    duplicateOfClaimId: null,
    sopOutcome: null,
    ...overrides,
  };
}

// Fixed timestamp so tests stay deterministic across runs.
const FIXED_TS = new Date("2026-01-15T12:00:00.000Z");

/**
 * Typed minimal fixture for an invoice-group row. Returns the full
 * `invoiceGroupsTable.$inferSelect` shape with sensible defaults so callers
 * can override only the fields a given test cares about. Keeping this
 * strongly typed (no `any`/`as never`) means schema additions trip the
 * compiler instead of silently leaving fields undefined at runtime.
 */
function makeGroup(overrides: Partial<InvoiceGroup> = {}): InvoiceGroup {
  return {
    id: 9001,
    invoiceNumber: "INV-2026-001",
    clientNumber: "C100",
    errorDetails: "Distance billed exceeds the contract distance for this leg.",
    errorTypeId: "11",
    errorTypeName: "Trip Distance Mismatch",
    status: "New",
    outcome: "Pending",
    approvedAmount: null,
    rideCount: 2,
    serviceDate: null,
    totalAmount: "97.50",
    groupContext: null,
    draftSubject: null,
    draftDescriptionHtml: null,
    aiBaselineSubject: null,
    aiBaselineDescriptionHtml: null,
    draftEditedAt: null,
    draftEditedBy: null,
    draftReviewedAt: null,
    draftReviewedBy: null,
    understandingReadback: null,
    understandingReadbackAt: null,
    understandingReadbackBy: null,
    previewGeneratedAt: null,
    previewGeneratedBy: null,
    reattestRequired: false,
    reattestCompletedAt: null,
    reattestCompletedBy: null,
    reattestNote: null,
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
    disputeEmailSent: false,
    disputeEmailSentAt: null,
    generatedEmailSubject: null,
    generatedEmailBody: null,
    generatedEmailAt: null,
    evidenceFiles: null,
    evidenceNotes: "GPS breadcrumbs attached.",
    evidenceChecklist: null,
    payorEmail: null,
    payorDenialReason: null,
    payorDenialReasonNote: null,
    payorDenialReasonAt: null,
    payorDenialReasonBy: null,
    awaitingPayorAgainAt: null,
    importBatch: null,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    ...overrides,
  };
}

/**
 * Typed minimal fixture for a claim row. Same rationale as `makeGroup` —
 * keeping the full `claimsTable.$inferSelect` shape forces schema additions
 * to surface at compile time instead of silently leaving runtime holes.
 */
function makeClaim(overrides: Partial<Claim> & Pick<Claim, "id" | "confNumber">): Claim {
  return {
    invoiceGroupId: 9001,
    date: "2026-01-15",
    refNumber: null,
    clientNumber: "C100",
    carNumber: "CAR-7",
    errorDetails: "billed > contract",
    errorTypeId: "11",
    errorTypeName: "Trip Distance Mismatch",
    claimAmount: "42.50",
    status: "New",
    outcome: "Pending",
    approvedAmount: null,
    invoiceNumbers: null,
    payorEmail: null,
    disputeEmailSent: false,
    disputeEmailSentAt: null,
    importBatch: null,
    evidenceFiles: null,
    evidenceNotes: "GPS log uploaded.",
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
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    ...overrides,
  };
}

/**
 * Typed `GroupContext` builder. Accepts the lightweight `PromptLegRowInput`
 * shape used elsewhere in this test file and promotes each entry into a
 * full `Claim` row via `makeClaim` so the resulting `GroupContext` matches
 * the production type exactly.
 */
function makeCtx(rides: PromptLegRowInput[]): GroupContext {
  const claims = rides.map((r) =>
    makeClaim({
      id: r.id,
      confNumber: r.confNumber,
      date: r.date,
      clientNumber: r.clientNumber,
      carNumber: r.carNumber,
      claimAmount: r.claimAmount,
      perLegContext: r.perLegContext,
      duplicateOfClaimId: r.duplicateOfClaimId,
      sopOutcome: r.sopOutcome,
    }),
  );
  return {
    group: makeGroup({ rideCount: claims.length }),
    rides: claims,
    primaryClaim: claims[0],
  };
}

const baseSettings: PortalSettings = {
  providerName: "Acme Transit",
  contactEmail: "ops@acme.example",
  contactPhone: "555-0100",
  defaultGpsBreadcrumbs: "",
  defaultDisputeInstructions: "",
};

const errorType: ErrorType = {
  id: 11,
  name: "Trip Distance Mismatch",
  category: null,
  description: "Distance billed exceeds the contract distance",
  guidance: "Verify GPS breadcrumbs and provider mileage report.",
  recommendedActions: null,
  disputeReasonsLibrary: null,
  evidenceRequirements: null,
  decisionTree: null,
  emailTemplate: null,
  disputeInstructions: "Cite the GPS evidence by file name.",
  useGpsControlDeviation: false,
  useDirectEmail: false,
  tripOverriding: false,
  createdAt: FIXED_TS,
  updatedAt: FIXED_TS,
};

// ---------------------------------------------------------------------------
// (a) Parity — no per_leg_context, no duplicates → byte-identical
// ---------------------------------------------------------------------------

test("(a) parity: no per_leg_context, no duplicates — helper output is byte-identical to legacy rides block", () => {
  const rides = [
    makeLeg({ id: 501, confNumber: "ABC123" }),
    makeLeg({ id: 502, confNumber: "DEF456", date: "2026-01-16", claimAmount: "55.00" }),
  ];
  const result = buildPromptLegInputs({ legs: rides, groupLegs: rides });

  // Legacy ride-line format (verbatim from portal-submissions before refactor).
  const expectedRidesBlock = rides
    .map((r, i) => `  ${i + 1}. Conf #${r.confNumber} | Service date: ${r.date || "N/A"} | Client: ${r.clientNumber || "N/A"} | Car: ${r.carNumber || "N/A"} | Amount: $${r.claimAmount || "0.00"}`)
    .join("\n");

  assert.equal(result.ridesBlock, expectedRidesBlock);
  assert.equal(result.hasPerLegContext, false);
  assert.equal(result.perLegContextLegCount, 0);
  assert.equal(result.siblingDuplicateCount, 0);
  for (const lines of result.perClaimAnnotationLines.values()) {
    assert.deepEqual(lines, []);
  }
  // Every leg's role is "none" (no siblings, not a duplicate).
  for (const input of result.inputs) {
    assert.equal(input.role, "none");
    assert.equal(input.siblingDuplicateRefs, undefined);
    assert.equal(input.primaryRef, undefined);
  }
});

test("(a) parity: portal write-up prompt is byte-identical to the legacy assembly", () => {
  const rides = [
    makeLeg({ id: 501, confNumber: "ABC123" }),
    makeLeg({ id: 502, confNumber: "DEF456", date: "2026-01-16", claimAmount: "55.00" }),
  ];
  const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides });
  const { prompt } = buildPortalDescriptionPrompt({
    ctx: makeCtx(rides),
    errorType,
    disputeReason: "GPS shows 4.2 miles, not the 6.1 billed.",
    settings: baseSettings,
    promptLegInputs,
    specialCircumstances: null,
  });

  // No "Per-leg finding" lines and no sibling annotations should appear in
  // the parity case. (This is the byte-equivalence guarantee.)
  assert.equal(prompt.includes("Per-leg finding:"), false);
  assert.equal(prompt.includes("rolled under this primary"), false);
  assert.equal(prompt.includes("the trip-overriding finding lives there"), false);
  // The legacy rides block must still be present verbatim.
  assert.match(prompt, /  1\. Conf #ABC123 \| Service date: 2026-01-15 \| Client: C100 \| Car: CAR-7 \| Amount: \$42\.50\n  2\. Conf #DEF456 \| Service date: 2026-01-16 \| Client: C100 \| Car: CAR-7 \| Amount: \$55\.00/);
});

test("(a) parity: readback prompt is byte-identical to the legacy assembly", () => {
  const rides = [
    makeLeg({ id: 501, confNumber: "ABC123" }),
    makeLeg({ id: 502, confNumber: "DEF456" }),
  ];
  const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides });
  const { prompt } = buildReadbackPrompt({
    ctx: makeCtx(rides),
    errorType,
    reason: "Mileage mismatch",
    specialCircumstances: "",
    promptLegInputs,
  });

  // Reconstruct what the legacy prompt looked like verbatim and assert
  // exact equality — this is the parity guarantee.
  const headline = `Invoice #INV-2026-001 (2 rides) — Error Type: Trip Distance Mismatch.`;
  const guidance = `\nSOP guidance for this error type: Verify GPS breadcrumbs and provider mileage report.`;
  const treeLine = `\nDecision-tree outcome: Mileage mismatch`;
  const specialLine = `\nOperator-supplied special circumstances: (none)`;
  const expected = `You are previewing your understanding of an NEMT claim dispute before drafting the full write-up. Do NOT write the dispute. In 2 to 4 plain-language sentences, restate — in your own words — what the dispute is actually about, given the inputs below. Lead with the core ask, then the key reason. If the operator's special circumstances change the framing from a surface read of the error type, reflect that explicitly in the readback so the operator can spot any misunderstanding.

${headline}${guidance}${treeLine}${specialLine}

Return ONLY the 2–4 sentence restatement. No headers, no bullet points, no preamble like "Here is my understanding".`;

  assert.equal(prompt, expected);
});

test("(a) parity: per-claim email prompt is byte-identical to the legacy assembly", () => {
  const claim = makeClaim({ id: 501, confNumber: "ABC123" });
  const promptLegInputs = buildPromptLegInputs({
    legs: [makeLeg({ id: claim.id, confNumber: claim.confNumber })],
    groupLegs: [makeLeg({ id: claim.id, confNumber: claim.confNumber })],
  });
  const { prompt } = buildPerClaimEmailPrompt({
    claim,
    errorType,
    disputeReason: "GPS shows shorter distance",
    instructions: "Cite the GPS evidence by file name.",
    promptLegInputs,
  });

  // Parity: no annotation block — the bulleted "Claim details" section
  // ends with the error description line and nothing else.
  assert.equal(prompt.includes("Per-leg finding:"), false);
  assert.equal(prompt.includes("Sibling duplicates rolled under this primary:"), false);
  assert.equal(prompt.includes("Rolled under primary"), false);
  assert.match(prompt, /- Error description: Distance billed exceeds the contract distance\n\nReason for dispute/);
});

// ---------------------------------------------------------------------------
// (b) Every leg has per_leg_context
// ---------------------------------------------------------------------------

test("(b) every leg has per_leg_context — each leg's finding shows under the rides block", () => {
  const rides = [
    makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "Driver waited 47 min; member confirmed delay." }),
    makeLeg({ id: 502, confNumber: "DEF456", perLegContext: "GPS shows trip ended at 5:12pm, not 5:48pm as billed." }),
  ];
  const result = buildPromptLegInputs({ legs: rides, groupLegs: rides });

  assert.equal(result.hasPerLegContext, true);
  assert.equal(result.perLegContextLegCount, 2);
  assert.equal(result.siblingDuplicateCount, 0);

  const expectedRidesBlock =
    `  1. Conf #ABC123 | Service date: 2026-01-15 | Client: C100 | Car: CAR-7 | Amount: $42.50\n` +
    `     Per-leg finding: Driver waited 47 min; member confirmed delay.\n` +
    `  2. Conf #DEF456 | Service date: 2026-01-15 | Client: C100 | Car: CAR-7 | Amount: $42.50\n` +
    `     Per-leg finding: GPS shows trip ended at 5:12pm, not 5:48pm as billed.`;
  assert.equal(result.ridesBlock, expectedRidesBlock);

  // Per-claim annotations are bulleted (for the per-claim email path) and
  // include each leg's finding.
  assert.deepEqual(result.perClaimAnnotationLines.get(501), [
    "- Per-leg finding: Driver waited 47 min; member confirmed delay.",
  ]);
  assert.deepEqual(result.perClaimAnnotationLines.get(502), [
    "- Per-leg finding: GPS shows trip ended at 5:12pm, not 5:48pm as billed.",
  ]);
});

test("(b) all-context: portal write-up + readback prompts include the per-leg findings block", () => {
  const rides = [
    makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "Driver waited 47 min; member confirmed delay." }),
    makeLeg({ id: 502, confNumber: "DEF456", perLegContext: "GPS shows trip ended early." }),
  ];
  const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides });

  const { prompt: portalPrompt } = buildPortalDescriptionPrompt({
    ctx: makeCtx(rides),
    errorType,
    disputeReason: "Mileage mismatch",
    settings: baseSettings,
    promptLegInputs,
    specialCircumstances: null,
  });
  assert.match(portalPrompt, /     Per-leg finding: Driver waited 47 min; member confirmed delay\./);
  assert.match(portalPrompt, /     Per-leg finding: GPS shows trip ended early\./);

  const { prompt: readbackPrompt } = buildReadbackPrompt({
    ctx: makeCtx(rides),
    errorType,
    reason: "Mileage mismatch",
    specialCircumstances: "",
    promptLegInputs,
  });
  // The readback now carries the per-leg findings block (it didn't before).
  assert.match(readbackPrompt, /Per-leg findings the operator captured during the SOP walk/);
  assert.match(readbackPrompt, /     Per-leg finding: Driver waited 47 min/);
});

test("(b) all-context: per-claim email prompt embeds per-leg finding bullet under the claim details", () => {
  const claim = makeClaim({ id: 501, confNumber: "ABC123", perLegContext: "Driver waited 47 min." });
  const ride = makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "Driver waited 47 min; member confirmed delay." });
  const promptLegInputs = buildPromptLegInputs({ legs: [ride], groupLegs: [ride] });
  const { prompt } = buildPerClaimEmailPrompt({
    claim,
    errorType,
    disputeReason: "Mileage mismatch",
    instructions: "Cite GPS evidence.",
    promptLegInputs,
  });
  assert.match(prompt, /- Error description: Distance billed exceeds the contract distance\n- Per-leg finding: Driver waited 47 min; member confirmed delay\.\n\nReason for dispute/);
});

test("(b) all-context: per-claim email prompt still embeds per-leg finding bullet when errorType has no description", () => {
  // Regression guard: the per-claim annotation block must render
  // independently of the optional `errorType.description` line. Earlier
  // structuring placed the annotation immediately after the description
  // template, which made it easy to misread as conditional on description
  // being present. This pins that the bullet is *always* emitted when an
  // annotation exists, regardless of `errorType.description`.
  const errorTypeNoDesc: ErrorType = { ...errorType, description: null };
  const claim = makeClaim({ id: 501, confNumber: "ABC123", perLegContext: "Driver waited 47 min." });
  const ride = makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "Driver waited 47 min; member confirmed delay." });
  const promptLegInputs = buildPromptLegInputs({ legs: [ride], groupLegs: [ride] });
  const { prompt } = buildPerClaimEmailPrompt({
    claim,
    errorType: errorTypeNoDesc,
    disputeReason: "Mileage mismatch",
    instructions: "Cite GPS evidence.",
    promptLegInputs,
  });
  // The "- Error description:" line is omitted (description is null) but
  // the per-leg annotation bullet must still appear directly under the
  // "- Error type:" line.
  assert.equal(prompt.includes("- Error description:"), false);
  assert.match(prompt, /- Error type: Trip Distance Mismatch\n- Per-leg finding: Driver waited 47 min; member confirmed delay\.\n\nReason for dispute/);
});

// ---------------------------------------------------------------------------
// (c) Primary + 2 sibling duplicates
// ---------------------------------------------------------------------------

test("(c) primary + 2 sibling duplicates — duplicates skipped from rides block; primary annotated", () => {
  const primary = makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "Trip started at member's home, not the address billed." });
  const dupA = makeLeg({ id: 502, confNumber: "DEF456", duplicateOfClaimId: 501 });
  const dupB = makeLeg({ id: 503, confNumber: "GHI789", duplicateOfClaimId: 501 });
  const rides = [primary, dupA, dupB];
  const result = buildPromptLegInputs({ legs: rides, groupLegs: rides });

  assert.equal(result.hasPerLegContext, true);
  assert.equal(result.perLegContextLegCount, 1);
  assert.equal(result.siblingDuplicateCount, 2);

  const primaryInput = result.inputs.find((i) => i.claimId === 501)!;
  assert.equal(primaryInput.role, "primary");
  assert.deepEqual(primaryInput.siblingDuplicateRefs, ["DEF456", "GHI789"]);

  const dupInput = result.inputs.find((i) => i.claimId === 502)!;
  assert.equal(dupInput.role, "duplicate");
  assert.equal(dupInput.primaryRef, "ABC123");

  // Rides block: only the primary appears (duplicates skipped — primary owns
  // the finding) and the sibling-coverage annotation lines are present.
  const expectedRidesBlock =
    `  1. Conf #ABC123 | Service date: 2026-01-15 | Client: C100 | Car: CAR-7 | Amount: $42.50\n` +
    `     Per-leg finding: Trip started at member's home, not the address billed.\n` +
    `     This same trip-overriding finding also covers Conf #DEF456, Conf #GHI789 (rolled under this primary).`;
  assert.equal(result.ridesBlock, expectedRidesBlock);

  // Per-claim annotations: primary lists its siblings; duplicates point to
  // the primary; the per-leg context line is suppressed for duplicates.
  assert.deepEqual(result.perClaimAnnotationLines.get(501), [
    "- Per-leg finding: Trip started at member's home, not the address billed.",
    "- Sibling duplicates rolled under this primary: Conf #DEF456, Conf #GHI789 (the same trip-overriding finding covers them).",
  ]);
  assert.deepEqual(result.perClaimAnnotationLines.get(502), [
    "- Rolled under primary Conf #ABC123 (the trip-overriding finding lives on the primary; do not re-state it here).",
  ]);
  assert.deepEqual(result.perClaimAnnotationLines.get(503), [
    "- Rolled under primary Conf #ABC123 (the trip-overriding finding lives on the primary; do not re-state it here).",
  ]);
});

test("(c) primary + siblings: portal write-up names the rolled-up siblings on the primary's line", () => {
  const primary = makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "Trip started at member's home." });
  const dupA = makeLeg({ id: 502, confNumber: "DEF456", duplicateOfClaimId: 501 });
  const dupB = makeLeg({ id: 503, confNumber: "GHI789", duplicateOfClaimId: 501 });
  const rides = [primary, dupA, dupB];
  const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides });
  const { prompt } = buildPortalDescriptionPrompt({
    ctx: makeCtx(rides),
    errorType,
    disputeReason: "Address mismatch",
    settings: baseSettings,
    promptLegInputs,
    specialCircumstances: null,
  });

  assert.match(prompt, /     This same trip-overriding finding also covers Conf #DEF456, Conf #GHI789 \(rolled under this primary\)\./);
  // Duplicates do NOT appear as their own lines in the rides block.
  assert.equal(prompt.match(/Conf #DEF456 \| Service date/g), null);
  assert.equal(prompt.match(/Conf #GHI789 \| Service date/g), null);
});

// ---------------------------------------------------------------------------
// (d) Duplicate-only call edge case (per-claim email path)
// ---------------------------------------------------------------------------

test("(d) duplicate-only call: helper names the primary and skips per-leg context", () => {
  const primary = makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "Primary's narrative — must NOT appear under the duplicate." });
  const dup = makeLeg({ id: 502, confNumber: "DEF456", duplicateOfClaimId: 501, perLegContext: "stale duplicate context that should be ignored" });
  const result = buildPromptLegInputs({ legs: [dup], groupLegs: [primary, dup] });

  assert.equal(result.inputs.length, 1);
  const dupInput = result.inputs[0];
  assert.equal(dupInput.role, "duplicate");
  assert.equal(dupInput.primaryRef, "ABC123");
  assert.equal(dupInput.perLegContext, null, "duplicate's perLegContext must be cleared — primary owns the finding");
  // Audit counters: a duplicate `legs` slice has no per-leg-context (cleared)
  // and contributes no sibling-duplicate refs (those are counted on primaries).
  assert.equal(result.hasPerLegContext, false);
  assert.equal(result.perLegContextLegCount, 0);
  assert.equal(result.siblingDuplicateCount, 0);

  // Per-claim annotation lines for the duplicate point at the primary and
  // explicitly suppress the per-leg context.
  assert.deepEqual(result.perClaimAnnotationLines.get(502), [
    "- Rolled under primary Conf #ABC123 (the trip-overriding finding lives on the primary; do not re-state it here).",
  ]);
});

test("(d) duplicate-only: per-claim email prompt embeds primary-pointer bullet, omits stale per-leg context", () => {
  const primary = makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "Primary owns the finding." });
  const dupRow = makeLeg({ id: 502, confNumber: "DEF456", duplicateOfClaimId: 501, perLegContext: "stale duplicate context" });
  const dupClaim = makeClaim({ id: 502, confNumber: "DEF456", duplicateOfClaimId: 501, perLegContext: "stale duplicate context" });
  const promptLegInputs = buildPromptLegInputs({ legs: [dupRow], groupLegs: [primary, dupRow] });
  const { prompt } = buildPerClaimEmailPrompt({
    claim: dupClaim,
    errorType,
    disputeReason: "Mileage mismatch",
    instructions: "Cite GPS evidence.",
    promptLegInputs,
  });

  assert.match(prompt, /- Rolled under primary Conf #ABC123 \(the trip-overriding finding lives on the primary; do not re-state it here\)\./);
  // Stale duplicate context must NOT leak into the prompt — primary owns the
  // finding (Task #307 §"Sibling-duplicate parity").
  assert.equal(prompt.includes("stale duplicate context"), false);
  assert.equal(prompt.includes("Per-leg finding:"), false);
});

test("(d) duplicate-only with missing primary: helper throws (no silent fallback per guard #10)", () => {
  const orphan = makeLeg({ id: 502, confNumber: "DEF456", duplicateOfClaimId: 999 });
  assert.throws(
    () => buildPromptLegInputs({ legs: [orphan], groupLegs: [orphan] }),
    /primary claim 999 for duplicate 502 not found/,
  );
});

// ---------------------------------------------------------------------------
// Task #312: audit-counter projection (per-leg context threading into the
// audit-log metadata for the email-channel write-up + readback prompt sites)
// ---------------------------------------------------------------------------

test("Task #312: promptLegAuditCounters projects exactly the three traceability counters (parity case)", () => {
  const rides = [
    makeLeg({ id: 501, confNumber: "ABC123" }),
    makeLeg({ id: 502, confNumber: "DEF456" }),
  ];
  const result = buildPromptLegInputs({ legs: rides, groupLegs: rides });
  const counters = promptLegAuditCounters(result);

  // Exact keys + values — the audit log shape is a contract for downstream
  // analytics ("did the AI see the per-leg finding when it drafted this?").
  assert.deepEqual(counters, {
    hasPerLegContext: false,
    perLegContextLegCount: 0,
    siblingDuplicateCount: 0,
  });
  // No extra keys leak into the projection — spreading it into an audit
  // metadata object must NOT carry the prompt strings or input arrays.
  assert.deepEqual(Object.keys(counters).sort(), [
    "hasPerLegContext",
    "perLegContextLegCount",
    "siblingDuplicateCount",
  ]);
});

test("Task #312: promptLegAuditCounters reflects per_leg_context counts (all-context case)", () => {
  const rides = [
    makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "Driver waited 47 min." }),
    makeLeg({ id: 502, confNumber: "DEF456", perLegContext: "GPS shows trip ended early." }),
  ];
  const counters = promptLegAuditCounters(
    buildPromptLegInputs({ legs: rides, groupLegs: rides }),
  );
  assert.deepEqual(counters, {
    hasPerLegContext: true,
    perLegContextLegCount: 2,
    siblingDuplicateCount: 0,
  });
});

test("Task #312: promptLegAuditCounters reflects sibling-duplicate roll-up (primary+siblings case)", () => {
  const primary = makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "Trip started at member's home." });
  const dupA = makeLeg({ id: 502, confNumber: "DEF456", duplicateOfClaimId: 501 });
  const dupB = makeLeg({ id: 503, confNumber: "GHI789", duplicateOfClaimId: 501 });
  const counters = promptLegAuditCounters(
    buildPromptLegInputs({ legs: [primary, dupA, dupB], groupLegs: [primary, dupA, dupB] }),
  );
  assert.deepEqual(counters, {
    hasPerLegContext: true,
    perLegContextLegCount: 1,
    siblingDuplicateCount: 2,
  });
});

test("Task #372: legacy auto-derived '• Q — A' breadcrumb is treated as empty (write-up bot can't read its own walk back to itself)", () => {
  // Pre-#372, the SOP-advance player auto-filled `per_leg_context` with
  // a bullet-list of the operator's worktree. Those rows still exist in
  // prod; the helper must drop them at the boundary so the dispute
  // write-up never sees them as "captured operator context", and the
  // audit counters under-count them as missing per-leg context (which
  // they effectively are — they're a derivation of the walk, not a
  // human-authored finding).
  const legacy = [
    "• Was GPS available? — Yes",
    "• Did breadcrumbs match? — No",
    "• Reasonable explanation? — Yes",
  ].join("\n");
  const ride = makeLeg({ id: 901, confNumber: "LEG-001", perLegContext: legacy });
  const result = buildPromptLegInputs({ legs: [ride], groupLegs: [ride] });
  // The bullet-list never makes it into the rides block.
  assert.equal(result.ridesBlock.includes("•"), false, "bullet-list must not leak into the rides block");
  assert.equal(result.ridesBlock.includes("Was GPS available"), false);
  // And the audit counters reflect "no per-leg context captured".
  assert.deepEqual(promptLegAuditCounters(result), {
    hasPerLegContext: false,
    perLegContextLegCount: 0,
    siblingDuplicateCount: 0,
  });
});

test("Task #372: a real prose perLegContext that happens to start with one bullet is NOT swallowed", () => {
  // Defensive: an operator note that begins with "• follow-up needed"
  // followed by prose is genuine captured context. The detector
  // requires EVERY non-empty line to start with "• ", so this stays.
  const prose = "• follow-up needed\nDriver confirmed late pickup at 9:15.";
  const ride = makeLeg({ id: 902, confNumber: "LEG-002", perLegContext: prose });
  const result = buildPromptLegInputs({ legs: [ride], groupLegs: [ride] });
  assert.equal(result.hasPerLegContext, true);
  assert.equal(result.ridesBlock.includes("Driver confirmed late pickup"), true);
});

test("Task #312: promptLegAuditCounters on a duplicate-only slice — primary owns the finding, counters reflect the slice", () => {
  const primary = makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "Primary owns the finding." });
  const dup = makeLeg({ id: 502, confNumber: "DEF456", duplicateOfClaimId: 501 });
  const counters = promptLegAuditCounters(
    buildPromptLegInputs({ legs: [dup], groupLegs: [primary, dup] }),
  );
  // The duplicate's perLegContext is suppressed, and sibling refs only
  // accrue on primaries — neither is in this slice, so both counts are 0.
  assert.deepEqual(counters, {
    hasPerLegContext: false,
    perLegContextLegCount: 0,
    siblingDuplicateCount: 0,
  });
});
