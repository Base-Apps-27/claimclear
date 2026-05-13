/**
 * Upgrades the 213 synthetic `portal_responses` rows seeded by the original
 * duplicate-cluster backfill (`oneshot:duplicate_cluster_resolver_response_backfill`,
 * backfillId='duplicate_cluster_resolution_2026_05_13') with real LLM-classified
 * verdicts so the Responses Awaiting Review page shows the correct
 * Approval/Denial/Info-request chip pre-filled.
 *
 * Why this exists
 * ---------------
 * The original backfill inserted ONE placeholder portal_responses row per
 * group (response_type='other', content=template "Hi Accounting Agape, you
 * submitted a correction…", classifierSource='keyword') purely so the
 * Responses-Awaiting-Review page's EXISTS guard would surface the group.
 * It deferred verdict capture to manual operator review. Result: 213 groups
 * landed on the inbox with a generic chip and no AI summary.
 *
 * Per the codebase contract (`email-phrase-classifier.ts` Task #314 comment),
 * decisions must come from the LLM classifier — NEVER from a hand-coded
 * regex. So this script runs each carrier body through the canonical
 * `tryClassifyInboundEmail()` and persists the result with the exact same
 * field shape as live inbound-email ingest writes.
 *
 * Behaviour
 * ---------
 *   --plan                 Plan-only. Classifies (using cache) and prints
 *                          the decision distribution. No DB writes.
 *   --apply                Performs UPDATEs in PROD. Required to write.
 *   --max-groups N         Hard cap on groups processed this run.
 *   --resume-only          Don't re-classify; only use cached decisions.
 *
 * Idempotency
 * -----------
 * Each row already carries `metadata.backfillId =
 * 'duplicate_cluster_resolution_2026_05_13'` from the original synthetic
 * insert. We UPDATE that exact row in place, gated on
 * `classifier_source = 'keyword'` (the synthetic value). Re-running this
 * script with the upgrade backfillId already on a row is a no-op.
 *
 * Reversal
 * --------
 * Every upgraded row stamps `metadata.upgradeBackfillId =
 * 'duplicate_cluster_response_upgrade_2026_05_13'` and preserves the prior
 * synthetic metadata under `metadata.previousSynthetic`.
 *
 * Pre-update typed columns (`responseType`, `classifier_source`,
 * `classifier_confidence`, `ai_summary`, `extracted_amount`,
 * `extracted_deadline`, `requested_action`) were NOT snapshotted because
 * all 213 source rows were uniform: every original-backfill row had
 * `responseType='other'`, `classifier_source='manual'`,
 * `classifier_confidence=NULL`, and all AI/extracted fields NULL (verified
 * empirically before re-applying). Rollback is therefore a uniform UPDATE:
 *
 *   UPDATE portal_responses
 *      SET "responseType"        = 'other',
 *          classifier_source     = 'manual',
 *          classifier_confidence = NULL,
 *          ai_summary            = NULL,
 *          extracted_amount      = NULL,
 *          extracted_deadline    = NULL,
 *          requested_action      = NULL,
 *          content               = COALESCE(metadata->'previousSynthetic'->>'content', content),
 *          metadata              = jsonb_build_object(
 *                                    'note',       metadata->'previousSynthetic'->>'note',
 *                                    'source',     metadata->'previousSynthetic'->>'source',
 *                                    'backfillId', metadata->'previousSynthetic'->>'backfillId',
 *                                    'invoiceNumber', metadata->>'invoiceNumber'
 *                                  )
 *    WHERE metadata->>'upgradeBackfillId' =
 *          'duplicate_cluster_response_upgrade_2026_05_13';
 *
 *   DELETE FROM audit_logs
 *    WHERE metadata->>'backfillId' =
 *          'duplicate_cluster_response_upgrade_2026_05_13';
 *
 * Usage
 * -----
 *   cd artifacts/api-server
 *   DATABASE_URL="$PROD_DATABASE_URL" pnpm exec tsx \
 *     src/scripts/upgrade-duplicate-cluster-portal-responses-2026-05-13.ts --plan
 *   DATABASE_URL="$PROD_DATABASE_URL" pnpm exec tsx \
 *     src/scripts/upgrade-duplicate-cluster-portal-responses-2026-05-13.ts --apply
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { eq, and, inArray, sql } from "drizzle-orm";
import { db, portalResponsesTable, auditLogsTable } from "@workspace/db";
import {
  tryClassifyInboundEmail,
  type ClassifierCallResult,
  type InboundEmailContext,
} from "../lib/inbound-email-classifier";
import { logger } from "../lib/logger";

const ORIGINAL_BACKFILL_ID = "duplicate_cluster_resolution_2026_05_13";
const UPGRADE_BACKFILL_ID = "duplicate_cluster_response_upgrade_2026_05_13";
const SOURCE_JSON = resolve(
  __dirname,
  "../../exports/duplicate-cluster-routed-review-2026-05-13.json",
);
const CACHE_PATH = resolve(
  __dirname,
  "../../exports/duplicate-cluster-llm-classifications-2026-05-13.jsonl",
);
const SUMMARY_PATH = resolve(
  __dirname,
  "../../exports/duplicate-cluster-upgrade-summary-2026-05-13.json",
);

interface Packet {
  group_id: number;
  invoice_number: string;
  error_type_name: string | null;
  verdict_carrier_ticket_id: string | null;
  verdict_carrier_submission_id: number | null;
  verdict_carrier_body: string | null;
  verdict_carrier_message_author: string | null;
  portal_responses: Array<{
    id: number;
    invoice_group_id: number;
    submission_id: number | null;
    metadata: Record<string, unknown> | null;
    content: string | null;
  }>;
}

interface CachedClassification {
  groupId: number;
  portalResponseId: number;
  decision: string;
  confidence: string;
  summary: string;
  amount: string | null;
  deadline: string | null;
  requestedAction: string | null;
  newInvoiceNumber: string | null;
  suggestedPayorDenialReason: string | null;
  classifierUsage: { model: string; inputTokens: number; outputTokens: number };
  classifiedAt: string;
  abstained: boolean;
}

function parseFlags() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(`--${name}`);
  const valued = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  };
  return {
    plan: flag("plan"),
    apply: flag("apply"),
    resumeOnly: flag("resume-only"),
    maxGroups: valued("max-groups") ? Number(valued("max-groups")) : null,
  };
}

function loadCache(): Map<number, CachedClassification> {
  const map = new Map<number, CachedClassification>();
  if (!existsSync(CACHE_PATH)) return map;
  const lines = readFileSync(CACHE_PATH, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as CachedClassification;
      map.set(parsed.groupId, parsed);
    } catch {
      // skip malformed
    }
  }
  return map;
}

function appendCache(entry: CachedClassification) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  appendFileSync(CACHE_PATH, JSON.stringify(entry) + "\n", "utf8");
}

function deriveSubject(packet: Packet): string {
  // The portal scraper does not surface a separate subject for ticket
  // notes; synthesize one that mirrors the live MAS notification subject
  // line ("Re: Invoice <num> - Reply on Ticket <id>") so the LLM has the
  // same anchoring it gets on the email path.
  return `Re: Invoice ${packet.invoice_number} \u2014 reply on MAS ticket ${packet.verdict_carrier_ticket_id ?? "?"}`;
}

function deriveContext(packet: Packet): InboundEmailContext {
  return {
    payorName: "MAS",
    errorTypeName: packet.error_type_name ?? null,
    confNumber: packet.invoice_number ?? null,
    claimAmount: null,
    serviceDate: null,
  };
}

async function classifyPacket(
  packet: Packet,
): Promise<{ result: ClassifierCallResult | null; portalResponseId: number } | null> {
  const synthRow = (packet.portal_responses ?? []).find(
    (r) =>
      r.metadata &&
      typeof r.metadata === "object" &&
      (r.metadata as Record<string, unknown>).backfillId === ORIGINAL_BACKFILL_ID,
  );
  if (!synthRow) {
    logger.warn({ groupId: packet.group_id }, "No synthetic portal_response found; skipping");
    return null;
  }
  const body = packet.verdict_carrier_body ?? "";
  if (!body.trim()) {
    logger.warn({ groupId: packet.group_id }, "Empty carrier body; skipping classification");
    return { result: null, portalResponseId: synthRow.id };
  }
  const subject = deriveSubject(packet);
  const ctx = deriveContext(packet);
  const result = await tryClassifyInboundEmail(subject, body, ctx);
  return { result, portalResponseId: synthRow.id };
}

async function applyUpgrade(
  packet: Packet,
  cached: CachedClassification,
): Promise<{ updatedRows: number; alreadyUpgraded: boolean }> {
  const synthRow = (packet.portal_responses ?? []).find(
    (r) => r.id === cached.portalResponseId,
  );
  if (!synthRow) return { updatedRows: 0, alreadyUpgraded: false };

  const existingMeta = (synthRow.metadata as Record<string, unknown>) ?? {};
  if (existingMeta.upgradeBackfillId === UPGRADE_BACKFILL_ID) {
    return { updatedRows: 0, alreadyUpgraded: true };
  }

  const newMeta: Record<string, unknown> = {
    ...existingMeta,
    classifierVersion: "llm-first-v2",
    upgradeBackfillId: UPGRADE_BACKFILL_ID,
    upgradedAt: new Date().toISOString(),
    previousSynthetic: {
      note: existingMeta.note ?? null,
      content: synthRow.content ?? null,
      source: existingMeta.source ?? null,
      backfillId: existingMeta.backfillId ?? null,
    },
    newInvoiceNumber: cached.newInvoiceNumber,
    suggestedPayorDenialReason: cached.suggestedPayorDenialReason,
    classifierUsage: cached.classifierUsage,
    verdictCarrierTicketId: packet.verdict_carrier_ticket_id,
    verdictCarrierAuthor: packet.verdict_carrier_message_author,
  };

  // Strip the now-misleading synthetic "note" so the upgraded row reads
  // cleanly when an operator opens it.
  delete (newMeta as Record<string, unknown>).note;

  const responseTypeRaw = cached.abstained ? "other" : cached.decision;
  const classifierSource = cached.abstained ? "abstain" : "ai";

  let updatedCount = 0;
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(portalResponsesTable)
      .set({
        responseType: responseTypeRaw as
          | "approval"
          | "denial"
          | "partial_approval"
          | "info_request"
          | "acknowledgment"
          | "other",
        content: packet.verdict_carrier_body ?? synthRow.content ?? "",
        classifierSource,
        classifierConfidence: cached.abstained ? null : cached.confidence,
        aiSummary: cached.abstained ? null : cached.summary,
        extractedAmount: cached.abstained ? null : cached.amount,
        extractedDeadline: cached.abstained ? null : cached.deadline,
        requestedAction: cached.abstained ? null : cached.requestedAction,
        // processed stays false; live ingest only auto-clears phrase-signature
        // acknowledgments. AI/abstain rows must surface for operator review.
        metadata: newMeta,
      })
      .where(
        and(
          eq(portalResponsesTable.id, synthRow.id),
          // Defensive: synthetic rows from the original backfill carry
          // classifier_source IN ('manual','keyword'). Excluding 'ai'
          // ensures we never re-upgrade an already-upgraded row even if
          // somebody re-points the cache.
          inArray(portalResponsesTable.classifierSource, ["manual", "keyword"]),
          // Belt-and-braces: reject rows that already carry our upgrade
          // backfill stamp, regardless of classifierSource.
          sql`(metadata->>'upgradeBackfillId') IS DISTINCT FROM ${UPGRADE_BACKFILL_ID}`,
        ),
      )
      .returning({ id: portalResponsesTable.id });

    updatedCount = updated.length;
    if (updatedCount === 0) {
      // Nothing changed — do NOT pollute the audit trail.
      return;
    }

    await tx.insert(auditLogsTable).values({
      claimId: null,
      invoiceGroupId: packet.group_id,
      action: "portal_response_upgraded",
      details: `Upgraded synthetic portal_response #${synthRow.id} with LLM classification: ${responseTypeRaw} (${classifierSource}, confidence=${cached.confidence})`,
      userEmail: null,
      userName: "system:duplicate_cluster_response_upgrade",
      metadata: {
        backfillId: UPGRADE_BACKFILL_ID,
        portalResponseId: synthRow.id,
        decision: responseTypeRaw,
        classifierSource,
        classifierConfidence: cached.confidence,
        verdictCarrierTicketId: packet.verdict_carrier_ticket_id,
        invoiceNumber: packet.invoice_number,
      },
    });
  });

  return { updatedRows: updatedCount, alreadyUpgraded: updatedCount === 0 };
}

async function main() {
  const flags = parseFlags();
  if (!flags.plan && !flags.apply) {
    console.error("Specify --plan or --apply");
    process.exit(2);
  }
  if (flags.plan && flags.apply) {
    console.error("--plan and --apply are mutually exclusive");
    process.exit(2);
  }

  const packets = JSON.parse(readFileSync(SOURCE_JSON, "utf8")) as Packet[];
  const cap = flags.maxGroups ?? packets.length;
  const slice = packets.slice(0, cap);
  console.log(
    `Loaded ${packets.length} packets; processing ${slice.length} (cap=${cap})`,
  );

  const cache = loadCache();
  console.log(`Cache hits available: ${cache.size}`);

  let classifiedThisRun = 0;
  let abstainedThisRun = 0;

  for (const packet of slice) {
    if (cache.has(packet.group_id)) continue;
    if (flags.resumeOnly) continue;

    const out = await classifyPacket(packet);
    if (!out) continue;

    if (!out.result) {
      const entry: CachedClassification = {
        groupId: packet.group_id,
        portalResponseId: out.portalResponseId,
        decision: "other",
        confidence: "low",
        summary: "",
        amount: null,
        deadline: null,
        requestedAction: null,
        newInvoiceNumber: null,
        suggestedPayorDenialReason: null,
        classifierUsage: { model: "n/a", inputTokens: 0, outputTokens: 0 },
        classifiedAt: new Date().toISOString(),
        abstained: true,
      };
      cache.set(packet.group_id, entry);
      appendCache(entry);
      abstainedThisRun++;
      console.log(`  [abstain] group=${packet.group_id}`);
      continue;
    }

    const r = out.result.result;
    const entry: CachedClassification = {
      groupId: packet.group_id,
      portalResponseId: out.portalResponseId,
      decision: r.decision,
      confidence: r.confidence,
      summary: r.summary,
      amount: r.amount,
      deadline: r.deadline,
      requestedAction: r.requestedAction,
      newInvoiceNumber: r.newInvoiceNumber,
      suggestedPayorDenialReason: r.suggestedPayorDenialReason,
      classifierUsage: out.result.usage,
      classifiedAt: new Date().toISOString(),
      abstained: false,
    };
    cache.set(packet.group_id, entry);
    appendCache(entry);
    classifiedThisRun++;
    console.log(
      `  [${r.decision}/${r.confidence}] group=${packet.group_id} inv=${packet.invoice_number}`,
    );
  }

  // Distribution
  const dist: Record<string, number> = {};
  const confDist: Record<string, number> = {};
  for (const c of cache.values()) {
    dist[c.decision] = (dist[c.decision] ?? 0) + 1;
    confDist[c.confidence] = (confDist[c.confidence] ?? 0) + 1;
  }
  console.log("\nClassification distribution:", dist);
  console.log("Confidence distribution:", confDist);
  console.log(`Classified this run: ${classifiedThisRun}, abstained: ${abstainedThisRun}`);

  if (flags.plan) {
    writeFileSync(
      SUMMARY_PATH,
      JSON.stringify({ mode: "plan", distribution: dist, confidence: confDist, total: cache.size }, null, 2),
    );
    console.log(`Wrote plan summary to ${SUMMARY_PATH}`);
    process.exit(0);
  }

  // APPLY
  let updated = 0;
  let already = 0;
  let missingCache = 0;
  for (const packet of slice) {
    const cached = cache.get(packet.group_id);
    if (!cached) {
      missingCache++;
      continue;
    }
    const res = await applyUpgrade(packet, cached);
    updated += res.updatedRows;
    if (res.alreadyUpgraded) already++;
    if (updated % 25 === 0 && res.updatedRows === 1) {
      console.log(`  applied ${updated}…`);
    }
  }

  const summary = {
    mode: "apply",
    backfillId: UPGRADE_BACKFILL_ID,
    distribution: dist,
    confidence: confDist,
    totalCached: cache.size,
    appliedThisRun: updated,
    alreadyUpgradedSkipped: already,
    missingCacheSkipped: missingCache,
  };
  writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  console.log("\nAPPLY complete.", summary);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
