// Smoke test for the admin "Test Decision Tree" dialog contents:
// SopAdvancePlayer in preview mode renders a question + evidence row
// for a tree with evidence requirements. We render the dialog body
// shape (not the Radix Dialog) since static markup suffices.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SopAdvancePlayer } from "@/components/decision-tree/sop-advance-player";
import type { DecisionTree } from "@/components/decision-tree";

void React;

const adminTestTree: DecisionTree = {
  rootId: "root",
  nodes: [
    {
      id: "root",
      question: "Did dispatch confirm pickup?",
      helpText: "Open dispatch history first.",
      options: [
        { label: "Yes", outcomeType: "portal_dispute", outcomeLabel: "Portal" },
        { label: "No", outcomeType: "cannot_dispute", outcomeLabel: "Cannot dispute" },
      ],
      evidenceRequirements: [
        { key: "dispatch_screenshot", label: "Dispatch Screenshot", required: true, acceptsImage: true },
      ],
    },
  ],
};

function renderDialogContents(tree: DecisionTree): string {
  // This is the same JSX subtree the page renders inside its Dialog
  // body — see `pages/error-types.tsx`:
  //   <Dialog open={!!testTree}>
  //     <DialogContent>
  //       <DialogHeader><DialogTitle>Test Decision Tree</DialogTitle></DialogHeader>
  //       {testTree && <SopAdvancePlayer mode="preview" tree={testTree} />}
  //     </DialogContent>
  //   </Dialog>
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <SopAdvancePlayer mode="preview" tree={tree} />
    </QueryClientProvider>,
  );
}

test("Test Decision Tree dialog mounts the unified SopAdvancePlayer in preview mode", () => {
  const html = renderDialogContents(adminTestTree);
  // The unified player's outer container.
  assert.match(html, /data-testid="sop-advance-player"/);
  // Test-Mode badge proves preview mode is active (not live).
  assert.match(html, /data-testid="sop-preview-mode-badge"/);
});

test("Test Decision Tree dialog: tree with evidence renders an evidence-capable row (paste zone)", () => {
  const html = renderDialogContents(adminTestTree);
  // Question text from the tree is visible.
  assert.match(html, /Did dispatch confirm pickup\?/);
  // Evidence block + the specific evidence row mount.
  assert.match(html, /data-testid="sop-evidence-block"/);
  assert.match(html, /data-testid="sop-evidence-req-dispatch_screenshot"/);
  // The image-accepting row exposes the keyboard paste zone — this
  // is the affordance Task #415 originally regressed and the unified
  // primitive now guarantees.
  assert.match(html, /data-testid="sop-evidence-req-dispatch_screenshot-paste-zone"/);
  // The Upload button always renders (paste button is gated by
  // navigator.clipboard.read availability — covered by the
  // sop-advance-player tests).
  assert.match(html, /data-testid="sop-evidence-req-dispatch_screenshot-upload-btn"/);
});

test("Test Decision Tree dialog: option buttons render so the admin can advance the walk", () => {
  const html = renderDialogContents(adminTestTree);
  // Both option buttons render with their stable test-ids.
  assert.match(html, /data-testid="sop-option-0"/);
  assert.match(html, /data-testid="sop-option-1"/);
  // And neither the live PerLegContextEditor nor the include "Ready"
  // card appear — preview must not mount live terminal sub-screens.
  assert.equal(html.includes("per-leg-context-editor"), false);
  assert.equal(html.includes("sop-include-ready-card"), false);
});
