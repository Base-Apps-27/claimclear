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
import {
  SopAdvancePlayer,
  isReqSatisfied,
  extractClipboardFiles,
  pasteFromClipboard,
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
});

// Task #415 — the redundant italic "or paste a screenshot" hint was
// removed once the explicit Paste button was restored. If a future
// edit re-introduces it the row will look noisy; this test pins the
// removal.
test("SopAdvancePlayer: the redundant 'or paste a screenshot' italic hint is gone (Task #415 cleanup)", () => {
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

// ---------------------------------------------------------------------------
// Task #415 — explicit one-click "Paste" button. The button uses the
// Async Clipboard API (`navigator.clipboard.read`) so it can read a
// screenshot the user has already copied to the OS clipboard, with no
// drop-zone focus required. We test:
//   (a) the button only renders when the API is available,
//   (b)/(c)/(d) the click-handler logic via the pure `pasteFromClipboard`
//       helper — image is uploaded, missing image fires the toast hook,
//       disallowed MIME is ignored,
//   (e) the button is disabled when the row is disabled.
// renderToStaticMarkup can't fire DOM events, so the click logic is
// tested through the pure helper (the same pattern `extractClipboardFiles`
// uses for the keyboard-paste flow).
// ---------------------------------------------------------------------------

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

test("Paste button: hidden when navigator.clipboard.read is not available (Task #415, older-Safari fallback)", () => {
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

test("Paste button: disabled when the evidence row is disabled (Task #415, gating parity with Upload)", () => {
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

function fakeClipboardItem(entries: Array<{ mime: string; blob: Blob }>): ClipboardItem {
  return {
    types: entries.map((e) => e.mime),
    getType: async (mime: string) => {
      const hit = entries.find((e) => e.mime === mime);
      if (!hit) throw new Error(`no entry for ${mime}`);
      return hit.blob;
    },
  } as unknown as ClipboardItem;
}

test("pasteFromClipboard: allowed image on the clipboard → onUpload called with that file (Task #415 happy path)", async () => {
  const png = new Blob(["x"], { type: "image/png" });
  const uploads: File[] = [];
  let nothingFoundCalls = 0;
  await pasteFromClipboard({
    read: async () => [fakeClipboardItem([{ mime: "image/png", blob: png }])],
    onUpload: (f) => uploads.push(f),
    onNothingFound: () => { nothingFoundCalls++; },
  });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].type, "image/png");
  assert.equal(nothingFoundCalls, 0);
});

test("pasteFromClipboard: empty clipboard → friendly-toast hook fires, onUpload is NOT called", async () => {
  const uploads: File[] = [];
  let nothingFoundCalls = 0;
  await pasteFromClipboard({
    read: async () => [],
    onUpload: (f) => uploads.push(f),
    onNothingFound: () => { nothingFoundCalls++; },
  });
  assert.equal(uploads.length, 0);
  assert.equal(nothingFoundCalls, 1);
});

test("pasteFromClipboard: clipboard MIME outside the SOP-evidence allowlist → onUpload NOT called", async () => {
  const exe = new Blob(["x"], { type: "application/x-msdownload" });
  const uploads: File[] = [];
  let nothingFoundCalls = 0;
  await pasteFromClipboard({
    read: async () => [fakeClipboardItem([{ mime: "application/x-msdownload", blob: exe }])],
    onUpload: (f) => uploads.push(f),
    onNothingFound: () => { nothingFoundCalls++; },
  });
  assert.equal(uploads.length, 0);
  assert.equal(nothingFoundCalls, 1);
});

test("pasteFromClipboard: a rejected clipboard.read (permission denied) routes to onNothingFound, not onUpload", async () => {
  const uploads: File[] = [];
  let nothingFoundCalls = 0;
  await pasteFromClipboard({
    read: async () => { throw new Error("blocked"); },
    onUpload: (f) => uploads.push(f),
    onNothingFound: () => { nothingFoundCalls++; },
  });
  assert.equal(uploads.length, 0);
  assert.equal(nothingFoundCalls, 1);
});
