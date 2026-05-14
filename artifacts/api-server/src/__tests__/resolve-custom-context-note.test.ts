/**
 * Regression test for the "Custom context note" reaching the AI write-up.
 *
 * Background: the gauntlet UI's "Understanding notes" textarea persists
 * the operator's free-text note onto `invoice_groups.understandingReadback`,
 * and the live `/invoice-groups/:id/preview-generated` route forwards it
 * as `understandingReadback` to the draft generator. Pre-fix, the prompt
 * builder only consulted `specialCircumstances`, so the note was silently
 * dropped from the LLM input — breaking the textarea's visible promise
 * ("Included as additional context in the AI write-up").
 *
 * `resolveCustomContextNote` is the single source of truth for which of
 * the two carrier fields wins. These tests pin its contract so neither
 * carrier path can regress without tripping a red bar.
 *
 * Tests are pure (no DB, no LLM). The `pool` import is closed in `after`
 * because the route module transitively opens a Postgres pool at
 * module-load time.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";

import { pool } from "@workspace/db";
import {
  resolveCustomContextNote,
  buildPortalDescriptionPrompt,
} from "../routes/portal-submissions";
import { buildPromptLegInputs, type PromptLegRowInput } from "../lib/prompt-leg-inputs";

after(async () => {
  await pool.end().catch(() => undefined);
});

test("resolveCustomContextNote: empty when both inputs are missing/blank", () => {
  assert.equal(resolveCustomContextNote({}), "");
  assert.equal(resolveCustomContextNote({ specialCircumstances: null, understandingReadback: null }), "");
  assert.equal(resolveCustomContextNote({ specialCircumstances: "   ", understandingReadback: "" }), "");
});

test("resolveCustomContextNote: trims and returns specialCircumstances when present", () => {
  assert.equal(
    resolveCustomContextNote({ specialCircumstances: "  legacy note  " }),
    "legacy note",
  );
});

test("resolveCustomContextNote: falls back to understandingReadback when specialCircumstances is blank", () => {
  // This is the regression: the gauntlet "Generate preview" path forwards
  // the operator's note ONLY as understandingReadback. Without this
  // fallback the note never reaches the LLM.
  assert.equal(
    resolveCustomContextNote({ understandingReadback: "  context from gauntlet  " }),
    "context from gauntlet",
  );
  assert.equal(
    resolveCustomContextNote({ specialCircumstances: "", understandingReadback: "from gauntlet" }),
    "from gauntlet",
  );
});

test("resolveCustomContextNote: specialCircumstances wins when both non-empty (legacy callers are explicit)", () => {
  assert.equal(
    resolveCustomContextNote({
      specialCircumstances: "explicit legacy",
      understandingReadback: "from gauntlet",
    }),
    "explicit legacy",
  );
});

// ---------------------------------------------------------------------------
// End-to-end pin: the resolved note actually lands in the prompt's
// CRITICAL CONTEXT block. This is what the operator sees a regression of.
// ---------------------------------------------------------------------------

const baseSettings = {
  contactEmail: "ops@example.com",
  providerName: "Example Transport",
  contactPhone: "555-0100",
  defaultDisputeInstructions: "Be factual.",
  defaultGpsBreadcrumbs: "GPS evidence available on request.",
};

function makeLeg(id: number, confNumber: string): PromptLegRowInput {
  return {
    id,
    confNumber,
    date: "2026-01-15",
    clientNumber: "C100",
    carNumber: "CAR-7",
    claimAmount: "42.50",
    perLegContext: null,
    duplicateOfClaimId: null,
    sopOutcome: null,
  };
}

function makeCtx(rides: PromptLegRowInput[]) {
  // Minimal `GroupContext` shape — the prompt builder only reads a few
  // fields off `group` and treats `rides` as the leg list. Cast through
  // unknown to keep the fixture small without inventing every column.
  return {
    group: {
      id: 9001,
      invoiceNumber: "INV-2026-001",
      clientNumber: "C100",
      errorTypeName: "Trip Distance Mismatch",
      errorDetails: "Distance billed exceeds the contract distance.",
      evidenceNotes: null,
    },
    rides,
    primaryClaim: rides[0],
  } as unknown as Parameters<typeof buildPortalDescriptionPrompt>[0]["ctx"];
}

test("portal write-up prompt includes CRITICAL CONTEXT block when special circumstances are supplied", () => {
  const rides = [makeLeg(501, "ABC123")];
  const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides });
  const note = "Driver was rerouted by dispatch — mileage difference is intentional.";
  const { prompt } = buildPortalDescriptionPrompt({
    ctx: makeCtx(rides),
    errorType: null,
    disputeReason: "Mileage mismatch",
    settings: baseSettings,
    promptLegInputs,
    specialCircumstances: note,
  });

  assert.ok(
    prompt.includes("CRITICAL CONTEXT"),
    "expected CRITICAL CONTEXT header in prompt when a context note is supplied",
  );
  assert.ok(
    prompt.includes(note),
    "expected the operator's note to appear verbatim in the prompt",
  );
});

test("portal write-up prompt OMITS CRITICAL CONTEXT block when no note is supplied (parity)", () => {
  const rides = [makeLeg(501, "ABC123")];
  const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides });
  const { prompt } = buildPortalDescriptionPrompt({
    ctx: makeCtx(rides),
    errorType: null,
    disputeReason: "Mileage mismatch",
    settings: baseSettings,
    promptLegInputs,
    specialCircumstances: null,
  });

  assert.equal(
    prompt.includes("CRITICAL CONTEXT"),
    false,
    "CRITICAL CONTEXT block must not appear when no note is supplied",
  );
});
