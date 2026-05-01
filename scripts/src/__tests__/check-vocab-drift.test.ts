// Tests for the vocab-drift CI guardrail. We verify the scanner against
// in-memory file contents (not the live repo) so the test stays
// deterministic regardless of what artifacts exist on disk.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { scanFile, scanRepository } from "../check-vocab-drift";

test("scanFile flags every forbidden literal", () => {
  const sample = [
    `<Badge>{"Excluded"}</Badge>`,
    `<Badge>{"Dropped"}</Badge>`,
    `<Badge>{"Non-Issue"}</Badge>`,
    `<Badge>{"Non Issue"}</Badge>`,
  ].join("\n");
  const hits = scanFile("/tmp/Sample.tsx", sample);
  const literals = hits.map((h) => h.literal).sort();
  assert.deepEqual(literals, [
    `"Dropped"`,
    `"Excluded"`,
    `"Non Issue"`,
    `"Non-Issue"`,
  ]);
});

test("scanFile honours the per-line allow directive", () => {
  const sample = [
    `// vocab-allow-next-line — historical OpenAPI enum value`,
    `const ENUM_VALUE = "Non-Issue";`,
  ].join("\n");
  const hits = scanFile("/tmp/Sample.tsx", sample);
  assert.equal(hits.length, 0);
});

test("scanFile ignores forbidden literals that live inside // line comments", () => {
  const sample = [
    `const X = 1; // remember the old "Excluded" name`,
    `// We used to ship "Non-Issue" here — left in the comment for context`,
  ].join("\n");
  const hits = scanFile("/tmp/Sample.tsx", sample);
  assert.equal(hits.length, 0);
});

test("scanFile still flags forbidden literals outside comments on the same line", () => {
  const sample = `const X = "Excluded"; // tail comment shouldn't matter`;
  const hits = scanFile("/tmp/Sample.tsx", sample);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].literal, `"Excluded"`);
});

test("scanFile does NOT honour an allow directive two lines above", () => {
  // Sanity: the directive must sit on the immediately-preceding line.
  const sample = [
    `// vocab-allow-next-line`,
    `const HARMLESS = 1;`,
    `const BAD = "Excluded";`,
  ].join("\n");
  const hits = scanFile("/tmp/Sample.tsx", sample);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].literal, `"Excluded"`);
});

test("scanRepository finds plants in a tmp artifact tree and ignores allow-listed dirs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vocab-drift-test-"));
  const artifactSrc = path.join(root, "fakeapp", "src");
  const generated = path.join(root, "fakeapp", "src", "api-zod");
  const nodeMods = path.join(root, "fakeapp", "node_modules", "lib");
  fs.mkdirSync(artifactSrc, { recursive: true });
  fs.mkdirSync(generated, { recursive: true });
  fs.mkdirSync(nodeMods, { recursive: true });

  fs.writeFileSync(
    path.join(artifactSrc, "Bad.tsx"),
    `export const X = <span>{"Excluded"}</span>;\n`,
  );
  // Generated and node_modules copies must NOT register as drift.
  fs.writeFileSync(
    path.join(generated, "schema.tsx"),
    `export const X = "Non-Issue";\n`,
  );
  fs.writeFileSync(
    path.join(nodeMods, "thing.tsx"),
    `export const X = "Dropped";\n`,
  );

  const hits = scanRepository(root);
  assert.equal(hits.length, 1, JSON.stringify(hits, null, 2));
  assert.ok(hits[0].file.endsWith(path.join("fakeapp", "src", "Bad.tsx")));
  assert.equal(hits[0].literal, `"Excluded"`);

  fs.rmSync(root, { recursive: true, force: true });
});
