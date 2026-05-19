import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";

import errorTypesRouter from "../routes/error-types";
import {
  db,
  pool,
  errorTypesTable,
  errorTypeVersionsTable,
} from "@workspace/db";

// Task #772 — SOP version history (backend).
//
// Round-trip: create an error type, edit it twice, list versions
// (expects 3 rows including the initial create), restore the first
// version, and assert the tree matches.

const TEST_USER = {
  email: "task-772-tester@example.com",
  displayName: "Task 772 Tester",
};

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
  app.use("/api", errorTypesRouter);

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

async function fetchJson<T = any>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;
    const headers: Record<string, string> = {};
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body).toString();
    }
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: init?.method ?? "GET",
        headers,
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          let parsed: any = {};
          if (raw) {
            try { parsed = JSON.parse(raw); }
            catch { parsed = { _raw: raw }; }
          }
          resolveReq({ status: res.statusCode ?? 0, json: parsed as T });
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

async function cleanup(id: number) {
  await db.delete(errorTypeVersionsTable).where(eq(errorTypeVersionsTable.errorTypeId, id)).catch(() => undefined);
  await db.delete(errorTypesTable).where(eq(errorTypesTable.id, id)).catch(() => undefined);
}

test("Task #772: create + two edits → list shows 3 versions, restore returns the original tree", async () => {
  const uniq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const initialTree = {
    rootId: "n1",
    nodes: [
      { id: "n1", prompt: "Initial?", options: [] },
    ],
  };

  // 1. Create
  const createRes = await fetchJson<any>(`/api/error-types`, {
    method: "POST",
    body: {
      name: `T772-ErrType-${uniq}`,
      description: "v1",
      decisionTree: initialTree,
    },
  });
  assert.equal(createRes.status, 201, `create failed: ${JSON.stringify(createRes.json)}`);
  const errorTypeId = createRes.json.id as number;

  try {
    // 2. Edit #1 — change description and grow the tree to 2 nodes.
    const edit1Res = await fetchJson<any>(`/api/error-types/${errorTypeId}`, {
      method: "PATCH",
      body: {
        description: "v2",
        decisionTree: {
          rootId: "n1",
          nodes: [
            { id: "n1", prompt: "Initial?", options: [] },
            { id: "n2", prompt: "Added?", options: [] },
          ],
        },
      },
    });
    assert.equal(edit1Res.status, 200, `edit1 failed: ${JSON.stringify(edit1Res.json)}`);

    // 3. Edit #2 — grow the tree to 3 nodes.
    const edit2Res = await fetchJson<any>(`/api/error-types/${errorTypeId}`, {
      method: "PATCH",
      body: {
        description: "v3",
        decisionTree: {
          rootId: "n1",
          nodes: [
            { id: "n1", prompt: "Initial?", options: [] },
            { id: "n2", prompt: "Added?", options: [] },
            { id: "n3", prompt: "Also added?", options: [] },
          ],
        },
      },
    });
    assert.equal(edit2Res.status, 200, `edit2 failed: ${JSON.stringify(edit2Res.json)}`);

    // 4. List versions — expect 3 rows, newest first, with operator email + tree counts.
    const listRes = await fetchJson<any>(`/api/error-types/${errorTypeId}/versions`);
    assert.equal(listRes.status, 200, `list failed: ${JSON.stringify(listRes.json)}`);
    assert.ok(Array.isArray(listRes.json), "list response must be an array");
    assert.equal(listRes.json.length, 3, `expected 3 versions (1 create + 2 edits), got ${listRes.json.length}`);

    // Newest first ordering — most recent edit's nodeCount=3 is first;
    // the original create's nodeCount=1 is last.
    assert.equal(listRes.json[0].treeNodeCount, 3, "newest snapshot should have the largest tree");
    assert.equal(listRes.json[2].treeNodeCount, 1, "oldest snapshot should be the initial create's tree");
    for (const row of listRes.json) {
      assert.equal(row.createdBy, TEST_USER.email, "createdBy must capture the operator email from req.user");
    }

    // 5. Restore the original (oldest) version.
    const originalVersionId = listRes.json[2].id as number;
    const restoreRes = await fetchJson<any>(
      `/api/error-types/${errorTypeId}/versions/${originalVersionId}/restore`,
      { method: "POST" },
    );
    assert.equal(restoreRes.status, 200, `restore failed: ${JSON.stringify(restoreRes.json)}`);
    assert.deepEqual(
      restoreRes.json.decisionTree,
      initialTree,
      "restored error type must carry the original tree exactly",
    );
    assert.equal(restoreRes.json.description, "v1", "restored description must match the original snapshot");

    // 6. The restore itself writes another snapshot — list is now 4.
    const listAfter = await fetchJson<any>(`/api/error-types/${errorTypeId}/versions`);
    assert.equal(listAfter.status, 200);
    assert.equal(listAfter.json.length, 4, "restore must append a fresh snapshot (4 = 1 create + 2 edits + 1 restore)");
    assert.equal(listAfter.json[0].treeNodeCount, 1, "newest snapshot after restore must reflect the restored 1-node tree");
  } finally {
    await cleanup(errorTypeId);
  }
});
