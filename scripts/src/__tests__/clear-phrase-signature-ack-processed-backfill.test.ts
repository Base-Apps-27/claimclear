// Tests for the Task #283 one-shot backfill that clears the "Unprocessed"
// badge on historical phrase-signature acknowledgment receipts.
//
// The buckets called out in the task spec:
//   1. Qualifying row (responseType='acknowledgment',
//      classifierSource='phrase_signature', processed=false) → flipped
//      to processed=true.
//   2. AI-classified acknowledgment → NOT touched (operator must confirm
//      the model's call).
//   3. Abstain row → NOT touched (still needs manual review).
//   4. Phrase-signature non-acknowledgment (e.g. denial) → NOT touched
//      (still actionable).
//   5. Already-processed phrase-signature acknowledgment → NOT touched
//      and not double-counted.
//
// Plus an idempotency check: a second --apply over the just-cleaned
// dataset must update zero rows and write zero new audit entries.

import { test, after } from "node:test";
import { strict as assert } from "node:assert";
import { eq, inArray, sql } from "drizzle-orm";

import {
  db,
  pool,
  portalResponsesTable,
  auditLogsTable,
} from "@workspace/db";

import {
  runBackfill,
  BACKFILL_ID,
} from "../migrations/2026-05-clear-phrase-signature-ack-processed-backfill";
import { BACKFILL_IDS } from "../migrations/_backfill-audit";

after(async () => {
  await pool.end().catch(() => undefined);
});

interface SeedRowOpts {
  responseType: "acknowledgment" | "approval" | "denial" | "partial_approval" | "info_request" | "other";
  classifierSource: "phrase_signature" | "retro_phrase_signature" | "ai" | "abstain" | "keyword";
  processed: boolean;
}

