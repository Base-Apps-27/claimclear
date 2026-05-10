// Task #660 V2 — Discovery completeness check.
//
// Scans the ClaimClear source tree (and the api-server source tree)
// for walk/submit-flavored CTAs that point at the standalone
// `/claims/:id` or `/invoice-groups/:id` detail pages. Every such
// hit must live in an allowlisted file (the detail-page surfaces
// themselves, the queue, list pages, audit/reference surfaces, etc.)
// or the test fails — that is how future drift is caught when a new
// hero / banner / inbox row is added without retargeting it at the
// queue.
//
// The patterns and the allowlist are written verbatim here so the
// reviewer can see exactly what the sweep covers. Each allowlist
// entry carries a one-line reason explaining why the file may
// legitimately reference a detail-page URL.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// ─── Repo roots ────────────────────────────────────────────────────
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const CLAIMCLEAR_SRC = resolve(REPO_ROOT, "artifacts/claimclear/src");
const API_SERVER_SRC = resolve(REPO_ROOT, "artifacts/api-server/src");

// ─── Patterns ──────────────────────────────────────────────────────
// Cover every shape we expect a CTA / URL builder to take:
//   • template literal:    `/claims/${id}` / `/invoice-groups/${id}`
//   • inside backticks:    `…/claims/${id}/…`
//   • string concat:       '/claims/' + id  ·  "/invoice-groups/" + id
//   • interpolation:       href={`/claims/${id}`}
// Plus programmatic-navigation forms (navigate / setLocation / goto
// / window.open / window.location.assign) that take the same path.
const DETAIL_HREF_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "template-literal-claims", re: /["`']\/claims\/\$\{[^}]+\}/ },
  { kind: "template-literal-groups", re: /["`']\/invoice-groups\/\$\{[^}]+\}/ },
  {
    kind: "embedded-template-claims",
    re: /`[^`]*\/claims\/\$\{[^}]+\}[^`]*`/,
  },
  {
    kind: "embedded-template-groups",
    re: /`[^`]*\/invoice-groups\/\$\{[^}]+\}[^`]*`/,
  },
  {
    kind: "concat-claims",
    re: /["']\/claims\/["']\s*\+/,
  },
  {
    kind: "concat-groups",
    re: /["']\/invoice-groups\/["']\s*\+/,
  },
  {
    kind: "navigate-call-claims",
    re: /(?:navigate|setLocation|goto|window\.open|window\.location\.assign)\s*\(\s*[`"']\/claims\/\$\{/,
  },
  {
    kind: "navigate-call-groups",
    re: /(?:navigate|setLocation|goto|window\.open|window\.location\.assign)\s*\(\s*[`"']\/invoice-groups\/\$\{/,
  },
];

// ─── Allowlist (file → reason) ─────────────────────────────────────
// Every entry must carry a concrete reason that survives review.
const ALLOWLIST: ReadonlyMap<string, string> = new Map([
  // Route definitions — register the pages, do not navigate to them.
  ["artifacts/claimclear/src/App.tsx", "wouter <Route path=> registration"],

  // Queue + detail surfaces — blocklisted by Task #660; they own the
  // surfaces and may reference detail URLs internally.
  ["artifacts/claimclear/src/pages/queue.tsx", "queue surface (blocklisted)"],
  ["artifacts/claimclear/src/pages/claim-detail.tsx", "detail surface (blocklisted)"],
  ["artifacts/claimclear/src/pages/invoice-group-detail.tsx", "detail surface (blocklisted)"],
  ["artifacts/claimclear/src/components/claim-detail-v2.tsx", "detail surface (blocklisted)"],
  ["artifacts/claimclear/src/components/invoice-group-detail-v2.tsx", "detail surface (blocklisted)"],
  ["artifacts/claimclear/src/components/inline-group-workspace-mini.tsx", "queue inline workspace (blocklisted)"],
  ["artifacts/claimclear/src/components/chip-drawer-overlay.tsx", "right-edge chip drawer; only escape-hatch ↗ 'Open full view'/'Open full activity view' arrows reference detail URLs (Task #678)"],
  ["artifacts/claimclear/src/components/invoice-group-submission-gauntlet.tsx", "submission gauntlet (blocklisted)"],
  ["artifacts/claimclear/src/components/decision-tree/sop-advance-player.tsx", "SOP player (blocklisted)"],

  // List / directory pages — row navigation IS the list contract;
  // these pages never host walk/submit CTAs.
  ["artifacts/claimclear/src/pages/claims.tsx", "list-page row navigation + 'View details' menu"],
  ["artifacts/claimclear/src/pages/invoice-groups.tsx", "list-page row navigation + 'View details' menu"],

  // Reference / escape-hatch / closed-state surfaces. Each link
  // here is explicitly labeled "Open full details" / "↗" / a search
  // result / an audit pointer / a closure-summary anchor — never a
  // walk or submit action.
  ["artifacts/claimclear/src/pages/admin-user-activity.tsx", "audit log drilldown pointer"],
  ["artifacts/claimclear/src/pages/responses-awaiting-review.tsx", "'Open full details' escape-hatch buttons"],
  ["artifacts/claimclear/src/pages/claim-new.tsx", "post-create navigation to the newly created leg"],
  ["artifacts/claimclear/src/pages/invoice-new.tsx", "post-create navigation + duplicate-group conflict redirect"],
  ["artifacts/claimclear/src/components/activity-feed.tsx", "'via INV-…' audit-trail badge"],
  ["artifacts/claimclear/src/components/header-search.tsx", "global search results"],
  ["artifacts/claimclear/src/components/portal-submission-drawer.tsx", "drawer breadcrumb back to the submitted group"],
  ["artifacts/claimclear/src/components/conversations-card.tsx", "embedded sibling-leg reference inside a chat message"],
  ["artifacts/claimclear/src/components/communication/group-communication-thread.tsx", "leg reference rendered inside a thread"],
  ["artifacts/claimclear/src/components/withdrawal-review-drawer.tsx", "review drawer breadcrumb"],
  ["artifacts/claimclear/src/components/invoice-group-legs-list.tsx", "leg list table-row link (list contract)"],
  ["artifacts/claimclear/src/components/service-date-cell.tsx", "empty-state 'Open group' / 'Review legs' anchor"],
  ["artifacts/claimclear/src/components/queue-needs-review-panel.tsx", "'Open in full view' escape-hatch"],
  ["artifacts/claimclear/src/components/queue-response-review-panel.tsx", "'↗' drilldown + response-anchor jump"],
  ["artifacts/claimclear/src/components/group-dossier-chrome.tsx", "renders the queue-deep-link CTA + breadcrumb"],
  ["artifacts/claimclear/src/components/attestation/group-review-pane.tsx", "completion pane reference"],
  ["artifacts/claimclear/src/components/attestation/completed-detail-pane.tsx", "completed-detail reference"],
  ["artifacts/claimclear/src/components/urgent-today-why.tsx", "'Cleared today' rows are reference-only (currently-urgent rows already route to /queue)"],

  // Tour fixtures — synthetic deep-links into the detail pages used
  // to highlight them while teaching the operator.
  ["artifacts/claimclear/src/tour/admin-tour.tsx", "tour synthetic deep-links to detail pages"],

  // API-server route definitions — declare these endpoints; they do
  // not render an operator-facing CTA.
  ["artifacts/api-server/src/routes/claims.ts", "Express route declarations"],
  ["artifacts/api-server/src/routes/invoice-groups.ts", "Express route declarations"],
  ["artifacts/api-server/src/routes/portal-submissions.ts", "Express route declarations"],
  ["artifacts/api-server/src/routes/dashboard.ts", "Express route declarations"],
  ["artifacts/api-server/src/routes/daily-brief.ts", "admin-brief 'Needs filing now' table — admin oversight surface, not an operator walk CTA"],

  // Audit-log humanizer — emits an `href` for *audit reference* into
  // the activity feed (drilldown pointer, not a walk/submit CTA).
  ["artifacts/api-server/src/lib/activity-humanizer.ts", "audit-feed drilldown href"],

  // Operator daily brief — primary CTAs are queueGroupHref/queueLegHref
  // (Task #660); the only remaining detail-page literals are the
  // documented orphan-leg fallback for legs whose invoiceGroupId is null.
  ["artifacts/api-server/src/lib/brief-personalization.ts", "documented orphan-leg fallback only — primary path is the queue helper"],
]);

// File extensions to scan.
const EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".tsx"]);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".turbo") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile()) {
      const dot = name.lastIndexOf(".");
      if (dot >= 0 && EXTENSIONS.has(name.slice(dot))) yield full;
    }
  }
}

