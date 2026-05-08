// Task #526 — Player rewind UI smoke test.
//
// Mounts SopAdvancePlayer in LIVE mode against a leg that already has
// two answers recorded, then exercises the R1 / R5 paths:
//
//   1. Live breadcrumb chips render and are clickable.
//   2. Back action strip is enabled and fires `POST /sop-back-step`
//      with `discardDraft: false`.
//   3. Clicking a breadcrumb chip opens the rewind confirm dialog
//      (light variant when impact preview reports no draft).
//
// We stub the network layer so no real backend is needed.

import "./terminals/_setup-jsdom.ts";

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
}
const fetchCalls: FetchCall[] = [];

// Per-test config so a single test can flip the back-step endpoint to
// return a 409 (the "draft would be discarded" path) and the impact
// preview to advertise a draft.
const fetchCfg = {
  backStepStatus: 200,
  draftWillBeDiscarded: false,
};

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

  // Evidence list — return empty.
  if (url.includes("/evidence") && method === "GET") {
    return jsonResponse({ evidence: [] });
  }
  // Rewind impact preview — variant flips with `fetchCfg`.
  if (url.includes("/sop-rewind-impact") && method === "GET") {
    return jsonResponse({
      action: "back-step",
      answersToPop: 1,
      draftWillBeDiscarded: fetchCfg.draftWillBeDiscarded,
      currentSopOutcome: null,
      clearsTerminal: false,
      evidenceWillBeCleared: 0,
      previewGeneratedAt: fetchCfg.draftWillBeDiscarded
        ? "2026-05-01T00:00:00Z"
        : null,
      draftReviewedAt: null,
    });
  }
  // Back-step — status flips with `fetchCfg`.
  if (url.includes("/sop-back-step") && method === "POST") {
    return jsonResponse(
      fetchCfg.backStepStatus === 200
        ? { id: 42 }
        : { error: "draft_would_be_discarded" },
      fetchCfg.backStepStatus,
    );
  }
  // Catch-all OK.
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
        {
          label: "No",
          outcomeType: "hold",
          outcomeLabel: "Hold",
        },
      ],
    },
    {
      id: "q2",
      question: "Did pickup match?",
      options: [
        { label: "Match", childId: "q3" },
        {
          label: "Mismatch",
          outcomeType: "internal",
          outcomeLabel: "Internal",
        },
      ],
    },
    {
      id: "q3",
      question: "Was POD signed?",
      options: [
        {
          label: "Yes",
          outcomeType: "portal_dispute",
          outcomeLabel: "Portal dispute",
        },
        {
          label: "No",
          outcomeType: "cannot_dispute",
          outcomeLabel: "Cannot dispute",
        },
      ],
    },
  ],
};

function mountLive() {
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
          id: 42,
          sopOutcome: null,
          sopNodeId: "q3",
          dropReason: null,
          duplicateOfClaimId: null,
          invoiceGroupId: null,
          perLegContext: null,
          sopAnswers: [
            {
              nodeId: "q1",
              answer: "Yes",
              ts: "2026-05-01T00:00:00Z",
            },
            {
              nodeId: "q2",
              answer: "Match",
              ts: "2026-05-01T00:01:00Z",
            },
          ],
          confNumber: "CLM-42",
        }}
      />
    </QueryClientProvider>,
  );
}

function resetCfg() {
  fetchCalls.length = 0;
  fetchCfg.backStepStatus = 200;
  fetchCfg.draftWillBeDiscarded = false;
}

test("Live mode: clickable breadcrumb chips + Back action strip both render and are wired to the rewind endpoints", async (t) => {
  resetCfg();
  t.after(() => {
    cleanup();
    resetCfg();
  });

  mountLive();

  // (1) Live breadcrumb mounts (the read-only `sop-breadcrumb` does
  //     NOT — that one is preview-only).
  const liveBreadcrumb = screen.queryByTestId("sop-breadcrumb-live");
  assert.ok(
    liveBreadcrumb,
    "live (clickable) breadcrumb should render in live mode",
  );
  assert.equal(
    screen.queryByTestId("sop-breadcrumb"),
    null,
    "read-only breadcrumb must NOT mount in live mode",
  );

  // The two answered chips are present.
  assert.ok(screen.queryByTestId("sop-breadcrumb-chip-q1"));
  assert.ok(screen.queryByTestId("sop-breadcrumb-chip-q2"));

  // (2) Action strip mounts with both Back and Reclassify enabled.
  const backBtn = screen.getByTestId("sop-action-back") as HTMLButtonElement;
  const reclassifyBtn = screen.getByTestId(
    "sop-action-reclassify",
  ) as HTMLButtonElement;
  assert.equal(backBtn.disabled, false, "Back should be enabled with answers > 0");
  assert.equal(reclassifyBtn.disabled, false);

  // (3) Click Back → fires POST /sop-back-step with discardDraft:false.
  fireEvent.click(backBtn);

  await waitFor(() => {
    const hit = fetchCalls.find(
      (c) => c.url.includes("/sop-back-step") && c.method === "POST",
    );
    assert.ok(hit, "Back must call POST /sop-back-step");
    assert.match(
      hit!.body ?? "",
      /"discardDraft"\s*:\s*false/,
      "Back must send discardDraft:false on the happy path",
    );
  });

  // No rewind dialog should open on the happy path (server returned 200).
  await waitFor(() => {
    assert.equal(
      screen.queryByTestId("rewind-confirm-dialog"),
      null,
      "no dialog opens when back-step succeeds without a draft conflict",
    );
  });
});

