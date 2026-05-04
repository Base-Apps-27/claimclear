import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  isClerk,
  isAdmin,
  canSeeAmounts,
  canDoBulk,
  canEditSetup,
} from "./role-helpers";
import { formatCurrency } from "./format";

// These pure-function tests mirror the server-side role-helpers tests
// but run in the client bundle so a regression in the client-side
// classifier (which gates HideForClerk, the sidebar setup section,
// route DenyClerk wrappers, money-tile masking on Insights, etc.) is
// caught at `pnpm test`. The richer integration coverage —
// per-endpoint 403/200 + money scrub on responses — lives in
// api-server/src/__tests__/clerk-rbac.test.ts.

describe("role classifier helpers (client)", () => {
  test("isClerk identifies only clerk role", () => {
    assert.equal(isClerk({ role: "clerk" }), true);
    assert.equal(isClerk({ role: "admin" }), false);
    assert.equal(isClerk({ role: "user" }), false);
    assert.equal(isClerk(null), false);
    assert.equal(isClerk(undefined), false);
    assert.equal(isClerk({}), false);
    assert.equal(isClerk({ role: null }), false);
  });

  test("isAdmin identifies only admin role", () => {
    assert.equal(isAdmin({ role: "admin" }), true);
    assert.equal(isAdmin({ role: "clerk" }), false);
    assert.equal(isAdmin({ role: "user" }), false);
    assert.equal(isAdmin(null), false);
  });

  test("canSeeAmounts denies only clerks (admin/user/anon allowed)", () => {
    assert.equal(canSeeAmounts({ role: "admin" }), true);
    assert.equal(canSeeAmounts({ role: "user" }), true);
    assert.equal(canSeeAmounts(null), true);
    assert.equal(canSeeAmounts({ role: "clerk" }), false);
  });

  test("canDoBulk denies only clerks", () => {
    assert.equal(canDoBulk({ role: "admin" }), true);
    assert.equal(canDoBulk({ role: "user" }), true);
    assert.equal(canDoBulk({ role: "clerk" }), false);
  });

  test("canEditSetup denies only clerks", () => {
    assert.equal(canEditSetup({ role: "admin" }), true);
    assert.equal(canEditSetup({ role: "user" }), true);
    assert.equal(canEditSetup({ role: "clerk" }), false);
  });
});

// formatCurrency is the renderer for every money cell in the app.
// For clerks the server nulls money fields, so this function is what
// makes the resulting cell display "—" instead of "$NaN" or "$0.00".
describe("formatCurrency renders '—' for nulled money fields", () => {
  test("null/undefined → '—' (clerk-scrubbed value path)", () => {
    assert.equal(formatCurrency(null), "—");
    assert.equal(formatCurrency(undefined), "—");
  });

  test("real number / string formats normally for admin/user", () => {
    assert.equal(formatCurrency(123.45), "$123.45");
    assert.equal(formatCurrency("99.50"), "$99.50");
    assert.equal(formatCurrency(0), "$0.00");
  });

  test("garbage string → '—' (defensive)", () => {
    assert.equal(formatCurrency("not-a-number"), "—");
  });
});
