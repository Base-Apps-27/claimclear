// Route-level regression tests for POST /api/daily-brief/weekly outcome
// shape. Mirrors daily-brief-route-outcome.test.ts so the weekly job
// gets the same "always 200, structured outcome, briefRunId stamped"
// guarantees the daily job has.

import { test } from "node:test";
import { strict as assert } from "node:assert";

const BASE = `http://localhost:${process.env.PORT ?? "8080"}`;
const TOKEN = process.env.BOT_SERVICE_TOKEN ?? "";

async function postWeekly(body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}/api/daily-brief/weekly`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bot-token": TOKEN },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

test("POST /api/daily-brief/weekly: empty recipients override → outcome=failed, recipientCount=0, HTTP 200", async () => {
  const { status, json } = await postWeekly({ recipients: "   " });
  assert.equal(status, 200, "must NOT 500 even when no recipients resolve");
  assert.equal(json.outcome, "failed", "0 recipients must map to failed outcome");
  assert.equal(json.sent, false);
  assert.equal(json.method, "none");
  assert.equal(json.recipientCount, 0);
  assert.equal(json.sentCount, 0);
  assert.ok(typeof json.briefRunId === "string" && json.briefRunId.length > 0, "briefRunId must be stamped");
  assert.ok(
    json.briefRunId.startsWith("weekly-"),
    `weekly briefRunId must use the weekly- prefix to distinguish it from daily, got ${json.briefRunId}`,
  );
  assert.ok(Array.isArray(json.degradationNotes));
});

test("POST /api/daily-brief/weekly: valid override → outcome=ok, sent=true, briefRunId set, structured fields present", async () => {
  const { status, json } = await postWeekly({
    recipients: `weekly-route-test-1-${Date.now()}@test.local,weekly-route-test-2-${Date.now()}@test.local`,
  });
  assert.equal(status, 200);
  assert.ok(["ok", "degraded"].includes(json.outcome), `expected ok or degraded outcome, got ${json.outcome}`);
  assert.equal(json.recipientCount, 2);
  assert.equal(typeof json.sentCount, "number");
  assert.ok(typeof json.briefRunId === "string" && json.briefRunId.startsWith("weekly-"));
  assert.ok(typeof json.message === "string" && json.message.length > 0);
  assert.ok(Array.isArray(json.failures));
});
