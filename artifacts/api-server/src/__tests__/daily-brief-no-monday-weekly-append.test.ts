// Guardrail: the daily ops brief must NOT append the weekly digest
// section on Mondays. Task #721 split the weekly executive digest into
// its own POST /api/daily-brief/weekly route + WEEKLY_DIGEST cron, so
// the daily renderer should no longer reach into weekly-digest helpers
// or branch on isMondayInNewYork.
//
// We assert by source-scanning the daily-body renderer for the legacy
// helpers. If a future patch reintroduces the Monday append, this
// test fails immediately.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DAILY_BODY_PATH = join(HERE, "..", "lib", "daily-brief", "daily-body.ts");
const ROUTE_PATH = join(HERE, "..", "routes", "daily-brief.ts");

const FORBIDDEN_IN_DAILY_BODY: { name: string; re: RegExp }[] = [
  { name: "isMondayInNewYork branch", re: /isMondayInNewYork/ },
  { name: "getWeeklyDigest call", re: /getWeeklyDigest\b/ },
  { name: "renderWeeklyDigestSection", re: /renderWeeklyDigestSection/ },
  { name: "renderWeeklyExecBody appended into daily", re: /renderWeeklyExecBody/ },
];

test("daily-body.ts does NOT import or call any weekly-digest helper", () => {
  const src = readFileSync(DAILY_BODY_PATH, "utf8");
  for (const { name, re } of FORBIDDEN_IN_DAILY_BODY) {
    assert.equal(
      re.test(src),
      false,
      `daily-body.ts contains forbidden pattern "${name}" — the weekly digest is now its own route.`,
    );
  }
});

test("daily-brief route POST / does NOT call renderWeeklyExecBody (weekly is a separate route)", () => {
  const src = readFileSync(ROUTE_PATH, "utf8");
  // The weekly route IS in this file (router.post('/weekly', ...)) so
  // renderWeeklyExecBody appearing in the file is fine — but it must
  // ONLY appear inside the /weekly handler, not inside POST /. We
  // approximate that by checking the daily handler block does not
  // contain the call.
  const dailyHandlerStart = src.indexOf('router.post(\n  "/"');
  const weeklyHandlerStart = src.indexOf('router.post(\n  "/weekly"');
  assert.ok(dailyHandlerStart >= 0, "expected daily POST / handler in routes/daily-brief.ts");
  assert.ok(weeklyHandlerStart > dailyHandlerStart, "expected weekly handler after daily handler");
  const dailyHandlerSrc = src.slice(dailyHandlerStart, weeklyHandlerStart);
  assert.equal(
    /renderWeeklyExecBody/.test(dailyHandlerSrc),
    false,
    "POST / (daily) must not render the weekly exec body — that's POST /weekly's job.",
  );
  assert.equal(
    /isMondayInNewYork/.test(dailyHandlerSrc),
    false,
    "POST / (daily) must not branch on Monday — the Monday weekly cron handles that.",
  );
});
