// One-shot backfill: re-classify every portal_responses row currently in
// the "Responses Awaiting Review" bucket through the new LLM-first
// pipeline (Task #314).
//
// Why this exists
// ---------------
// Task #314 inverted the email classifier so the cheap LLM
// (claude-haiku-4-5) is the source of truth for every non-acknowledgment
// email. The hand-coded phrase classifier is now an ack-only pre-filter.
// That fix only affects emails arriving *after* the deploy — every row
// already in `portal_responses` linked to a group whose macroPhase is
// "response-pending" was classified by the old pipeline (keyword + Sonnet)
// and may carry the wrong verdict (e.g. "Corrections - Ticket Closed"
// stamped as `approval` instead of `info_request`).
//
// What it does
// ------------
// 1. Selects every portal_responses row whose `invoice_group_id` is in a
//    group with `macroPhase = "response-pending"` (matches the predicate
//    used by `buildMacroPhaseCondition` in routes/invoice-groups.ts).
// 2. Skips rows already stamped with `metadata.classifierVersion =
//    "llm-first-v1"` so re-runs are idempotent.
// 3. Re-runs the new pipeline on the persisted body (`raw_content` falling
//    back to `content`): phrase classifier → if "unknown",
//    `tryClassifyInboundEmail` (LLM).
// 4. Decides the safe-to-rewrite verdict:
//      - If a HUMAN audit log exists on the linked group/claim after the
//        response's `received_at`, the row's classification is RELABEL-
//        SKIPPED: only `metadata` is stamped (classifierVersion,
//        backfilledAt, previousResponseType, skippedReason, etc.) and
//        `response_type` / `classifier_confidence` / `ai_summary` are
//        left untouched. A structured log line is emitted so an operator
//        can audit it.
//      - Otherwise the row is RELABELLED: `response_type`,
//        `classifier_source`, `classifier_confidence`, `ai_summary`,
//        `extracted_amount`, `extracted_deadline`, `requested_action`,
//        and `metadata` are updated; an `audit_logs` row tagged
//        `response_reclassified` is inserted against the linked group
//        (or claim, when no group is linked).
//    The script never calls `transitionGroupStatus` /
//    `transitionClaimStatus` — group/claim status is left to the cron
//    that materialises status from response state.
// 5. If the LLM call fails ("abstain"), the row is left at
//    `response_type = "other"` only when its previous label was
//    non-acknowledgment AND no human had touched it; the row is stamped
//    with `classifierVersion: "llm-first-v1"` and the abstain is
//    counted in the summary.
//
// Idempotency
// -----------
// Step 2's filter excludes rows already stamped with
// `classifierVersion: "llm-first-v1"`. Re-running after a partial run
// resumes from the first un-stamped row.
//
// Flags
// -----
//   --apply              actually write changes (default = dry-run)
//   --dry-run            same as default; explicit for clarity
//   --limit N            only process the first N candidates
//   --response-id N      only candidate response id N (overrides limit)
//
// Run
// ---
//   pnpm --filter @workspace/scripts run backfill:llm-first-classifier
//   pnpm --filter @workspace/scripts run backfill:llm-first-classifier -- --apply

import {
  db,
  pool,
  portalResponsesTable,
  invoiceGroupsTable,
  auditLogsTable,
} from "@workspace/db";
import { and, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { classifyByPhrase } from "../lib/email-phrase-classifier";
import {
  tryClassifyInboundEmail,
  type ClassifiedDecision,
  type ClassifierCallResult,
  type InboundEmailContext,
} from "../lib/inbound-email-classifier";
import { computeCostUsd } from "../lib/llm-pricing";
import { claimsTable } from "@workspace/db";

// Bumped to v2 in Task #321 when the inbound classifier output gained
// `newInvoiceNumber` + `suggestedPayorDenialReason`. Re-running the
// backfill against rows stamped v1 will now re-fetch the AI verdict and
// stamp the new fields so older Responses Awaiting Review rows benefit
// from the same hints freshly-arrived rows do.
const CLASSIFIER_VERSION = "llm-first-v2";
const BACKFILL_SOURCE = "llm_first_classifier_backfill";

// Mirror of `STATUS_BY_PHASE["response-pending"]` in routes/invoice-groups.ts
// — the bucket the user calls "Responses Awaiting Review".
const RESPONSE_PENDING_STATUSES = ["Ready to Review", "Needs Review"] as const;

interface CliFlags {
  apply: boolean;
  limit: number | null;
  responseId: number | null;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { apply: false, limit: null, responseId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") flags.apply = true;
    else if (a === "--dry-run") flags.apply = false;
    else if (a === "--limit") flags.limit = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--limit=")) flags.limit = Number.parseInt(a.slice("--limit=".length), 10);
    else if (a === "--response-id") flags.responseId = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--response-id=")) flags.responseId = Number.parseInt(a.slice("--response-id=".length), 10);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: llm-first-classifier-backfill [--apply | --dry-run] [--limit N] [--response-id ID]",
      );
      process.exit(0);
    }
  }
  if (flags.limit !== null && Number.isNaN(flags.limit)) throw new Error("--limit must be a number");
  if (flags.responseId !== null && Number.isNaN(flags.responseId)) throw new Error("--response-id must be a number");
  return flags;
}

