// Interaction-driven preview-mode walk: boots SopAdvancePlayer under
// jsdom, clicks through to a terminal, and asserts ZERO fetch calls
// were made — the central guarantee of preview mode.

import "./terminals/_setup-jsdom.ts";

// fetch spy — installed BEFORE module imports.
interface FetchCall {
  url: string;
  method: string;
}
const fetchCalls: FetchCall[] = [];

(globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  fetchCalls.push({
    url: typeof input === "string" ? input : input.toString(),
    method: (init?.method ?? "GET").toUpperCase(),
  });
  return new Response("{}", {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

// Imports — must come AFTER the jsdom + fetch setup above.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  render,
  screen,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SopAdvancePlayer } from "./sop-advance-player";
import type { DecisionTree } from "./types";

void React;

const tree: DecisionTree = {
  rootId: "q1",
  nodes: [
    {
      id: "q1",
      question: "Was GPS available?",
      options: [
        { label: "Yes, GPS available", childId: "q2" },
        { label: "No GPS data", outcomeType: "hold", outcomeLabel: "Place on hold" },
      ],
    },
    {
      id: "q2",
      question: "Did pickup match?",
      options: [
        { label: "Match", outcomeType: "portal_dispute", outcomeLabel: "Portal dispute" },
        { label: "Mismatch", outcomeType: "internal", outcomeLabel: "Internal" },
      ],
    },
  ],
};

function mountPreview() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SopAdvancePlayer mode="preview" tree={tree} />
    </QueryClientProvider>,
  );
}

test("Preview walk: clicking options advances to the next question, then to the terminal outcome card — with ZERO network calls", (t) => {
  fetchCalls.length = 0;
  t.after(() => {
    cleanup();
    fetchCalls.length = 0;
  });

  mountPreview();

  // (1) First question is on screen, Test-Mode badge is visible.
  assert.ok(
    screen.queryByTestId("sop-preview-mode-badge"),
    "Test-Mode badge should mount in preview",
  );
  assert.match(
    screen.getByTestId("sop-advance-player").textContent ?? "",
    /Was GPS available\?/,
  );

  // (2) Click the first option → walks to q2.
  fireEvent.click(screen.getByTestId("sop-option-0"));

  assert.match(
    screen.getByTestId("sop-advance-player").textContent ?? "",
    /Did pickup match\?/,
    "after clicking option 0 the second question should render",
  );
  // Breadcrumb now shows the prior answer.
  assert.ok(
    screen.queryByTestId("sop-breadcrumb"),
    "breadcrumb should appear once at least one answer exists",
  );
  // Undo + Restart should both be enabled now (not a terminal yet).
  const undo = screen.getByTestId("sop-preview-undo") as HTMLButtonElement;
  const restart = screen.getByTestId("sop-preview-restart") as HTMLButtonElement;
  assert.equal(undo.disabled, false, "Undo should enable after the first click");
  assert.equal(restart.disabled, false, "Restart should enable after the first click");

  // (3) Click an option that lands on a terminal (Match → portal_dispute).
  fireEvent.click(screen.getByTestId("sop-option-0"));

  assert.ok(
    screen.queryByTestId("sop-preview-outcome-card"),
    "preview outcome card should mount after picking a terminal option",
  );
  // OUTCOME_LABELS maps `portal_dispute` to the include role label "Ready",
  // and PreviewOutcomeCard renders "Reached: <label>".
  assert.match(
    screen.getByTestId("sop-preview-outcome-label").textContent ?? "",
    /Reached:\s*Ready/,
  );
  // No live terminal sub-screen mounted.
  assert.equal(
    screen.queryByTestId("sop-terminal-card"),
    null,
    "live terminal card must NOT render in preview mode",
  );

  // (4) Undo from the terminal → returns to q2.
  fireEvent.click(screen.getByTestId("sop-preview-undo"));
  assert.equal(
    screen.queryByTestId("sop-preview-outcome-card"),
    null,
    "Undo from the terminal should clear the preview outcome card",
  );
  assert.match(
    screen.getByTestId("sop-advance-player").textContent ?? "",
    /Did pickup match\?/,
    "after Undo we're back on q2",
  );

  // (5) Restart → back to q1, controls disabled, no breadcrumb.
  fireEvent.click(screen.getByTestId("sop-preview-restart"));
  assert.match(
    screen.getByTestId("sop-advance-player").textContent ?? "",
    /Was GPS available\?/,
    "Restart should rewind to the root question",
  );
  assert.equal(
    screen.queryByTestId("sop-breadcrumb"),
    null,
    "breadcrumb should disappear after Restart wipes answers",
  );
  assert.equal(
    (screen.getByTestId("sop-preview-undo") as HTMLButtonElement).disabled,
    true,
    "Undo should re-disable after Restart",
  );

  // (6) The central contract: nothing went out over the wire.
  assert.deepEqual(
    fetchCalls,
    [],
    `preview walk must perform ZERO network requests; got: ${JSON.stringify(fetchCalls)}`,
  );
});
