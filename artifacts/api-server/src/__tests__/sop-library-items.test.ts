// Task #771 — round-trip integration test for the SOP library backend.
// Covers create → list → get → update → delete for both `kind` values
// (`evidence_requirement` and `sub_tree`).

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";

import sopLibraryItemsRouter from "../routes/sop-library-items";
import { db, pool, sopLibraryItemsTable } from "@workspace/db";

const TEST_USER = { email: "task-771-tester@example.com", displayName: "Task 771 Tester" };

let server: http.Server;
let baseUrl: string;

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved", role: "admin" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", sopLibraryItemsRouter);

  await new Promise<void>((resolveListen, rejectListen) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolveListen();
      } else {
        rejectListen(new Error("Failed to obtain test server port"));
      }
    });
  });
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await pool.end().catch(() => undefined);
});

async function request<T = any>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : undefined,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          let parsed: any = {};
          if (raw) {
            try { parsed = JSON.parse(raw); } catch { parsed = { _raw: raw }; }
          }
          resolveReq({ status: res.statusCode ?? 0, json: parsed as T });
        });
      },
    );
    req.on("error", rejectReq);
    if (payload) req.write(payload);
    req.end();
  });
}

async function cleanupItem(id: number) {
  await db.delete(sopLibraryItemsTable).where(eq(sopLibraryItemsTable.id, id)).catch(() => undefined);
}

test("Task #771: round-trip create → list → get → update → delete for kind=evidence_requirement", async () => {
  const label = `t771-ev-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const payload = {
    label: "Driver manifest",
    description: "Signed driver manifest for the trip",
    fileTypes: ["pdf", "image"],
    required: true,
  };

  const created = await request<{ id: number; kind: string; label: string; payload: any }>(
    "POST",
    "/api/sop-library-items",
    { kind: "evidence_requirement", label, description: "common evidence", payload },
  );
  assert.equal(created.status, 201, `expected 201, got ${created.status} (${JSON.stringify(created.json)})`);
  assert.equal(created.json.kind, "evidence_requirement");
  assert.equal(created.json.label, label);
  assert.deepEqual(created.json.payload, payload);
  const id = created.json.id;
  assert.ok(typeof id === "number" && id > 0, "create response must include numeric id");

  try {
    const list = await request<Array<{ id: number }>>("GET", "/api/sop-library-items");
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.json) && list.json.some((row) => row.id === id),
      "newly created item must appear in the list response");

    const got = await request<{ id: number; label: string }>("GET", `/api/sop-library-items/${id}`);
    assert.equal(got.status, 200);
    assert.equal(got.json.id, id);
    assert.equal(got.json.label, label);

    const newPayload = { ...payload, fileTypes: ["pdf"] };
    const updated = await request<{ id: number; label: string; description: string | null; payload: any }>(
      "PATCH",
      `/api/sop-library-items/${id}`,
      { label: `${label}-v2`, description: null, payload: newPayload },
    );
    assert.equal(updated.status, 200, `expected 200, got ${updated.status} (${JSON.stringify(updated.json)})`);
    assert.equal(updated.json.label, `${label}-v2`);
    assert.equal(updated.json.description, null);
    assert.deepEqual(updated.json.payload, newPayload);

    const deleted = await request("DELETE", `/api/sop-library-items/${id}`);
    assert.equal(deleted.status, 204);

    const missing = await request("GET", `/api/sop-library-items/${id}`);
    assert.equal(missing.status, 404, "GET after DELETE must return 404");
  } finally {
    await cleanupItem(id);
  }
});

test("Task #771: round-trip create → list → get → update → delete for kind=sub_tree", async () => {
  const label = `t771-st-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const payload = {
    rootId: "n1",
    nodes: [
      { id: "n1", prompt: "Eligible on date?", options: [
        { label: "Yes", childId: "n2" },
        { label: "No", outcomeType: "dispute" },
      ] },
      { id: "n2", prompt: "Pickup matches?", options: [] },
    ],
  };

  const created = await request<{ id: number; kind: string; payload: any }>(
    "POST",
    "/api/sop-library-items",
    { kind: "sub_tree", label, payload },
  );
  assert.equal(created.status, 201, `expected 201, got ${created.status} (${JSON.stringify(created.json)})`);
  assert.equal(created.json.kind, "sub_tree");
  assert.deepEqual(created.json.payload, payload);
  const id = created.json.id;

  try {
    const got = await request<{ kind: string; payload: any }>("GET", `/api/sop-library-items/${id}`);
    assert.equal(got.status, 200);
    assert.equal(got.json.kind, "sub_tree");
    assert.deepEqual(got.json.payload, payload);

    const list = await request<Array<{ id: number; kind: string }>>("GET", "/api/sop-library-items");
    assert.equal(list.status, 200);
    assert.ok(list.json.some((row) => row.id === id && row.kind === "sub_tree"),
      "sub_tree item must appear in the list response");

    const newPayload = { ...payload, rootId: "n2" };
    const updated = await request<{ payload: any }>(
      "PATCH",
      `/api/sop-library-items/${id}`,
      { payload: newPayload },
    );
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.json.payload, newPayload);

    const deleted = await request("DELETE", `/api/sop-library-items/${id}`);
    assert.equal(deleted.status, 204);

    const missing = await request("GET", `/api/sop-library-items/${id}`);
    assert.equal(missing.status, 404);
  } finally {
    await cleanupItem(id);
  }
});

test("Task #771: POST rejects unknown kind with 400 (CHECK constraint guard in app layer)", async () => {
  const res = await request("POST", "/api/sop-library-items", {
    kind: "not_a_real_kind",
    label: "x",
    payload: {},
  });
  assert.equal(res.status, 400, "unknown kind must be rejected with 400 before reaching the DB");
});
