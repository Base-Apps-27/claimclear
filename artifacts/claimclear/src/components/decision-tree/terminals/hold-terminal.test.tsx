// Hold terminal — Guard #3 in the task spec: the rendered DOM here MUST
// stay byte-for-byte identical to the pre-refactor block. These tests
// pin the structural fragments (testids, label, breadcrumb-friendly
// classes) plus both branches: resume-available vs stale-tree.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HoldTerminal } from "./hold-terminal";

void React;

function render(node: React.ReactElement): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  );
}

const treeWithNode = {
  rootId: "n1",
  nodes: [
    { id: "n1", question: "Q1", options: [] },
    { id: "n2", question: "Q2", options: [] },
  ],
} as never;

test("HoldTerminal: resume-available branch renders the Resume CTA + guidance", () => {
  const html = render(
    <HoldTerminal
      leg={{
        id: 1,
        sopOutcome: "hold",
        sopNodeId: "n2",
        dropReason: null,
        invoiceGroupId: 10,
      }}
      tree={treeWithNode}
    />,
  );
  assert.match(html, /data-testid="sop-terminal-card"/);
  assert.match(html, /data-testid="sop-hold-guidance"/);
  assert.match(html, /data-testid="sop-hold-resume-btn"/);
  assert.match(html, /Resume — clear hold/);
  assert.match(html, /SOP outcome:/);
  assert.match(html, /<code class="font-mono">hold<\/code>/);
});

test("HoldTerminal: stale-tree branch renders the reclassify guidance instead of Resume", () => {
  const html = render(
    <HoldTerminal
      leg={{
        id: 1,
        sopOutcome: "hold",
        sopNodeId: "n_missing",
        dropReason: null,
        invoiceGroupId: 10,
      }}
      tree={treeWithNode}
    />,
  );
  assert.match(html, /data-testid="sop-hold-stale-guidance"/);
  assert.match(html, /SOP workflow was updated/);
  // Resume button must NOT render when the node id is no longer in tree.
  assert.equal(html.includes('data-testid="sop-hold-resume-btn"'), false);
});

test("HoldTerminal byte-equivalent snapshot guards: required structural fragments", () => {
  // Pre-refactor parity assertions — these substrings are the
  // contract. If any disappear, the operator-facing UI silently
  // drifted.
  const html = render(
    <HoldTerminal
      leg={{
        id: 1,
        sopOutcome: "hold",
        sopNodeId: "n2",
        dropReason: "operator_paused",
        invoiceGroupId: 10,
      }}
      tree={treeWithNode}
    />,
  );

  for (const fragment of [
    'data-testid="sop-terminal-card"',
    'class="p-4 text-center space-y-2"',
    "SOP outcome:",
    '<code class="font-mono">hold</code>',
    "drop reason:",
    '<code class="font-mono">operator_paused</code>',
    'data-testid="sop-hold-guidance"',
    "SOP walk paused at this step. Resume to continue from where you left off.",
    'data-testid="sop-hold-resume-btn"',
    "Resume — clear hold",
  ]) {
    assert.ok(
      html.includes(fragment),
      `byte-parity guard tripped — missing fragment: ${fragment}`,
    );
  }
});

test("HoldTerminal: disabledReason is rendered as a muted footnote", () => {
  const html = render(
    <HoldTerminal
      leg={{
        id: 1,
        sopOutcome: "hold",
        sopNodeId: "n2",
        dropReason: null,
        invoiceGroupId: 10,
      }}
      tree={treeWithNode}
      disabledReason="Group is submitted — hold cannot be cleared from here."
    />,
  );
  assert.match(html, /Group is submitted/);
});