function isTestFile(absPath: string): boolean {
  return /\.test\.tsx?$/.test(absPath) || absPath.includes("/__tests__/");
}

interface Hit {
  file: string;
  line: number;
  pattern: string;
  snippet: string;
}

function scan(rootAbs: string): Hit[] {
  const hits: Hit[] = [];
  for (const abs of walk(rootAbs)) {
    if (isTestFile(abs)) continue;
    const rel = relative(REPO_ROOT, abs).split("\\").join("/");
    if (ALLOWLIST.has(rel)) continue;
    const text = readFileSync(abs, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip /api/... fetch URLs — they are SSE / REST clients, not
      // operator CTAs (the patterns above accidentally hit them).
      if (/\/api\/(claims|invoice-groups)\//.test(line)) continue;
      for (const { kind, re } of DETAIL_HREF_PATTERNS) {
        if (re.test(line)) {
          hits.push({ file: rel, line: i + 1, pattern: kind, snippet: line.trim() });
          break;
        }
      }
    }
  }
  return hits;
}

test("Task #660 V2 — no walk/submit CTAs point at detail pages outside the allowlist", () => {
  const hits = [...scan(CLAIMCLEAR_SRC), ...scan(API_SERVER_SRC)];
  if (hits.length > 0) {
    const report = hits
      .map((h) => `  [${h.pattern}] ${h.file}:${h.line}  ${h.snippet}`)
      .join("\n");
    assert.fail(
      `Found ${hits.length} detail-page href(s) outside the Task #660 allowlist.\n` +
        `Each must either be retargeted at /queue?group=<id>[&leg=<legId>] (use ` +
        `the queueGroupHref / queueLegHref helpers) or, if it is a legitimate ` +
        `reference / escape-hatch / list-row / route definition, added to the ` +
        `ALLOWLIST in cta-sweep-completeness.test.ts with a one-line reason.\n\n${report}`,
    );
  }
});

test("Task #660 V2 — every allowlist entry still exists (prevent stale exemptions)", () => {
  const stale: string[] = [];
  for (const rel of ALLOWLIST.keys()) {
    const abs = resolve(REPO_ROOT, rel);
    try {
      statSync(abs);
    } catch {
      stale.push(rel);
    }
  }
  assert.equal(
    stale.length,
    0,
    `Stale allowlist entries (file no longer exists):\n${stale.map((s) => `  - ${s}`).join("\n")}\n` +
      `Remove them from ALLOWLIST in cta-sweep-completeness.test.ts.`,
  );
});
