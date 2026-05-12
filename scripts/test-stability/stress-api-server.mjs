#!/usr/bin/env node
// Diagnostic stress harness for @workspace/api-server.
// Runs the node:test suite repeatedly under several configurable modes
// (shuffle, repeat, serial, default-parallel, suspect-files, single-file)
// and writes per-run logs + a summary.json that downstream tooling
// (render-api-server-report.mjs) consumes.
//
// IMPORTANT: This is purely diagnostic. It does not modify product code,
// does not patch tests, and does not alter the existing test scripts.

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(__dirname, "..", "..");
const API_PKG_DIR = join(REPO_ROOT, "artifacts", "api-server");
const SUSPECT_FILES_JSON = join(__dirname, "api-server-suspect-files.json");

const ENV = {
  STABILITY_RUNS: parseInt(process.env.STABILITY_RUNS ?? "10", 10),
  STABILITY_FAIL_FAST: (process.env.STABILITY_FAIL_FAST ?? "false").toLowerCase() === "true",
  STABILITY_LOG_DIR: process.env.STABILITY_LOG_DIR
    ?? join(REPO_ROOT, "artifacts", "test-stability", "api-server"),
  STABILITY_PATTERN: process.env.STABILITY_PATTERN ?? null,
  STABILITY_MODE: process.env.STABILITY_MODE ?? "shuffle",
  STABILITY_CONCURRENCY: process.env.STABILITY_CONCURRENCY ?? null,
  STABILITY_ISOLATION_RERUNS: parseInt(process.env.STABILITY_ISOLATION_RERUNS ?? "3", 10),
  STABILITY_ENV_VARIANT: process.env.STABILITY_ENV_VARIANT ?? null,
  STABILITY_JSON_REPORT: (process.env.STABILITY_JSON_REPORT ?? "true").toLowerCase() === "true",
  STABILITY_DB_SNAPSHOT: (process.env.STABILITY_DB_SNAPSHOT ?? "true").toLowerCase() === "true",
  STABILITY_RUN_TIMEOUT_MS: parseInt(process.env.STABILITY_RUN_TIMEOUT_MS ?? "900000", 10),
};

const SUPPORTED_MODES = new Set([
  "shuffle", "repeat", "serial", "default-parallel", "suspect-files", "single-file",
]);

if (!SUPPORTED_MODES.has(ENV.STABILITY_MODE)) {
  console.error(`Unsupported STABILITY_MODE=${ENV.STABILITY_MODE}. Supported: ${[...SUPPORTED_MODES].join(", ")}`);
  process.exit(2);
}

mkdirSync(ENV.STABILITY_LOG_DIR, { recursive: true });
mkdirSync(join(ENV.STABILITY_LOG_DIR, "isolation"), { recursive: true });

// ---------------- Env snapshot (redacted) ----------------
function redactDbUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.hostname}/${url.pathname.replace(/^\//, "")}`;
  } catch {
    return "<unparseable>";
  }
}
function envSnapshotRedacted() {
  return {
    NODE_ENV: process.env.NODE_ENV ?? null,
    TZ: process.env.TZ ?? null,
    DATABASE_URL: redactDbUrl(process.env.DATABASE_URL),
    TEST_DATABASE_URL: redactDbUrl(process.env.TEST_DATABASE_URL),
    BOT_SERVICE_TOKEN_present: Boolean(process.env.BOT_SERVICE_TOKEN),
    BOT_SERVICE_TOKEN_length: process.env.BOT_SERVICE_TOKEN ? process.env.BOT_SERVICE_TOKEN.length : 0,
    SESSION_SECRET_present: Boolean(process.env.SESSION_SECRET),
    FIELD_ENCRYPTION_KEY_present: Boolean(process.env.FIELD_ENCRYPTION_KEY),
    CI: process.env.CI ?? null,
    NODE_OPTIONS: process.env.NODE_OPTIONS ?? null,
    STABILITY_ENV_VARIANT: ENV.STABILITY_ENV_VARIANT,
  };
}

// ---------------- DB snapshot ----------------
const SNAPSHOT_TABLES = [
  "claims", "invoice_groups", "portal_submissions", "portal_batch_runs",
  "audit_logs", "users", "attestations",
];

