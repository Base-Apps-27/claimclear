// One-shot backfill: reclassify confirmation emails that the legacy keyword
// classifier mislabelled, and revert the wrong "Needs Review" status flips
// where it is safe to do so.
//
// Why this exists
// ---------------
// Until the phrase-signature classifier landed, response-matcher used a
// `\bapproved\b|\bdenied\b|\breceived\b|...` regex over `subject + body`.
// The audit found ~85% false positives — almost all 167 boilerplate
// "Ticket Under Review" / "GPS-leg how-to" / Freshdesk auto-ack emails were
// misclassified as approval/denial/info_request, and each one bumped its
// invoice group (or claim) from Awaiting Response to Needs Review with a
// noisy reason like "approval response received via email — awaiting staff
// review". This script cleans up that historical damage.
//
// What it does
// ------------
// 1. Selects every portal_responses row where source='email' AND
//    responseType != 'acknowledgment' AND classifier_source NOT IN
//    ('phrase_signature', 'retro_phrase_signature') (legacy keyword/AI
//    rows that pre-date the new pipeline OR were left for manual review).
// 2. For each row, runs `classifyByPhrase` on the persisted body. If the
//    deterministic classifier now says it is an acknowledgment AND the
//    historical responseType is something else, the row is a reclassify
//    candidate. (If the classifier says a DIFFERENT actionable label —
//    e.g. legacy=approval, phrase=denial — we relabel for cleaner data
//    but never silently flip the status.)
// 3. For each candidate:
//    a. Update portal_responses: responseType='acknowledgment',
//       classifierSource='retro_phrase_signature' (DISTINCT from the
//       fresh-pipeline 'phrase_signature' so reports can tell the two
//       cohorts apart for at-a-glance triage), and stash original values
//       under metadata.retro_confirmation_reclassify so the audit trail
//       is preserved (we never lose the historical row).
//    b. Insert an explicit audit_logs row tagged
//       `response_reclassified` against the linked group OR claim with
//       the responseId, signature id, old/new classifier_source, and
//       old/new responseType in metadata. This is a permanent
//       traceability record that survives even if the row is later
//       relabelled again.
//    c. If the linked invoice group (or claim, when no group is linked) is:
//         - currently in "Needs Review",
//         - was last status-changed by the email_response_matcher
//           referencing THIS specific responseId (verified via
//           audit_logs.metadata),
//         - has no later actionable response (later non-ack response on
//           the same group/claim aborts the revert — the operator should
//           handle the more recent thing),
//         - has had no later HUMAN audit-log activity (any audit_logs row
//           after the response's receivedAt where userEmail !=
//           'system' aborts the revert — operator already touched it,
//           do not surprise them),
//       then call transitionGroupStatus / transitionClaimStatus with
//       systemOverride=true to flip the status back to "Awaiting Response"
//       with reason `"Retro reclassification of response #N — confirmation
//       email mislabelled by legacy keyword classifier"`.
//    d. Otherwise we relabel the response row but leave the status alone
//       (and log the reason it was unsafe to revert) so the human reviewer
//       still gets the cleaner data without surprise status flips.
//
// Idempotent. Re-running:
//   - Step 1's filter excludes already-reclassified rows
//     (`classifier_source IN ('phrase_signature', 'retro_phrase_signature')`),
//     so no double-work.
//   - Step 3c's preconditions check the CURRENT state, so a group already
//     reverted on a previous run shows up as "no longer Needs Review" and
//     is skipped.
//
// Flags:
//   --apply               actually write changes (default = dry-run)
//   --limit N             only process the first N candidates after sorting
//   --sender-domain X     only candidates whose sender_email ends with @X
//   --response-id N       only candidate response id N (overrides limit)
//
// Run:
//   pnpm --filter @workspace/scripts run backfill:reclassify-confirmation-emails
//   pnpm --filter @workspace/scripts run backfill:reclassify-confirmation-emails -- --apply
//   pnpm --filter @workspace/scripts run backfill:reclassify-confirmation-emails -- --apply --sender-domain medanswering.com

