// Task #372 — SOP-advance player tests. The render layer is exercised
// via renderToStaticMarkup (no jsdom); the satisfaction predicate is
// exercised directly because it owns the central guarantee: required
// evidence is satisfied ONLY by a real attachment or non-empty text,
// never by an "acknowledged" checkbox short-circuit.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SopAdvancePlayer, isReqSatisfied, extractClipboardFiles } from "./sop-advance-player";
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

test("SopAdvancePlayer: there is NO 'acknowledged' checkbox in the evidence row (Task #372 false-satisfy removal)", () => {
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

// ---------------------------------------------------------------------------
// Paste-from-clipboard support — code review explicitly required this
// alongside the file-picker upload. The render layer mounts a
// `paste-zone` testid on each image-accepting evidence row, and the
// pure helper `extractClipboardFiles` filters DataTransfer entries to
// the SOP-evidence allowlist. Tested directly so jsdom isn't needed.
// ---------------------------------------------------------------------------

test("SopAdvancePlayer: image-accepting evidence rows expose a clipboard paste zone (review-fix: paste-from-clipboard)", () => {
  const html = render(
    <SopAdvancePlayer
      leg={{ id: 1, sopOutcome: null, sopNodeId: null, sopAnswers: [], invoiceGroupId: 9, duplicateOfClaimId: null, dropReason: null, perLegContext: null }}
      tree={richTree}
    />,
  );
  // The image-accepting requirement (`gps_screenshot`) MUST mount a
  // paste zone so the operator can drop a screenshot directly.
  assert.match(html, /data-testid="sop-evidence-req-gps_screenshot-paste-zone"/);
  assert.match(html, /or paste a screenshot/);
});

function fakeDataTransfer(items: Array<{ kind: "file" | "string"; type: string; file?: File }>): DataTransfer {
  return {
    items: {
      length: items.length,
      // Indexed access via for-loop in extractClipboardFiles — back the
      // length+numeric-index protocol with a Proxy-free fixture.
      ...Object.fromEntries(items.map((it, i) => [i, {
        kind: it.kind,
        type: it.type,
        getAsFile: () => it.file ?? null,
      }])),
    },
  } as unknown as DataTransfer;
}

test("extractClipboardFiles: returns image File entries (the screenshot-paste happy path)", () => {
  const png = new File(["x"], "shot.png", { type: "image/png" });
  const got = extractClipboardFiles(fakeDataTransfer([
    { kind: "file", type: "image/png", file: png },
  ]));
  assert.equal(got.length, 1);
  assert.equal(got[0].type, "image/png");
});

test("extractClipboardFiles: skips string-kind entries (plain text paste must not become a file upload)", () => {
  const got = extractClipboardFiles(fakeDataTransfer([
    { kind: "string", type: "text/plain" },
  ]));
  assert.equal(got.length, 0);
});

test("extractClipboardFiles: skips file-kind entries whose MIME isn't on the SOP-evidence allowlist", () => {
  const exe = new File(["x"], "evil.exe", { type: "application/x-msdownload" });
  const got = extractClipboardFiles(fakeDataTransfer([
    { kind: "file", type: "application/x-msdownload", file: exe },
  ]));
  assert.equal(got.length, 0);
});

test("extractClipboardFiles: PDF is in the allowlist (operators routinely paste copied PDFs)", () => {
  const pdf = new File(["x"], "doc.pdf", { type: "application/pdf" });
  const got = extractClipboardFiles(fakeDataTransfer([
    { kind: "file", type: "application/pdf", file: pdf },
  ]));
  assert.equal(got.length, 1);
});

test("extractClipboardFiles: null/undefined DataTransfer → []", () => {
  assert.deepEqual(extractClipboardFiles(null), []);
  assert.deepEqual(extractClipboardFiles(undefined), []);
});
