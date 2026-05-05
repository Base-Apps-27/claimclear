// Static-scan guardrail: forbids the off-by-one date-display bug from
// recurring anywhere in the platform.
//
// The bug pattern: `new Date("YYYY-MM-DD")` parses the bare calendar
// day as midnight UTC. In any negative-UTC offset (ET in April:
// UTC-4 → 8pm Apr 5) it then renders as "Apr 5" via
// `toLocaleDateString` / `format`, even though the stored service
// date was Apr 6. See task notes for the original Apr 5/Apr 6
// dashboard incident.
//
// All human-facing date rendering must go through:
//   - frontend: `formatDate` / `formatDateTime` in `claimclear/src/lib/format.ts`
//   - backend:  `formatServiceDate` in `api-server/src/lib/dates.ts`
//
// This test walks the source tree and flags any callsite that builds
// a Date out of a literal `YYYY-MM-DD` or out of a property/variable
// whose name is a known calendar-day field (`.date`, `serviceDate`,
// `earliestDate`). The two formatter files are allow-listed because
// they are the canonical implementation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const SCAN_ROOTS = [
  "artifacts/api-server/src",
  "artifacts/claimclear/src",
];

// Files that legitimately implement the safe parsing/formatting
// primitives. They're allowed to call `new Date(...)` on a YMD.
const ALLOWED_FILES = new Set<string>([
  "artifacts/api-server/src/lib/dates.ts",
  "artifacts/claimclear/src/lib/format.ts",
]);

// Property/variable names that are known to carry a bare YYYY-MM-DD
// calendar day on the wire (per Drizzle schema + API zod contracts).
// Adding a new calendar-day field? Add it here AND make sure callers
// route through the formatter helpers.
const CALENDAR_DAY_NAMES = [
  "serviceDate",
  "earliestServiceDate",
  "earliestDate",
  "deadlineDate",
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
      yield* walk(full);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      yield full;
    }
  }
}

interface Violation {
  file: string;
  line: number;
  text: string;
  reason: string;
}

function scanFile(absPath: string, relPath: string): Violation[] {
  if (ALLOWED_FILES.has(relPath)) return [];
  const src = readFileSync(absPath, "utf8");
  const lines = src.split("\n");
  const out: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip line comments so we don't false-positive on docs/examples.
    const stripped = line.replace(/\/\/.*$/, "");

    // (1) Literal YYYY-MM-DD inside a `new Date("...")` call.
    if (/new Date\(\s*["'`]\d{4}-\d{2}-\d{2}/.test(stripped)) {
      out.push({
        file: relPath,
        line: i + 1,
        text: line.trim(),
        reason: "Constructed Date from a literal YYYY-MM-DD calendar day. Use formatServiceDate (backend) or formatDate (frontend) for display, or parseYMD/dateKeyInTz for math.",
      });
      continue;
    }

    // (2) `new Date(<something>.<calendar-day-name>)` — the wire shape
    // of those fields is a calendar day, so the same off-by-one applies.
    for (const name of CALENDAR_DAY_NAMES) {
      const re = new RegExp(`new Date\\(\\s*[A-Za-z_$][A-Za-z0-9_$]*\\.${name}\\b`);
      if (re.test(stripped)) {
        out.push({
          file: relPath,
          line: i + 1,
          text: line.trim(),
          reason: `Constructed Date from a calendar-day field (.${name}). Route through the formatter helpers instead.`,
        });
        break;
      }
    }
  }
  return out;
}

test("no off-by-one date constructions outside the formatter helpers", () => {
  const violations: Violation[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root);
    for (const file of walk(abs)) {
      const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
      violations.push(...scanFile(file, rel));
    }
  }
  if (violations.length > 0) {
    const detail = violations
      .map(v => `  ${v.file}:${v.line}\n    ${v.text}\n    → ${v.reason}`)
      .join("\n");
    assert.fail(
      `Found ${violations.length} unsafe Date construction(s) from calendar-day strings. ` +
        `These cause the "Apr 5 vs Apr 6" off-by-one bug in negative-UTC timezones. ` +
        `Use formatServiceDate (backend) or formatDate (frontend) instead.\n\n${detail}`
    );
  }
});
