import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Task #273: every batch-processor success branch that flips a portal_submission
// row to "submitted" must also null out errorMessage, otherwise a row that
// failed once and then succeeded keeps showing a stale red error pill on the
// Portal Submissions page. Verified by source-file inspection because the
// batch-processor pulls in the live DB module at import time.

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoSrc = resolve(__dirname, "..");

test("every status='submitted' update in batch-processor.ts also sets errorMessage: null", () => {
  const src = readFileSync(resolve(repoSrc, "lib/batch-processor.ts"), "utf8");

  // Find each `db.update(portalSubmissionsTable).set({ ... status: "submitted" ... })`
  // block and assert it includes `errorMessage: null` so a successful row
  // never carries forward a previous attempt's error pill.
  const updateBlockRe = /db\s*\.\s*update\(portalSubmissionsTable\)\s*\.\s*set\(\{([\s\S]*?)\}\)/g;
  const submittedBlocks: string[] = [];
  for (const m of src.matchAll(updateBlockRe)) {
    const body = m[1];
    if (/status:\s*["']submitted["']/.test(body)) submittedBlocks.push(body);
  }

  assert.ok(
    submittedBlocks.length >= 2,
    `expected at least two status='submitted' update blocks in batch-processor.ts (portal + direct-email branches), found ${submittedBlocks.length}`,
  );

  for (const block of submittedBlocks) {
    assert.match(
      block,
      /errorMessage:\s*null/,
      `every batch-processor success branch must clear errorMessage on the submitted transition; offending block:\n${block}`,
    );
  }
});

test("boot-time IIFE includes the Task #273 stale errorMessage backfill", () => {
  const src = readFileSync(resolve(repoSrc, "index.ts"), "utf8");

  // The backfill UPDATE must scope to status='submitted' rows whose
  // error_message is non-null/non-empty so it's idempotent and self-healing.
  assert.match(
    src,
    /UPDATE\s+portal_submissions\s+SET\s+error_message\s*=\s*NULL[\s\S]*WHERE\s+status\s*=\s*'submitted'[\s\S]*error_message\s+IS\s+NOT\s+NULL/,
    "index.ts must include a boot-time backfill that nulls error_message on submitted portal_submissions rows",
  );
});

test("portal-submissions row component renders 'Email Sent' pill for Direct Email rows", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../claimclear/src/pages/portal-submissions.tsx"),
    "utf8",
  );

  // The row must branch on issueType === 'Direct Email' inside the
  // portalTicketId pill so the long Outlook messageId is hidden behind a
  // short label and only revealed via the tooltip.
  assert.match(
    src,
    /sub\.portalTicketId[\s\S]*sub\.issueType\s*===\s*["']Direct Email["'][\s\S]*Email Sent/,
    "portal-submissions row must render an 'Email Sent' pill for Direct Email rows when portalTicketId is set",
  );

  // The full messageId must still be reachable via the hover tooltip so
  // support/debugging can still copy it.
  assert.match(
    src,
    /WrapTooltip\s+content=\{`[^`]*\$\{sub\.portalTicketId\}`\}/,
    "the Email Sent pill tooltip must expose the underlying portalTicketId for copy/debugging",
  );
});
