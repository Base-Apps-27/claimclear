// Regression: a degraded `connector_health` row for outlook must NOT
// suppress brief dispatch. The connector_health status drives the
// warning banner only; send eligibility comes from the live
// isOutlookConnected() reachability check. This test sets the health
// row to "degraded" with a lastError, posts the daily and weekly
// briefs, and asserts both routes still attempt sends.

import { test } from "node:test";
import { strict as assert } from "node:assert";

import { recordConnectorHealth, getConnectorHealth, type HealthStatus } from "../lib/connector-health";

interface BriefResponse {
  status: number;
  json: {
    method?: string;
    message?: string;
    outcome?: string;
    recipientCount?: number;
  };
}

const HEALTH_STATUSES: readonly HealthStatus[] = ["healthy", "degraded", "unhealthy", "unknown"];
function narrowHealthStatus(value: string | null | undefined): HealthStatus {
  return HEALTH_STATUSES.find((s) => s === value) ?? "healthy";
}

const BASE = `http://localhost:${process.env.PORT ?? "8080"}`;
const TOKEN = process.env.BOT_SERVICE_TOKEN ?? "";

async function postJson(path: string, body: Record<string, unknown>): Promise<BriefResponse> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bot-token": TOKEN },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as BriefResponse["json"];
  return { status: res.status, json };
}

test("degraded outlook health row does NOT suppress daily brief dispatch", async () => {
  const before = await getConnectorHealth("outlook");
  await recordConnectorHealth("outlook", "degraded", "synthetic test degradation");
  try {
    const { status, json } = await postJson("/api/daily-brief", {
      recipients: `degraded-health-daily-${Date.now()}@test.local`,
    });
    assert.equal(status, 200);
    // Critical: send must have been attempted. We accept ok or
    // degraded outcome (depends on whether outlook actually delivered),
    // but NEVER the "skipped … (Outlook connector unavailable)" path
    // — because connectivity, not health-row status, gates dispatch.
    assert.notEqual(json.method, "none", `dispatch was suppressed by degraded health: ${json.message}`);
    assert.equal(json.recipientCount, 1);
    assert.ok(json.outcome === "ok" || json.outcome === "degraded", `unexpected outcome ${json.outcome}: ${json.message}`);
  } finally {
    if (before) {
      await recordConnectorHealth(
        "outlook",
        narrowHealthStatus(before.status),
        before.lastError ?? null,
        (before.metadata as Record<string, unknown> | null) ?? undefined,
      );
    } else {
      await recordConnectorHealth("outlook", "healthy", null);
    }
  }
});

test("degraded outlook health row does NOT suppress weekly digest dispatch", async () => {
  const before = await getConnectorHealth("outlook");
  await recordConnectorHealth("outlook", "degraded", "synthetic test degradation");
  try {
    const { status, json } = await postJson("/api/daily-brief/weekly", {
      recipients: `degraded-health-weekly-${Date.now()}@test.local`,
    });
    assert.equal(status, 200);
    assert.notEqual(json.method, "none", `dispatch was suppressed by degraded health: ${json.message}`);
    assert.equal(json.recipientCount, 1);
    assert.ok(json.outcome === "ok" || json.outcome === "degraded", `unexpected outcome ${json.outcome}: ${json.message}`);
  } finally {
    if (before) {
      await recordConnectorHealth(
        "outlook",
        narrowHealthStatus(before.status),
        before.lastError ?? null,
        (before.metadata as Record<string, unknown> | null) ?? undefined,
      );
    } else {
      await recordConnectorHealth("outlook", "healthy", null);
    }
  }
});
