#!/usr/bin/env node
// Render artifacts/test-stability/api-server/summary.json into report.md.
//
// Pure read-side tool: never executes tests, never mutates DB.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const LOG_DIR = process.env.STABILITY_LOG_DIR
  ?? join(REPO_ROOT, "artifacts", "test-stability", "api-server");
const SUMMARY_PATH = join(LOG_DIR, "summary.json");
const REPORT_PATH = join(LOG_DIR, "report.md");

if (!existsSync(SUMMARY_PATH)) {
  console.error(`No summary.json at ${SUMMARY_PATH}. Run a stability session first.`);
  process.exit(2);
}

const s = JSON.parse(readFileSync(SUMMARY_PATH, "utf8"));
const runs = s.runs ?? [];
const isolation = s.isolation ?? [];
const passed = runs.filter((r) => r.exitCode === 0).length;
const failed = runs.length - passed;

const failedFilesAll = new Set();
const failedTestsAll = new Set();
const tagCounts = {};
for (const r of runs) {
  for (const f of r.failedFiles ?? []) failedFilesAll.add(f);
  for (const t of r.failedTestNames ?? []) failedTestsAll.add(t);
  for (const tag of r.likelyRootCauseTags ?? []) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
}

const slowest = [...runs].sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0)).slice(0, 5);

function fmtTable(rows, headers) {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}

const lines = [];
lines.push(`# API Server Test-Stability Report`);
lines.push("");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push(`Session started: ${s.sessionStartedAt ?? "?"}`);
lines.push(`Session ended: ${s.sessionEndedAt ?? "(in progress / aborted)"}`);
lines.push(`Mode: \`${s.config?.STABILITY_MODE}\`  Runs: ${s.config?.STABILITY_RUNS}  Concurrency: ${s.config?.STABILITY_CONCURRENCY ?? "(default)"}  Pattern: ${s.config?.STABILITY_PATTERN ?? "-"}  Env variant: ${s.config?.STABILITY_ENV_VARIANT ?? "-"}`);
lines.push("");
lines.push(`## Summary`);
lines.push(`- Total runs: **${runs.length}**`);
lines.push(`- Passed: **${passed}**`);
lines.push(`- Failed: **${failed}**`);
lines.push("");
lines.push(`## Likely root-cause tag counts`);
if (Object.keys(tagCounts).length === 0) {
  lines.push("_(none — all runs passed or no recognized failure patterns)_");
} else {
  lines.push(fmtTable(
    Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, String(v)]),
    ["Tag", "Count"],
  ));
}
lines.push("");
lines.push(`## Failed files (any run)`);
lines.push(failedFilesAll.size === 0 ? "_(none)_" : Array.from(failedFilesAll).sort().map((f) => `- \`${f}\``).join("\n"));
lines.push("");
lines.push(`## Failed test names (any run)`);
lines.push(failedTestsAll.size === 0 ? "_(none)_" : Array.from(failedTestsAll).sort().map((t) => `- ${t}`).join("\n"));
lines.push("");
lines.push(`## Per-run table`);
lines.push(fmtTable(
  runs.map((r) => [
    String(r.runIndex),
    String(r.exitCode),
    String(r.durationMs ?? ""),
    r.seed ?? "-",
    (r.likelyRootCauseTags ?? []).join(",") || "-",
    String((r.failedFiles ?? []).length),
    `\`${r.logPath}\``,
  ]),
  ["#", "exit", "ms", "seed", "tags", "#failed-files", "log"],
));
lines.push("");
lines.push(`## Isolation reruns`);
if (isolation.length === 0) {
  lines.push("_(no isolation reruns — either no failures or run was aborted)_");
} else {
  lines.push(fmtTable(
    isolation.map((iso) => [
      `\`${iso.file}\``,
      String(iso.isolationPassCount),
      String(iso.isolationFailCount),
      String(iso.reproducesInIsolation),
      String(iso.likelyOrderDependent),
    ]),
    ["File", "pass", "fail", "reproducesInIsolation", "likelyOrderDependent"],
  ));
  lines.push("");
  lines.push(`### Likely order-dependent failures`);
  const orderDep = isolation.filter((i) => i.likelyOrderDependent);
  if (orderDep.length === 0) lines.push("_(none — all failures reproduce in isolation)_");
  else for (const i of orderDep) lines.push(`- \`${i.file}\``);
}
lines.push("");
lines.push(`## DB row-count deltas (per run)`);
const tables = ["claims","invoice_groups","portal_submissions","portal_batch_runs","audit_logs","users","attestations"];
const dbRows = runs.map((r) => [
  String(r.runIndex),
  ...tables.map((t) => {
    const d = r.dbRowDelta?.[t];
    return d === null || d === undefined ? "-" : String(d);
  }),
]);
lines.push(fmtTable(dbRows, ["#", ...tables]));
lines.push("");
lines.push(`## Slowest runs`);
lines.push(fmtTable(
  slowest.map((r) => [String(r.runIndex), String(r.durationMs ?? ""), String(r.exitCode), `\`${r.logPath}\``]),
  ["#", "ms", "exit", "log"],
));
lines.push("");
lines.push(`## Env snapshot (redacted)`);
lines.push("```json");
lines.push(JSON.stringify(s.envSnapshotRedacted ?? {}, null, 2));
lines.push("```");
lines.push("");
lines.push(`## First-error excerpts (failed runs only)`);
const failedRuns = runs.filter((r) => r.exitCode !== 0);
if (failedRuns.length === 0) lines.push("_(no failures)_");
else for (const r of failedRuns) {
  lines.push(`### Run #${r.runIndex} (\`${r.logPath}\`)`);
  lines.push("```");
  lines.push(r.firstErrorExcerpt ?? "(no recognizable error excerpt — see full log)");
  lines.push("```");
}
lines.push("");
lines.push(`## Recommended next diagnostic target`);
if (failed === 0) {
  lines.push(`- No flake reproduced under \`${s.config?.STABILITY_MODE}\` mode with ${runs.length} runs.`);
  lines.push(`- Recommended next step: increase \`STABILITY_RUNS\`, switch mode (try \`serial\` after \`shuffle\` and vice-versa), or vary \`STABILITY_ENV_VARIANT=no-bot-token\` / \`tz-utc\`.`);
} else {
  const orderDep = isolation.filter((i) => i.likelyOrderDependent);
  if (orderDep.length > 0) {
    lines.push(`- ${orderDep.length} file(s) failed only under shuffled multi-file runs and passed in isolation. Investigate the cross-file shared state (DB rows, env vars, module singletons).`);
  }
  if (tagCounts.pool_after_end) lines.push(`- \`pool_after_end\` observed: confirm whether node:test worker reuse is invoking a sibling file after \`pool.end()\`.`);
  if (tagCounts.env_leak) lines.push(`- \`env_leak\` observed: verify \`BOT_SERVICE_TOKEN\` mutation set is responsible (see suspect files list).`);
  if (tagCounts.db_unique_collision) lines.push(`- \`db_unique_collision\` observed: a fixture row from a prior run/file leaked.`);
  if (tagCounts.singleton_leak) lines.push(`- \`singleton_leak\` observed: an \`__set*ForTest(null)\` reset was likely skipped due to a thrown \`before()\`.`);
  if (tagCounts.server_handle_leak) lines.push(`- \`server_handle_leak\` observed: review \`app.listen\` / cron / interval cleanup.`);
}

writeFileSync(REPORT_PATH, lines.join("\n"));
console.log(`Report written: ${REPORT_PATH}`);
