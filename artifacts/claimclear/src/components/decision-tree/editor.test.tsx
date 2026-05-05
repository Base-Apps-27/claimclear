// InstructionImageUploader render contract: Upload + Paste buttons
// render when no image yet, are replaced by the image preview when one
// is present, the test-id prefix is stable, and PDFs are excluded.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { InstructionImageUploader } from "./editor";

void React;

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

test("InstructionImageUploader: with no current image renders the keyboard-paste zone, Upload, and Paste (when clipboard.read available)", () => {
  const html = withNavigator(
    { clipboard: { read: async () => [] } },
    () =>
      renderToStaticMarkup(
        <InstructionImageUploader
          onUploaded={() => {}}
          onRemove={() => {}}
        />,
      ),
  );
  assert.match(html, /data-testid="instruction-image-paste-zone"/);
  assert.match(html, /data-testid="instruction-image-upload-btn"/);
  assert.match(html, /data-testid="instruction-image-paste-btn"/);
  // Hidden file input also mounts under the prefixed test-id.
  assert.match(html, /data-testid="instruction-image-file-input"/);
  // Empty-state Upload label per the prop override.
  assert.match(html, /Upload/);
});

test("InstructionImageUploader: when navigator.clipboard.read is unavailable, Upload still renders but Paste is hidden", () => {
  const html = withNavigator({ userAgent: "test" }, () =>
    renderToStaticMarkup(
      <InstructionImageUploader
        onUploaded={() => {}}
        onRemove={() => {}}
      />,
    ),
  );
  assert.match(html, /data-testid="instruction-image-upload-btn"/);
  assert.equal(
    html.includes("instruction-image-paste-btn"),
    false,
    "Paste button must hide when navigator.clipboard.read isn't available",
  );
});

test("InstructionImageUploader: PDFs are not on the file input's accept list (this uploader is image-only)", () => {
  const html = withNavigator(
    { clipboard: { read: async () => [] } },
    () =>
      renderToStaticMarkup(
        <InstructionImageUploader
          onUploaded={() => {}}
          onRemove={() => {}}
        />,
      ),
  );
  // Pull the file input tag and verify accept list excludes PDFs.
  const m = html.match(
    /<input[^>]*data-testid="instruction-image-file-input"[^>]*>/,
  );
  assert.ok(m, "expected to find the hidden file input");
  assert.equal(
    m![0].includes("application/pdf"),
    false,
    "instruction-image uploader must not advertise PDF in its accept list",
  );
  assert.match(m![0], /accept="[^"]*image\//);
});

test("InstructionImageUploader: with a current image, the upload UI is REPLACED by the image preview (no buttons render)", () => {
  const html = withNavigator(
    { clipboard: { read: async () => [] } },
    () =>
      renderToStaticMarkup(
        <InstructionImageUploader
          imagePath="/objects/uploads/foo.png"
          onUploaded={() => {}}
          onRemove={() => {}}
        />,
      ),
  );
  // Image preview wins; route /objects/* through the API proxy.
  assert.match(html, /<img[^>]*src="\/api\/storage\/objects\/uploads\/foo\.png"/);
  // None of the upload/paste affordances should render alongside it.
  assert.equal(html.includes("instruction-image-upload-btn"), false);
  assert.equal(html.includes("instruction-image-paste-btn"), false);
  assert.equal(html.includes("instruction-image-paste-zone"), false);
});
