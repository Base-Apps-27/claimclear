// PerLegContextEditor — extracted from the retired Include terminal
// screen. These tests pin the rendering invariants and the pure-helper
// contracts (the AI-clarification gate state machine + the Check
// button's enable predicate). End-to-end save / readback flow is
// pinned by the api-server integration test
// `artifacts/api-server/src/__tests__/include-terminal-readback-cycle.test.ts`.
//
// What this test pins:
//   - The optional context input renders with its stable test-id.
//   - The Check-with-AI button is the entry point (no auto-save on blur).
//   - A legacy "• Q — A" perLegContext is treated as EMPTY (the SOP
//     transcript card on the leg page surfaces the legacy text).
//   - A non-legacy perLegContext renders as the saved-context summary
//     and exposes the explicit "Clear saved" button.
//   - When there is NO saved context, the Clear-saved button does not
//     render (avoid a noisy affordance).
//   - canRequestReadback / readbackStatusTestId pure helpers behave.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  PerLegContextEditor,
  canRequestReadback,
  readbackStatusTestId,
  type PerLegContextEditorMode,
} from "./per-leg-context-editor";

void React;

function render(node: React.ReactElement): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  );
}

test("PerLegContextEditor renders the optional context input + Check-with-AI gate", () => {
  const html = render(
    <PerLegContextEditor legId={1} perLegContext={null} />,
  );
  assert.match(html, /data-testid="per-leg-context-editor"/);
  assert.match(html, /data-testid="sop-include-context-editor"/);
  assert.match(html, /data-testid="sop-include-check-btn"/);
  // The retired hand-off button MUST NOT render.
  assert.equal(
    html.includes("sop-include-handoff-btn"),
    false,
    "retired hand-off button should not render in the new editor",
  );
});

test("PerLegContextEditor: a legacy '• Q — A' perLegContext is treated as empty (the SOP transcript card surfaces the legacy text)", () => {
  const legacy = "• Was GPS available? — Yes\n• Did breadcrumbs match? — No";
  const html = render(
    <PerLegContextEditor legId={1} perLegContext={legacy} />,
  );
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

test("PerLegContextEditor: a non-legacy perLegContext renders as the saved-context summary", () => {
  const html = render(
    <PerLegContextEditor
      legId={1}
      perLegContext="Driver waited 47 minutes; member confirmed delay."
    />,
  );
  assert.match(html, /data-testid="sop-include-saved-context"/);
  assert.match(html, /Driver waited 47 minutes/);
});

test("PerLegContextEditor: saved-context summary exposes the explicit 'Clear saved' button (optional-field semantics)", () => {
  const html = render(
    <PerLegContextEditor
      legId={1}
      perLegContext="Driver waited 47 minutes; member confirmed delay."
    />,
  );
  assert.match(html, /data-testid="sop-include-clear-saved-btn"/);
  assert.match(html, /Clear saved/);
});

test("PerLegContextEditor: no saved context → NO 'Clear saved' button", () => {
  const html = render(
    <PerLegContextEditor legId={1} perLegContext={null} />,
  );
  assert.equal(
    html.includes("sop-include-clear-saved-btn"),
    false,
    "Clear-saved button rendered when there is nothing to clear",
  );
});

test("PerLegContextEditor: disabledReason is surfaced as a muted footnote", () => {
  const html = render(
    <PerLegContextEditor
      legId={1}
      perLegContext={null}
      disabled
      disabledReason="Group is submitted — editor locked."
    />,
  );
  assert.match(html, /Group is submitted/);
});

// ---------------------------------------------------------------------------
// canRequestReadback — the "Check with AI" button is enabled only when
// there is non-empty raw text to send AND we are in edit mode (avoid
// duplicate POSTs while a readback / save / review pane is on screen).
// ---------------------------------------------------------------------------

test("canRequestReadback: empty raw → disabled", () => {
  assert.equal(canRequestReadback({ mode: "edit", raw: "" }), false);
  assert.equal(canRequestReadback({ mode: "edit", raw: "   \n   " }), false);
});

test("canRequestReadback: non-empty raw in edit mode → enabled", () => {
  assert.equal(canRequestReadback({ mode: "edit", raw: "x" }), true);
});

test("canRequestReadback: any non-edit mode → disabled (avoid duplicate POSTs)", () => {
  for (const mode of ["checking", "review", "saving"] as PerLegContextEditorMode[]) {
    assert.equal(canRequestReadback({ mode, raw: "x" }), false);
  }
});

// ---------------------------------------------------------------------------
// readbackStatusTestId — stable inline-status-indicator test-ids.
// ---------------------------------------------------------------------------

test("readbackStatusTestId: edit → null", () => {
  assert.equal(readbackStatusTestId("edit"), null);
});

test("readbackStatusTestId: checking/review/saving each produce a distinct testid", () => {
  assert.equal(readbackStatusTestId("checking"), "sop-include-readback-checking");
  assert.equal(readbackStatusTestId("review"), "sop-include-readback-review");
  assert.equal(readbackStatusTestId("saving"), "sop-include-readback-saving");
});