interface CandidateResponse {
  id: number;
  claimId: number | null;
  invoiceGroupId: number | null;
  responseType: ClassifiedDecision;
  classifierSource: string;
  classifierConfidence: string | null;
  aiSummary: string | null;
  senderEmail: string | null;
  subject: string | null;
  content: string | null;
  rawContent: string | null;
  receivedAt: Date;
  metadata: Record<string, unknown> | null;
}

async function fetchCandidates(flags: CliFlags): Promise<CandidateResponse[]> {
  // Filter mirrors `buildMacroPhaseCondition("response-pending")` in
  // routes/invoice-groups.ts: the group must be in a response-pending
  // status, with no reattest in flight, and with no claim still owing a
  // MAS cancel action.
  //
  // DELIBERATE DIVERGENCE FROM THE INBOX QUERY: we drop the "must exist
  // at least one currently-reviewable (non-ack) response" guard the inbox
  // uses. That guard exists to hide groups whose only responses were ack
  // boilerplate; we WANT to re-classify exactly those rows because the
  // LLM may now turn one of them into an actionable verdict
  // (info_request / approval / denial). The set processed here is
  // therefore a strict superset of what is currently visible in the
  // "Responses Awaiting Review" list — by design.
  //
  // STATUS-CHANGE BEHAVIOUR: this script never calls
  // `transitionGroupStatus` / `transitionClaimStatus`. It only relabels
  // the response row and stamps audit_logs. Group/claim status is left
  // to the existing materialiser cron — operators will see the new
  // verdict pill immediately, but the group's status only flips on the
  // next materialisation pass. This is the conservative choice for a
  // one-shot bulk rewrite; do not add inline transitions here without
  // re-thinking the human-activity safety check.
  const conditions = [
    isNotNull(portalResponsesTable.invoiceGroupId),
    inArray(invoiceGroupsTable.status, [...RESPONSE_PENDING_STATUSES]),
    isNull(invoiceGroupsTable.reattestCompletedAt),
    or(
      isNull(invoiceGroupsTable.reattestRequired),
      eq(invoiceGroupsTable.reattestRequired, false),
    )!,
    sql`not exists (
      select 1 from claims c
      where c.invoice_group_id = ${invoiceGroupsTable.id}
        and c.mas_action_required = 'cancel'
        and c.mas_action_completed_at is null
    )`,
  ];

  if (flags.responseId !== null) {
    conditions.push(eq(portalResponsesTable.id, flags.responseId));
  }

  let query = db
    .select({
      id: portalResponsesTable.id,
      claimId: portalResponsesTable.claimId,
      invoiceGroupId: portalResponsesTable.invoiceGroupId,
      responseType: portalResponsesTable.responseType,
      classifierSource: portalResponsesTable.classifierSource,
      classifierConfidence: portalResponsesTable.classifierConfidence,
      aiSummary: portalResponsesTable.aiSummary,
      senderEmail: portalResponsesTable.senderEmail,
      subject: portalResponsesTable.subject,
      content: portalResponsesTable.content,
      rawContent: portalResponsesTable.rawContent,
      receivedAt: portalResponsesTable.receivedAt,
      metadata: portalResponsesTable.metadata,
    })
    .from(portalResponsesTable)
    .innerJoin(
      invoiceGroupsTable,
      eq(invoiceGroupsTable.id, portalResponsesTable.invoiceGroupId),
    )
    .where(and(...conditions))
    .orderBy(portalResponsesTable.id)
    .$dynamic();

  if (flags.limit !== null) query = query.limit(flags.limit);

  const rows = await query;
  return rows as CandidateResponse[];
}

