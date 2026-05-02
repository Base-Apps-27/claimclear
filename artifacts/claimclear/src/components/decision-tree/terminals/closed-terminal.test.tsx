// Per-role render coverage for the closed-family terminals
// (cannot_dispute / non_issue / internal). The closed terminal collapses
// three sopOutcomes into one abridged card driven by `outcomeRole` →
// these tests pin (a) the right icon/label per outcome, (b) the
// "Reclassify if wrong" guidance always renders, and (c) the optional
// "Closure category" line surfaces dropReason when present.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { ClosedTerminal } from "./closed-terminal";

void React;

const tree = { rootId: "n1", nodes: [{ id: "n1", question: "?", options: [] }] } as never;

function render(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    <ClosedTerminal
      leg={{
        id: 1,
        sopOutcome: "cannot_dispute",
        sopNodeId: null,
        dropReason: null,
        ...overrides,
      }}
      tree={tree}
    />,
  );
}

test("ClosedTerminal renders the cannot_dispute label ('Non-contestable (Withdraw)')", () => {
  const html = render({ sopOutcome: "cannot_dispute" });
  assert.match(html, /Non-contestable \(Withdraw\)/);
  assert.match(html, /data-testid="sop-terminal-card"/);
});

test("ClosedTerminal renders the non_issue label ('Non-issue')", () => {
  const html = render({ sopOutcome: "non_issue" });
  assert.match(html, /Non-issue/);
});

test("ClosedTerminal renders the 'Resolve Internally' label for internal", () => {
  const html = render({ sopOutcome: "internal" });
  assert.match(html, /Resolve Internally/);
});

test("ClosedTerminal always renders the 'Reclassify if wrong' guidance", () => {
  for (const outcome of ["cannot_dispute", "non_issue", "internal"]) {
    const html = render({ sopOutcome: outcome });
    assert.match(
      html,
      /data-testid="sop-terminal-guidance"[^>]*>[^<]*Outcome set by SOP/,
      `guidance missing for ${outcome}`,
    );
  }
});

test("ClosedTerminal surfaces the closure category when dropReason is set", () => {
  const html = render({
    sopOutcome: "cannot_dispute",
    dropReason: "out_of_window",
  });
  assert.match(
    html,
    /data-testid="sop-terminal-closure-category"[^>]*>[\s\S]*Closure category[\s\S]*out_of_window/,
  );
});

test("ClosedTerminal omits the closure-category line when dropReason is null", () => {
  const html = render({ sopOutcome: "cannot_dispute", dropReason: null });
  assert.equal(
    html.includes('data-testid="sop-terminal-closure-category"'),
    false,
  );
});
