// Task #372 — Include terminal renders the AI-clarification gate at the
// end of the SOP walk. These tests pin:
//   - the "Ready" label + optional per-leg context input render
//   - the "Check with AI" button is the entry point (no auto-save on blur)
//   - the channel hint reflects errorType.useDirectEmail (Guard #2)
//   - the legacy portal_dispute outcome routes here (regression guard)
//   - missing/null errorType → "Channel: not configured" (Guard #9)
//   - migration: a legacy "• Q — A" perLegContext is treated as empty
//     (the SOP transcript card surfaces the legacy text on the leg page)
//   - non-legacy perLegContext renders as the saved-context summary
//   - hand-off button is initially disabled when no saved context
//     and no typed text — actually enabled, since empty + saved-blank
//     is a valid "nothing to add" hand-off (see helper test).

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

test("IncludeTerminal renders the Ready label + per-leg-context editor + Check-with-AI gate", () => {
  const html = render(
    <IncludeTerminal
      leg={{
        id: 1,
        sopOutcome: "dispute",
        sopNodeId: null,
        perLegContext: null,
      }}
      tree={tree}
      errorType={{ useDirectEmail: false }}
    />,
  );
  assert.match(html, /data-testid="sop-include-ready-label"[^>]*>[^<]*Ready/);
  assert.match(html, /data-testid="sop-include-context-editor"/);
  assert.match(html, /data-testid="sop-include-check-btn"/);
  assert.match(html, /data-testid="sop-include-handoff-btn"/);
  // The renderer HTML-encodes the apostrophe in "I'm" → &#x27;
  assert.match(html, /(I'm|I&#x27;m) done — hand off/);
});

test("IncludeTerminal: a legacy '• Q — A' perLegContext is treated as empty in the editor (Task #372 migration)", () => {
  const legacy = "• Was GPS available? — Yes\n• Did breadcrumbs match? — No";
  const html = render(
    <IncludeTerminal
      leg={{ id: 1, sopOutcome: "dispute", perLegContext: legacy }}
      tree={tree}
      errorType={{ useDirectEmail: false }}
    />,
  );
  // Legacy bullets must NOT be rendered in the saved-context summary
  // (the SOP transcript card on the leg page surfaces them instead).
  assert.equal(
    html.includes("Was GPS available"),
    false,
    "legacy bullet text leaked into the editor",
  );
  assert.equal(
    html.includes("data-testid=\"sop-include-saved-context\""),
    false,
    "saved-context summary rendered for a legacy-only value",
  );
});

test("IncludeTerminal: a non-legacy perLegContext renders as the saved-context summary", () => {
  const html = render(
    <IncludeTerminal
      leg={{
        id: 1,
        sopOutcome: "dispute",
        perLegContext: "Driver waited 47 minutes; member confirmed delay.",
      }}
      tree={tree}
      errorType={{ useDirectEmail: false }}
    />,
  );
  assert.match(html, /data-testid="sop-include-saved-context"/);
  assert.match(html, /Driver waited 47 minutes/);
});

test("IncludeTerminal: saved-context summary exposes the explicit 'Clear saved' button (review-fix: optional-field semantics)", () => {
  // Optional-field contract: the operator must have a way to ERASE
  // prior saved context without typing+accepting empty replacement
  // text. The button POSTs an empty string to /per-leg-context.
  const html = render(
    <IncludeTerminal
      leg={{
        id: 1,
        sopOutcome: "dispute",
        perLegContext: "Driver waited 47 minutes; member confirmed delay.",
      }}
      tree={tree}
      errorType={{ useDirectEmail: false }}
    />,
  );
  assert.match(html, /data-testid="sop-include-clear-saved-btn"/);
  assert.match(html, /Clear saved/);
});

test("IncludeTerminal: no saved context → NO 'Clear saved' button (avoid noisy affordance)", () => {
  const html = render(
    <IncludeTerminal
      leg={{ id: 1, sopOutcome: "dispute", perLegContext: null }}
      tree={tree}
      errorType={{ useDirectEmail: false }}
    />,
  );
  assert.equal(
    html.includes("sop-include-clear-saved-btn"),
    false,
    "Clear-saved button rendered when there is nothing to clear",
  );
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
  // Central guarantee of the Task #308 redesign carried into #372: the
  // old `portal_dispute` enum value MUST still land on the include
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
