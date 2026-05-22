// POST /invoice-groups/:id/email-send — the legacy-thread fallback
// endpoint. The replier route (POST /invoice-groups/:id/email-thread/
// :conversationId/reply) cannot be used when the latest conversation
// row has no `conversationId` (legacy data), because that produces a
// malformed URL → 404. This route sends a fresh email instead, and is
// the destination the frontend routes to whenever `conversationId` is
// empty.
//
// Coverage:
//   - happy path: 200, outbound_emails row persisted with Graph's
//     echoed messageId+conversationId, audit_logs row written with
//     mode="fresh_send", response body is a ThreadMessage shape.
//   - validation: 400 on missing subject, missing bodyText, empty `to`.
//   - 404 when the group id does not exist.
//   - 502 when the Graph send throws.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import http from "node:http";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { eq, and } from "drizzle-orm";

import responseTrackerRouter, { __setSendImplForTesting } from "../routes/response-tracker";
import {
  db,
  pool,
  invoiceGroupsTable,
  outboundEmailsTable,
  auditLogsTable,
} from "@workspace/db";

let server: http.Server;
let baseUrl: string;

const TEST_USER = { email: "send-tester@example.com", displayName: "Send Tester" };

before(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = { ...TEST_USER, status: "approved" };
    (req as any).isAuthenticated = () => true;
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api", responseTrackerRouter);

  await new Promise<void>((resolveListen, rejectListen) => {
    server = app.listen(0, () => {
      const addr = server.address();
      if (typeof addr === "object" && addr) {
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolveListen();
      } else {
        rejectListen(new Error("no port"));
      }
    });
  });
});

after(async () => {
  __setSendImplForTesting(null);
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
  await pool.end().catch(() => undefined);
});

async function fetchJson<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; json: T }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolveReq, rejectReq) => {
    const body = init?.body !== undefined ? JSON.stringify(init.body) : undefined;
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: init?.method ?? "GET",
        headers: body
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString() }
          : {},
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            resolveReq({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : ({} as T) });
          } catch (e) { rejectReq(e); }
        });
      },
    );
    req.on("error", rejectReq);
    if (body) req.write(body);
    req.end();
  });
}

