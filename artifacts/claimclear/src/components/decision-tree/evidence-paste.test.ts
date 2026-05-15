// Pure-helper tests for the shared evidence paste utilities. No jsdom
// — every helper accepts the IO callback as a parameter so tests can
// drive every branch (image found, no image, disallowed MIME,
// permission denied) without a real DOM.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  extractClipboardFiles,
  pasteFromClipboard,
  isClipboardReadAvailable,
  ALLOWED_EVIDENCE_TYPES,
  MAX_EVIDENCE_SIZE,
} from "./evidence-paste";

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

// Allowlist + size constants — single source of truth for every consumer.

test("ALLOWED_EVIDENCE_TYPES: every common operator-paste MIME is on the allowlist", () => {
  for (const mime of [
    "image/png", "image/jpeg", "image/gif", "image/webp",
    "image/heic", "image/heif", "image/tiff", "image/bmp",
    "application/pdf",
    // Spreadsheets — operators attach CSV / Excel exports as evidence.
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]) {
    assert.equal(
      ALLOWED_EVIDENCE_TYPES.has(mime),
      true,
      `expected ${mime} to be on the SOP-evidence allowlist`,
    );
  }
});

test("ALLOWED_EVIDENCE_TYPES: a non-evidence MIME is rejected", () => {
  assert.equal(ALLOWED_EVIDENCE_TYPES.has("application/x-msdownload"), false);
  assert.equal(ALLOWED_EVIDENCE_TYPES.has("text/html"), false);
});

test("MAX_EVIDENCE_SIZE: 50 MB cap (bytes)", () => {
  assert.equal(MAX_EVIDENCE_SIZE, 50 * 1024 * 1024);
});

// extractClipboardFiles — keyboard-paste happy path + filters.

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

test("extractClipboardFiles: spreadsheets pass the allowlist (operators attach CSV/Excel evidence)", () => {
  const csv = new File(["a,b"], "rides.csv", { type: "text/csv" });
  const xlsx = new File(["x"], "report.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const got = extractClipboardFiles(fakeDataTransfer([
    { kind: "file", type: "text/csv", file: csv },
    {
      kind: "file",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      file: xlsx,
    },
  ]));
  assert.equal(got.length, 2);
});

test("extractClipboardFiles: { acceptPdf: false } also filters spreadsheets (instruction-image uploader is image-only)", () => {
  const csv = new File(["a,b"], "rides.csv", { type: "text/csv" });
  const png = new File(["x"], "shot.png", { type: "image/png" });
  const got = extractClipboardFiles(
    fakeDataTransfer([
      { kind: "file", type: "text/csv", file: csv },
      { kind: "file", type: "image/png", file: png },
    ]),
    { acceptPdf: false },
  );
  assert.equal(got.length, 1);
  assert.equal(got[0].type, "image/png");
});

test("extractClipboardFiles: { acceptPdf: false } filters PDFs (instruction-image uploader)", () => {
  const pdf = new File(["x"], "doc.pdf", { type: "application/pdf" });
  const png = new File(["x"], "shot.png", { type: "image/png" });
  const got = extractClipboardFiles(
    fakeDataTransfer([
      { kind: "file", type: "application/pdf", file: pdf },
      { kind: "file", type: "image/png", file: png },
    ]),
    { acceptPdf: false },
  );
  assert.equal(got.length, 1);
  assert.equal(got[0].type, "image/png");
});

test("extractClipboardFiles: null/undefined DataTransfer → []", () => {
  assert.deepEqual(extractClipboardFiles(null), []);
  assert.deepEqual(extractClipboardFiles(undefined), []);
});

// isClipboardReadAvailable — capability gate that drives the explicit
// Paste button's render-or-hide decision.

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

test("isClipboardReadAvailable: false when navigator.clipboard.read isn't a function", () => {
  withNavigator({ userAgent: "test" }, () => {
    assert.equal(isClipboardReadAvailable(), false);
  });
});

test("isClipboardReadAvailable: true when navigator.clipboard.read exists", () => {
  withNavigator({ clipboard: { read: async () => [] } }, () => {
    assert.equal(isClipboardReadAvailable(), true);
  });
});

// pasteFromClipboard — Async-Clipboard-API wrapper. The button click
// handler routes through this helper; testing it pure means the
// browser API doesn't have to be present for coverage.

test("pasteFromClipboard: allowed image on the clipboard → onUpload called with that file (happy path)", async () => {
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

test("pasteFromClipboard: { acceptPdf: false } — clipboard PDF is NOT uploaded (instruction-image uploader)", async () => {
  const pdf = new Blob(["x"], { type: "application/pdf" });
  const uploads: File[] = [];
  let nothingFoundCalls = 0;
  await pasteFromClipboard({
    read: async () => [fakeClipboardItem([{ mime: "application/pdf", blob: pdf }])],
    onUpload: (f) => uploads.push(f),
    onNothingFound: () => { nothingFoundCalls++; },
    acceptPdf: false,
  });
  assert.equal(uploads.length, 0);
  assert.equal(nothingFoundCalls, 1);
});
