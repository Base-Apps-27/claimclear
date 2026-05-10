// RichTextEditor — guard tests for the typed-but-unsent leave warning
// (Task #670). Mirrors the per-leg-context-editor leave-confirm
// pattern: typing in the rich-text reply editor and then attempting to
// navigate away (SPA push, back/forward, or tab close) must trigger an
// in-app AlertDialog instead of silently dropping the draft.
//
// What this test pins:
//   - The pure helper `richTextHasUnsavedDraft` recognizes empty Tiptap
//     documents (`<p></p>`, whitespace-only, etc.) as NOT-unsaved, and
//     any non-whitespace user text as unsaved.
//   - The component source wires up the three guard channels
//     (`beforeunload`, history `pushState`, `popstate`) and renders the
//     leave-confirm AlertDialog with the stable test-ids the operator
//     relies on. Source-presence assertions are used because Tiptap's
//     `useEditor` returns null under SSR (`renderToStaticMarkup`) and
//     the dialog body is therefore unreachable from a snapshot test.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { richTextHasUnsavedDraft } from "./rich-text-editor";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  join(__dirname, "rich-text-editor.tsx"),
  "utf8",
);

test("richTextHasUnsavedDraft: empty / whitespace-only documents are NOT unsaved", () => {
  assert.equal(richTextHasUnsavedDraft(""), false);
  assert.equal(richTextHasUnsavedDraft("<p></p>"), false);
  assert.equal(richTextHasUnsavedDraft("<p><br></p>"), false);
  assert.equal(richTextHasUnsavedDraft("<p>   </p>"), false);
  assert.equal(richTextHasUnsavedDraft("<p>&nbsp;</p>"), false);
  assert.equal(
    richTextHasUnsavedDraft("<ul><li><p></p></li></ul>"),
    false,
  );
});

test("richTextHasUnsavedDraft: any non-whitespace user text is unsaved", () => {
  assert.equal(richTextHasUnsavedDraft("<p>hi</p>"), true);
  assert.equal(richTextHasUnsavedDraft("<p>  word  </p>"), true);
  assert.equal(
    richTextHasUnsavedDraft("<p><strong>bold</strong></p>"),
    true,
  );
  assert.equal(
    richTextHasUnsavedDraft("<ul><li><p>item</p></li></ul>"),
    true,
  );
});

test("RichTextEditor source: leave-confirm AlertDialog and its action test-ids are wired", () => {
  assert.match(
    SOURCE,
    /data-testid="rich-text-editor-leave-confirm"/,
    "leave-confirm AlertDialog is missing its stable test-id",
  );
  assert.match(
    SOURCE,
    /data-testid="rich-text-editor-leave-cancel"/,
    "Stay-on-this-page button is missing its stable test-id",
  );
  assert.match(
    SOURCE,
    /data-testid="rich-text-editor-leave-confirm-btn"/,
    "Discard-and-leave button is missing its stable test-id",
  );
});

test("RichTextEditor source: all three navigation channels are guarded", () => {
  // Tab close / hard refresh.
  assert.match(SOURCE, /addEventListener\("beforeunload"/);
  // SPA push/replace navigation (wouter and friends).
  assert.match(SOURCE, /window\.history\.pushState = /);
  assert.match(SOURCE, /window\.history\.replaceState = /);
  // Back / forward.
  assert.match(SOURCE, /addEventListener\("popstate"/);
});

test("RichTextEditor source: guard tears itself down when the draft is gone", () => {
  // Cleanup must restore the original history methods AND remove both
  // window listeners so the guard doesn't leak into other screens.
  assert.match(SOURCE, /window\.history\.pushState = originalPush/);
  assert.match(SOURCE, /window\.history\.replaceState = originalReplace/);
  assert.match(SOURCE, /removeEventListener\("beforeunload"/);
  assert.match(SOURCE, /removeEventListener\("popstate"/);
});
