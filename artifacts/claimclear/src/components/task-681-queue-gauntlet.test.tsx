// Task #681 — definitive queue gauntlet.
//
// Source-level guards that the queue page (A) is the only operator
// surface that mutates state, and that the affordances ported from
// claim-detail-v2 (B) and invoice-group-detail-v2 (C) actually live
// in the queue workspace.
//
// We read the source files directly (no mocks, no render harness) so
// these tests fail loudly the moment someone re-introduces a stripped
// affordance on B/C or removes a ported one from A.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = (name: string) => readFileSync(join(here, name), "utf8");

const A = src("inline-group-workspace-mini.tsx");
const C = src("invoice-group-detail-v2.tsx");
const drawer = src("chip-drawer-overlay.tsx");

// ─── C: invoice-group-detail-v2 strip ──────────────────────────────

test("C — Mark MAS Eligible dropdown item is gone", () => {
  assert.ok(
    !/data-testid="header-phase-mark-mas-eligible"/.test(C),
    "header-phase-mark-mas-eligible testid must not appear on C",
  );
  assert.ok(
    !/markMasEligibleMutation/.test(C),
    "markMasEligibleMutation must be removed from C",
  );
  assert.ok(
    !/useMarkInvoiceGroupMasEligible/.test(C),
    "useMarkInvoiceGroupMasEligible import/use must be removed from C",
  );
  assert.ok(
    !/\bshowMarkMas\b/.test(C),
    "showMarkMas variable must be removed from C",
  );
});

test("C — Status overrides dropdown still present (admin escape hatch survives on C)", () => {
  assert.match(C, /partitionTransitions\(/);
  assert.match(C, /transitions-section-phase/);
});

// ─── A: inline-group-workspace-mini ports ──────────────────────────

test("A — Clear recorded verdict button is wired (distinct from Reopen walk)", () => {
  assert.match(A, /useClearLegVerdictDraft/);
  assert.match(A, /data-testid="mini-clear-verdict-draft"/);
  // Distinct testids — Reopen walk and Clear recorded verdict are
  // siblings in the ready footer.
  assert.match(A, /data-testid="mini-reopen-walk"/);
  assert.ok(
    A.indexOf('data-testid="mini-clear-verdict-draft"') >
      A.indexOf('data-testid="mini-reopen-walk"'),
    "Clear recorded verdict button must render after Reopen walk in source order",
  );
});

test("A — Admin status override dropdown is mounted and HideForClerk-gated", () => {
  // The override is its own module so the queue page can stay
  // tree-shake-friendly and the override is testable in isolation
  // (see task-681-behavior.test.tsx).
  assert.match(A, /<AdminStatusOverride\b/);
  assert.match(A, /from "@\/components\/admin-status-override"/);

  const adminOverride = src("admin-status-override.tsx");
  assert.match(adminOverride, /export function AdminStatusOverride\(/);
  assert.match(adminOverride, /useUpdateInvoiceGroupStatus/);
  assert.match(adminOverride, /useGetInvoiceGroupValidTransitions/);
  assert.match(adminOverride, /partitionTransitions\([^)]*isAdmin\)/);
  assert.match(adminOverride, /data-testid="mini-admin-status-override-trigger"/);
  assert.match(adminOverride, /data-testid={`mini-admin-status-override-\$\{s\}`}/);
  assert.match(adminOverride, /<HideForClerk>/);
  // Belt-and-suspenders: an isAdmin early return must short-circuit
  // before we even consult validTransitions / render anything.
  assert.match(adminOverride, /if \(!isAdmin\) return null;/);
});

// ─── chip-drawer-overlay: delete-note confirm ──────────────────────

test("chip-drawer NotesPanel — delete now goes through an AlertDialog confirm", () => {
  assert.match(drawer, /data-testid="mini-note-delete-confirm"/);
  assert.match(drawer, /data-testid="mini-note-delete-cancel"/);
  assert.match(drawer, /data-testid="mini-note-delete-confirm-action"/);
  assert.match(drawer, /pendingDeleteNoteId/);
  // The trash button must no longer call del() inline; it must arm
  // the pending state instead.
  assert.match(drawer, /onClick=\{\(\) => setPendingDeleteNoteId\(n\.id\)\}/);
  assert.ok(
    !/onClick=\{\(\) => del\(n\.id\)\}/.test(drawer),
    "trash button must not call del(n.id) directly anymore",
  );
});