function bodyForClassification(r: CandidateResponse): string {
  return r.rawContent || r.content || "";
}

function alreadyLlmFirst(r: CandidateResponse): boolean {
  const md = (r.metadata ?? {}) as Record<string, unknown>;
  return md.classifierVersion === CLASSIFIER_VERSION;
}

async function loadInboundContext(c: CandidateResponse): Promise<InboundEmailContext> {
  // Best-effort context (matches loadInboundContext in response-matcher.ts).
  // Missing context is fine — the classifier handles empty context.
  try {
    if (c.invoiceGroupId !== null) {
      const [row] = await db
        .select({
          payorEmail: invoiceGroupsTable.payorEmail,
          errorTypeName: invoiceGroupsTable.errorTypeName,
        })
        .from(invoiceGroupsTable)
        .where(eq(invoiceGroupsTable.id, c.invoiceGroupId))
        .limit(1);
      if (row) {
        return {
          payorName: row.payorEmail ?? null,
          errorTypeName: row.errorTypeName ?? null,
        };
      }
    }
    if (c.claimId !== null) {
      const [row] = await db
        .select({
          confNumber: claimsTable.confNumber,
          claimAmount: claimsTable.claimAmount,
          date: claimsTable.date,
          errorTypeName: claimsTable.errorTypeName,
          payorEmail: claimsTable.payorEmail,
        })
        .from(claimsTable)
        .where(eq(claimsTable.id, c.claimId))
        .limit(1);
      if (row) {
        return {
          confNumber: row.confNumber,
          claimAmount: row.claimAmount ?? null,
          serviceDate: row.date ?? null,
          errorTypeName: row.errorTypeName ?? null,
          payorName: row.payorEmail ?? null,
        };
      }
    }
  } catch {
    // Swallow — context is optional.
  }
  return {};
}

interface ClassifierVerdict {
  newResponseType: ClassifiedDecision;
  classifierSource: "phrase_signature" | "ai" | "abstain";
  phraseSignatureId: string | null;
  phraseSignatureMatches: string[];
  // Holds both the parsed verdict and the raw Anthropic usage block when
  // the AI path ran. The wrapper shape (vs. just `ClassifiedInboundEmail`)
  // lets the backfill stamp `metadata.classifierUsage` on rewritten rows
  // so they show up in the classifier-stats dashboard alongside live
  // traffic (Task #320).
  aiResult: ClassifierCallResult | null;
}

async function reclassify(c: CandidateResponse): Promise<ClassifierVerdict> {
  const phrase = classifyByPhrase(bodyForClassification(c));
  if (phrase.outcome === "acknowledgment") {
    return {
      newResponseType: "acknowledgment",
      classifierSource: "phrase_signature",
      phraseSignatureId: phrase.selectedSignatureId,
      phraseSignatureMatches: phrase.matchedSignatureIds,
      aiResult: null,
    };
  }
  const ctx = await loadInboundContext(c);
  const ai = await tryClassifyInboundEmail(c.subject ?? "", bodyForClassification(c), ctx);
  if (ai) {
    return {
      newResponseType: ai.result.decision,
      classifierSource: "ai",
      phraseSignatureId: null,
      phraseSignatureMatches: [],
      aiResult: ai,
    };
  }
  return {
    newResponseType: "other",
    classifierSource: "abstain",
    phraseSignatureId: null,
    phraseSignatureMatches: [],
    aiResult: null,
  };
}

interface HumanActivityHit {
  found: true;
  auditId: number;
  userEmail: string | null;
  action: string;
  timestamp: Date;
}
interface HumanActivityMiss {
  found: false;
}
type HumanActivity = HumanActivityHit | HumanActivityMiss;

