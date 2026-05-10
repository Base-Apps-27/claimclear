// Task #656 regression. The canonical evidence URL stored on
// claim_evidence.imageUrl is `/objects/<key>`; without a top-level
// `/objects/*` alias the request falls through to the SPA fallback and
// the operator sees a 401. Pinned in two parts:
//   1. Wiring: assert app.ts mounts the alias route (catches deletion
//      of the single-line fix).
//   2. Behavior: in an ad-hoc harness mirroring app.ts's wiring
//      (requireAuth + serveObjectEntity), assert that an authenticated
//      GET reaches the handler (404 from a stubbed ObjectNotFoundError,
//      content-type !== text/html), and that an unauthenticated GET
//      returns 401 from requireAuth.
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import express, { type Express, type Request, type Response, type NextFunction } from "express";

import { serveObjectEntity } from "../routes/storage";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";

let server: http.Server;
let baseUrl: string;
let authed = true;
const realGetObjectEntityFile = ObjectStorageService.prototype.getObjectEntityFile;

before(async () => {
  ObjectStorageService.prototype.getObjectEntityFile = async function () {
    throw new ObjectNotFoundError();
  };

  const harness: Express = express();
  harness.use((req: Request, _res: Response, next: NextFunction) => {
    const r = req as unknown as { user?: unknown; isAuthenticated: () => boolean; log: Record<string, (...a: unknown[]) => void> };
    if (authed) r.user = { id: "u1", email: "t@x", status: "approved", role: "operator" };
    r.isAuthenticated = () => authed;
    r.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  harness.get("/objects/*path", requireAuth, serveObjectEntity);
  harness.get("/{*splat}", (_req, res) => res.status(200).type("html").send("<html/>"));

  await new Promise<void>((r) => { server = harness.listen(0, () => r()); });
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(async () => {
  ObjectStorageService.prototype.getObjectEntityFile = realGetObjectEntityFile;
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
});

test("app.ts wires the top-level /objects/*path alias to serveObjectEntity behind requireAuth", () => {
  const appSrc = readFileSync(path.join(import.meta.dirname, "..", "app.ts"), "utf8");
  assert.match(
    appSrc,
    /app\.get\(\s*["']\/objects\/\*path["']\s*,\s*requireAuth\s*,\s*serveObjectEntity\s*\)/,
    "app.ts must mount GET /objects/*path with requireAuth + serveObjectEntity — removing this line breaks every evidence link",
  );
});

test("authed GET /objects/<path> reaches serveObjectEntity (404, not SPA HTML)", async () => {
  authed = true;
  const res = await fetch(`${baseUrl}/objects/uploads/abc.png`);
  assert.equal(res.status, 404, `expected 404 from ObjectNotFoundError, got ${res.status}`);
  const ct = (res.headers.get("content-type") ?? "").split(";")[0];
  assert.notEqual(ct, "text/html", "response should come from serveObjectEntity, not the SPA fallback");
});

test("unauthed GET /objects/<path> returns 401 from requireAuth", async () => {
  authed = false;
  const res = await fetch(`${baseUrl}/objects/uploads/abc.png`);
  assert.equal(res.status, 401);
});
