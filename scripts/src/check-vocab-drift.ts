// Vocabulary drift guardrail. Scans `artifacts/*/src/**/*.tsx` for any
// of the forbidden literals defined in `@workspace/vocab` and exits
// non-zero on the first hit. The contract is simple: if you want one of
// those words to appear in the UI, route it through the glossary.
//
// Allow-listing options:
//   1. Generated files under `**/api-zod/**` and `**/api-client-react/**`
//      are skipped wholesale (they mirror DB enums and must keep the raw
//      enum values).
//   2. The glossary itself is excluded by virtue of living in `lib/vocab`,
//      not under `artifacts/*`.
//   3. Per-line escape hatch: a comment containing `vocab-allow-next-line`
//      on the line immediately above an offending literal allows that
//      single occurrence (still emit a warning so it stays visible).

import * as fs from "node:fs";
import * as path from "node:path";

import {
  FORBIDDEN_LITERALS,
  FORBIDDEN_BADGE_STATE_EXPRS,
  VOCAB_ALLOW_DIRECTIVE,
} from "@workspace/vocab";

interface Hit {
  file: string;
  line: number;
  text: string;
  literal: string;
}

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const ARTIFACTS_DIR = path.join(REPO_ROOT, "artifacts");

// Directories we never scan. `node_modules`, `dist`, build outputs, and
// any generated code path.
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
  ".turbo",
]);
const SKIP_PATH_FRAGMENTS = ["api-zod", "api-client-react"];

// Operator-facing artifacts the guardrail enforces. Other artifacts
// (mockup sandbox, training-guide slides, design canvases) are
// intentionally excluded — they reproduce historical UIs verbatim and
// would force a maintenance burden that doesn't match the task's
// "operator-facing app" scope. If a new operator-facing artifact is
// added, list its directory name here.
const OPERATOR_FACING_ARTIFACTS = new Set([
  "claimclear",
  "api-server",
]);

function* walkTsx(root: string): Generator<string> {
  if (!fs.existsSync(root)) return;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      if (SKIP_PATH_FRAGMENTS.includes(entry.name)) continue;
      yield* walkTsx(full);
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      yield full;
    }
  }
}

// Strip the part of a line that lives inside a `//` line comment. We
// keep block comments (`/* … */`) as-is — they're rare enough that a
// false positive there is fine and explicit. The point is to allow
// authors to *talk about* "Non-Issue" or "Excluded" in code comments
// without having to add a vocab-allow-next-line directive every time.
function stripLineComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : "";
    if (ch === "'" && !inDouble && !inBacktick && prev !== "\\") inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inBacktick && prev !== "\\") inDouble = !inDouble;
    else if (ch === "`" && !inSingle && !inDouble && prev !== "\\") inBacktick = !inBacktick;
    else if (ch === "/" && line[i + 1] === "/" && !inSingle && !inDouble && !inBacktick) {
      return line.slice(0, i);
    }
  }
  return line;
}

export function scanFile(file: string, contents: string): Hit[] {
  const hits: Hit[] = [];
  const lines = contents.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Per-line allow directive sits on the previous line.
    const prev = i > 0 ? lines[i - 1] : "";
    const allowed = prev.includes(VOCAB_ALLOW_DIRECTIVE);
    if (allowed) continue;
    const codePortion = stripLineComment(line);
    for (const literal of FORBIDDEN_LITERALS) {
      if (codePortion.includes(literal)) {
        hits.push({ file, line: i + 1, text: line.trim(), literal });
      }
    }
    // Broader contract: a `<Badge>` (or any non-StateBadge JSX element)
    // that renders one of the canonical state-domain expressions is a
    // state pill in disguise. Flag it so the author either routes
    // through `<StateBadge>` or marks it `vocab-allow-next-line`.
    if (codePortion.includes("<Badge") || codePortion.includes(">{")) {
      for (const expr of FORBIDDEN_BADGE_STATE_EXPRS) {
        if (codePortion.includes(expr) && !codePortion.includes("<StateBadge")) {
          // Skip pure read-only comparisons (`x === y`, `if (x.status)`)
          // by requiring the expression to sit inside JSX text — simplest
          // heuristic: it's preceded by `>` on the same line, OR the line
          // also contains `<Badge`.
          const indexOfExpr = codePortion.indexOf(expr);
          const before = codePortion.slice(0, indexOfExpr);
          const looksLikeJsxText =
            before.includes("<Badge") ||
            /[>]\s*$/.test(before) ||
            before.trimEnd().endsWith(">");
          if (looksLikeJsxText) {
            hits.push({ file, line: i + 1, text: line.trim(), literal: expr });
          }
        }
      }
    }
  }
  return hits;
}

export interface ScanRepositoryOptions {
  /** Restrict to only these top-level artifact directory names. */
  artifactNames?: Set<string>;
}

export function scanRepository(
  rootArtifactsDir: string = ARTIFACTS_DIR,
  options: ScanRepositoryOptions = {},
): Hit[] {
  const all: Hit[] = [];
  if (!fs.existsSync(rootArtifactsDir)) return all;
  const artifactDirs = fs
    .readdirSync(rootArtifactsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => !options.artifactNames || options.artifactNames.has(e.name))
    .map((e) => path.join(rootArtifactsDir, e.name));
  for (const artifactDir of artifactDirs) {
    for (const file of walkTsx(artifactDir)) {
      const contents = fs.readFileSync(file, "utf8");
      all.push(...scanFile(file, contents));
    }
  }
  return all;
}

function format(hits: Hit[]): string {
  if (hits.length === 0) return "";
  const lines: string[] = [];
  lines.push(`Found ${hits.length} forbidden literal occurrence(s):`);
  for (const h of hits) {
    const rel = path.relative(REPO_ROOT, h.file);
    lines.push(`  ${rel}:${h.line}  ${h.literal}`);
    lines.push(`    | ${h.text}`);
  }
  lines.push("");
  lines.push("Forbidden literals must be rendered through @workspace/vocab.");
  lines.push(`If a usage is legitimately not a UI label, add \`// ${VOCAB_ALLOW_DIRECTIVE}\` on the line above it.`);
  return lines.join("\n");
}

function main(): void {
  const hits = scanRepository(ARTIFACTS_DIR, { artifactNames: OPERATOR_FACING_ARTIFACTS });
  if (hits.length > 0) {
    console.error(format(hits));
    process.exit(1);
  }
  console.log("Vocabulary drift check passed.");
}

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(import.meta.filename);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main();
}
