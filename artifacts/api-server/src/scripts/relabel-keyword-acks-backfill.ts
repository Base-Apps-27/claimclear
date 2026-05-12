// One-shot backfill: harmonize classifier_source for legacy keyword-classified
// acknowledgment rows.
//
// Why this exists
// ---------------
// Before the phrase-signature classifier landed, response-matcher used a
// keyword regex and stamped successful matches with `classifier_source =
// 'keyword'`. The newer pipeline writes `phrase_signature` for fresh acks
// and `retro_phrase_signature` for acks recovered by the
// reclassify-confirmation-emails backfill (see
// reclassify-confirmation-emails-backfill.ts).
//
// What is left over: rows where `responseType = 'acknowledgment'` AND
// `classifier_source = 'keyword'`. The legacy keyword path got the LABEL
// right (these really are acknowledgments) but the SOURCE tag is stale —
// dashboards that bucket by classifier source miss them.
//
// This script verifies each row by re-running it through the deterministic
// phrase classifier. If the phrase classifier ALSO says acknowledgment,
// we relabel `classifier_source` -> 'retro_phrase_signature' and stash
// the original tag under metadata. If the phrase classifier disagrees
// (says actionable / unknown), we leave the row alone and log it for
// human review — relabelling those would mask a different problem.
//
// No status changes. The label was already 'acknowledgment' before AND
// after, so no group/claim transition is implied.
//
// Idempotent. Re-runs see classifier_source = 'retro_phrase_signature'
// and skip the row.
//
// Flags:
//   --apply       actually write changes (default = dry-run)
//   --limit N     only process the first N candidates after sorting
//
// Run:
//   pnpm --filter @workspace/api-server exec tsx src/scripts/relabel-keyword-acks-backfill.ts
//   pnpm --filter @workspace/api-server exec tsx src/scripts/relabel-keyword-acks-backfill.ts -- --apply

import {
  db,
  pool,
  portalResponsesTable,
  auditLogsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { classifyByPhrase } from "../lib/email-phrase-classifier";

const RETRO_CLASSIFIER_SOURCE = "retro_phrase_signature";

interface CliFlags {
  apply: boolean;
  limit: number | null;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { apply: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") flags.apply = true;
    else if (a === "--limit") flags.limit = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--limit=")) flags.limit = Number.parseInt(a.slice("--limit=".length), 10);
    else if (a === "--help" || a === "-h") {
      console.log("Usage: relabel-keyword-acks-backfill [--apply] [--limit N]");
      process.exit(0);
    }
  }
  if (flags.limit !== null && Number.isNaN(flags.limit)) throw new Error("--limit must be a number");
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  console.log(`relabel-keyword-acks-backfill — apply=${flags.apply} limit=${flags.limit ?? "ALL"}`);

  let q = db
    .select({
      id: portalResponsesTable.id,
      claimId: portalResponsesTable.claimId,
      invoiceGroupId: portalResponsesTable.invoiceGroupId,
      responseType: portalResponsesTable.responseType,
      classifierSource: portalResponsesTable.classifierSource,
      senderEmail: portalResponsesTable.senderEmail,
      content: portalResponsesTable.content,
      rawContent: portalResponsesTable.rawContent,
      metadata: portalResponsesTable.metadata,
    })
    .from(portalResponsesTable)
    .where(and(
      eq(portalResponsesTable.responseType, "acknowledgment"),
      eq(portalResponsesTable.classifierSource, "keyword"),
    ))
    .orderBy(portalResponsesTable.id)
    .$dynamic();
  if (flags.limit !== null) q = q.limit(flags.limit);

  const rows = await q;
  console.log(`Found ${rows.length} candidate row(s) (responseType=acknowledgment, classifier_source=keyword)`);

  let agreed = 0;
  let disagreedActionable = 0;
  let disagreedUnknown = 0;

  for (const r of rows) {
    const body = r.rawContent || r.content || "";
    const phrase = classifyByPhrase(body);
    const link = r.invoiceGroupId !== null
      ? `group#${r.invoiceGroupId}`
      : r.claimId !== null
      ? `claim#${r.claimId}`
      : "(unlinked)";

    if (phrase.outcome === "acknowledgment") {
      agreed++;
      console.log(
        `  ✓ response#${r.id} ${link} sender=${r.senderEmail} sig=${phrase.selectedSignatureId} → relabel keyword → ${RETRO_CLASSIFIER_SOURCE}`,
      );
      if (flags.apply) {
        const oldMeta = (r.metadata ?? {}) as Record<string, unknown>;
        const newMeta = {
          ...oldMeta,
          phraseSignature: phrase.selectedSignatureId,
          retro_keyword_ack_relabel: {
            at: new Date().toISOString(),
            previousClassifierSource: r.classifierSource,
            newSignature: phrase.selectedSignatureId,
            reason: "Legacy keyword classifier correctly labelled as acknowledgment; harmonizing classifier_source for dashboards.",
          },
        };
        await db
          .update(portalResponsesTable)
          .set({
            classifierSource: RETRO_CLASSIFIER_SOURCE,
            metadata: newMeta,
            updatedAt: new Date(),
          })
          .where(eq(portalResponsesTable.id, r.id));

        await db.insert(auditLogsTable).values({
          invoiceGroupId: r.invoiceGroupId,
          claimId: r.claimId,
          action: "response_classifier_source_harmonized",
          details: `classifier_source: keyword → ${RETRO_CLASSIFIER_SOURCE} (response #${r.id})`,
          metadata: {
            responseId: r.id,
            previousClassifierSource: "keyword",
            newClassifierSource: RETRO_CLASSIFIER_SOURCE,
            phraseSignature: phrase.selectedSignatureId,
          },
          userEmail: "system@retro-keyword-ack-relabel",
          userName: null,
        });
      }
    } else if (phrase.outcome === "unknown") {
      disagreedUnknown++;
      console.log(
        `  ? response#${r.id} ${link} sender=${r.senderEmail} → phrase classifier UNKNOWN; leaving keyword tag intact for manual review`,
      );
    } else {
      disagreedActionable++;
      console.log(
        `  ⚠ response#${r.id} ${link} sender=${r.senderEmail} → phrase classifier says "${phrase.outcome}" (sig=${phrase.selectedSignatureId}); LEAVING ALONE — disagreement worth a human look`,
      );
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  candidates                       : ${rows.length}`);
  console.log(`  agreed (relabelled to retro)     : ${agreed}`);
  console.log(`  disagreed (phrase=unknown)       : ${disagreedUnknown}`);
  console.log(`  disagreed (phrase=actionable)    : ${disagreedActionable}`);
  console.log(`  apply mode                       : ${flags.apply ? "WROTE CHANGES" : "DRY-RUN ONLY"}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