import {
  db,
  pool,
  portalResponsesTable,
  invoiceGroupsTable,
  claimsTable,
  auditLogsTable,
} from "@workspace/db";
import { and, eq, gt, ne, notInArray, sql, desc, isNotNull } from "drizzle-orm";
import { classifyByPhrase } from "../lib/email-phrase-classifier";
import { transitionGroupStatus } from "../lib/group-transitions";
import { transitionClaimStatus } from "../lib/claim-transitions";

const RETRO_CLASSIFIER_SOURCE = "retro_phrase_signature";

interface CliFlags {
  apply: boolean;
  limit: number | null;
  senderDomain: string | null;
  responseId: number | null;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { apply: false, limit: null, senderDomain: null, responseId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") flags.apply = true;
    else if (a === "--limit") flags.limit = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--limit=")) flags.limit = Number.parseInt(a.slice("--limit=".length), 10);
    else if (a === "--sender-domain") flags.senderDomain = argv[++i];
    else if (a.startsWith("--sender-domain=")) flags.senderDomain = a.slice("--sender-domain=".length);
    else if (a === "--response-id") flags.responseId = Number.parseInt(argv[++i], 10);
    else if (a.startsWith("--response-id=")) flags.responseId = Number.parseInt(a.slice("--response-id=".length), 10);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: reclassify-confirmation-emails-backfill [--apply] [--limit N] [--sender-domain DOMAIN] [--response-id ID]",
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
  responseType: string;
  classifierSource: string;
  senderEmail: string | null;
  subject: string | null;
  content: string | null;
  rawContent: string | null;
  bodyFormat: string;
  receivedAt: Date;
  metadata: Record<string, unknown> | null;
}

async function fetchCandidates(flags: CliFlags): Promise<CandidateResponse[]> {
  // Re-classify every email row that the legacy pipeline did NOT flag as
  // acknowledgment and that has not already been touched by the new pipeline
  // (live OR retro). AI rows ARE included: the AI sometimes hallucinated an
  // actionable label on plain ack boilerplate too.
  const conditions = [
    eq(portalResponsesTable.source, "email"),
    ne(portalResponsesTable.responseType, "acknowledgment"),
    notInArray(portalResponsesTable.classifierSource, ["phrase_signature", RETRO_CLASSIFIER_SOURCE]),
  ];
  if (flags.responseId !== null) {
    conditions.push(eq(portalResponsesTable.id, flags.responseId));
  }
  if (flags.senderDomain) {
    const domain = flags.senderDomain.replace(/^@/, "").toLowerCase();
    conditions.push(sql`lower(${portalResponsesTable.senderEmail}) like ${"%@" + domain}`);
  }

  let query = db
    .select({
      id: portalResponsesTable.id,
      claimId: portalResponsesTable.claimId,
      invoiceGroupId: portalResponsesTable.invoiceGroupId,
      responseType: portalResponsesTable.responseType,
      classifierSource: portalResponsesTable.classifierSource,
      senderEmail: portalResponsesTable.senderEmail,
      subject: portalResponsesTable.subject,
      content: portalResponsesTable.content,
      rawContent: portalResponsesTable.rawContent,
      bodyFormat: portalResponsesTable.bodyFormat,
      receivedAt: portalResponsesTable.receivedAt,
      metadata: portalResponsesTable.metadata,
    })
    .from(portalResponsesTable)
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

function senderDomainOf(senderEmail: string | null): string {
  if (!senderEmail) return "(no-sender)";
  const at = senderEmail.lastIndexOf("@");
  return at < 0 ? "(no-domain)" : senderEmail.slice(at + 1).toLowerCase();
}

interface RevertSafetyVerdict {
  safe: boolean;
  reason: string;
  /** Stable bucket for skip-reason aggregation in the summary report. */
  skipBucket?: string;
}

async function checkRevertSafety(c: CandidateResponse): Promise<RevertSafetyVerdict> {
  if (c.invoiceGroupId !== null) return checkRevertSafetyGroup(c);
  if (c.claimId !== null) return checkRevertSafetyClaim(c);
  return { safe: false, reason: "response not linked to a claim or group", skipBucket: "unlinked_response" };
}

async function checkLaterHumanActivity(opts: {
  groupId?: number;
  claimId?: number;
  after: Date;
}): Promise<{ found: true; auditId: number; userEmail: string | null } | { found: false }> {
  // Any audit_logs row on the entity, after the candidate's receivedAt,
  // authored by a NON-system user. If any exist, an operator has touched
  // this entity since the bad transition and we must not silently revert.
  const conditions = [
    gt(auditLogsTable.timestamp, opts.after),
    isNotNull(auditLogsTable.userEmail),
    ne(auditLogsTable.userEmail, "system"),
  ];
  if (opts.groupId !== undefined) conditions.push(eq(auditLogsTable.invoiceGroupId, opts.groupId));
  if (opts.claimId !== undefined) conditions.push(eq(auditLogsTable.claimId, opts.claimId));

  const [hit] = await db
    .select({ id: auditLogsTable.id, userEmail: auditLogsTable.userEmail })
    .from(auditLogsTable)
    .where(and(...conditions))
    .orderBy(auditLogsTable.timestamp)
    .limit(1);
  return hit ? { found: true, auditId: hit.id, userEmail: hit.userEmail } : { found: false };
}

async function checkRevertSafetyGroup(c: CandidateResponse): Promise<RevertSafetyVerdict> {
  const groupId = c.invoiceGroupId!;
  const [group] = await db
    .select({ status: invoiceGroupsTable.status })
    .from(invoiceGroupsTable)
    .where(eq(invoiceGroupsTable.id, groupId));
  if (!group) return { safe: false, reason: `group ${groupId} not found`, skipBucket: "entity_missing" };
  if (group.status !== "Needs Review") {
    return {
      safe: false,
      reason: `group#${groupId} is currently "${group.status}", not "Needs Review"`,
      skipBucket: "entity_no_longer_needs_review",
    };
  }

  const laterResponses = await db
    .select({ id: portalResponsesTable.id, responseType: portalResponsesTable.responseType })
    .from(portalResponsesTable)
    .where(
      and(
        eq(portalResponsesTable.invoiceGroupId, groupId),
        gt(portalResponsesTable.receivedAt, c.receivedAt),
        ne(portalResponsesTable.responseType, "acknowledgment"),
      ),
    )
    .limit(1);
  if (laterResponses.length > 0) {
    return {
      safe: false,
      reason: `group#${groupId} has a later non-ack response (#${laterResponses[0].id}, type=${laterResponses[0].responseType})`,
      skipBucket: "later_actionable_response",
    };
  }

  // NEW: any later non-system audit_log on this group means an operator
  // has already engaged with the entity since the bad transition.
  const human = await checkLaterHumanActivity({ groupId, after: c.receivedAt });
  if (human.found) {
    return {
      safe: false,
      reason: `group#${groupId} has later operator activity (audit#${human.auditId} by ${human.userEmail ?? "(unknown user)"}); leaving it alone`,
      skipBucket: "later_manual_operator_activity",
    };
  }

  const [lastChange] = await db
    .select({ id: auditLogsTable.id, action: auditLogsTable.action, metadata: auditLogsTable.metadata, userEmail: auditLogsTable.userEmail, timestamp: auditLogsTable.timestamp })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.invoiceGroupId, groupId),
        eq(auditLogsTable.action, "group_status_changed"),
      ),
    )
    .orderBy(desc(auditLogsTable.timestamp), desc(auditLogsTable.id))
    .limit(1);
  if (!lastChange) {
    return {
      safe: false,
      reason: `group#${groupId} has no group_status_changed audit row`,
      skipBucket: "no_status_change_audit",
    };
  }

  const md = (lastChange.metadata ?? {}) as Record<string, unknown>;
  const md_to = String(md.to ?? "");
  const md_source = String(md.source ?? "");
  const md_responseId = (md as { responseId?: number }).responseId;
  if (md_to !== "Needs Review" || md_source !== "email_response_matcher") {
    return {
      safe: false,
      reason: `group#${groupId} most recent status_changed (audit#${lastChange.id}) was source="${md_source}" to="${md_to}", not from email matcher`,
      skipBucket: "last_change_not_from_email_matcher",
    };
  }
  if (md_responseId !== undefined && md_responseId !== c.id) {
    return {
      safe: false,
      reason: `group#${groupId} last status flip was caused by response#${md_responseId}, not by this row (#${c.id})`,
      skipBucket: "last_change_attributed_to_other_response",
    };
  }

  return {
    safe: true,
    reason: `group#${groupId} last flip authored by email_response_matcher${md_responseId !== undefined ? ` for response#${md_responseId}` : ""}; no later operator activity`,
  };
}

