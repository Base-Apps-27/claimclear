// Task #660 V3 — deep-link contract test for the ClaimClear UI's
// `queueGroupHref` / `queueLegHref` helpers used by every retargeted
// walk/submit CTA on the Dashboard (and any future surface that
// builds a queue deep-link). Mirror of the api-server-side contract
// test in `artifacts/api-server/src/__tests__/queue-cta.test.ts`.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { queueGroupHref, queueLegHref } from "./queue-cta";

const QUEUE_HREF_RE = /^\/queue\?group=(\d+)(?:&leg=(\d+))?$/;

test("queueGroupHref produces /queue?group=<id>", () => {
  const href = queueGroupHref(42);
  assert.equal(href, "/queue?group=42");
  assert.ok(QUEUE_HREF_RE.test(href));
});

test("queueLegHref produces /queue?group=<gid>&leg=<lid>", () => {
  const href = queueLegHref(7, 199);
  assert.equal(href, "/queue?group=7&leg=199");
  const m = QUEUE_HREF_RE.exec(href);
  assert.ok(m);
  assert.equal(m![1], "7");
  assert.equal(m![2], "199");
});

test("dashboard.tsx hero rows route through queueGroupHref (not inline /invoice-groups/${...})", () => {
  const dashboardPath = resolve(
    import.meta.dirname,
    "..",
    "pages",
    "dashboard.tsx",
  );
  const src = readFileSync(dashboardPath, "utf8");
  // Both retargeted hero rows must use the helper.
  const fileTodayRow = /testid=\{`file-today-row-\$\{[^}]+\}`\}/;
  const stuckRow = /testid=\{`stuck-row-\$\{[^}]+\}`\}/;
  assert.ok(fileTodayRow.test(src), "file-today HeroRow must still exist");
  assert.ok(stuckRow.test(src), "stuck HeroRow must still exist");

  // Locate each HeroRow block and assert its `to=` prop uses the helper.
  for (const marker of ["file-today-row-", "stuck-row-"]) {
    const idx = src.indexOf(marker);
    assert.ok(idx > 0, `expected ${marker} in dashboard.tsx`);
    // Look 400 chars BEFORE the testid (the `to=` prop is on the
    // line immediately above in the JSX block).
    const window = src.slice(Math.max(0, idx - 400), idx + 200);
    assert.match(
      window,
      /to=\{queueGroupHref\([^)]+\)\}/,
      `${marker} HeroRow must use queueGroupHref(...) for its 'to' prop`,
    );
    assert.doesNotMatch(
      window,
      /to=\{`\/invoice-groups\/\$\{[^}]+\}`\}/,
      `${marker} HeroRow must not use an inline /invoice-groups/:id href`,
    );
  }
});
