// Glossary completeness + invariant tests. These run in isolation
// (`pnpm --filter @workspace/vocab test`) and also gate the broader CI
// run so a missing entry is caught at the package boundary.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  GLOSSARY,
  CLAIM_STATUS,
  CLAIM_STATUSES,
  OUTCOME,
  OUTCOMES,
  LEG_SUB_STATUS,
  LEG_SUB_STATUSES,
  LEG_CONCLUSION,
  LEG_CONCLUSIONS,
  CLOSURE_REASON,
  CLOSURE_REASONS,
  HOLD_REASON,
  HOLD_REASONS,
  SUBMISSION_STAGE,
  SUBMISSION_STAGES,
  VERDICT_OUTCOME,
  VERDICT_OUTCOMES,
  outcomeLabel,
  legSubStatusLabel,
  legSubStatusDisplayLabel,
  legConclusionLabel,
  closureReasonLabel,
  closureReasonAuditLabel,
  entriesForDomain,
} from "../index";

// ─────────────────────────────────────────────────────────────────────
// Completeness — every enum value has exactly one glossary entry, and
// the entry's `enumValue` round-trips back to the same key.
// ─────────────────────────────────────────────────────────────────────

const checks: Array<[string, readonly string[], Record<string, { enumValue: string; label: string }>]> = [
  ["claim_status", CLAIM_STATUSES, CLAIM_STATUS],
  ["outcome", OUTCOMES, OUTCOME],
  ["leg_sub_status", LEG_SUB_STATUSES, LEG_SUB_STATUS],
  ["leg_conclusion", LEG_CONCLUSIONS, LEG_CONCLUSION],
  ["closure_reason", CLOSURE_REASONS, CLOSURE_REASON],
  ["hold_reason", HOLD_REASONS, HOLD_REASON],
  ["submission_stage", SUBMISSION_STAGES, SUBMISSION_STAGE],
  ["verdict_outcome", VERDICT_OUTCOMES, VERDICT_OUTCOME],
];

for (const [domain, enumValues, table] of checks) {
  test(`${domain}: every enum value has a glossary entry`, () => {
    for (const v of enumValues) {
      const entry = table[v];
      assert.ok(entry, `${domain}.${v} missing from glossary`);
      assert.equal(entry.enumValue, v, `${domain}.${v}.enumValue must round-trip`);
      assert.ok(entry.label.length > 0, `${domain}.${v}.label empty`);
      assert.ok(entry.description.length > 0, `${domain}.${v}.description empty`);
    }
  });

  test(`${domain}: glossary has no extra keys beyond the enum`, () => {
    const tableKeys = Object.keys(table).sort();
    const enumKeys = [...enumValues].sort();
    assert.deepEqual(tableKeys, enumKeys);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Non-Issue unification: enum stays "Non-Issue" but the rendered label
// must be the sentence-case form everywhere.
// ─────────────────────────────────────────────────────────────────────

test("Non-Issue enum is preserved while the label is sentence case", () => {
  const entry = OUTCOME["Non-Issue"];
  assert.equal(entry.enumValue, "Non-Issue", "DB / OpenAPI enum must stay TitleCase");
  assert.equal(entry.label, "Non-issue", "Rendered label must be sentence case");
});

test("outcomeLabel renders Non-Issue as Non-issue", () => {
  assert.equal(outcomeLabel("Non-Issue"), "Non-issue");
});

test("closure_reason.non_issue label is Non-issue", () => {
  assert.equal(closureReasonLabel("non_issue"), "Non-issue");
});

test("leg_conclusion.non_issue label is Non-issue", () => {
  assert.equal(legConclusionLabel("non_issue"), "Non-issue");
});

test("legSubStatusDisplayLabel resolves dropped against sopOutcome", () => {
  assert.equal(legSubStatusDisplayLabel("dropped", { sopOutcome: "non_issue" }), "Non-issue");
  assert.equal(legSubStatusDisplayLabel("dropped", { sopOutcome: "cannot_dispute" }), "Non-contestable");
  // Default for `dropped` (no sop hint) is now "Non-contestable" — Task #649
  // flipped the queue-row default to match the dominant SOP outcome.
  assert.equal(legSubStatusDisplayLabel("dropped"), "Non-contestable");
  assert.equal(legSubStatusDisplayLabel("excluded"), "Non-issue");
  assert.equal(legSubStatusLabel("ready"), "Ready");
});

test("closureReasonAuditLabel adds the qualifier expected by the audit log", () => {
  assert.equal(closureReasonAuditLabel("denied_by_payor"), "Denied by payor");
  assert.equal(closureReasonAuditLabel("cannot_dispute"), "Withdrawn — cannot dispute");
  assert.equal(closureReasonAuditLabel("non_issue"), "Resolved — non-issue at classification");
});

// ─────────────────────────────────────────────────────────────────────
// Cross-domain checks
// ─────────────────────────────────────────────────────────────────────

test("flat glossary keys are unique", () => {
  const seen = new Set<string>();
  for (const e of GLOSSARY) {
    assert.ok(!seen.has(e.key), `duplicate glossary key: ${e.key}`);
    seen.add(e.key);
  }
});

test("entriesForDomain returns only that domain", () => {
  const outcomes = entriesForDomain("outcome");
  assert.ok(outcomes.length === OUTCOMES.length);
  for (const e of outcomes) assert.equal(e.domain, "outcome");
});

// "Non-issue" word-collision invariant: every domain that owns the
// concept renders the same string. Catches future drift if someone
// re-spells one of them as "Non Issue" or "Non-Issue".
test("every Non-issue surface uses the same canonical label", () => {
  assert.equal(OUTCOME["Non-Issue"].label, "Non-issue");
  assert.equal(LEG_CONCLUSION.non_issue.label, "Non-issue");
  assert.equal(CLOSURE_REASON.non_issue.label, "Non-issue");
  assert.equal(LEG_SUB_STATUS.excluded.label, "Non-issue");
  // `LEG_SUB_STATUS.dropped` intentionally renders as "Non-contestable"
  // (Task #649). Use `legSubStatusDisplayLabel(sub, leg)` with the leg
  // row to reach the "Non-issue" form when warranted.
});

test("LEG_SUB_STATUS.dropped default label is Non-contestable", () => {
  assert.equal(LEG_SUB_STATUS.dropped.label, "Non-contestable");
});