async function checkRevertSafetyClaim(c: CandidateResponse): Promise<RevertSafetyVerdict> {
  const claimId = c.claimId!;
  const [claim] = await db
    .select({ status: claimsTable.status })
    .from(claimsTable)
    .where(eq(claimsTable.id, claimId));
  if (!claim) return { safe: false, reason: `claim ${claimId} not found`, skipBucket: "entity_missing" };
  if (claim.status !== "Needs Review") {
    return {
      safe: false,
      reason: `claim#${claimId} is currently "${claim.status}", not "Needs Review"`,
      skipBucket: "entity_no_longer_needs_review",
    };
  }

  const laterResponses = await db
    .select({ id: portalResponsesTable.id, responseType: portalResponsesTable.responseType })
    .from(portalResponsesTable)
    .where(
      and(
        eq(portalResponsesTable.claimId, claimId),
        gt(portalResponsesTable.receivedAt, c.receivedAt),
        ne(portalResponsesTable.responseType, "acknowledgment"),
      ),
    )
    .limit(1);
  if (laterResponses.length > 0) {
    return {
      safe: false,
      reason: `claim#${claimId} has a later non-ack response (#${laterResponses[0].id}, type=${laterResponses[0].responseType})`,
      skipBucket: "later_actionable_response",
    };
  }

  const human = await checkLaterHumanActivity({ claimId, after: c.receivedAt });
  if (human.found) {
    return {
      safe: false,
      reason: `claim#${claimId} has later operator activity (audit#${human.auditId} by ${human.userEmail ?? "(unknown user)"}); leaving it alone`,
      skipBucket: "later_manual_operator_activity",
    };
  }

  const [lastChange] = await db
    .select({ id: auditLogsTable.id, metadata: auditLogsTable.metadata, action: auditLogsTable.action })
    .from(auditLogsTable)
    .where(
      and(
        eq(auditLogsTable.claimId, claimId),
        eq(auditLogsTable.action, "status_changed"),
      ),
    )
    .orderBy(desc(auditLogsTable.timestamp), desc(auditLogsTable.id))
    .limit(1);
  if (!lastChange) {
    return {
      safe: false,
      reason: `claim#${claimId} has no status_changed audit row`,
      skipBucket: "no_status_change_audit",
    };
  }
  const md = (lastChange.metadata ?? {}) as Record<string, unknown>;
  const md_to = String(md.to ?? "");
  const md_source = String(md.source ?? "");
  const md_responseId = (md as { responseId?: number }).responseId;
  if (md_to !== "Needs Review" || md_source !== "email_response_matcher") {
    return {
      safe: false,
      reason: `claim#${claimId} last status_changed (audit#${lastChange.id}) was source="${md_source}" to="${md_to}", not from email matcher`,
      skipBucket: "last_change_not_from_email_matcher",
    };
  }
  if (md_responseId !== undefined && md_responseId !== c.id) {
    return {
      safe: false,
      reason: `claim#${claimId} last status flip was caused by response#${md_responseId}, not by this row (#${c.id})`,
      skipBucket: "last_change_attributed_to_other_response",
    };
  }
  return {
    safe: true,
    reason: `claim#${claimId} last flip authored by email_response_matcher${md_responseId !== undefined ? ` for response#${md_responseId}` : ""}; no later operator activity`,
  };
}