let _pgClientCtor = null;
async function getPgClient() {
  if (_pgClientCtor) return _pgClientCtor;
  // pg is a transitive dep of @workspace/db / @workspace/api-server, not of this script.
  // Resolve it relative to the api-server package so pnpm's store finds it.
  const reqFromDb = createRequire(join(REPO_ROOT, "lib", "db", "package.json"));
  const pgPath = reqFromDb.resolve("pg");
  const mod = await import(pathToFileURL(pgPath).href);
  _pgClientCtor = (mod.default ?? mod).Client;
  return _pgClientCtor;
}

async function dbSnapshot() {
  if (!ENV.STABILITY_DB_SNAPSHOT) return { skipped: true, reason: "STABILITY_DB_SNAPSHOT=false" };
  if (!process.env.DATABASE_URL) return { skipped: true, reason: "DATABASE_URL not set" };
  const counts = {};
  let client;
  try {
    const Client = await getPgClient();
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    for (const t of SNAPSHOT_TABLES) {
      try {
        const r = await client.query(`SELECT count(*)::bigint AS n FROM "${t}"`);
        counts[t] = Number(r.rows[0].n);
      } catch (e) {
        counts[t] = { error: String(e.message ?? e).slice(0, 200) };
      }
    }
    return { skipped: false, counts };
  } catch (e) {
    return { skipped: true, reason: `DB connect failed: ${String(e.message ?? e).slice(0, 200)}` };
  } finally {
    try { await client?.end(); } catch {}
  }
}

function deltaCounts(pre, post) {
  if (!pre || !post || pre.skipped || post.skipped) return null;
  const out = {};
  for (const t of SNAPSHOT_TABLES) {
    const a = typeof pre.counts?.[t] === "number" ? pre.counts[t] : null;
    const b = typeof post.counts?.[t] === "number" ? post.counts[t] : null;
    out[t] = a !== null && b !== null ? b - a : null;
  }
  return out;
}

// ---------------- Build node --test command ----------------
function loadSuspectFiles() {
  const list = JSON.parse(readFileSync(SUSPECT_FILES_JSON, "utf8"));
  return list;
}

function defaultGlob() {
  // Matches the api-server `test` script.
  return ["src/__tests__/*.test.ts"];
}

