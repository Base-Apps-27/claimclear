// Task #379 — UI-driven coverage of the Include-terminal AI clarification
// gate. Spins up jsdom + React Testing Library and exercises the actual
// IncludeTerminal component end-to-end:
//
//   type raw text → click "Check with AI" → review pane appears →
//   click "Accept clarified" → save fires → hand-off enabled →
//   edit text (diverges) → hand-off DISABLED → clear text → ENABLED
//
// What this test pins (the disabled-while-typed-text-differs invariant
// is the central guard of #372/#379 and is observed via the real
// `data-testid="sop-include-handoff-btn"` button's `disabled` attribute,
// not via a local copy of `canHandoff`):
//
//   - Hand-off button starts ENABLED (empty box + no saved context is
//     a legitimate "nothing to add" hand-off).
//   - Typing any non-empty raw text DISABLES hand-off.
//   - Mid-readback (`mode === "checking"`) DISABLES hand-off.
//   - Review pane is mounted while the AI restatement is on screen and
//     hand-off is still DISABLED.
//   - After Accept lands, hand-off ENABLES because the typed text
//     equals `lastSavedRaw`.
//   - Editing the text after Accept DISABLES hand-off again.
//   - Clearing the textarea ENABLES hand-off (the "nothing to add"
//     escape, even when there's saved server context — that's only
//     erased explicitly via "Clear saved").
//
// Backend assertions (audit-row write, endpoint contract, AI stub) are
// covered by the api-server integration test
// `artifacts/api-server/src/__tests__/include-terminal-readback-cycle.test.ts`.
// The two together — UI gate + backend audit — cover the full Task #379
// done criteria.

// ---------------------------------------------------------------------------
// jsdom globals — installed via `_setup-jsdom.ts`, which MUST be the first
// import in this file. ESM import statements are hoisted in DFS-pre-order,
// so importing the setup module before `@testing-library/*` guarantees
// `document.body` is on the global at the moment `screen` is captured.
// ---------------------------------------------------------------------------

import "./_setup-jsdom.ts";

// ---------------------------------------------------------------------------
// fetch stub — capture every POST so we can assert the wire calls fired
// in the right order with the right payloads. Returns canned api-server
// shapes for the two endpoints the IncludeTerminal hits.
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}
const fetchCalls: FetchCall[] = [];
const CANNED_READBACK =
  "Driver waited 47 minutes at pickup; member confirmed the delay by phone before the trip.";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    fetchCalls.push({ url, method, body });

    if (url.endsWith("/per-leg-context-readback") && method === "POST") {
      return jsonResponse(200, { readback: CANNED_READBACK });
    }
    if (url.endsWith("/per-leg-context") && method === "POST") {
      const ctx = (body as { context?: string } | null)?.context ?? "";
      return jsonResponse(200, {
        id: 1,
        perLegContext: ctx.length === 0 ? null : ctx,
      });
    }
    return jsonResponse(404, { error: `unstubbed ${method} ${url}` });
  },
});

// ---------------------------------------------------------------------------
// Imports — must come AFTER the jsdom + fetch setup above.
// ---------------------------------------------------------------------------

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  type RenderResult,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IncludeTerminal } from "./include-terminal";

void React;

const tree = { rootId: "n1", nodes: [{ id: "n1", question: "?", options: [] }] } as never;

function renderIncludeTerminal(opts?: {
  perLegContext?: string | null;
}): RenderResult {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <IncludeTerminal
        leg={{
          id: 99,
          sopOutcome: "dispute",
          sopNodeId: null,
          perLegContext: opts?.perLegContext ?? null,
        }}
        tree={tree}
        errorType={{ useDirectEmail: false }}
      />
    </QueryClientProvider>,
  );
}

function getHandoffBtn(): HTMLButtonElement {
  return screen.getByTestId("sop-include-handoff-btn") as HTMLButtonElement;
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByTestId("sop-include-context-editor") as HTMLTextAreaElement;
}