async function checkLaterHumanActivity(c: CandidateResponse): Promise<HumanActivity> {
  // Any audit_logs row on the linked entity, after the candidate's
  // receivedAt, authored by a NON-system user. "system" covers both the
  // literal "system" actor and any `system@*` pseudo-user used by other
  // backfills (matches the pattern in
  // reclassify-confirmation-emails-backfill.ts).
  const conditions = [
    gt(auditLogsTable.timestamp, c.receivedAt),
    isNotNull(auditLogsTable.userEmail),
    ne(auditLogsTable.userEmail, "system"),
    sql`${auditLogsTable.userEmail} NOT LIKE 'system@%'`,
  ];
  if (c.invoiceGroupId !== null) {
    conditions.push(eq(auditLogsTable.invoiceGroupId, c.invoiceGroupId));
  } else if (c.claimId !== null) {
    conditions.push(eq(auditLogsTable.claimId, c.claimId));
  } else {
    return { found: false };
  }
  const [hit] = await db
    .select({
      id: auditLogsTable.id,
      userEmail: auditLogsTable.userEmail,
      action: auditLogsTable.action,
      timestamp: auditLogsTable.timestamp,
    })
    .from(auditLogsTable)
    .where(and(...conditions))
    .orderBy(auditLogsTable.timestamp)
    .limit(1);
  if (!hit) return { found: false };
  return {
    found: true,
    auditId: hit.id,
    userEmail: hit.userEmail,
    action: hit.action,
    timestamp: hit.timestamp,
  };
}

interface ApplyResult {
  relabelled: boolean;
  changedResponseType: boolean;
}

async function applyRelabel(
  c: CandidateResponse,
  verdict: ClassifierVerdict,
  human: HumanActivity,
  apply: boolean,
): Promise<ApplyResult> {
  const oldMetadata = (c.metadata ?? {}) as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const safe = !human.found;

  const baseMetadata: Record<string, unknown> = {
    ...oldMetadata,
    classifierVersion: CLASSIFIER_VERSION,
    backfilledAt: nowIso,
    backfillSource: BACKFILL_SOURCE,
    previousResponseType: c.responseType,
    previousClassifierSource: c.classifierSource,
    previousClassifierConfidence: c.classifierConfidence,
    previousAiSummary: c.aiSummary,
    // Task #321: persist the new AI hints alongside the existing fields so
    // Responses Awaiting Review can pre-fill its operator pickers without
    // a separate fetch. Use the verdict's AI result when present; abstain
    // rows leave both null. Existing values (if any) are preserved on the
    // row via the `...oldMetadata` spread above and only overwritten when
    // the fresh verdict actually has a value to write.
    newInvoiceNumber: verdict.aiResult?.result.newInvoiceNumber ?? (oldMetadata as Record<string, unknown>).newInvoiceNumber ?? null,
    suggestedPayorDenialReason: verdict.aiResult?.result.suggestedPayorDenialReason ?? (oldMetadata as Record<string, unknown>).suggestedPayorDenialReason ?? null,
    backfillVerdict: {
      newResponseType: verdict.newResponseType,
      classifierSource: verdict.classifierSource,
      phraseSignature: verdict.phraseSignatureId,
      phraseSignatureMatches: verdict.phraseSignatureMatches,
      aiConfidence: verdict.aiResult?.result.confidence ?? null,
      newInvoiceNumber: verdict.aiResult?.result.newInvoiceNumber ?? null,
      suggestedPayorDenialReason: verdict.aiResult?.result.suggestedPayorDenialReason ?? null,
    },
    // Stamp the same per-row usage shape the live classifier writes
    // (response-matcher.ts) so backfilled rows are queryable by the
    // classifier-stats dashboard. Null on phrase / abstain paths.
    classifierUsage: verdict.aiResult
      ? {
          model: verdict.aiResult.usage.model,
          inputTokens: verdict.aiResult.usage.inputTokens,
          outputTokens: verdict.aiResult.usage.outputTokens,
          costUsd: computeCostUsd(verdict.aiResult.usage),
        }
      : null,
  };

  if (!safe) {
    // Human touched the entity after the row was originally classified.
    // Stamp metadata only — leave the human-visible verdict fields
    // (response_type, classifier_source, classifier_confidence,
    // ai_summary, etc.) untouched so the operator's prior decisions are
    // not silently overwritten.
    const metadataWithSkip: Record<string, unknown> = {
      ...baseMetadata,
      backfillSkipped: true,
      backfillSkipReason: `human activity on ${
        c.invoiceGroupId !== null ? `group#${c.invoiceGroupId}` : `claim#${c.claimId}`
      } after receivedAt — audit#${(human as HumanActivityHit).auditId} by ${(human as HumanActivityHit).userEmail ?? "(unknown)"}`,
      backfillSkippedAuditId: (human as HumanActivityHit).auditId,
      backfillSkippedAuditUser: (human as HumanActivityHit).userEmail,
      backfillSkippedAuditAction: (human as HumanActivityHit).action,
    };
    if (apply) {
      await db
        .update(portalResponsesTable)
        .set({ metadata: metadataWithSkip, updatedAt: new Date() })
        .where(eq(portalResponsesTable.id, c.id));
      await writeReclassifyAudit(c, verdict, human);
    }
    return { relabelled: false, changedResponseType: false };
  }

  // Safe path: rewrite the verdict fields too.
  const changedResponseType = c.responseType !== verdict.newResponseType;
  if (apply) {
    await db
      .update(portalResponsesTable)
      .set({
        responseType: verdict.newResponseType,
        classifierSource: verdict.classifierSource,
        classifierConfidence: verdict.aiResult?.result.confidence ?? null,
        aiSummary: verdict.aiResult?.result.summary ?? null,
        extractedAmount: verdict.aiResult?.result.amount ?? null,
        extractedDeadline: verdict.aiResult?.result.deadline ?? null,
        requestedAction: verdict.aiResult?.result.requestedAction ?? null,
        metadata: baseMetadata,
        updatedAt: new Date(),
      })
      .where(eq(portalResponsesTable.id, c.id));
    await writeReclassifyAudit(c, verdict, human);
  }
  return { relabelled: true, changedResponseType };
}

