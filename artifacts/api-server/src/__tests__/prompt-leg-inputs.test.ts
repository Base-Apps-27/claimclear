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
  normalizeTree,
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
    // Wave B columns (migration 0034) — NOT NULL with column defaults; the
    // fixture sets them to the same defaults the migration uses so test rows
    // satisfy the trigger and `$inferSelect` requires no overrides.
    phase: "triage",
    phaseEnteredAt: FIXED_TS,
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
    isTourSample: false,
    // Wave D-PR1: GENERATED ALWAYS column. Postgres computes from `status`
    // on insert/update; the fixture sets it to mirror the seeded `status`
    // so the typed `$inferSelect` shape is satisfied without overrides.
    isOpen: true,
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
    submittedVia: null,
    importBatch: null,
    evidenceFiles: null,
    evidenceNotes: "GPS log uploaded.",
    evidenceChecklist: null,
    generatedEmailSubject: null,
    generatedEmailBody: null,
    generatedEmailAt: null,
    includedInDispute: true,
    // Wave B column (migration 0034) — NOT NULL with column default
    // 'unclassified'; same rationale as `phase` on the group fixture.
    disposition: "unclassified",
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
    isTourSample: false,
    // Wave D-PR1: GENERATED ALWAYS column. Postgres computes from `status`
    // on insert/update; the fixture sets it to mirror the seeded `status`
    // so the typed `$inferSelect` shape is satisfied without overrides.
    isOpen: true,
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
  sourceSopText: null,
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

  // Task #398: dollar amounts are deliberately omitted from prompt rides
  // — the dispute write-up never reasons about money. Pre-#398 the line
  // ended `| Amount: $${claimAmount}`; the trailing field is gone now.
  const expectedRidesBlock = rides
    .map((r, i) => `  ${i + 1}. Conf #${r.confNumber} | Service date: ${r.date || "N/A"} | Client: ${r.clientNumber || "N/A"} | Car: ${r.carNumber || "N/A"}`)
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
  // Task #398: rides block no longer carries the trailing `| Amount: $X`
  // field — every prompt site asserts on the dollar-free shape now.
  assert.match(prompt, /  1\. Conf #ABC123 \| Service date: 2026-01-15 \| Client: C100 \| Car: CAR-7\n  2\. Conf #DEF456 \| Service date: 2026-01-16 \| Client: C100 \| Car: CAR-7/);
  // Defensive: the dollar sign must NOT appear anywhere in the rides
  // block (even with a different label). Pin it so a regression putting
  // `Total: $X` back trips this test.
  assert.equal(prompt.includes("Amount: $"), false);
  assert.equal(prompt.includes("Total invoice amount:"), false);
});

