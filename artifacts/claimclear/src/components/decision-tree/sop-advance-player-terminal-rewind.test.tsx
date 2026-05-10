// Task #684 (R2 + R5 polish) — terminal-screen per-step rewind test.
//
// Mounts SopAdvancePlayer in LIVE mode against a leg that has reached
// a closed terminal verdict (`cannot_dispute`) with three recorded
// answers. Asserts that:
//
//   1. The R2 ClosedTerminalRewindCard renders with the verb hierarchy
//      (Change my answer primary, Restart walk secondary, Reclassify
//      footnote, "both keep the classification" helper).
//   2. Each Walked-answers row exposes a `sop-terminal-rewind-to-{nodeId}`
//      button per R5 — clicking one calls `openRewindDialog("jump", nodeId)`
//      which mounts the RewindConfirmDialog with the right `nodeId`
//      sent to the impact-preview endpoint.
//
// The existing rewind plumbing tests (sop-advance-player-rewind.test.tsx)
// already cover the breadcrumb-chip path + the 409→heavy escalation;
// this test pins the missing terminal-card surface.

import "./terminals/_setup-jsdom.ts";

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
}
const fetchCalls: FetchCall[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

(globalThis as { fetch: typeof fetch }).fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const url = typeof input === "string" ? input : input.toString();
  const method = (init?.method ?? "GET").toUpperCase();
  const body =
    typeof init?.body === "string" ? (init.body as string) : null;
  fetchCalls.push({ url, method, body });

  if (url.includes("/evidence") && method === "GET") {
    return jsonResponse({ evidence: [] });
  }
  if (url.includes("/sop-rewind-impact") && method === "GET") {
    return jsonResponse({
      action: "jump",
      answersToPop: 2,
      nextSopNodeId: "q2",
      currentSopOutcome: "cannot_dispute",
      clearsTerminal: true,
      evidenceWillBeCleared: 0,
      draftWillBeDiscarded: false,
      previewGeneratedAt: null,
      draftReviewedAt: null,
    });
  }
  return jsonResponse({});
}) as typeof fetch;

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
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
        { label: "Yes", childId: "q2" },
        { label: "No", outcomeType: "hold", outcomeLabel: "Hold" },
      ],
    },
    {
      id: "q2",
      question: "Did pickup match?",
      options: [
        { label: "Match", childId: "q3" },
        { label: "Mismatch", outcomeType: "internal", outcomeLabel: "Internal" },
      ],
    },
    {
      id: "q3",
      question: "Was POD signed?",
      options: [
        { label: "Yes", outcomeType: "portal_dispute", outcomeLabel: "Portal dispute" },
        { label: "No", outcomeType: "cannot_dispute", outcomeLabel: "Cannot dispute" },
      ],
    },
  ],
};

function mountTerminal() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SopAdvancePlayer
        mode="live"
        tree={tree}
        leg={{
          id: 77,
          sopOutcome: "cannot_dispute",
          sopNodeId: "q3",
          dropReason: null,
          duplicateOfClaimId: null,
          invoiceGroupId: null,
          perLegContext: null,
          sopAnswers: [
            { nodeId: "q1", answer: "Yes", ts: "2026-05-01T00:00:00Z" },
            { nodeId: "q2", answer: "Match", ts: "2026-05-01T00:01:00Z" },
            { nodeId: "q3", answer: "No", ts: "2026-05-01T00:02:00Z" },
          ],
          confNumber: "CLM-77",
        }}
      />
    </QueryClientProvider>,
  );
}

test("R2 closed-terminal card: verb hierarchy is Change-answer primary, Restart secondary, Reclassify footnote, with the 'both keep the classification' helper", (t) => {
  fetchCalls.length = 0;
  t.after(() => {
    cleanup();
    fetchCalls.length = 0;
  });

  mountTerminal();

  // Verb hierarchy ── all three CTAs render with the expected testids.
  assert.ok(
    screen.queryByTestId("sop-terminal-change-answer"),
    "Change my answer (primary) must render in the closed terminal",
  );
  assert.ok(
    screen.queryByTestId("sop-terminal-restart"),
    "Restart walk (secondary) must render in the closed terminal",
  );
  assert.ok(
    screen.queryByTestId("sop-terminal-reclassify-footnote"),
    "Reclassify must be demoted to a footnote, not a primary CTA",
  );

  // The R2 helper line — pinned by testid so a copy-tweak doesn't
  // silently strip it.
  const helper = screen.queryByTestId("sop-terminal-verb-helper");
  assert.ok(helper, "'both keep the classification' helper must render");
  assert.match(
    helper!.textContent ?? "",
    /both keep the classification/i,
  );

  // The legacy `sop-action-strip` (used during mid-walk only) must NOT
  // render at the terminal — verbs live in the verdict card now.
  assert.equal(
    screen.queryByTestId("sop-action-strip"),
    null,
    "mid-walk action strip must NOT mount at the closed terminal",
  );
});

test("R5 per-step rewind: each Walked-answer row exposes a Rewind-to-here button that opens the rewind dialog with the matching nodeId", async (t) => {
  fetchCalls.length = 0;
  t.after(() => {
    cleanup();
    fetchCalls.length = 0;
  });

  mountTerminal();

  // One per-step rewind button per recorded answer.
  for (const nodeId of ["q1", "q2", "q3"]) {
    assert.ok(
      screen.queryByTestId(`sop-terminal-rewind-to-${nodeId}`),
      `per-step Rewind-to-here button must render for ${nodeId}`,
    );
  }

  // Click the q1 button → opens the rewind confirm dialog.
  fireEvent.click(screen.getByTestId("sop-terminal-rewind-to-q1"));

  await waitFor(() => {
    assert.ok(
      screen.queryByTestId("rewind-confirm-dialog"),
      "clicking a per-step button must mount the RewindConfirmDialog",
    );
  });

  // The dialog's lazy impact-preview GET must be called for action=jump
  // with nodeId=q1 (the SOLE source of truth that openRewindDialog was
  // called with the right nodeId).
  await waitFor(() => {
    const impactCall = fetchCalls.find(
      (c) =>
        c.url.includes("/sop-rewind-impact") &&
        c.method === "GET" &&
        c.url.includes("action=jump") &&
        c.url.includes("nodeId=q1"),
    );
    assert.ok(
      impactCall,
      "impact preview must fire with action=jump and nodeId=q1",
    );
  });

  // Cancel closes the dialog without firing any rewind mutation.
  fireEvent.click(screen.getByTestId("rewind-confirm-cancel"));
  await waitFor(() => {
    assert.equal(screen.queryByTestId("rewind-confirm-dialog"), null);
  });
  assert.equal(
    fetchCalls.find((c) => c.url.includes("/sop-jump") && c.method === "POST"),
    undefined,
    "Cancel must NOT fire any rewind mutation",
  );
});
