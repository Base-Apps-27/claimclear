// Cross-package vocabulary consistency: any package that ships its own
// inline label tables for canonical concepts must stay in sync with the
// glossary. The glossary doesn't import these packages directly (would
// invert the dependency graph), so we test the relationship from
// scripts where both sides are dependencies.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { CLOSURE_REASON_BANNER } from "@workspace/closure-options";
import { CLOSURE_REASON } from "@workspace/vocab";

test("closure-options banner labels match the glossary verbatim", () => {
  assert.equal(
    CLOSURE_REASON_BANNER.non_issue.label,
    CLOSURE_REASON.non_issue.label,
    "non_issue banner label drifted from @workspace/vocab",
  );
});

test("closure-options banner submitLabel uses the canonical Non-issue spelling", () => {
  assert.equal(
    CLOSURE_REASON_BANNER.non_issue.submitLabel,
    `Mark ${CLOSURE_REASON.non_issue.label}`,
    "non_issue submitLabel must read 'Mark Non-issue'",
  );
});
