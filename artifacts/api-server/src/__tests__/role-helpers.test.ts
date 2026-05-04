// Unit coverage for the role helpers + denyClerk middleware. Pure
// functions (no DB / no HTTP) so this runs in milliseconds.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isClerk,
  isAdmin,
  canSeeAmounts,
  canDoBulk,
  canEditSetup,
  scrubMoneyFields,
  scrubMoneyFieldsArray,
  scrubDashboardAmounts,
  dropAmountFiltersForUser,
} from "../lib/role";
import { denyClerk } from "../middlewares/denyClerk";

const admin = { role: "admin" } as const;
const user = { role: "user" } as const;
const clerk = { role: "clerk" } as const;

test("isClerk / isAdmin classify the three roles correctly", () => {
  assert.equal(isClerk(clerk), true);
  assert.equal(isClerk(user), false);
  assert.equal(isClerk(admin), false);
  assert.equal(isClerk(null), false);
  assert.equal(isClerk(undefined), false);

  assert.equal(isAdmin(admin), true);
  assert.equal(isAdmin(user), false);
  assert.equal(isAdmin(clerk), false);
});

test("canSeeAmounts / canDoBulk / canEditSetup deny only clerks", () => {
  for (const role of [admin, user]) {
    assert.equal(canSeeAmounts(role), true, `canSeeAmounts(${role.role})`);
    assert.equal(canDoBulk(role), true, `canDoBulk(${role.role})`);
    assert.equal(canEditSetup(role), true, `canEditSetup(${role.role})`);
  }
  assert.equal(canSeeAmounts(clerk), false);
  assert.equal(canDoBulk(clerk), false);
  assert.equal(canEditSetup(clerk), false);
});

test("scrubMoneyFields nulls money keys for clerks and is a no-op for others", () => {
  const row = { id: 1, claimAmount: "12.50", approvedAmount: "10.00", totalAmount: "22.50", status: "Open" };

  // Clerk: money nulled, non-money preserved.
  const clerkView = scrubMoneyFields({ ...row }, clerk);
  assert.equal(clerkView.claimAmount, null);
  assert.equal(clerkView.approvedAmount, null);
  assert.equal(clerkView.totalAmount, null);
  assert.equal(clerkView.id, 1);
  assert.equal(clerkView.status, "Open");

  // User + admin: untouched (we even check identity isn't mutated below).
  for (const r of [user, admin]) {
    const v = scrubMoneyFields({ ...row }, r);
    assert.equal(v.claimAmount, "12.50");
    assert.equal(v.approvedAmount, "10.00");
    assert.equal(v.totalAmount, "22.50");
  }

  // Money keys not present on the row are not invented (no `null` planted).
  const partial = scrubMoneyFields({ id: 7, status: "Open" } as Record<string, unknown>, clerk);
  assert.equal("claimAmount" in partial, false);
  assert.equal("approvedAmount" in partial, false);
  assert.equal("totalAmount" in partial, false);
});

test("scrubMoneyFieldsArray scrubs every row for clerks and is short-circuited for others", () => {
  const rows = [
    { id: 1, claimAmount: "1.00", totalAmount: "1.00" },
    { id: 2, claimAmount: "2.00", totalAmount: "2.00" },
  ];
  const out = scrubMoneyFieldsArray(rows.map(r => ({ ...r })), clerk);
  assert.equal(out.length, 2);
  for (const r of out) {
    assert.equal(r.claimAmount, null);
    assert.equal(r.totalAmount, null);
  }
  // Non-clerks: identity-equal pass-through (the function returns `rows`
  // directly, no mapping cost). This is a small but load-bearing
  // optimization on hot list endpoints, so we lock it in.
  const same = scrubMoneyFieldsArray(rows, admin);
  assert.equal(same, rows);
});

test("scrubDashboardAmounts nulls every known dashboard money key for clerks", () => {
  const amounts = {
    totalClaimed: "100",
    totalApproved: "80",
    totalExposure: "20",
    totalLost: "5",
    atRiskClaim: "10",
    atRiskExposure: "10",
    lostExpiredClaim: "2",
    lostExpiredExposure: "2",
    lostDeniedClaim: "3",
    lostDeniedExposure: "3",
    lostExposureTotal: "5",
    reclaimedApproved: "1",
    // A non-money sibling we expect to survive — proves the helper is
    // an allowlist over a known set, not a blanket "null everything".
    countOpen: 7,
  } as Record<string, unknown>;

  const clerkView = scrubDashboardAmounts({ ...amounts }, clerk);
  for (const key of [
    "totalClaimed", "totalApproved", "totalExposure", "totalLost",
    "atRiskClaim", "atRiskExposure",
    "lostExpiredClaim", "lostExpiredExposure",
    "lostDeniedClaim", "lostDeniedExposure",
    "lostExposureTotal", "reclaimedApproved",
  ]) {
    assert.equal(clerkView[key], null, `dashboard ${key} should be nulled for clerks`);
  }
  assert.equal(clerkView.countOpen, 7, "non-money sibling should be preserved");

  const adminView = scrubDashboardAmounts({ ...amounts }, admin);
  assert.equal(adminView.totalClaimed, "100");
  assert.equal(adminView.atRiskExposure, "10");
});

test("dropAmountFiltersForUser strips amountMin/amountMax for clerks only", () => {
  const q = { amountMin: "10", amountMax: "50", status: "Open" } as Record<string, unknown>;
  const clerkQ = dropAmountFiltersForUser({ ...q }, clerk);
  assert.equal("amountMin" in clerkQ, false);
  assert.equal("amountMax" in clerkQ, false);
  assert.equal(clerkQ.status, "Open");

  const adminQ = dropAmountFiltersForUser({ ...q }, admin);
  assert.equal(adminQ.amountMin, "10");
  assert.equal(adminQ.amountMax, "50");
});

test("denyClerk middleware: 403 for clerks, next() for admin/user/anonymous", () => {
  // Anonymous (req.user undefined) is *not* a clerk, so denyClerk lets
  // it through — auth is the responsibility of `requireAuth` upstream.
  // This matches the pattern used for `requireAdmin` / `requireApproved`.
  for (const u of [admin, user, undefined]) {
    let nextCalled = false;
    let statusCode: number | null = null;
    const req = { user: u } as { user?: { role?: string } };
    const res = {
      status(code: number) { statusCode = code; return this; },
      json(_body: unknown) { return this; },
    };
    const next = () => { nextCalled = true; };
    denyClerk(req as never, res as never, next as never);
    assert.equal(nextCalled, true, `next() should fire for role=${u?.role ?? "anonymous"}`);
    assert.equal(statusCode, null, `no status() for role=${u?.role ?? "anonymous"}`);
  }

  // Clerk: 403 with the documented error body.
  let nextCalled = false;
  let statusCode: number | null = null;
  let body: unknown = null;
  const req = { user: clerk } as { user: { role: string } };
  const res = {
    status(code: number) { statusCode = code; return this; },
    json(b: unknown) { body = b; return this; },
  };
  denyClerk(req as never, res as never, (() => { nextCalled = true; }) as never);
  assert.equal(nextCalled, false, "clerk must not pass through denyClerk");
  assert.equal(statusCode, 403);
  assert.deepEqual(body, { error: "Not available for your role" });
});