async function writeReclassifyAudit(
  c: CandidateResponse,
  verdict: ClassifierVerdict,
  human: HumanActivity,
): Promise<void> {
  const detailsParts = [
    `Response #${c.id} re-classified by ${BACKFILL_SOURCE}:`,
    `responseType ${c.responseType} → ${verdict.newResponseType}`,
    `classifierSource ${c.classifierSource} → ${verdict.classifierSource}`,
  ];
  if (verdict.phraseSignatureId) detailsParts.push(`(matched signature ${verdict.phraseSignatureId})`);
  if (human.found) detailsParts.push(`SKIPPED (human activity after receivedAt — audit#${human.auditId})`);
  await db.insert(auditLogsTable).values({
    claimId: c.invoiceGroupId !== null ? null : c.claimId,
    invoiceGroupId: c.invoiceGroupId,
    action: human.found ? "response_reclassify_skipped" : "response_reclassified",
    details: detailsParts.join(" "),
    metadata: {
      responseId: c.id,
      previousResponseType: c.responseType,
      newResponseType: verdict.newResponseType,
      previousClassifierSource: c.classifierSource,
      newClassifierSource: verdict.classifierSource,
      classifierVersion: CLASSIFIER_VERSION,
      phraseSignature: verdict.phraseSignatureId,
      phraseSignatureMatches: verdict.phraseSignatureMatches,
      aiConfidence: verdict.aiResult?.result.confidence ?? null,
      backfillSource: BACKFILL_SOURCE,
      humanActivityFound: human.found,
      humanActivityAuditId: human.found ? human.auditId : null,
      humanActivityUser: human.found ? human.userEmail : null,
    },
    userEmail: "system@llm-first-classifier-backfill",
    userName: "LLM-First Classifier Backfill",
  });
}

interface BackfillStats {
  considered: number;
  alreadyStamped: number;
  unchangedSafe: number;
  reclassifiedSafe: number;
  skippedHumanActivity: number;
  abstained: number;
  byTransition: Map<string, number>;
}