interface RelabelEntry {
  candidate: CandidateResponse;
  oldType: string;
  newType: string;
  signatureId: string | null;
  reverted: boolean;
  unsafeReason: string | null;
  unsafeBucket: string | null;
}

interface ReclassifyResult {
  reclassified: number;
  reverted: number;
  unsafeRevertButRelabelled: number;
  alreadyAck: number;
  classifierStillUnknown: number;
  classifierAgreesActionable: number;
  /** entries actually relabelled (for the per-domain summary). */
  relabelEntries: RelabelEntry[];
  /** counts of skip reasons for entries we relabelled but did NOT revert. */
  skipReasonCounts: Map<string, number>;
}

async function processCandidates(
  candidates: CandidateResponse[],
  flags: CliFlags,
): Promise<ReclassifyResult> {
  const result: ReclassifyResult = {
    reclassified: 0,
    reverted: 0,
    unsafeRevertButRelabelled: 0,
    alreadyAck: 0,
    classifierStillUnknown: 0,
    classifierAgreesActionable: 0,
    relabelEntries: [],
    skipReasonCounts: new Map(),
  };

  for (const c of candidates) {
    const phrase = classifyByPhrase(bodyForClassification(c));
    const target = phrase.outcome;

    if (target === "unknown") {
      result.classifierStillUnknown++;
      console.log(
        `  - response#${c.id} sender=${c.senderEmail} type=${c.responseType} src=${c.classifierSource} → phrase classifier still says UNKNOWN, leaving as-is`,
      );
      continue;
    }
    if (target === c.responseType) {
      result.classifierAgreesActionable++;
      console.log(
        `  ✓ response#${c.id} sender=${c.senderEmail} legacy=${c.responseType} matches phrase classifier (sig=${phrase.selectedSignatureId}); no relabelling needed`,
      );
      continue;
    }
    if (target !== "acknowledgment") {
      // Phrase classifier says actionable-but-different from legacy.
      // Cleaner labels are good but we are NOT going to revert a Needs
      // Review status flip in this case (the group still needs review
      // either way). Just relabel + audit.
      result.reclassified++;
      result.relabelEntries.push({
        candidate: c,
        oldType: c.responseType,
        newType: target,
        signatureId: phrase.selectedSignatureId,
        reverted: false,
        unsafeReason: "label-only relabel (still actionable; status unchanged)",
        unsafeBucket: "still_actionable_no_revert_attempted",
      });
      result.skipReasonCounts.set(
        "still_actionable_no_revert_attempted",
        (result.skipReasonCounts.get("still_actionable_no_revert_attempted") ?? 0) + 1,
      );
      console.log(
        `  ~ response#${c.id} sender=${c.senderEmail} legacy=${c.responseType} → phrase=${target} (sig=${phrase.selectedSignatureId}); relabel only, no status revert`,
      );
      if (flags.apply) {
        await relabelResponse(c, target, phrase.selectedSignatureId);
        await writeRelabelAudit(c, c.responseType, target, phrase.selectedSignatureId);
      }
      continue;
    }

    // target === 'acknowledgment' — the false-positive case the audit found.
    if (c.responseType === "acknowledgment") {
      result.alreadyAck++;
      continue;
    }
    result.reclassified++;
    const verdict = await checkRevertSafety(c);
    const linkLabel = c.invoiceGroupId !== null
      ? `group#${c.invoiceGroupId}`
      : c.claimId !== null
      ? `claim#${c.claimId}`
      : "(unlinked)";
    if (verdict.safe) {
      result.reverted++;
      console.log(
        `  ↩ response#${c.id} sender=${c.senderEmail} legacy=${c.responseType} → ack (sig=${phrase.selectedSignatureId}); reverting ${linkLabel} Needs Review → Awaiting Response — ${verdict.reason}`,
      );
    } else {
      result.unsafeRevertButRelabelled++;
      const bucket = verdict.skipBucket ?? "unspecified_skip_reason";
      result.skipReasonCounts.set(bucket, (result.skipReasonCounts.get(bucket) ?? 0) + 1);
      console.log(
        `  ⚠ response#${c.id} sender=${c.senderEmail} legacy=${c.responseType} → ack (sig=${phrase.selectedSignatureId}); RELABELLED ONLY (no status revert): ${verdict.reason}`,
      );
    }
    result.relabelEntries.push({
      candidate: c,
      oldType: c.responseType,
      newType: "acknowledgment",
      signatureId: phrase.selectedSignatureId,
      reverted: verdict.safe,
      unsafeReason: verdict.safe ? null : verdict.reason,
      unsafeBucket: verdict.safe ? null : (verdict.skipBucket ?? "unspecified_skip_reason"),
    });
    if (flags.apply) {
      await relabelResponse(c, "acknowledgment", phrase.selectedSignatureId);
      await writeRelabelAudit(c, c.responseType, "acknowledgment", phrase.selectedSignatureId);
      if (verdict.safe) await revertStatus(c);
    }
  }

  return result;
}

