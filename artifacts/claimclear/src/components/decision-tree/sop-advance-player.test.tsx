// SOP-advance player render + state tests. Static render via
// renderToStaticMarkup; the satisfaction predicate is exercised
// directly. Pure paste helpers are tested in `evidence-paste.test.ts`,
// and the interaction-driven preview walk lives in
// `sop-advance-player-preview-walk.test.tsx`.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SopAdvancePlayer,
  isReqSatisfied,
} from "./sop-advance-player";
import type { DecisionTree, EvidenceReq } from "./types";

void React;

function render(node: React.ReactElement): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  );
}

const richTree: DecisionTree = {
  rootId: "n1",
  nodes: [
    {
      id: "n1",
      question: "Was GPS available?",
      helpText: "Pull dispatch history first.",
      instructionText: "Open dispatch → Job filter → All Comments.",
      instructionImageUrl: "/objects/uploads/example.png",
      instructionLinkUrl: "https://example.com/sop",
      instructionLinkLabel: "Open SOP doc",
      options: [
        { label: "Yes, GPS available", childId: "n2" },
        { label: "No GPS data", outcomeType: "hold", outcomeLabel: "Place on hold" },
      ],
      evidenceRequirements: [
        { key: "gps_screenshot", label: "GPS Screenshot", required: true, acceptsImage: true },
        { key: "explanation", label: "Explanation", required: true, acceptsText: true },
      ],
    },
    { id: "n2", question: "Step 2?", options: [] },
  ],
};

test("SopAdvancePlayer renders helpText, instructionText, instructionImage, instructionLink, evidence block", () => {
  const html = render(
    <SopAdvancePlayer
      leg={{ id: 1, sopOutcome: null, sopNodeId: null, sopAnswers: [], invoiceGroupId: 9, duplicateOfClaimId: null, dropReason: null, perLegContext: null }}
      tree={richTree}
    />,
  );
  // Question + help
  assert.match(html, /Was GPS available\?/);
  assert.match(html, /Pull dispatch history first\./);
  // Instruction block
  assert.match(html, /data-testid="sop-instruction-block"/);
  assert.match(html, /Open dispatch/);
  assert.match(html, /\/api\/storage\/objects\/uploads\/example\.png/);
  assert.match(html, /href="https:\/\/example\.com\/sop"/);
  assert.match(html, /Open SOP doc/);
  // Evidence block + required badges
  assert.match(html, /data-testid="sop-evidence-block"/);
  assert.match(html, /data-testid="sop-evidence-req-gps_screenshot"/);
  assert.match(html, /data-testid="sop-evidence-req-explanation"/);
  // The blocked hint should render because required items aren't satisfied
  assert.match(html, /data-testid="sop-evidence-blocked"/);
});

test("SopAdvancePlayer: there is NO 'acknowledged' checkbox in the evidence row", () => {
  const html = render(
    <SopAdvancePlayer
      leg={{ id: 1, sopOutcome: null, sopNodeId: null, sopAnswers: [], invoiceGroupId: 9, duplicateOfClaimId: null, dropReason: null, perLegContext: null }}
      tree={richTree}
    />,
  );
  // The pre-#372 player had a checkbox that satisfied the requirement
  // on its own. The new contract requires real content; if a checkbox
  // input slips back into the evidence rows this test catches it.
  assert.equal(
    html.includes('type="checkbox"'),
    false,
    "evidence rows should not render any checkbox inputs",
  );
});

const reqImageRequired: EvidenceReq = {
  key: "k", label: "GPS", required: true, acceptsImage: true,
};
const reqTextRequired: EvidenceReq = {
  key: "k", label: "Notes", required: true, acceptsText: true,
};
const reqOptional: EvidenceReq = {
  key: "k", label: "Optional", required: false, acceptsImage: true,
};

test("isReqSatisfied: optional requirements are always satisfied", () => {
  assert.equal(
    isReqSatisfied({ req: reqOptional, pending: { items: [], notes: "" }, persistedItems: [] }),
    true,
  );
});

test("isReqSatisfied: required image — empty pending + empty persisted → NOT satisfied", () => {
  assert.equal(
    isReqSatisfied({ req: reqImageRequired, pending: { items: [], notes: "" }, persistedItems: [] }),
    false,
  );
});

