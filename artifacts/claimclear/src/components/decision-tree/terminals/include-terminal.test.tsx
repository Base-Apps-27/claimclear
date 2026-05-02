// Include terminal renders for legs whose outcomeRole collapses to the
// "include" bucket. Two outcomes funnel here through outcomeRole: the
// legacy `portal_dispute` AND the new `dispute`. These tests pin:
//   - the "Ready" label + per-leg-context editor render
//   - the channel hint reflects errorType.useDirectEmail (Guard #2)
//   - the legacy portal_dispute outcome routes here (regression guard)
//   - missing/null errorType → "Channel: not configured" (Guard #9)

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IncludeTerminal } from "./include-terminal";
import { terminalKindForLeg } from "@/lib/sop-terminal-routing";

void React;

const tree = { rootId: "n1", nodes: [{ id: "n1", question: "?", options: [] }] } as never;

function render(node: React.ReactElement): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  );
}

test("IncludeTerminal renders the Ready label + per-leg-context editor", () => {
  const html = render(
    <IncludeTerminal
      leg={{
        id: 1,
        sopOutcome: "dispute",
        sopNodeId: null,
        perLegContext: "• step — yes",
      }}
      tree={tree}
      errorType={{ useDirectEmail: false }}
    />,
  );
  assert.match(html, /data-testid="sop-include-ready-label"[^>]*>[^<]*Ready/);
  assert.match(html, /data-testid="sop-include-context-editor"/);
  assert.match(html, /data-testid="sop-include-handoff-btn"/);
  // The renderer HTML-encodes the apostrophe in "I'm" → &#x27;
  assert.match(html, /(I'm|I&#x27;m) done — hand off/);
});

test("IncludeTerminal channel hint: useDirectEmail=true → 'via email'", () => {
  const html = render(
    <IncludeTerminal
      leg={{ id: 1, sopOutcome: "dispute" }}
      tree={tree}
      errorType={{ useDirectEmail: true }}
    />,
  );
  assert.match(
    html,
    /data-testid="sop-include-channel-hint"[^>]*>[^<]*Channel: via email/i,
  );
});

test("IncludeTerminal channel hint: useDirectEmail=false → 'via portal'", () => {
  const html = render(
    <IncludeTerminal
      leg={{ id: 1, sopOutcome: "dispute" }}
      tree={tree}
      errorType={{ useDirectEmail: false }}
    />,
  );
  assert.match(
    html,
    /data-testid="sop-include-channel-hint"[^>]*>[^<]*Channel:[^<]*portal/i,
  );
});

test("IncludeTerminal channel hint: missing errorType → 'not configured' (Guard #9, NEVER silent portal default)", () => {
  const html = render(
    <IncludeTerminal
      leg={{ id: 1, sopOutcome: "dispute" }}
      tree={tree}
      errorType={null}
    />,
  );
  assert.match(
    html,
    /data-testid="sop-include-channel-hint"[^>]*>[^<]*not configured/i,
  );
});

test("IncludeTerminal legacy regression: a leg with sopOutcome='portal_dispute' STILL routes to include via outcomeRole", () => {
  // This is the central guarantee of the Task #308 redesign: the old
  // `portal_dispute` enum value MUST still land on the include
  // terminal even though we no longer reference it directly. If
  // outcomeRole/role-routing drift, this test catches it.
  assert.equal(
    terminalKindForLeg({ sopOutcome: "portal_dispute", duplicateOfClaimId: null }),
    "include",
  );
  const html = render(
    <IncludeTerminal
      leg={{ id: 1, sopOutcome: "portal_dispute" }}
      tree={tree}
      errorType={{ useDirectEmail: false }}
    />,
  );
  assert.match(html, /data-testid="sop-include-ready-label"/);
});

test("IncludeTerminal: disabledReason is surfaced as a muted footnote", () => {
  const html = render(
    <IncludeTerminal
      leg={{ id: 1, sopOutcome: "dispute" }}
      tree={tree}
      errorType={{ useDirectEmail: false }}
      disabledReason="Group is submitted — editor locked."
    />,
  );
  assert.match(html, /Group is submitted/);
});