async function relabelResponse(
  c: CandidateResponse,
  newType: "acknowledgment" | "approval" | "denial" | "partial_approval" | "info_request" | "other",
  signatureId: string | null,
): Promise<void> {
  const oldMetadata = (c.metadata ?? {}) as Record<string, unknown>;
  const newMetadata = {
    ...oldMetadata,
    phraseSignature: signatureId,
    retro_confirmation_reclassify: {
      at: new Date().toISOString(),
      previousResponseType: c.responseType,
      previousClassifierSource: c.classifierSource,
      newSignature: signatureId,
      reason: "Legacy keyword classifier mislabelled boilerplate; reclassified by phrase-signature backfill",
    },
  };

  await db
    .update(portalResponsesTable)
    .set({
      responseType: newType,
      classifierSource: RETRO_CLASSIFIER_SOURCE,
      metadata: newMetadata,
      updatedAt: new Date(),
    })
    .where(eq(portalResponsesTable.id, c.id));
}

async function writeRelabelAudit(
  c: CandidateResponse,
  oldType: string,
  newType: string,
  signatureId: string | null,
): Promise<void> {
  // Permanent traceability record for the relabel itself, separate from the
  // metadata stash on the response row. Keyed against the linked entity so
  // it appears on the group/claim audit timeline.
  const details = `Response #${c.id} reclassified: responseType ${oldType} → ${newType}, classifierSource ${c.classifierSource} → ${RETRO_CLASSIFIER_SOURCE}${signatureId ? ` (matched signature ${signatureId})` : ""}`;
  await db.insert(auditLogsTable).values({
    claimId: c.invoiceGroupId !== null ? null : c.claimId,
    invoiceGroupId: c.invoiceGroupId,
    action: "response_reclassified",
    details,
    metadata: {
      responseId: c.id,
      previousResponseType: oldType,
      newResponseType: newType,
      previousClassifierSource: c.classifierSource,
      newClassifierSource: RETRO_CLASSIFIER_SOURCE,
      phraseSignature: signatureId,
      backfillSource: "reclassify_confirmation_emails_backfill",
      senderEmail: c.senderEmail,
      subject: c.subject,
    },
    userEmail: "system",
    userName: "Confirmation-Email Backfill",
  });
}

