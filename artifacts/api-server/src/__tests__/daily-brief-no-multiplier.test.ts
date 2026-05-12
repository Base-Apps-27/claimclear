// Guardrail: the brief renderer modules must NOT apply the legacy
// vendor-prepay (× 1.7) multiplier or any other money inflation. The
// canonical /dashboard/summary and /dashboard/insights aggregators
// already bake the multiplier in at the boundary; multiplying again at
// the renderer would double-inflate every dollar an exec sees.
//
// We grep the source files for tell-tale tokens. If a future patch
// reintroduces multiplication inside the brief, this test fails before
// the regression ships.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIEF_DIR = join(HERE, "..", "lib", "daily-brief");

const FORBIDDEN_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "literal 1.7 multiplier", re: /\*\s*1\.7\b/ },
  { name: "literal 1.7 multiplier (reversed)", re: /\b1\.7\s*\*/ },
  { name: "vendorPrepay multiplication", re: /vendorPrepayRate\s*\*/ },
  { name: "× 1.7 in source", re: /×\s*1\.7/ },
  { name: "70%-of-claim heuristic", re: /\* 0\.7\b/ },
];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f));
}

// Strip // line comments and /* … */ block comments so the guardrail
// only fires on real code, not the explanatory comments that mention
// the legacy × 1.7 multiplier on purpose.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("daily-brief module does NOT apply the × 1.7 multiplier in the template layer", () => {
  const files = listSourceFiles(BRIEF_DIR);
  assert.ok(files.length >= 5, "expected several brief module files to scan");
  for (const path of files) {
    const code = stripComments(readFileSync(path, "utf8"));
    for (const { name, re } of FORBIDDEN_PATTERNS) {
      assert.equal(
        re.test(code),
        false,
        `${path} contains forbidden pattern "${name}" in code (comments excluded).`,
      );
    }
  }
});

test("partials.money() formats canonical strings without inflation", async () => {
  const { money } = await import("../lib/daily-brief/partials");
  // Canonical aggregator emits strings; renderer must format them as-is.
  assert.equal(money("100.00"), "$100");
  assert.equal(money("1234.56"), "$1,235");
  assert.equal(money(2400), "$2,400");
  assert.equal(money(null), "—");
  // Critically: a $100 input must NOT come out as $170 (× 1.7).
  assert.notEqual(money("100"), "$170");
});