async function seedGroup(): Promise<typeof invoiceGroupsTable.$inferSelect> {
  const invoiceNumber = `T-SEND-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const [g] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber,
    status: "Awaiting Response",
    outcome: "Pending",
  }).returning();
  return g;
}

async function cleanupGroup(id: number): Promise<void> {
  await db.delete(outboundEmailsTable).where(eq(outboundEmailsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(auditLogsTable).where(eq(auditLogsTable.invoiceGroupId, id)).catch(() => undefined);
  await db.delete(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, id)).catch(() => undefined);
}

interface ThreadMessageShape {
  id: string;
  direction: "outbound" | "inbound";
  conversationId: string;
  subject: string | null;
  sender: string;
  bodyPreview: string | null;
  timestamp: string;
}

// ---- Happy path ----------------------------------------------------------

test("POST /invoice-groups/:id/email-send → persists outbound row, audit log, and returns ThreadMessage", async () => {
  const g = await seedGroup();
  try {
    let captured: any = null;
    __setSendImplForTesting(async (args) => {
      captured = args;
      return { messageId: "graph-msg-abc", conversationId: "graph-conv-xyz" };
    });

    const res = await fetchJson<ThreadMessageShape>(`/api/invoice-groups/${g.id}/email-send`, {
      method: "POST",
      body: {
        subject: "Following up on invoice " + g.invoiceNumber,
        bodyText: "Hello,\nPlease see attached.\n\nThanks",
        to: ["payor@example.com"],
        cc: ["cc@example.com"],
      },
    });

    assert.equal(res.status, 200, JSON.stringify(res.json));

    // Graph received an HTML-wrapped body with line breaks.
    assert.ok(captured, "sendImpl must have been invoked");
    assert.equal(captured.subject, "Following up on invoice " + g.invoiceNumber);
    assert.deepEqual(captured.to, ["payor@example.com"]);
    assert.deepEqual(captured.cc, ["cc@example.com"]);
    assert.ok(captured.html.includes("<br/>"), "plain-text newlines must become <br/> in the HTML body");
    assert.ok(captured.html.includes("Hello"));

    // Response shape: ThreadMessage with Graph's echoed conversationId.
    assert.equal(res.json.direction, "outbound");
    assert.equal(res.json.conversationId, "graph-conv-xyz");
    assert.equal(res.json.subject, "Following up on invoice " + g.invoiceNumber);
    assert.ok(res.json.id.startsWith("out-"));

    // outbound_emails row persisted with Graph identifiers.
    const outbound = await db.select().from(outboundEmailsTable)
      .where(eq(outboundEmailsTable.invoiceGroupId, g.id));
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].messageId, "graph-msg-abc");
    assert.equal(outbound[0].conversationId, "graph-conv-xyz");
    assert.equal(outbound[0].kind, "manual");
    assert.deepEqual(outbound[0].recipients, ["payor@example.com", "cc@example.com"]);
    assert.equal(outbound[0].sentByUserEmail, TEST_USER.email);

    // audit_logs row written with mode=fresh_send.
    const audits = await db.select().from(auditLogsTable)
      .where(and(
        eq(auditLogsTable.invoiceGroupId, g.id),
        eq(auditLogsTable.action, "email_reply_sent"),
      ));
    assert.equal(audits.length, 1);
    const meta = audits[0].metadata as Record<string, unknown>;
    assert.equal(meta.mode, "fresh_send");
    assert.equal(meta.scope, "invoice_group");
    assert.equal(meta.conversationId, "graph-conv-xyz");
    assert.equal(meta.outboundEmailId, outbound[0].id);
  } finally {
    await cleanupGroup(g.id);
  }
});

// ---- Validation ----------------------------------------------------------

test("400 when subject is missing or blank", async () => {
  const g = await seedGroup();
  try {
    __setSendImplForTesting(async () => ({ messageId: "x", conversationId: "y" }));
    const r1 = await fetchJson<{ error: string }>(`/api/invoice-groups/${g.id}/email-send`, {
      method: "POST",
      body: { bodyText: "hi", to: ["a@b.c"] },
    });
    assert.equal(r1.status, 400);
    assert.match(r1.json.error, /subject/i);

    const r2 = await fetchJson<{ error: string }>(`/api/invoice-groups/${g.id}/email-send`, {
      method: "POST",
      body: { subject: "   ", bodyText: "hi", to: ["a@b.c"] },
    });
    assert.equal(r2.status, 400);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("400 when bodyText is missing or blank", async () => {
  const g = await seedGroup();
  try {
    __setSendImplForTesting(async () => ({ messageId: "x", conversationId: "y" }));
    const res = await fetchJson<{ error: string }>(`/api/invoice-groups/${g.id}/email-send`, {
      method: "POST",
      body: { subject: "S", to: ["a@b.c"] },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /bodyText/i);
  } finally {
    await cleanupGroup(g.id);
  }
});

test("400 when `to` list is empty", async () => {
  const g = await seedGroup();
  try {
    __setSendImplForTesting(async () => ({ messageId: "x", conversationId: "y" }));
    const res = await fetchJson<{ error: string }>(`/api/invoice-groups/${g.id}/email-send`, {
      method: "POST",
      body: { subject: "S", bodyText: "hi", to: [] },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /to/i);
  } finally {
    await cleanupGroup(g.id);
  }
});

// ---- Not found -----------------------------------------------------------

test("404 when the invoice group does not exist", async () => {
  __setSendImplForTesting(async () => ({ messageId: "x", conversationId: "y" }));
  const res = await fetchJson<{ error: string }>(`/api/invoice-groups/99999999/email-send`, {
    method: "POST",
    body: { subject: "S", bodyText: "hi", to: ["a@b.c"] },
  });
  assert.equal(res.status, 404);
});

// ---- Upstream failure ----------------------------------------------------

test("502 when the Graph send throws", async () => {
  const g = await seedGroup();
  try {
    __setSendImplForTesting(async () => {
      throw new Error("Graph timeout");
    });
    const res = await fetchJson<{ error: string }>(`/api/invoice-groups/${g.id}/email-send`, {
      method: "POST",
      body: { subject: "S", bodyText: "hi", to: ["a@b.c"] },
    });
    assert.equal(res.status, 502);
    assert.match(res.json.error, /Graph timeout/);

    // Nothing persisted on failure.
    const outbound = await db.select().from(outboundEmailsTable)
      .where(eq(outboundEmailsTable.invoiceGroupId, g.id));
    assert.equal(outbound.length, 0);
    const audits = await db.select().from(auditLogsTable)
      .where(eq(auditLogsTable.invoiceGroupId, g.id));
    assert.equal(audits.length, 0);
  } finally {
    await cleanupGroup(g.id);
  }
});