async function revertStatus(c: CandidateResponse): Promise<void> {
  const reason = `Retro reclassification of response #${c.id} — confirmation email mislabelled by legacy keyword classifier; reverting status set by email_response_matcher`;
  const actor = { userEmail: "system", userName: "Confirmation-Email Backfill" };
  if (c.invoiceGroupId !== null) {
    await transitionGroupStatus({
      groupId: c.invoiceGroupId,
      newStatus: "Awaiting Response",
      source: "reclassify_confirmation_emails_backfill",
      reason,
      actor,
      systemOverride: true,
    });
  } else if (c.claimId !== null) {
    await transitionClaimStatus({
      claimId: c.claimId,
      newStatus: "Awaiting Response",
      source: "reclassify_confirmation_emails_backfill",
      reason,
      actor,
      systemOverride: true,
    });
  }
}

async function reportPreState(): Promise<void> {
  const total = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(portalResponsesTable)
    .where(eq(portalResponsesTable.source, "email"));
  const nonAck = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(portalResponsesTable)
    .where(
      and(
        eq(portalResponsesTable.source, "email"),
        ne(portalResponsesTable.responseType, "acknowledgment"),
        notInArray(portalResponsesTable.classifierSource, ["phrase_signature", RETRO_CLASSIFIER_SOURCE]),
      ),
    );
  console.log(`[pre] portal_responses source=email total=${total[0].n} | non-ack legacy rows=${nonAck[0].n}`);
}