async function processOne(
  c: CandidateResponse,
  flags: CliFlags,
  stats: BackfillStats,
): Promise<void> {
  if (alreadyLlmFirst(c)) {
    stats.alreadyStamped++;
    return;
  }
  const verdict = await reclassify(c);
  const human = await checkLaterHumanActivity(c);
  const linkLabel = c.invoiceGroupId !== null
    ? `group#${c.invoiceGroupId}`
    : c.claimId !== null
    ? `claim#${c.claimId}`
    : "(unlinked)";
  const transitionKey = `${c.responseType} → ${verdict.newResponseType}`;
  stats.byTransition.set(transitionKey, (stats.byTransition.get(transitionKey) ?? 0) + 1);

  if (verdict.classifierSource === "abstain") stats.abstained++;

  const result = await applyRelabel(c, verdict, human, flags.apply);

  if (human.found) {
    stats.skippedHumanActivity++;
    console.log(
      `  ⚠ response#${c.id} ${linkLabel} sender=${c.senderEmail} legacy=${c.responseType} → ${verdict.newResponseType} (src=${verdict.classifierSource}); RELABEL SKIPPED — human activity audit#${human.auditId} by ${human.userEmail ?? "(unknown)"} on ${human.timestamp.toISOString()}`,
    );
  } else if (result.changedResponseType) {
    stats.reclassifiedSafe++;
    console.log(
      `  ↺ response#${c.id} ${linkLabel} sender=${c.senderEmail} legacy=${c.responseType} → ${verdict.newResponseType} (src=${verdict.classifierSource}${verdict.aiResult ? `, conf=${verdict.aiResult.result.confidence}` : ""}${verdict.phraseSignatureId ? `, sig=${verdict.phraseSignatureId}` : ""})`,
    );
  } else {
    stats.unchangedSafe++;
    console.log(
      `  ✓ response#${c.id} ${linkLabel} sender=${c.senderEmail} verdict unchanged (${verdict.newResponseType}, src=${verdict.classifierSource}); metadata stamped`,
    );
  }
}

async function reportPreState(): Promise<void> {
  const [{ n: total }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(portalResponsesTable)
    .innerJoin(
      invoiceGroupsTable,
      eq(invoiceGroupsTable.id, portalResponsesTable.invoiceGroupId),
    )
    .where(
      and(
        isNotNull(portalResponsesTable.invoiceGroupId),
        inArray(invoiceGroupsTable.status, [...RESPONSE_PENDING_STATUSES]),
        isNull(invoiceGroupsTable.reattestCompletedAt),
        or(
          isNull(invoiceGroupsTable.reattestRequired),
          eq(invoiceGroupsTable.reattestRequired, false),
        )!,
      ),
    );
  console.log(`[pre] ${total} portal_responses rows linked to response-pending groups`);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  console.log(
    `[backfill] mode=${flags.apply ? "APPLY" : "dry-run"} limit=${flags.limit ?? "(none)"} responseId=${flags.responseId ?? "(any)"}\n`,
  );
  await reportPreState();

  const candidates = await fetchCandidates(flags);
  console.log(`[scan] ${candidates.length} candidate response rows in scope\n`);

  const stats: BackfillStats = {
    considered: 0,
    alreadyStamped: 0,
    unchangedSafe: 0,
    reclassifiedSafe: 0,
    skippedHumanActivity: 0,
    abstained: 0,
    byTransition: new Map(),
  };

  for (const c of candidates) {
    stats.considered++;
    try {
      await processOne(c, flags, stats);
    } catch (err) {
      console.error(
        `  ✗ response#${c.id} FAILED:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log(`\n[summary]`);
  console.log(`  considered:                    ${stats.considered}`);
  console.log(`  already stamped (skipped):     ${stats.alreadyStamped}`);
  console.log(`  reclassified (verdict change): ${stats.reclassifiedSafe}`);
  console.log(`  unchanged (metadata stamped):  ${stats.unchangedSafe}`);
  console.log(`  skipped (human activity):      ${stats.skippedHumanActivity}`);
  console.log(`  LLM abstained (other/abstain): ${stats.abstained}`);

  if (stats.byTransition.size > 0) {
    console.log(`\n[transitions] old → new responseType (all candidates):`);
    const sorted = [...stats.byTransition.entries()].sort((a, b) => b[1] - a[1]);
    for (const [k, n] of sorted) {
      console.log(`  ${String(n).padStart(4)}  ${k}`);
    }
  }

  if (!flags.apply) {
    console.log(`\n[dry-run] No changes written. Re-run with --apply to commit.`);
  } else {
    console.log(`\n[apply] Done. Reclassified ${stats.reclassifiedSafe}, stamped ${stats.unchangedSafe + stats.reclassifiedSafe}, skipped ${stats.skippedHumanActivity}.`);
  }
}

main()
  .then(() => pool.end().then(() => process.exit(0)))
  .catch((err) => {
    console.error("[backfill] FAILED", err);
    pool.end().finally(() => process.exit(1));
  });
