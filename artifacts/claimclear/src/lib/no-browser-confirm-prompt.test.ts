// Task #667 — guard rail: no user-facing flow in artifacts/claimclear/src
// may call window.confirm / window.prompt / bare confirm() / bare prompt().
//
// Task #664 already removed those primitives from the claim recovery
// actions on /claims/:id (with a render-time guard in
// claim-detail-no-walk-no-submit.test.tsx). This sweep covers the rest
// of the app: the Stop-batch confirm on /portal-submissions, the
// link-URL prompt in the rich-text editor, the Discard-changes confirm
// in the decision-tree plain-text editor, and the unsaved-context
// navigation guards in per-leg-context-editor.
//
// We walk every .ts/.tsx file under src/ (excluding *.test.ts,
// *.test.tsx, and this file) and assert that none of them contain a
// window.confirm / window.prompt invocation, nor a bare confirm(/prompt(
// call. Comments are stripped first so explanatory prose like
// "// don't use window.confirm here" doesn't trip the guard.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = new URL("../", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip generated/output directories that aren't user code.
      if (entry === "node_modules" || entry === "dist" || entry === "test-results") continue;
      walk(full, out);
    } else if (st.isFile()) {
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (/\.test\.(ts|tsx)$/.test(entry)) continue;
      if (entry === "no-browser-confirm-prompt.test.ts") continue;
      out.push(full);
    }
  }
  return out;
}

function stripComments(source: string): string {
  // Remove /* ... */ block comments, then // ... line comments. This is
  // a deliberately simple stripper — it does not understand strings or
  // regex literals, but the patterns we're guarding against
  // (`window.confirm(` etc.) don't appear in any string literal in
  // user-facing code in this app, so false positives are not a concern.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const FORBIDDEN = [
  { re: /\bwindow\.confirm\s*\(/, label: "window.confirm(" },
  { re: /\bwindow\.prompt\s*\(/, label: "window.prompt(" },
  // Bare confirm()/prompt() — must not be the property-access form
  // (e.g. `event.confirm(...)`) and must not be a TypeScript type
  // annotation. The character class up front excludes `.` and word
  // chars, so `obj.confirm(` and `myConfirm(` don't match.
  { re: /(^|[^A-Za-z0-9_.])confirm\s*\(/, label: "confirm(" },
  { re: /(^|[^A-Za-z0-9_.])prompt\s*\(/, label: "prompt(" },
];

test("Task #667 — no window.confirm / window.prompt / bare confirm() / prompt() in user-facing src", () => {
  const files = walk(SRC_ROOT);
  const offenders: string[] = [];
  for (const file of files) {
    const stripped = stripComments(readFileSync(file, "utf8"));
    for (const { re, label } of FORBIDDEN) {
      const m = stripped.match(re);
      if (m) {
        offenders.push(`${relative(SRC_ROOT, file)} — ${label}`);
        break;
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Task #667 forbids browser confirm/prompt in user-facing flows. Use AlertDialog (yes/no) or Dialog + a structured input instead. Offenders:\n  - ${offenders.join("\n  - ")}`,
  );
});