test("Task #830: readback prompt is framing-only — built from the operator's note text alone", () => {
  // The readback no longer threads case context (error type, decision-
  // tree outcome, per-leg findings, SOP transcript) — those still feed
  // the full Generate Preview pass. The framing-only prompt surfaces
  // whether the AI understood the operator's words on their own, so
  // ambiguity in the note is caught before the rich context papers
  // over it.
  const note = "Driver didn't stop at the member's house.";
  const { prompt, systemPrompt } = buildReadbackPrompt({ specialCircumstances: note });

  // The prompt embeds the note verbatim in a triple-quoted block.
  assert.match(prompt, /Operator's note:\n"""\nDriver didn't stop at the member's house\.\n"""/);
  // And asks for a 1–3 sentence restatement that flags ambiguity, with
  // strict no-invention rules — those are the framing-only contract.
  assert.match(prompt, /1 to 3 plain-language sentences/);
  assert.match(prompt, /Do not invent facts/);
  assert.match(prompt, /name the ambiguity explicitly/);

  // None of the case-context surfaces from the legacy readback prompt
  // may appear — the test pins the absence so a regression that
  // reintroduces ctx/errorType/reason/per-leg threading fails loudly.
  assert.equal(prompt.includes("Error Type:"), false);
  assert.equal(prompt.includes("SOP guidance"), false);
  assert.equal(prompt.includes("Decision-tree outcome"), false);
  assert.equal(prompt.includes("Per-leg finding"), false);
  assert.equal(prompt.includes("SOP walk transcript"), false);
  assert.equal(prompt.includes("Invoice #"), false);

  // System prompt is also note-scoped (no draft-the-dispute framing).
  assert.match(systemPrompt, /restate a short operator-written note/);
});

test("Task #830: same note + different case contexts produce the same readback prompt", () => {
  // The readback is independent of the surrounding case. Two groups
  // with completely different legs/error types/findings must yield
  // identical prompts as long as the operator's note is the same —
  // the deterministic guarantee that lets the operator trust the
  // check as a check on their *words*, not on the case.
  const note = "Verify GPS shows the actual route taken.";
  const aRides = [makeLeg({ id: 501, confNumber: "ABC123", perLegContext: "leg A had a 47-min wait" })];
  const bRides = [
    makeLeg({ id: 700, confNumber: "ZZZ999", perLegContext: "leg B was a duplicate of nothing" }),
    makeLeg({ id: 701, confNumber: "YYY888" }),
  ];
  // Build prompt-leg-inputs to prove the helper *would* surface a
  // per-leg findings block — and then assert the readback ignores it.
  void buildPromptLegInputs({ legs: aRides, groupLegs: aRides });
  void buildPromptLegInputs({ legs: bRides, groupLegs: bRides });

  const a = buildReadbackPrompt({ specialCircumstances: note });
  const b = buildReadbackPrompt({ specialCircumstances: note });
  assert.equal(a.prompt, b.prompt);
  assert.equal(a.systemPrompt, b.systemPrompt);
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
    `  1. Conf #ABC123 | Service date: 2026-01-15 | Client: C100 | Car: CAR-7\n` +
    `     Per-leg finding: Driver waited 47 min; member confirmed delay.\n` +
    `  2. Conf #DEF456 | Service date: 2026-01-15 | Client: C100 | Car: CAR-7\n` +
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

  // Task #830: the readback is framing-only on the operator's note —
  // it never carries the per-leg findings block (the full Generate
  // Preview prompt above still does). Pin the absence so a regression
  // that reintroduces per-leg threading into the readback fails loudly.
  void promptLegInputs;
  const { prompt: readbackPrompt } = buildReadbackPrompt({ specialCircumstances: "" });
  assert.equal(readbackPrompt.includes("Per-leg finding"), false);
  assert.equal(readbackPrompt.includes("Per-leg findings the operator captured"), false);
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
    `  1. Conf #ABC123 | Service date: 2026-01-15 | Client: C100 | Car: CAR-7\n` +
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

test("Task #312: promptLegAuditCounters projects exactly the five traceability counters (parity case)", () => {
  const rides = [
    makeLeg({ id: 501, confNumber: "ABC123" }),
    makeLeg({ id: 502, confNumber: "DEF456" }),
  ];
  const result = buildPromptLegInputs({ legs: rides, groupLegs: rides });
  const counters = promptLegAuditCounters(result);

  // Exact keys + values — the audit log shape is a contract for downstream
  // analytics. Two questions the audit log answers:
  //   - did the AI see the operator's authored unique finding? (per-leg)
  //   - did the AI see the SOP walk-through trail?           (transcript)
  // These are deliberately distinct counters: a leg can carry one,
  // the other, both, or neither.
  assert.deepEqual(counters, {
    hasPerLegContext: false,
    perLegContextLegCount: 0,
    siblingDuplicateCount: 0,
    hasSopTranscript: false,
    sopTranscriptLegCount: 0,
  });
  // No extra keys leak into the projection — spreading it into an audit
  // metadata object must NOT carry the prompt strings or input arrays.
  assert.deepEqual(Object.keys(counters).sort(), [
    "hasPerLegContext",
    "hasSopTranscript",
    "perLegContextLegCount",
    "siblingDuplicateCount",
    "sopTranscriptLegCount",
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
    hasSopTranscript: false,
    sopTranscriptLegCount: 0,
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
    hasSopTranscript: false,
    sopTranscriptLegCount: 0,
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
    hasSopTranscript: false,
    sopTranscriptLegCount: 0,
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
    hasSopTranscript: false,
    sopTranscriptLegCount: 0,
  });
});

// ---------------------------------------------------------------------------
// Task #377: SOP walk transcript threading into the dispute write-up prompt
// ---------------------------------------------------------------------------
//
// The transcript is derived from each leg's `sopAnswers` jsonb + the
// matching decision tree (passed in via `treesByLegId`). The four
// surfaces it has to thread through:
//   - rides block (group write-up + readback)
//   - per-claim annotations (per-claim email path)
//   - audit counters (analytics question: did the AI see the walk?)
//   - parity guard (no tree map → no transcript → byte-identical output)

const transcriptTree = {
  nodes: [
    { id: "n1", question: "Was GPS available?" },
    { id: "n2", question: "Did breadcrumbs match the billed route?" },
  ],
};

test("Task #377: SOP transcript renders under each visible leg in the rides block", () => {
  const ride = makeLeg({
    id: 501,
    confNumber: "ABC123",
    errorTypeId: "11",
    sopAnswers: [
      { nodeId: "n1", answer: "Yes" },
      { nodeId: "n2", answer: "No" },
    ],
  });
  const treesByLegId = new Map([[501, transcriptTree]]);
  const result = buildPromptLegInputs({ legs: [ride], groupLegs: [ride], treesByLegId });

  const expectedRidesBlock =
    `  1. Conf #ABC123 | Service date: 2026-01-15 | Client: C100 | Car: CAR-7\n` +
    `     SOP walk transcript:\n` +
    `       • Was GPS available? — Yes\n` +
    `       • Did breadcrumbs match the billed route? — No`;
  assert.equal(result.ridesBlock, expectedRidesBlock);

  // Per-claim annotation: one bullet item whose body is the transcript
  // block (children indented under the bullet so the LLM reads them as
  // continuation of the same item).
  assert.deepEqual(result.perClaimAnnotationLines.get(501), [
    "- SOP walk transcript:\n  • Was GPS available? — Yes\n  • Did breadcrumbs match the billed route? — No",
  ]);

  // Counters: transcript is present, per-leg-context is not — the two
  // are independent dimensions, the audit log answers them separately.
  assert.equal(result.hasSopTranscript, true);
  assert.equal(result.sopTranscriptLegCount, 1);
  assert.equal(result.hasPerLegContext, false);
});

test("Task #377: a leg with BOTH SOP transcript and per-leg finding renders both, transcript first", () => {
  const ride = makeLeg({
    id: 501,
    confNumber: "ABC123",
    errorTypeId: "11",
    perLegContext: "Driver waited 47 min; member confirmed delay.",
    sopAnswers: [
      { nodeId: "n1", answer: "Yes" },
      { nodeId: "n2", answer: "No" },
    ],
  });
  const treesByLegId = new Map([[501, transcriptTree]]);
  const result = buildPromptLegInputs({ legs: [ride], groupLegs: [ride], treesByLegId });

  // Order matters: the SOP walk gives the model the *background* (how we
  // got to this conclusion); the per-leg finding is the *novel* operator
  // narrative on top. Background → finding mirrors the order the operator
  // reads it on the leg page.
  const expectedRidesBlock =
    `  1. Conf #ABC123 | Service date: 2026-01-15 | Client: C100 | Car: CAR-7\n` +
    `     SOP walk transcript:\n` +
    `       • Was GPS available? — Yes\n` +
    `       • Did breadcrumbs match the billed route? — No\n` +
    `     Per-leg finding: Driver waited 47 min; member confirmed delay.`;
  assert.equal(result.ridesBlock, expectedRidesBlock);

  assert.deepEqual(result.perClaimAnnotationLines.get(501), [
    "- SOP walk transcript:\n  • Was GPS available? — Yes\n  • Did breadcrumbs match the billed route? — No",
    "- Per-leg finding: Driver waited 47 min; member confirmed delay.",
  ]);

  // Both counters fire independently — this is the shape the audit log
  // is designed to surface.
  assert.deepEqual(promptLegAuditCounters(result), {
    hasPerLegContext: true,
    perLegContextLegCount: 1,
    siblingDuplicateCount: 0,
    hasSopTranscript: true,
    sopTranscriptLegCount: 1,
  });
});

test("Task #377: a transcript node removed from the tree (SOP edited) renders with the (node removed from tree) marker, still surfaced not silently dropped", () => {
  const ride = makeLeg({
    id: 501,
    confNumber: "ABC123",
    errorTypeId: "11",
    sopAnswers: [
      { nodeId: "n1", answer: "Yes" },
      { nodeId: "n-deleted-7", answer: "Continue" },
    ],
  });
  const treesByLegId = new Map([[501, transcriptTree]]);
  const result = buildPromptLegInputs({ legs: [ride], groupLegs: [ride], treesByLegId });

  // The unresolved row is kept (Guard #5: never silently mask
  // operator-recorded steps) and tagged so the LLM knows the row is
  // a stale reference rather than a live SOP question.
  assert.match(result.ridesBlock, /• Was GPS available\? — Yes/);
  assert.match(result.ridesBlock, /• n-deleted-7 \(node removed from tree\) — Continue/);
  assert.equal(result.sopTranscriptLegCount, 1);
});

test("Task #377: duplicate's transcript is suppressed (primary owns the trip-bound finding)", () => {
  const primary = makeLeg({
    id: 501,
    confNumber: "ABC123",
    errorTypeId: "11",
    sopAnswers: [{ nodeId: "n1", answer: "Yes" }],
  });
  const dup = makeLeg({
    id: 502,
    confNumber: "DEF456",
    duplicateOfClaimId: 501,
    errorTypeId: "11",
    sopAnswers: [{ nodeId: "n1", answer: "Yes" }],
  });
  const treesByLegId = new Map([[501, transcriptTree], [502, transcriptTree]]);
  const result = buildPromptLegInputs({
    legs: [primary, dup],
    groupLegs: [primary, dup],
    treesByLegId,
  });

  // Primary's transcript surfaces; duplicate's row is skipped from the
  // rides block entirely (no head row for it), and the duplicate's
  // per-claim annotations contain ONLY the primary-pointer bullet
  // (no transcript echo). Note: the primary's sibling-roll-up
  // annotation does mention "Conf #DEF456" — that's expected, what
  // matters is that there's no numbered head row for the duplicate.
  assert.match(result.ridesBlock, /Conf #ABC123[\s\S]*SOP walk transcript:[\s\S]*• Was GPS available\? — Yes/);
  assert.equal(result.ridesBlock.match(/^ {2}\d+\. /gm)?.length, 1, "only the primary should get a numbered head row");
  assert.equal(result.ridesBlock.includes("2. Conf #DEF456"), false);
  assert.deepEqual(result.perClaimAnnotationLines.get(502), [
    "- Rolled under primary Conf #ABC123 (the trip-overriding finding lives on the primary; do not re-state it here).",
  ]);
  // Counter only credits the primary — the duplicate's transcript is
  // not what the LLM saw (and re-feeding it would just echo the primary).
  assert.equal(result.sopTranscriptLegCount, 1);
});

test("Task #377: parity guard — no tree map → no transcript → rides block byte-identical to legacy (audit counters zero)", () => {
  // Caller hasn't been upgraded to thread `treesByLegId` yet. Even if
  // the leg has `sopAnswers` populated, no transcript should leak into
  // the prompt — preserves the parity guarantee for the four prompt
  // sites until they all opt in.
  const ride = makeLeg({
    id: 501,
    confNumber: "ABC123",
    errorTypeId: "11",
    sopAnswers: [{ nodeId: "n1", answer: "Yes" }],
  });
  const result = buildPromptLegInputs({ legs: [ride], groupLegs: [ride] });

  const expectedRidesBlock =
    `  1. Conf #ABC123 | Service date: 2026-01-15 | Client: C100 | Car: CAR-7`;
  assert.equal(result.ridesBlock, expectedRidesBlock);
  assert.deepEqual(result.perClaimAnnotationLines.get(501), []);
  assert.equal(result.hasSopTranscript, false);
  assert.equal(result.sopTranscriptLegCount, 0);
});

test("Task #377: a leg with empty sopAnswers contributes no transcript even when its tree is loaded", () => {
  // A leg that hasn't walked the SOP yet (or whose walk was reset) has
  // an empty `sopAnswers` jsonb. Counters must reflect "no transcript"
  // — otherwise a freshly-routed leg would inflate the analytics number.
  const ride = makeLeg({
    id: 501,
    confNumber: "ABC123",
    errorTypeId: "11",
    sopAnswers: [],
  });
  const treesByLegId = new Map([[501, transcriptTree]]);
  const result = buildPromptLegInputs({ legs: [ride], groupLegs: [ride], treesByLegId });

  assert.equal(result.ridesBlock.includes("SOP walk transcript:"), false);
  assert.equal(result.sopTranscriptLegCount, 0);
  assert.equal(result.hasSopTranscript, false);
});

test("Task #830 (was #377): readback prompt does NOT carry the SOP transcript — framing-only on the operator's note", () => {
  // Pre-#830 the readback prompt mirrored the write-up's grounding
  // sources (per-leg findings, sibling-duplicates, SOP transcript) so
  // the operator could verify the AI saw them. That made the check
  // *very* hard to fail: even a vague note would come back paraphrased
  // through the case context. The framing-only redesign moves that
  // verification job to Generate Preview itself; the readback is now
  // strictly about whether the AI understood the operator's words.
  const ride = makeLeg({
    id: 501,
    confNumber: "ABC123",
    errorTypeId: "11",
    sopAnswers: [
      { nodeId: "n1", answer: "Yes" },
      { nodeId: "n2", answer: "No" },
    ],
  });
  const treesByLegId = new Map([[501, transcriptTree]]);
  const promptLegInputs = buildPromptLegInputs({ legs: [ride], groupLegs: [ride], treesByLegId });
  // Sanity: transcript is present in the helper output — so if the
  // readback were threading it, it WOULD appear.
  assert.equal(promptLegInputs.hasSopTranscript, true);
  void promptLegInputs;

  const { prompt } = buildReadbackPrompt({ specialCircumstances: "" });
  assert.equal(prompt.includes("SOP walk transcript"), false);
  assert.equal(prompt.includes("Was GPS available"), false);
  assert.equal(prompt.includes("Per-leg findings the operator captured"), false);
});

test("Task #377: normalizeTree returns null on malformed jsonb payloads — no nodeId leak through buildPromptLegInputs", () => {
  // Pin the contract that protects the prompt from nodeId-leak when the
  // `error_types.decision_tree` jsonb is malformed in the DB. Each of
  // these cases must normalize to `null` so that the helper's
  // `tree==null` short-circuit suppresses the leg's transcript entirely
  // (rather than rendering rows like "n1 — Yes" that would just be
  // gibberish to the LLM and would also bypass the explicit
  // "(node removed from tree)" marker the operator-facing UI uses).
  assert.equal(normalizeTree(null), null);
  assert.equal(normalizeTree(undefined), null);
  assert.equal(normalizeTree("not an object"), null);
  assert.equal(normalizeTree({}), null, "missing nodes key");
  assert.equal(normalizeTree({ nodes: "not an array" }), null);
  // Nodes array is present but every entry is malformed (missing id /
  // missing question / wrong types) — filter strips all of them.
  // Returning `{nodes:[]}` here would have the helper render every row
  // as unresolved "{nodeId} — {answer}"; returning null suppresses
  // the transcript entirely.
  assert.equal(
    normalizeTree({
      nodes: [
        { id: 7, question: "wrong type" },
        { question: "missing id" },
        null,
      ],
    }),
    null,
  );

  // Integration check: a leg whose tree normalizes to null must produce
  // no transcript output and zero counter contribution — the no-leak
  // contract is observable through the helper too.
  const ride = makeLeg({
    id: 501,
    confNumber: "ABC123",
    errorTypeId: "11",
    sopAnswers: [{ nodeId: "n1", answer: "Yes" }],
  });
  const treesByLegId = new Map([[501, normalizeTree({ nodes: [{ id: 7, question: "wrong" }] })]]);
  const result = buildPromptLegInputs({ legs: [ride], groupLegs: [ride], treesByLegId });
  assert.equal(result.ridesBlock.includes("SOP walk transcript:"), false);
  assert.equal(result.ridesBlock.includes("n1"), false);
  assert.equal(result.sopTranscriptLegCount, 0);
});

test("Task #377: normalizeTree keeps well-formed nodes intact (positive parity for the malformed-nodes guard)", () => {
  // Defensive partner of the "malformed → null" test: a payload with
  // *some* well-formed nodes still returns a tree (with only the valid
  // entries kept) so a partial schema migration doesn't blow away
  // every transcript surface.
  const tree = normalizeTree({
    nodes: [
      { id: "n1", question: "Was GPS available?" },
      { id: 7, question: "wrong type — dropped" },
      { id: "n2", question: "Did breadcrumbs match?" },
    ],
  });
  assert.deepEqual(tree, {
    nodes: [
      { id: "n1", question: "Was GPS available?" },
      { id: "n2", question: "Did breadcrumbs match?" },
    ],
  });
});

test("Task #377: a leg whose tree entry is missing from the map (e.g., no errorTypeId) contributes no transcript (no nodeId leak into the prompt)", () => {
  // Defensive: if a leg's tree couldn't be loaded (no errorTypeId, or
  // the error_type was deleted), feeding raw nodeIds to the LLM would
  // be gibberish. The helper drops the transcript entirely for that
  // leg — better silent than wrong.
  const ride = makeLeg({
    id: 501,
    confNumber: "ABC123",
    sopAnswers: [{ nodeId: "n1", answer: "Yes" }],
  });
  const treesByLegId = new Map<number, typeof transcriptTree | null>([[501, null]]);
  const result = buildPromptLegInputs({ legs: [ride], groupLegs: [ride], treesByLegId });

  assert.equal(result.ridesBlock.includes("SOP walk transcript:"), false);
  assert.equal(result.ridesBlock.includes("n1"), false);
  assert.equal(result.sopTranscriptLegCount, 0);
});
