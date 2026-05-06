// End-to-end RBAC contract: every endpoint the clerk role is supposed
// to be denied from is hit with each role and the response is asserted.
// Boots a real Express app with the production routers, but injects
// `req.user` from a header so we don't need a real auth flow.
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";

import claimsRouter from "../routes/claims";
import invoiceGroupsRouter from "../routes/invoice-groups";
import portalSubmissionsRouter from "../routes/portal-submissions";
import errorTypesRouter from "../routes/error-types";
import appSettingsRouter from "../routes/app-settings";
import importRouter from "../routes/import";
import batchJobsRouter from "../routes/batch-jobs";
import adminRouter from "../routes/admin";

let server: http.Server;
let basePort: number;

const ADMIN_USER = { id: "u_admin", role: "admin", email: "admin@example.com", status: "approved" };
const USER_USER = { id: "u_user", role: "user", email: "user@example.com", status: "approved" };
const CLERK_USER = { id: "u_clerk", role: "clerk", email: "clerk@example.com", status: "approved" };

before(async () => {
  const app: Express = express();
  app.use(express.json());

  // Inject req.user from `x-test-role` so we can simulate each role
  // without booting the real OIDC flow. The production middleware
  // chain populates req.user from the session — denyClerk only reads
  // req.user.role, so a header-driven shim is faithful enough.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const role = (req.headers["x-test-role"] as string | undefined) ?? "";
    if (role === "admin") (req as unknown as { user: typeof ADMIN_USER }).user = ADMIN_USER;
    else if (role === "user") (req as unknown as { user: typeof USER_USER }).user = USER_USER;
    else if (role === "clerk") (req as unknown as { user: typeof CLERK_USER }).user = CLERK_USER;
    // Stub passport's req.isAuthenticated so requireAuth/requireAdmin
    // (which call it) don't 500 in this test harness.
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () => Boolean(role);
    next();
  });

  app.use("/api", claimsRouter);
  app.use("/api", invoiceGroupsRouter);
  app.use("/api", portalSubmissionsRouter);
  app.use("/api", errorTypesRouter);
  app.use("/api", appSettingsRouter);
  app.use("/api/import", importRouter);
  app.use("/api", batchJobsRouter);
  app.use("/api", adminRouter);

  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        basePort = addr.port;
        resolve();
      } else {
        reject(new Error("Failed to obtain test server port"));
      }
    });
  });
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface HttpResult {
  status: number;
  body: string;
}

function request(opts: {
  method: string;
  path: string;
  role: "admin" | "user" | "clerk" | "anonymous";
  body?: unknown;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.role !== "anonymous") headers["x-test-role"] = opts.role;
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : null;
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(payload));
    }
    const req = http.request(
      { hostname: "127.0.0.1", port: basePort, path: opts.path, method: opts.method, headers },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: raw }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ===== Endpoint × role matrix =====
//
// For each row we assert:
//   - clerk gets exactly 403 (denied by denyClerk)
//   - admin/user get something OTHER than 403 (200/400/404 are all fine —
//     we are checking the gate, not the handler's input validation).
// `adminOnly: true` means the endpoint is gated by `requireAdmin`,
// which already rejects clerks (admin-only ⇒ clerk denied). For those
// rows we still assert clerk gets 403, but we skip the "user passes"
// check because requireAdmin denies `user` too.
const GATED_ENDPOINTS: Array<{
  method: string;
  path: string;
  body?: unknown;
  label: string;
  adminOnly?: boolean;
}> = [
  // Setup writes
  { method: "POST",   path: "/api/error-types",                        label: "POST /error-types",        body: { name: "x", description: "x" } },
  { method: "PATCH",  path: "/api/error-types/999999",                 label: "PATCH /error-types/:id",   body: { name: "x" } },
  { method: "DELETE", path: "/api/error-types/999999",                 label: "DELETE /error-types/:id" },
  { method: "PUT",    path: "/api/app-settings",                       label: "PUT /app-settings",        body: {}, adminOnly: true },
  { method: "POST",   path: "/api/import",                             label: "POST /import",             body: {} },

  // Bulk / batch
  { method: "POST",   path: "/api/portal-submissions/batch-process",   label: "POST /portal-submissions/batch-process", body: {} },
  { method: "POST",   path: "/api/portal-submissions/batch-abort/abc", label: "POST /portal-submissions/batch-abort/:batchId", body: {} },
  { method: "GET",    path: "/api/claims/export-csv",                  label: "GET /claims/export-csv" },
  { method: "POST",   path: "/api/claims/bulk-assign-error-type",      label: "POST /claims/bulk-assign-error-type",    body: { ids: [], errorTypeId: 1 } },
  { method: "GET",    path: "/api/invoice-groups/export-csv",          label: "GET /invoice-groups/export-csv" },
  { method: "POST",   path: "/api/invoice-groups",                     label: "POST /invoice-groups",                   body: { invoiceNumber: "RBAC-TEST", legs: [{ confNumber: "RBAC-CONF" }] } },
  { method: "POST",   path: "/api/invoice-groups/bulk-assign-error-type", label: "POST /invoice-groups/bulk-assign-error-type", body: { ids: [], errorTypeId: 1 } },

  // Admin (gated by requireAdmin which also rejects clerk)
  { method: "GET",    path: "/api/admin/audit-logs.csv",               label: "GET /admin/audit-logs.csv", adminOnly: true },
];

for (const ep of GATED_ENDPOINTS) {
  test(`clerk is denied (403): ${ep.label}`, async () => {
    const res = await request({ method: ep.method, path: ep.path, role: "clerk", body: ep.body });
    assert.equal(res.status, 403, `clerk should get 403 on ${ep.label}, got ${res.status}: ${res.body.slice(0, 200)}`);
  });

  test(`admin is not denied (≠403): ${ep.label}`, async () => {
    const res = await request({ method: ep.method, path: ep.path, role: "admin", body: ep.body });
    assert.notEqual(res.status, 403, `admin should not get 403 on ${ep.label}, got ${res.status}`);
  });

  if (!ep.adminOnly) {
    test(`user is not denied (≠403): ${ep.label}`, async () => {
      const res = await request({ method: ep.method, path: ep.path, role: "user", body: ep.body });
      assert.notEqual(res.status, 403, `user should not get 403 on ${ep.label}, got ${res.status}`);
    });
  }
}

test("clerk reads /claims with money nulled and amountMin/amountMax stripped", async () => {
  const res = await request({
    method: "GET",
    path: "/api/claims?amountMin=100&amountMax=200&limit=1",
    role: "clerk",
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.body.slice(0, 200)}`);
  const json = JSON.parse(res.body) as { claims: Array<{ claimAmount: unknown; approvedAmount: unknown }> };
  assert.ok(Array.isArray(json.claims), "expected claims array");
  for (const c of json.claims) {
    assert.equal(c.claimAmount, null, "claimAmount must be null for clerks");
    assert.equal(c.approvedAmount, null, "approvedAmount must be null for clerks");
  }
});

test("clerk reads /invoice-groups with totalAmount nulled", async () => {
  const res = await request({
    method: "GET",
    path: "/api/invoice-groups?limit=1",
    role: "clerk",
  });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${res.body.slice(0, 200)}`);
  const json = JSON.parse(res.body) as { groups: Array<{ totalAmount: unknown }> };
  assert.ok(Array.isArray(json.groups), "expected groups array");
  for (const g of json.groups) {
    assert.equal(g.totalAmount, null, "totalAmount must be null for clerks");
  }
});