test("isReqSatisfied: required image — pending item with imageUrl → satisfied", () => {
  assert.equal(
    isReqSatisfied({
      req: reqImageRequired,
      pending: { items: [{ id: "1", imageUrl: "/objects/x.png" }], notes: "" },
      persistedItems: [],
    }),
    true,
  );
});

test("isReqSatisfied: required image — pending item still UPLOADING (no imageUrl yet) → NOT satisfied", () => {
  // Guard against the race where the operator clicks Continue while
  // the upload hasn't returned an objectPath yet. The gate must trip
  // false until the image URL lands.
  assert.equal(
    isReqSatisfied({
      req: reqImageRequired,
      pending: { items: [{ id: "1", uploading: true }], notes: "" },
      persistedItems: [],
    }),
    false,
  );
});

test("isReqSatisfied: required image — persisted evidence with imageUrl → satisfied (restored from server)", () => {
  assert.equal(
    isReqSatisfied({
      req: reqImageRequired,
      pending: { items: [], notes: "" },
      persistedItems: [{
        id: 1, claimId: 1, evidenceTypeName: "k", imageUrl: "/objects/y.png",
        treeNodeId: "n1", collectedAt: "2026-01-01T00:00:00Z", evidenceTypeId: null, notes: null, collectedBy: null,
      } as never],
    }),
    true,
  );
});

test("isReqSatisfied: required text — empty notes + no persisted note → NOT satisfied", () => {
  assert.equal(
    isReqSatisfied({ req: reqTextRequired, pending: { items: [], notes: "" }, persistedItems: [] }),
    false,
  );
});

test("isReqSatisfied: required text — whitespace-only notes do not satisfy", () => {
  assert.equal(
    isReqSatisfied({ req: reqTextRequired, pending: { items: [], notes: "   \n   " }, persistedItems: [] }),
    false,
  );
});

test("isReqSatisfied: required text — non-empty pending notes → satisfied", () => {
  assert.equal(
    isReqSatisfied({ req: reqTextRequired, pending: { items: [], notes: "Driver verified pickup" }, persistedItems: [] }),
    true,
  );
});

test("isReqSatisfied: required text — persisted note → satisfied", () => {
  assert.equal(
    isReqSatisfied({
      req: reqTextRequired,
      pending: { items: [], notes: "" },
      persistedItems: [{
        id: 1, claimId: 1, evidenceTypeName: "k", notes: "Saved note",
        treeNodeId: "n1", collectedAt: "2026-01-01T00:00:00Z", evidenceTypeId: null, imageUrl: null, collectedBy: null,
      } as never],
    }),
    true,
  );
});

// EvidenceReqRow render contract — pin every test-id the row exposes so
// future edits to either consumer of `EvidencePasteUpload` (this row OR
// the instruction-image uploader in editor.tsx) can't silently drop a
// button. The primitive itself is the single source of truth; these
// tests verify the consumer mounts it.

test("SopAdvancePlayer: image-accepting evidence rows expose a clipboard paste zone", () => {
  const html = render(
    <SopAdvancePlayer
      leg={{ id: 1, sopOutcome: null, sopNodeId: null, sopAnswers: [], invoiceGroupId: 9, duplicateOfClaimId: null, dropReason: null, perLegContext: null }}
      tree={richTree}
    />,
  );
  // The image-accepting requirement (`gps_screenshot`) MUST mount a
  // paste zone so the operator can drop a screenshot directly.
  assert.match(html, /data-testid="sop-evidence-req-gps_screenshot-paste-zone"/);
});

test("SopAdvancePlayer: the redundant 'or paste a screenshot' italic hint is gone", () => {
  // The italic "or paste a screenshot" hint was removed once the
  // explicit Paste button was restored. If a future edit re-introduces
  // it the row will look noisy; this test pins the removal.
  const html = render(
    <SopAdvancePlayer
      leg={{ id: 1, sopOutcome: null, sopNodeId: null, sopAnswers: [], invoiceGroupId: 9, duplicateOfClaimId: null, dropReason: null, perLegContext: null }}
      tree={richTree}
    />,
  );
  assert.equal(
    html.includes("or paste a screenshot"),
    false,
    "the italic hint should be replaced by the explicit Paste button",
  );
});