test("Include-terminal hand-off gate: typing → Check → Accept → save cycle through the real UI; hand-off button reflects canHandoff at every transition", async (t) => {
  fetchCalls.length = 0;
  t.after(() => {
    cleanup();
    fetchCalls.length = 0;
  });

  renderIncludeTerminal();

  // ─── Initial state: empty box, no saved context → hand-off ENABLED ───
  // (the "nothing leg-specific to add" path).
  assert.equal(
    getHandoffBtn().disabled,
    false,
    "hand-off should start enabled when both raw and saved are empty",
  );

  // ─── Step 1: operator types raw text → hand-off DISABLES ───
  // This is the central guard: typed text that hasn't been
  // Check + Accepted MUST block hand-off so the note can't be
  // silently dropped.
  const rawTyped = "driver waited like 47 min, member confirmed by phone before trip";
  fireEvent.change(getTextarea(), { target: { value: rawTyped } });
  await waitFor(() => {
    assert.equal(
      getHandoffBtn().disabled,
      true,
      "hand-off must disable as soon as raw !== lastSavedRaw",
    );
  });
  // The "blocked" hint paragraph also surfaces alongside the disabled
  // button so the operator knows WHY it's disabled.
  assert.ok(
    screen.queryByTestId("sop-include-handoff-blocked-hint"),
    "blocked-hint copy should render while typed text diverges from lastSavedRaw",
  );

  // ─── Step 2: click "Check with AI" → readback POST fires → review pane ───
  fireEvent.click(screen.getByTestId("sop-include-check-btn"));

  // Review pane appears with both the raw note and the AI restatement.
  await waitFor(() => {
    assert.ok(
      screen.queryByTestId("sop-include-readback-review"),
      "review pane should mount once readback resolves",
    );
  });
  assert.equal(
    screen.getByTestId("sop-include-readback-clarified").textContent,
    CANNED_READBACK,
    "AI restatement should render in the clarified pane",
  );
  // Mid-cycle the hand-off button is still DISABLED (mode !== 'edit').
  assert.equal(
    getHandoffBtn().disabled,
    true,
    "hand-off must stay disabled while review pane is mounted",
  );

  // Wire-call assertion: exactly one POST to /per-leg-context-readback
  // with the operator's raw text.
  const readbackCalls = fetchCalls.filter((c) =>
    c.url.endsWith("/per-leg-context-readback") && c.method === "POST",
  );
  assert.equal(readbackCalls.length, 1, "exactly one readback POST should have fired");
  assert.equal(
    (readbackCalls[0].body as { context?: string }).context,
    rawTyped,
    "readback POST should send the operator's raw text verbatim",
  );

  // ─── Step 3: click "Accept clarified" → save POST → hand-off ENABLES ───
  fireEvent.click(screen.getByTestId("sop-include-accept-btn"));

  // Wait for the save to land + the hand-off button to flip enabled.
  // Post-save, raw stays in the box and lastSavedRaw is updated to
  // match — so canHandoff returns true and the button enables.
  await waitFor(() => {
    assert.equal(
      getHandoffBtn().disabled,
      false,
      "hand-off must enable once raw === lastSavedRaw post-Accept",
    );
  });
  // Saved-context summary now renders with the clarified text.
  await waitFor(() => {
    assert.ok(
      screen.queryByTestId("sop-include-saved-context"),
      "saved-context summary should render after Accept",
    );
  });

  // Wire-call assertion: exactly one POST to /per-leg-context with the
  // CLARIFIED text (not the raw text — the gate's whole job is to
  // ensure the dispute write-up sees the cleaned restatement).
  const saveCalls = fetchCalls.filter((c) =>
    c.url.endsWith("/per-leg-context") && c.method === "POST",
  );
  assert.equal(saveCalls.length, 1, "exactly one save POST should have fired");
  assert.equal(
    (saveCalls[0].body as { context?: string }).context,
    CANNED_READBACK,
    "save POST should send the AI-clarified text, not the raw text",
  );

  // ─── Step 4: operator edits the text post-save → hand-off DISABLES ───
  fireEvent.change(getTextarea(), { target: { value: `${rawTyped} (now edited)` } });
  await waitFor(() => {
    assert.equal(
      getHandoffBtn().disabled,
      true,
      "hand-off must re-disable when typed text diverges from lastSavedRaw",
    );
  });

  // ─── Step 5: operator clears the textarea → hand-off ENABLES ───
  // The "nothing to add" escape: empty input is always handoff-eligible
  // even when there IS saved server context (operator uses the explicit
  // 'Clear saved' button to erase that). Pinned in the helper test
  // (`include-save-flow.test.ts`); pinned here through the real button.
  fireEvent.change(getTextarea(), { target: { value: "" } });
  await waitFor(() => {
    assert.equal(
      getHandoffBtn().disabled,
      false,
      "hand-off must enable when the textarea is cleared",
    );
  });
});