async function seedResponse(opts: SeedRowOpts): Promise<typeof portalResponsesTable.$inferSelect> {
  const [row] = await db.insert(portalResponsesTable).values({
    source: "email",
    responseType: opts.responseType,
    classifierSource: opts.classifierSource,
    processed: opts.processed,
    content: "test body",
    senderEmail: `t283-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
    autoLinked: true,
  }).returning();
  return row;
}

async function fetchProcessed(id: number): Promise<boolean> {
  const [row] = await db
    .select({ processed: portalResponsesTable.processed })
    .from(portalResponsesTable)
    .where(eq(portalResponsesTable.id, id));
  return row.processed;
}

async function backfillSummaryAuditCount(): Promise<number> {
  const rows = await db
    .select({ id: auditLogsTable.id })
    .from(auditLogsTable)
    .where(sql`${auditLogsTable.metadata}->>'backfillId' = ${BACKFILL_ID}`);
  return rows.length;
}

test("clear-phrase-signature-ack-processed backfill: scopes to live rule and is idempotent", async () => {
  // Bucket 1: qualifying — must be flipped.
  const ackPhraseUnprocessed = await seedResponse({
    responseType: "acknowledgment",
    classifierSource: "phrase_signature",
    processed: false,
  });

  // Bucket 2: AI-classified ack — must NOT be touched.
  const ackAi = await seedResponse({
    responseType: "acknowledgment",
    classifierSource: "ai",
    processed: false,
  });

  // Bucket 3: abstain — must NOT be touched.
  const otherAbstain = await seedResponse({
    responseType: "other",
    classifierSource: "abstain",
    processed: false,
  });

  // Bucket 3b: retro_phrase_signature ack (from the prior reclassify
  // backfill) — must NOT be touched. The live rule explicitly only
  // matches the fresh 'phrase_signature' source.
  const ackRetroPhrase = await seedResponse({
    responseType: "acknowledgment",
    classifierSource: "retro_phrase_signature",
    processed: false,
  });

  // Bucket 4: phrase-signature denial — must NOT be touched (still
  // actionable, the operator needs to triage it).
  const denialPhrase = await seedResponse({
    responseType: "denial",
    classifierSource: "phrase_signature",
    processed: false,
  });

  // Bucket 5: phrase-signature ack already processed — must NOT be
  // counted (avoids double-flipping rows the live rule already handled).
  const ackPhraseAlreadyProcessed = await seedResponse({
    responseType: "acknowledgment",
    classifierSource: "phrase_signature",
    processed: true,
  });

  const allIds = [
    ackPhraseUnprocessed.id,
    ackAi.id,
    otherAbstain.id,
    ackRetroPhrase.id,
    denialPhrase.id,
    ackPhraseAlreadyProcessed.id,
  ];

  try {
    // --- Dry-run: must report exactly the qualifying row and write nothing.
    const auditCountBefore = await backfillSummaryAuditCount();

    const dryReport = await runBackfill({ apply: false, silent: true });
    assert.ok(
      dryReport.responseIds.includes(ackPhraseUnprocessed.id),
      "dry-run report must include the qualifying response id",
    );
    assert.ok(
      !dryReport.responseIds.includes(ackAi.id),
      "dry-run report must NOT include the AI ack",
    );
    assert.ok(
      !dryReport.responseIds.includes(otherAbstain.id),
      "dry-run report must NOT include the abstain row",
    );
    assert.ok(
      !dryReport.responseIds.includes(ackRetroPhrase.id),
      "dry-run report must NOT include the retro_phrase_signature ack",
    );
    assert.ok(
      !dryReport.responseIds.includes(denialPhrase.id),
      "dry-run report must NOT include the phrase-signature denial",
    );
    assert.ok(
      !dryReport.responseIds.includes(ackPhraseAlreadyProcessed.id),
      "dry-run report must NOT include the already-processed phrase-signature ack",
    );

    // Dry-run must NOT flip anything.
    const dryRows = await db
      .select({ id: portalResponsesTable.id, processed: portalResponsesTable.processed })
      .from(portalResponsesTable)
      .where(inArray(portalResponsesTable.id, allIds));
    const dryProcessed = new Map(dryRows.map((r) => [r.id, r.processed]));
    assert.equal(dryProcessed.get(ackPhraseUnprocessed.id), false, "dry-run must not flip");
    assert.equal(dryProcessed.get(ackAi.id), false);
    assert.equal(dryProcessed.get(otherAbstain.id), false);
    assert.equal(dryProcessed.get(ackRetroPhrase.id), false);
    assert.equal(dryProcessed.get(denialPhrase.id), false);
    assert.equal(dryProcessed.get(ackPhraseAlreadyProcessed.id), true);

    // Dry-run must NOT write a summary audit row.
    assert.equal(
      await backfillSummaryAuditCount(),
      auditCountBefore,
      "dry-run must not write any summary audit rows",
    );

    // --- Apply: flips the qualifying row, leaves the others alone, and
    //     writes exactly one summary audit row.
    const applyReport = await runBackfill({ apply: true, silent: true });
    assert.ok(
      applyReport.rowsUpdated >= 1,
      `apply must flip ≥1 rows (saw ${applyReport.rowsUpdated})`,
    );
    assert.ok(
      applyReport.responseIds.includes(ackPhraseUnprocessed.id),
      "apply report must list the qualifying id",
    );

    assert.equal(
      await fetchProcessed(ackPhraseUnprocessed.id),
      true,
      "qualifying ack must be flipped to processed=true",
    );
    assert.equal(await fetchProcessed(ackAi.id), false, "AI ack must remain unprocessed");
    assert.equal(await fetchProcessed(otherAbstain.id), false, "abstain row must remain unprocessed");
    assert.equal(
      await fetchProcessed(ackRetroPhrase.id),
      false,
      "retro_phrase_signature ack must remain unprocessed",
    );
    assert.equal(
      await fetchProcessed(denialPhrase.id),
      false,
      "phrase-signature denial must remain unprocessed",
    );
    assert.equal(
      await fetchProcessed(ackPhraseAlreadyProcessed.id),
      true,
      "already-processed ack must remain processed (no regression)",
    );

    // Exactly one new summary audit row, tagged with the registered backfill id.
    const auditCountAfter = await backfillSummaryAuditCount();
    assert.ok(
      auditCountAfter > auditCountBefore,
      "apply must write at least one summary audit row when it flips rows",
    );

    const summaryRows = await db
      .select()
      .from(auditLogsTable)
      .where(sql`${auditLogsTable.metadata}->>'backfillId' = ${BACKFILL_ID}`);
    const newest = summaryRows.sort((a, b) => b.id - a.id)[0];
    type Meta = {
      backfillId?: string;
      rowsUpdated?: number;
      responseIds?: number[];
      rule?: string;
    } | null;
    const meta = newest.metadata as Meta;
    assert.equal(meta?.backfillId, BACKFILL_ID);
    assert.equal(BACKFILL_ID, BACKFILL_IDS.clearPhraseSignatureAckProcessed);
    assert.equal(newest.action, "backfill_completed");
    assert.equal(newest.claimId, null);
    assert.equal(newest.invoiceGroupId, null);
    assert.ok(
      (meta?.rowsUpdated ?? 0) >= 1,
      "summary audit row must record the rowsUpdated count",
    );
    assert.ok(
      (meta?.responseIds ?? []).includes(ackPhraseUnprocessed.id),
      "summary audit row must list the flipped response ids",
    );

    // --- Idempotency: re-running --apply must update zero rows and
    //     write zero additional summary audit rows.
    const auditCountBeforeRerun = await backfillSummaryAuditCount();
    const rerunReport = await runBackfill({ apply: true, silent: true });
    assert.equal(
      rerunReport.rowsUpdated,
      0,
      "second --apply must update zero rows (already-clean dataset)",
    );
    assert.ok(
      !rerunReport.responseIds.includes(ackPhraseUnprocessed.id),
      "second --apply must not re-list the already-flipped row",
    );
    assert.equal(
      await backfillSummaryAuditCount(),
      auditCountBeforeRerun,
      "second --apply must not write a new summary audit row",
    );
  } finally {
    await db.delete(portalResponsesTable).where(inArray(portalResponsesTable.id, allIds)).catch(() => undefined);
  }
});

test("clear-phrase-signature-ack-processed backfill: --limit caps the scan and update", async () => {
  const seeded: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await seedResponse({
      responseType: "acknowledgment",
      classifierSource: "phrase_signature",
      processed: false,
    });
    seeded.push(r.id);
  }

  try {
    const report = await runBackfill({ apply: true, limit: 2, silent: true });
    assert.ok(report.candidateCount <= 2, `--limit must cap the scan (saw ${report.candidateCount})`);
    assert.ok(report.rowsUpdated <= 2, `--limit must cap the update (saw ${report.rowsUpdated})`);
  } finally {
    await db.delete(portalResponsesTable).where(inArray(portalResponsesTable.id, seeded)).catch(() => undefined);
  }
});