function withNavigator<T>(value: unknown, fn: () => T): T {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
  try {
    return fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, "navigator", desc);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

test("Paste button: hidden when navigator.clipboard.read is not available (older-Safari fallback)", () => {
  const html = withNavigator({ userAgent: "test" }, () =>
    render(
      <SopAdvancePlayer
        leg={{ id: 1, sopOutcome: null, sopNodeId: null, sopAnswers: [], invoiceGroupId: 9, duplicateOfClaimId: null, dropReason: null, perLegContext: null }}
        tree={richTree}
      />,
    ),
  );
  assert.equal(
    html.includes("sop-evidence-req-gps_screenshot-paste-btn"),
    false,
    "Paste button must be hidden when navigator.clipboard.read isn't available",
  );
  // Upload still renders so users aren't stranded.
  assert.match(html, /data-testid="sop-evidence-req-gps_screenshot-upload-btn"/);
});

test("Paste button: rendered when navigator.clipboard.read is available", () => {
  const html = withNavigator(
    { clipboard: { read: async () => [] } },
    () =>
      render(
        <SopAdvancePlayer
          leg={{ id: 1, sopOutcome: null, sopNodeId: null, sopAnswers: [], invoiceGroupId: 9, duplicateOfClaimId: null, dropReason: null, perLegContext: null }}
          tree={richTree}
        />,
      ),
  );
  assert.match(html, /data-testid="sop-evidence-req-gps_screenshot-paste-btn"/);
  // The Ctrl/Cmd+V power-user hint moves into the button's tooltip
  // (HTML `title` attribute) instead of the noisy italic line.
  assert.match(html, /title="Paste from clipboard \(Ctrl\/Cmd\+V\)"/);
});

test("Paste button: disabled when the evidence row is disabled (gating parity with Upload)", () => {
  const html = withNavigator(
    { clipboard: { read: async () => [] } },
    () =>
      render(
        <SopAdvancePlayer
          leg={{ id: 1, sopOutcome: null, sopNodeId: null, sopAnswers: [], invoiceGroupId: 9, duplicateOfClaimId: null, dropReason: null, perLegContext: null }}
          tree={richTree}
          disabledReason="Locked by another user"
        />,
      ),
  );
  // Pull just the Paste button's tag and confirm `disabled` is on it.
  // Using a non-greedy match so we don't slurp downstream buttons.
  const m = html.match(
    /<button[^>]*data-testid="sop-evidence-req-gps_screenshot-paste-btn"[^>]*>/,
  );
  assert.ok(m, "expected to find the Paste button tag in the rendered HTML");
  assert.match(m![0], /\bdisabled\b/);
});

// Task #416 — Preview mode. The admin "Test Decision Tree" dialog
// renders SopAdvancePlayer with `mode="preview"`, replacing the
// previous standalone admin player. Preview mode must:
//   - render WITHOUT a `leg` prop (synthesizes a stub from local state),
//   - surface a Test-Mode badge so operators know nothing is being
//     written,
//   - NOT mount the live `PerLegContextEditor` (no leg.id to bind to).

const simpleTestTree: DecisionTree = {
  rootId: "q1",
  nodes: [
    {
      id: "q1",
      question: "Is the rider verified?",
      options: [
        { label: "Yes", childId: "q2" },
        { label: "No", outcomeType: "cannot_dispute", outcomeLabel: "Cannot dispute" },
      ],
    },
    {
      id: "q2",
      question: "Did pickup match?",
      options: [
        { label: "Match", outcomeType: "portal_dispute", outcomeLabel: "Portal" },
        { label: "Mismatch", outcomeType: "internal", outcomeLabel: "Internal" },
      ],
    },
  ],
};

test("SopAdvancePlayer: preview mode renders WITHOUT a leg prop and shows the Test-Mode badge", () => {
  const html = render(
    <SopAdvancePlayer mode="preview" tree={simpleTestTree} />,
  );
  // The Test-Mode badge anchors operator awareness.
  assert.match(html, /data-testid="sop-preview-mode-badge"/);
  assert.match(html, /Test Mode/);
  // The first question still renders just like live.
  assert.match(html, /Is the rider verified\?/);
  // Both options should render.
  assert.match(html, /data-testid="sop-option-0"/);
  assert.match(html, /data-testid="sop-option-1"/);
});

test("SopAdvancePlayer: preview mode does NOT render the live PerLegContextEditor (no leg.id to bind)", () => {
  const html = render(
    <SopAdvancePlayer mode="preview" tree={simpleTestTree} />,
  );
  // The PerLegContextEditor mounts under `data-testid="per-leg-context-editor"`
  // — preview mode must not render it.
  assert.equal(
    html.includes("per-leg-context-editor"),
    false,
    "PerLegContextEditor should not render in preview mode",
  );
  // And the include "Ready" card must not render either — preview
  // walks land at a simple inline outcome card instead.
  assert.equal(html.includes("sop-include-ready-card"), false);
});

test("SopAdvancePlayer: preview mode with `initialState` at a terminal renders the inline outcome card with Undo + Restart", () => {
  const html = render(
    <SopAdvancePlayer
      mode="preview"
      tree={simpleTestTree}
      initialState={{
        currentNodeId: "q2",
        answers: [
          { nodeId: "q1", answer: "Yes", ts: "2026-01-01T00:00:00Z" },
          { nodeId: "q2", answer: "Match", ts: "2026-01-01T00:01:00Z" },
        ],
        sopOutcome: "portal_dispute",
      }}
    />,
  );
  // The dedicated preview outcome card mounts.
  assert.match(html, /data-testid="sop-preview-outcome-card"/);
  assert.match(html, /data-testid="sop-preview-outcome-label"/);
  // Both Undo and Restart buttons render.
  assert.match(html, /data-testid="sop-preview-undo"/);
  assert.match(html, /data-testid="sop-preview-restart"/);
  // The breadcrumb of preview answers is visible.
  assert.match(html, /data-testid="sop-breadcrumb"/);
  // No live terminal screen renders (closed/hold/duplicate cards live
  // under `sop-terminal-card`).
  assert.equal(html.includes("sop-terminal-card"), false);
});

test("SopAdvancePlayer: preview mode performs ZERO network calls during render (no useListClaimEvidence, no uploads, no SOP-advance mutations)", () => {
  // Critical contract for the admin "Test Decision Tree" dialog:
  // walking a tree in preview must not touch the API. The hook
  // `useListClaimEvidence`, the upload mutation, and the
  // SOP-advance mutation are all gated on `isPreview === false`,
  // and synthesizePreviewLeg avoids needing a real leg id. If any
  // future edit accidentally re-enables one of those paths in
  // preview, this spy catches it.
  const originalFetch = (globalThis as { fetch?: typeof fetch }).fetch;
  const fetchCalls: Array<{ url: string }> = [];
  (globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push({ url: typeof input === "string" ? input : input.toString() });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    // Walk every reachable preview state for the rich tree (which
    // has evidence requirements — the live path would otherwise
    // call `useListClaimEvidence`):
    //   1) initial render (no answers)
    //   2) mid-walk (one answer)
    //   3) terminal (sopOutcome set)
    render(<SopAdvancePlayer mode="preview" tree={richTree} />);
    render(
      <SopAdvancePlayer
        mode="preview"
        tree={richTree}
        initialState={{
          currentNodeId: "n2",
          answers: [{ nodeId: "n1", answer: "Yes, GPS available", ts: "2026-01-01T00:00:00Z" }],
          sopOutcome: null,
        }}
      />,
    );
    render(
      <SopAdvancePlayer
        mode="preview"
        tree={richTree}
        initialState={{
          currentNodeId: "n1",
          answers: [{ nodeId: "n1", answer: "No GPS data", ts: "2026-01-01T00:00:00Z" }],
          sopOutcome: "hold",
        }}
      />,
    );
  } finally {
    if (originalFetch) (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    else delete (globalThis as { fetch?: typeof fetch }).fetch;
  }
  assert.deepEqual(
    fetchCalls,
    [],
    `preview mode must not perform any network requests; got: ${JSON.stringify(fetchCalls)}`,
  );
});

test("SopAdvancePlayer: preview mode mounts Undo + Restart on the question card too (not only at terminal)", () => {
  // After at least one answer the in-progress controls should be
  // active so an operator can rewind during the walk.
  const html = render(
    <SopAdvancePlayer
      mode="preview"
      tree={simpleTestTree}
      initialState={{
        currentNodeId: "q2",
        answers: [{ nodeId: "q1", answer: "Yes", ts: "2026-01-01T00:00:00Z" }],
        sopOutcome: null,
      }}
    />,
  );
  assert.match(html, /data-testid="sop-preview-undo"/);
  assert.match(html, /data-testid="sop-preview-restart"/);
  // We're still on the question card (not the outcome card).
  assert.equal(html.includes("sop-preview-outcome-card"), false);
  assert.match(html, /Did pickup match\?/);
});