test("Live mode: clicking an answered breadcrumb chip opens the rewind confirm dialog (light variant when no draft exists)", async (t) => {
  resetCfg();
  t.after(() => {
    cleanup();
    resetCfg();
  });

  mountLive();

  // Click the second breadcrumb chip → opens the rewind confirm dialog
  // with action="jump" and nodeId="q2".
  fireEvent.click(screen.getByTestId("sop-breadcrumb-chip-q2"));

  // Dialog mounts; it lazily fetches the impact preview.
  const dialog = await waitFor(() =>
    screen.getByTestId("rewind-confirm-dialog"),
  );
  assert.ok(dialog);

  // Once impact resolves, the light variant primary CTA should render
  // (the stub returns draftWillBeDiscarded:false).
  await waitFor(() => {
    assert.ok(
      screen.queryByTestId("rewind-confirm-light"),
      "light primary CTA should render when no draft exists",
    );
    assert.equal(
      screen.queryByTestId("rewind-confirm-heavy"),
      null,
      "heavy primary CTA must NOT render in the light variant",
    );
    assert.ok(
      screen.queryByTestId("rewind-confirm-light-note"),
      "light note explaining 'no draft' should render",
    );
  });

  // Cancel closes the dialog without firing any rewind mutation.
  fireEvent.click(screen.getByTestId("rewind-confirm-cancel"));
  await waitFor(() => {
    assert.equal(screen.queryByTestId("rewind-confirm-dialog"), null);
  });
  assert.equal(
    fetchCalls.find(
      (c) =>
        c.url.includes("/sop-jump") || c.url.includes("/sop-back-step"),
    ),
    undefined,
    "Cancel must NOT fire any rewind mutation",
  );
});

test("Live mode: Back → 409 'draft would be discarded' → heavy dialog → confirm fires back-step with discardDraft:true", async (t) => {
  resetCfg();
  // The first POST /sop-back-step should 409. The second one (after
  // the operator confirms in the heavy dialog) should succeed.
  fetchCfg.backStepStatus = 409;
  fetchCfg.draftWillBeDiscarded = true;
  t.after(() => {
    cleanup();
    resetCfg();
  });

  mountLive();

  // Click Back — first POST returns 409 → heavy dialog opens.
  fireEvent.click(screen.getByTestId("sop-action-back"));

  await waitFor(() => {
    const firstBack = fetchCalls.find(
      (c) => c.url.includes("/sop-back-step") && c.method === "POST",
    );
    assert.ok(firstBack, "Back must call POST /sop-back-step");
    assert.match(
      firstBack!.body ?? "",
      /"discardDraft"\s*:\s*false/,
      "Quick Back must send discardDraft:false on the first attempt",
    );
  });

  await waitFor(() => {
    assert.ok(
      screen.queryByTestId("rewind-confirm-dialog"),
      "rewind dialog must open after the 409",
    );
  });

  await waitFor(() => {
    assert.ok(
      screen.queryByTestId("rewind-confirm-heavy"),
      "heavy primary CTA must render when draftWillBeDiscarded:true",
    );
    assert.ok(
      screen.queryByTestId("rewind-confirm-discard-callout"),
      "amber discard callout must render in the heavy variant",
    );
  });

  // Flip the back-step endpoint to succeed for the confirm POST.
  fetchCfg.backStepStatus = 200;
  const beforeConfirm = fetchCalls.length;
  fireEvent.click(screen.getByTestId("rewind-confirm-heavy"));

  await waitFor(() => {
    const confirmCall = fetchCalls
      .slice(beforeConfirm)
      .find(
        (c) => c.url.includes("/sop-back-step") && c.method === "POST",
      );
    assert.ok(
      confirmCall,
      "heavy CTA must fire a second POST /sop-back-step",
    );
    assert.match(
      confirmCall!.body ?? "",
      /"discardDraft"\s*:\s*true/,
      "heavy CTA must send discardDraft:true",
    );
  });

  // Dialog closes after success.
  await waitFor(() => {
    assert.equal(screen.queryByTestId("rewind-confirm-dialog"), null);
  });
});