// Deterministic seeded shuffle (Mulberry32 PRNG → Fisher-Yates).
// Used because Node 24.13 in this environment does not support --test-shuffle.
function seededShuffle(arr, seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  const rand = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildArgs(mode, files, runIndex) {
  const args = ["--import", "tsx", "--test"];
  switch (mode) {
    case "serial":
      args.push("--test-concurrency=1");
      break;
    case "shuffle":
    case "suspect-files":
    case "repeat":
    case "default-parallel":
    case "single-file":
      // Order is controlled by the file list in `files`; no node flag.
      break;
  }
  if (ENV.STABILITY_CONCURRENCY) {
    args.push(`--test-concurrency=${ENV.STABILITY_CONCURRENCY}`);
  }
  for (const f of files) args.push(f);
  return args;
}

function expandFiles(mode) {
  if (process.env.STABILITY_FILES_FROM) {
    // Explicit list overrides mode-based file selection (used to run e.g.
    // suspect file list under serial mode for an apples-to-apples comparison).
    const p = resolve(REPO_ROOT, process.env.STABILITY_FILES_FROM);
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (!Array.isArray(j)) throw new Error(`STABILITY_FILES_FROM must be a JSON array of paths: ${p}`);
    return j;
  }
  if (mode === "suspect-files") return loadSuspectFiles();
  if (mode === "single-file") {
    if (!ENV.STABILITY_PATTERN) {
      throw new Error("single-file mode requires STABILITY_PATTERN to point at a file path");
    }
    return [ENV.STABILITY_PATTERN];
  }
  // For other modes, expand the default glob using fast-glob-less approach: list dir.
  const dir = join(API_PKG_DIR, "src", "__tests__");
  let files = readdirSync(dir)
    .filter((n) => n.endsWith(".test.ts"))
    .map((n) => `src/__tests__/${n}`)
    .sort();
  if (ENV.STABILITY_PATTERN) {
    const re = new RegExp(ENV.STABILITY_PATTERN);
    files = files.filter((f) => re.test(f));
  }
  return files;
}

// ---------------- Run a single child invocation ----------------
function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function tagFromOutput(out) {
  const tags = [];
  const text = out;
  if (/Cannot use a pool after calling end/i.test(text)) tags.push("pool_after_end");
  if (/BOT_SERVICE_TOKEN|x-bot-token|unauthorized|401|invalid.*token/i.test(text) &&
      /(expected|actual|mismatch|fail)/i.test(text)) tags.push("env_leak");
  if (/duplicate key value|unique constraint/i.test(text)) tags.push("db_unique_collision");
  if (/(not found|missing row|no rows returned|expected.*to be defined)/i.test(text) &&
      /(seed|fixture|expected)/i.test(text)) tags.push("db_missing_seed");
  if (/process did not exit|EADDRINUSE|open handles|Did not exit/i.test(text)) tags.push("server_handle_leak");
  if (/Anthropic|chromium|BatchWorker|__set.*ForTest/i.test(text) &&
      /(undefined|null|stale|Cannot read)/i.test(text)) tags.push("singleton_leak");
  if (/timed out|test timed out|exceeded.*timeout/i.test(text)) tags.push("timeout");
  if (tags.length === 0 && /\u2716|not ok|failing tests:|^# fail/m.test(text)) tags.push("unknown");
  return Array.from(new Set(tags));
}

function parseFailures(out) {
  const failedFiles = new Set();
  const failedTestNames = new Set();
  // node:test TAP-style: "  not ok N - <name>"
  const notOk = out.matchAll(/^\s*not ok\s+\d+\s+-\s+(.+)$/gm);
  for (const m of notOk) failedTestNames.add(m[1].trim());
  // node:test failing tests block: file path lines like "src/__tests__/foo.test.ts" appear
  const fileMatches = out.matchAll(/(src\/__tests__\/[A-Za-z0-9_\-]+\.test\.ts)/g);
  for (const m of fileMatches) failedFiles.add(m[1]);
  return {
    failedFiles: Array.from(failedFiles),
    failedTestNames: Array.from(failedTestNames),
  };
}

// Seed is now generated by the harness (Node 24.13 lacks --test-shuffle).
// We carry it through the run record so the file order is reproducible
// via STABILITY_SEED=<n>.

function firstErrorExcerpt(out) {
  const idx = out.search(/Error:|AssertionError|not ok\s+\d+/);
  if (idx < 0) return null;
  return out.slice(Math.max(0, idx - 40), idx + 600).trim();
}

async function runOnce({ mode, runIndex, files, logPath, label, seed }) {
  const args = buildArgs(mode, files, runIndex);
  const cmdStr = `node ${args.join(" ")}`;
  const startedAt = new Date();
  const env = {
    ...process.env,
    TZ: process.env.TZ || "America/New_York",
  };
  if (ENV.STABILITY_ENV_VARIANT === "no-bot-token") {
    delete env.BOT_SERVICE_TOKEN;
  } else if (ENV.STABILITY_ENV_VARIANT === "tz-utc") {
    env.TZ = "UTC";
  }

  const child = spawn(process.execPath, args, {
    cwd: API_PKG_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const out = createWriteStream(logPath);
  let buf = "";
  const cap = (chunk) => { buf += chunk.toString(); out.write(chunk); };
  child.stdout.on("data", cap);
  child.stderr.on("data", cap);

  const timer = setTimeout(() => {
    try { child.kill("SIGKILL"); } catch {}
  }, ENV.STABILITY_RUN_TIMEOUT_MS);

  const exitCode = await new Promise((resolveExit) => {
    child.on("exit", (code, signal) => resolveExit(code ?? (signal ? 137 : 1)));
    child.on("error", () => resolveExit(1));
  });
  clearTimeout(timer);
  out.end();

  const endedAt = new Date();
  const failures = parseFailures(buf);
  const tags = tagFromOutput(buf);
  const excerpt = exitCode !== 0 ? firstErrorExcerpt(buf) : null;
  return {
    label,
    mode,
    runIndex,
    command: `(cwd=artifacts/api-server) ${cmdStr}`,
    files: files.length > 30 ? "<full-glob>" : files,
    fileCount: files.length,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    exitCode,
    seed,
    failedFiles: failures.failedFiles,
    failedTestNames: failures.failedTestNames,
    firstErrorExcerpt: excerpt,
    likelyRootCauseTags: tags,
    logPath: relative(REPO_ROOT, logPath),
  };
}

// ---------------- Isolation reruns ----------------
async function isolationReruns(failedFiles) {
  const reruns = [];
  for (const f of failedFiles) {
    let pass = 0, fail = 0;
    const logPaths = [];
    for (let i = 1; i <= ENV.STABILITY_ISOLATION_RERUNS; i++) {
      const ts = timestamp();
      const safe = f.replace(/[\/\\]/g, "_");
      const logPath = join(ENV.STABILITY_LOG_DIR, "isolation", `iso-${safe}-${ts}-${i}.log`);
      const r = await runOnce({
        mode: "single-file",
        runIndex: i,
        files: [f],
        logPath,
        label: `isolation:${f}`,
        seed: null,
      });
      logPaths.push(r.logPath);
      if (r.exitCode === 0) pass++; else fail++;
    }
    reruns.push({
      file: f,
      isolationPassCount: pass,
      isolationFailCount: fail,
      reproducesInIsolation: fail > 0,
      likelyOrderDependent: fail === 0,
      isolationLogPaths: logPaths,
    });
  }
  return reruns;
}

// ---------------- Main ----------------
async function main() {
  const summaryPath = join(ENV.STABILITY_LOG_DIR, "summary.json");
  const append = process.env.STABILITY_APPEND === "1" && existsSync(summaryPath);
  const session = append
    ? JSON.parse(readFileSync(summaryPath, "utf8"))
    : {
        schemaVersion: 1,
        sessionStartedAt: new Date().toISOString(),
        config: ENV,
        envSnapshotRedacted: envSnapshotRedacted(),
        runs: [],
        isolation: [],
      };
  const runOffset = append ? session.runs.length : 0;

  let baseFiles;
  try {
    baseFiles = expandFiles(ENV.STABILITY_MODE);
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(2);
  }
  console.log(`[stress-api-server] mode=${ENV.STABILITY_MODE} files=${baseFiles.length} runs=${ENV.STABILITY_RUNS}`);

  const aggregateFailedFiles = new Set();
  let anyFail = false;
  const baseSeed = process.env.STABILITY_SEED ?? String(Date.now());
  const shouldShuffle = ENV.STABILITY_MODE === "shuffle" || ENV.STABILITY_MODE === "suspect-files";

  for (let i = 1; i <= ENV.STABILITY_RUNS; i++) {
    const idx = runOffset + i;
    const ts = timestamp();
    const logPath = join(ENV.STABILITY_LOG_DIR, `run-${ts}-${idx}.log`);
    const seed = shouldShuffle ? `${baseSeed}-${idx}` : null;
    const files = shouldShuffle ? seededShuffle(baseFiles, seed) : baseFiles;
    const dbPre = await dbSnapshot();
    process.stdout.write(`[run ${idx} (${i}/${ENV.STABILITY_RUNS})] mode=${ENV.STABILITY_MODE} seed=${seed ?? "-"} ... `);
    const result = await runOnce({
      mode: ENV.STABILITY_MODE,
      runIndex: idx,
      files,
      logPath,
      label: `run-${idx}`,
      seed,
    });
    result.seed = seed;
    const dbPost = await dbSnapshot();
    const delta = deltaCounts(dbPre, dbPost);
    const enriched = {
      ...result,
      dbSnapshotPre: dbPre,
      dbSnapshotPost: dbPost,
      dbRowDelta: delta,
    };
    session.runs.push(enriched);
    console.log(`exit=${result.exitCode} dur=${result.durationMs}ms tags=${result.likelyRootCauseTags.join(",") || "-"} seed=${result.seed ?? "-"}`);
    if (result.exitCode !== 0) {
      anyFail = true;
      for (const f of result.failedFiles) aggregateFailedFiles.add(f);
      if (ENV.STABILITY_FAIL_FAST) break;
    }
    // Persist after every run so partial sessions are still useful
    writeFileSync(summaryPath, JSON.stringify(session, null, 2));
  }

  if (process.env.STABILITY_SKIP_ISOLATION !== "1") {
    // Aggregate failed files across the WHOLE session (incl. previously appended runs).
    const allFailedFiles = new Set();
    for (const r of session.runs) {
      for (const f of (r.failedFiles ?? [])) allFailedFiles.add(f);
    }
    if (allFailedFiles.size > 0) {
      console.log(`[stress-api-server] running isolation reruns for ${allFailedFiles.size} file(s)...`);
      session.isolation = await isolationReruns(Array.from(allFailedFiles));
    }
  }

  session.sessionEndedAt = new Date().toISOString();
  writeFileSync(summaryPath, JSON.stringify(session, null, 2));
  console.log(`[stress-api-server] summary written: ${relative(REPO_ROOT, summaryPath)}`);
  process.exit(anyFail && ENV.STABILITY_FAIL_FAST ? 1 : 0);
}

main().catch((e) => {
  console.error("[stress-api-server] fatal:", e);
  process.exit(2);
});
