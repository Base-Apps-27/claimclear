// Task #738. Orchestrator-outcome unit tests.
//
// Asserts that the per-submission scrape stamp helper —
// `recordScrapeOutcome` — actually writes the expected
// `last_scraped_at` / `last_scrape_outcome` / `last_scrape_error`
// columns for each of the three outcome paths the orchestrator
// `syncPortalResponsesForSubmission` takes (new_reply, no_change,
// error). Reviewer requested explicit DB-write coverage for all
// three so a regression in any one early-return path can't silently
// stop stamping the row.

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { eq, inArray } from "drizzle-orm";

import { recordScrapeOutcome } from "../lib/portal-response-sync";
import { db, pool, invoiceGroupsTable, portalSubmissionsTable } from "@workspace/db";

const createdGroupIds: number[] = [];
const createdSubmissionIds: number[] = [];

async function seedSubmission(tag: string): Promise<number> {
  const [group] = await db.insert(invoiceGroupsTable).values({
    invoiceNumber: tag, status: "Portal Queued",
  }).returning();
  createdGroupIds.push(group.id);
  const [sub] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: group.id,
    status: "submitted",
    invoiceNumber: tag,
    portalTicketId: `${tag}-T`,
    lastScrapedAt: null,
    lastScrapeOutcome: null,
    lastScrapeError: null,
  }).returning();
  createdSubmissionIds.push(sub.id);
  return sub.id;
}

async function readRow(id: number) {
  const [row] = await db
    .select({
      lastScrapedAt: portalSubmissionsTable.lastScrapedAt,
      lastScrapeOutcome: portalSubmissionsTable.lastScrapeOutcome,
      lastScrapeError: portalSubmissionsTable.lastScrapeError,
    })
    .from(portalSubmissionsTable)
    .where(eq(portalSubmissionsTable.id, id));
  return row;
}

before(() => { /* db pool is initialized lazily by the first query */ });

after(async () => {
  if (createdSubmissionIds.length > 0) {
    await db.delete(portalSubmissionsTable).where(inArray(portalSubmissionsTable.id, createdSubmissionIds));
  }
  if (createdGroupIds.length > 0) {
    await db.delete(invoiceGroupsTable).where(inArray(invoiceGroupsTable.id, createdGroupIds));
  }
  await pool.end().catch(() => undefined);
});

test("recordScrapeOutcome: new_reply path stamps lastScrapedAt + outcome with no error", async () => {
  const id = await seedSubmission(`outcome-newreply-${Date.now()}`);
  const before = Date.now();
  await recordScrapeOutcome(id, "new_reply", null);
  const row = await readRow(id);
  assert.equal(row.lastScrapeOutcome, "new_reply");
  assert.equal(row.lastScrapeError, null);
  assert.ok(row.lastScrapedAt && row.lastScrapedAt.getTime() >= before - 1000,
    "lastScrapedAt must be stamped to ~now on the new_reply path");
});

test("recordScrapeOutcome: no_change path stamps lastScrapedAt + outcome with no error", async () => {
  const id = await seedSubmission(`outcome-nochange-${Date.now()}`);
  await recordScrapeOutcome(id, "no_change", null);
  const row = await readRow(id);
  assert.equal(row.lastScrapeOutcome, "no_change");
  assert.equal(row.lastScrapeError, null);
  assert.ok(row.lastScrapedAt, "lastScrapedAt must be stamped on the no_change path");
});

test("recordScrapeOutcome: error path stamps lastScrapedAt + outcome AND truncated error excerpt", async () => {
  const id = await seedSubmission(`outcome-error-${Date.now()}`);
  // Use a >1000-char error to assert the helper truncates to 1000
  // (the column is bounded; a malformed reader trace must not blow
  // up the row).
  const huge = "reader timeout — " + "x".repeat(2000);
  await recordScrapeOutcome(id, "error", huge);
  const row = await readRow(id);
  assert.equal(row.lastScrapeOutcome, "error");
  assert.ok(row.lastScrapedAt, "lastScrapedAt must be stamped on the error path");
  assert.ok(row.lastScrapeError && row.lastScrapeError.length === 1000,
    "lastScrapeError must be truncated to 1000 chars");
  assert.match(row.lastScrapeError!, /^reader timeout/);
});