function reportRelabelBreakdown(entries: RelabelEntry[]): void {
  if (entries.length === 0) {
    console.log("\n[breakdown] no relabel entries");
    return;
  }
  // Group by (oldType, sender domain) so a reviewer can see at a glance
  // which historical buckets the reclassification cleaned up. Pick one
  // representative subject per bucket as a sanity sample.
  const buckets = new Map<string, { oldType: string; domain: string; count: number; reverted: number; sampleSubject: string | null; sampleResponseId: number }>();
  for (const e of entries) {
    const domain = senderDomainOf(e.candidate.senderEmail);
    const key = `${e.oldType}|${domain}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      if (e.reverted) existing.reverted++;
    } else {
      buckets.set(key, {
        oldType: e.oldType,
        domain,
        count: 1,
        reverted: e.reverted ? 1 : 0,
        sampleSubject: e.candidate.subject,
        sampleResponseId: e.candidate.id,
      });
    }
  }
  console.log("\n[breakdown] relabelled rows by (legacy responseType, sender domain):");
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  for (const b of sorted) {
    console.log(
      `  ${String(b.count).padStart(4)}  legacy=${b.oldType.padEnd(20)} domain=${b.domain.padEnd(28)} reverted=${b.reverted}  e.g. response#${b.sampleResponseId} subject="${(b.sampleSubject ?? "").slice(0, 80)}"`,
    );
  }

  // Per-domain totals (reclassified, reverted, relabel-only) — the
  // operator-facing summary the team will scan first.
  const perDomain = new Map<string, { count: number; reverted: number }>();
  for (const e of entries) {
    const domain = senderDomainOf(e.candidate.senderEmail);
    const ex = perDomain.get(domain) ?? { count: 0, reverted: 0 };
    ex.count++;
    if (e.reverted) ex.reverted++;
    perDomain.set(domain, ex);
  }
  console.log("\n[breakdown] per-sender-domain summary:");
  const sortedDomains = [...perDomain.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [domain, agg] of sortedDomains) {
    console.log(
      `  ${String(agg.count).padStart(4)}  ${domain.padEnd(40)}  reverted=${agg.reverted}  relabel-only=${agg.count - agg.reverted}`,
    );
  }
}

function reportSkipReasons(counts: Map<string, number>): void {
  if (counts.size === 0) {
    console.log("\n[skip-reasons] none — every relabelled row was safely reverted");
    return;
  }
  console.log("\n[skip-reasons] why some relabelled rows were NOT also status-reverted:");
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [reason, n] of sorted) {
    console.log(`  ${String(n).padStart(4)}  ${reason}`);
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  console.log(
    `[backfill] mode=${flags.apply ? "APPLY" : "dry-run"} limit=${flags.limit ?? "(none)"} senderDomain=${flags.senderDomain ?? "(any)"} responseId=${flags.responseId ?? "(any)"}\n`,
  );

  await reportPreState();
  const candidates = await fetchCandidates(flags);
  console.log(`[scan] ${candidates.length} candidate response rows to consider\n`);

  const result = await processCandidates(candidates, flags);

  console.log(`\n[summary]`);
  console.log(`  reclassified (response row updated):        ${result.reclassified}`);
  console.log(`    of which status reverted:                 ${result.reverted}`);
  console.log(`    of which relabel-only (unsafe to revert): ${result.unsafeRevertButRelabelled}`);
  console.log(`  classifier agrees with legacy actionable:   ${result.classifierAgreesActionable}`);
  console.log(`  classifier still says unknown:              ${result.classifierStillUnknown}`);
  console.log(`  already acknowledgment (skipped):           ${result.alreadyAck}`);

  reportRelabelBreakdown(result.relabelEntries);
  reportSkipReasons(result.skipReasonCounts);

  if (!flags.apply) {
    console.log(`\n[dry-run] No changes written. Re-run with --apply to commit.`);
  } else {
    console.log(`\n[apply] Done. Reclassified ${result.reclassified} responses, reverted ${result.reverted} statuses.`);
  }
}

main()
  .then(() => pool.end().then(() => process.exit(0)))
  .catch(err => {
    console.error("[backfill] FAILED", err);
    pool.end().finally(() => process.exit(1));
  });
