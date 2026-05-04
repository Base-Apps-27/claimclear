import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, claimsTable, invoiceGroupsTable, auditLogsTable, botActivityLogTable, errorTypesTable, appSettingsTable, claimEvidenceTable, stateEventsTable, portalBatchRunsTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";

import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";
import { transitionClaimStatus } from "../lib/claim-transitions";
import { transitionGroupStatus } from "../lib/group-transitions";
import { lintDraft, type LintResult } from "../lib/draft-lint";
import { primaryClaimIdForGroup } from "../lib/group-claims";
import { getMacroPhase } from "../lib/macro-phase";
import { allDisputedLegsResolved, resolveSubmissionActor } from "../lib/group-readiness";
import { emitStateEvent } from "../lib/state-events";
import { buildPromptLegInputs, loadDecisionTreesForLegs, promptLegAuditCounters, type PromptLegInputsResult, type PromptLegRowInput } from "../lib/prompt-leg-inputs";

function sanitizeHtml(html: string): string {
  let safe = html.replace(/<(script|style|iframe|object|embed|form|link|meta|base)[\s\S]*?<\/\1>/gi, "");
  safe = safe.replace(/<(script|style|iframe|object|embed|form|link|meta|base)[^>]*\/?>/gi, "");
  safe = safe.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "");
  safe = safe.replace(/\s+on\w+\s*=\s*'[^']*'/gi, "");
  safe = safe.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, "");
  safe = safe.replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"');
  safe = safe.replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");
  return safe;
}

// NOTE: Confirming a draft, queueing a submission, or retrying a failed
// submission only moves the row to status="pending". The Playwright worker is
// no longer kicked here — pending rows are picked up either (a) by an admin
// clicking "Process Pending" / "Process Selected" on the Portal Submissions
// page, or (b) by the scheduled portal_batch_sweeper cron that runs at
// 8am / 11am / 2pm / 6pm ET on weekdays. This is intentional: admins want
// to batch submissions rather than have the bot fire one row at a time
// the instant it's queued.

async function loadLintInputs(submission: typeof portalSubmissionsTable.$inferSelect) {
  // Lint runs against the group's primary leg — pick the lowest-id ride in
  // the group as the representative claim so the lint signal stays stable
  // across re-runs. Submissions are always group-scoped after the cutover.
  const [claim] = await db.select().from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, submission.invoiceGroupId))
    .orderBy(claimsTable.id)
    .limit(1);
  const evidence = await db.select({ evidenceTypeName: claimEvidenceTable.evidenceTypeName })
    .from(claimEvidenceTable)
    .where(eq(claimEvidenceTable.invoiceGroupId, submission.invoiceGroupId));
  return { claim: claim || null, evidence };
}

const router: IRouter = Router();

export interface GroupContext {
  group: typeof invoiceGroupsTable.$inferSelect;
  rides: (typeof claimsTable.$inferSelect)[];
  primaryClaim: typeof claimsTable.$inferSelect;
}

async function loadGroupContextByGroupId(groupId: number): Promise<GroupContext | null> {
  const [group] = await db.select().from(invoiceGroupsTable).where(eq(invoiceGroupsTable.id, groupId));
  if (!group) return null;
  const rides = await db.select().from(claimsTable)
    .where(eq(claimsTable.invoiceGroupId, groupId))
    .orderBy(claimsTable.id);
  if (rides.length === 0) return null;
  // primaryClaim is the lowest-id ride in the group — the stable
  // representative we use for audit-log row attribution.
  return { group, rides, primaryClaim: rides[0] };
}

/**
 * Filter rides down to those eligible for inclusion in a new portal submission.
 * Excludes:
 *   - legs currently On Hold (they're being parked while evidence is gathered)
 *   - legs that already have an in-flight submission (pending/in_progress) or a
 *     submitted-and-awaiting-response submission tied to the same group
 *
 * Returns the filtered rides plus the excluded buckets so the caller can audit
 * what was skipped.
 */
async function filterRidesForSubmission(
  rides: (typeof claimsTable.$inferSelect)[],
  groupId: number,
): Promise<{
  rides: (typeof claimsTable.$inferSelect)[];
  excludedHeld: (typeof claimsTable.$inferSelect)[];
  excludedAlreadySubmitted: (typeof claimsTable.$inferSelect)[];
}> {
  const excludedHeld = rides.filter(r => r.status === "On Hold");
  let candidate = rides.filter(r => r.status !== "On Hold");
  let excludedAlreadySubmitted: (typeof claimsTable.$inferSelect)[] = [];

  if (candidate.length > 0) {
    // Submissions are now group-scoped: if any in-flight submission exists
    // for this group, every eligible ride on the group is blocked from a
    // new submission until the existing one resolves. (Pre-cutover this
    // filter was per-leg; per-leg blocking has no meaning in the
    // group-only model.)
    const activeSubs = await db.select({ id: portalSubmissionsTable.id })
      .from(portalSubmissionsTable)
      .where(and(
        eq(portalSubmissionsTable.invoiceGroupId, groupId),
        inArray(portalSubmissionsTable.status, ["pending", "in_progress", "submitted"] as const),
      ));
    if (activeSubs.length > 0) {
      excludedAlreadySubmitted = candidate;
      candidate = [];
    }
  }

  return { rides: candidate, excludedHeld, excludedAlreadySubmitted };
}

/**
 * The `evidenceFiles` JSONB column is typed as `EvidenceFileRef[]` after
 * Task #384, but rows written before the contract tightened may still hold
 * plain string URLs. Centralise the legacy-shape narrowing so callers see a
 * single typed string list instead of sprinkling casts.
 *
 * Once a backfill normalises every row to `EvidenceFileRef[]`, the
 * `typeof item === "string"` branch can be dropped.
 */
function evidenceFileUrls(
  files: Array<{ url: string; name?: string | null; size?: number | null }> | null | undefined,
): string[] {
  if (!files) return [];
  const out: string[] = [];
  for (const item of files as ReadonlyArray<unknown>) {
    if (typeof item === "string" && item.length > 0) {
      out.push(item);
    } else if (item && typeof item === "object" && "url" in item && typeof (item as { url: unknown }).url === "string") {
      out.push((item as { url: string }).url);
    }
  }
  return out;
}

async function collectGroupEvidenceUrls(ctx: GroupContext): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (u: unknown) => {
    if (typeof u === "string" && u.length > 0 && !seen.has(u)) {
      if (!u.startsWith("/objects/")) {
        logger.warn({ url: u, groupId: ctx.group.id }, "collectGroupEvidenceUrls: dropping non-object-storage URL to prevent uncontrolled outbound request");
        return;
      }
      seen.add(u);
      urls.push(u);
    }
  };

  const groupEvidence = await db.select({ imageUrl: claimEvidenceTable.imageUrl })
    .from(claimEvidenceTable)
    .where(eq(claimEvidenceTable.invoiceGroupId, ctx.group.id));
  for (const r of groupEvidence) add(r.imageUrl);

  for (const url of evidenceFileUrls(ctx.group.evidenceFiles)) add(url);

  const rideIds = ctx.rides.map(r => r.id);
  if (rideIds.length > 0) {
    const rideEvidence = await db.select({ imageUrl: claimEvidenceTable.imageUrl })
      .from(claimEvidenceTable)
      .where(inArray(claimEvidenceTable.claimId, rideIds));
    for (const r of rideEvidence) add(r.imageUrl);
  }

  for (const ride of ctx.rides) {
    for (const url of evidenceFileUrls(ride.evidenceFiles)) add(url);
  }

  return urls;
}

function resolveGpsBreadcrumbs(issueType: string, settingsDefault: string): string {
  if (["Yes", "No", "Unknown"].includes(settingsDefault)) return settingsDefault;
  const isGps = issueType === "GPS Control Deviation";
  return isGps ? "Yes" : "";
}

export interface PortalSettings {
  providerName: string;
  contactEmail: string;
  contactPhone: string;
  defaultGpsBreadcrumbs: string;
  defaultDisputeInstructions: string;
}

async function getPortalSettings(): Promise<PortalSettings> {
  const rows = await db.select().from(appSettingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value || "";
  return {
    providerName: map["portal_provider_name"] || "",
    contactEmail: map["portal_contact_email"] || "",
    contactPhone: map["portal_contact_phone"] || "",
    defaultGpsBreadcrumbs: map["portal_default_gps_breadcrumbs"] || "",
    defaultDisputeInstructions: map["default_dispute_instructions"] || "",
  };
}

/**
 * Pick the dispatch path for a portal submission. The mapping lives on the
 * error_types row so admins can re-route a plan from the error-types admin
 * page without a code change. Three mutually-exclusive paths are supported
 * (the admin UI presents these as a single 3-way picker):
 *
 * - `useDirectEmail = true`           → "Direct Email" — bypass the MAS
 *   portal entirely and send the dispute as an email to the global
 *   recipient configured under app_settings.direct_email_recipient. Used
 *   for issue classes MAS resolves over email (e.g. "Attesting too Soon",
 *   "Invoice Number not in System"). Wins over the GPS toggle if both
 *   happen to be set.
 * - `useGpsControlDeviation = true`  → "GPS Control Deviation" Freshdesk
 *   form (the only form that has the GPS Breadcrumbs Available field).
 * - everything else                   → "Other Issue or Question" (safe
 *   default; also used when no error type is set on the claim/group).
 *
 * Downstream consumers (batch processor, worker) branch on the returned
 * string. "Direct Email" routes to sendDirectEmailDispute; the two
 * Freshdesk values route to the Playwright worker.
 */
export const DIRECT_EMAIL_ISSUE_TYPE = "Direct Email";

export function determineIssueType(errorType: typeof errorTypesTable.$inferSelect | null): string {
  if (errorType?.useDirectEmail) return DIRECT_EMAIL_ISSUE_TYPE;
  if (errorType?.useGpsControlDeviation) return "GPS Control Deviation";
  return "Other Issue or Question";
}

function joinNonEmpty(items: (string | null | undefined)[], sep = ", "): string {
  return items.filter((v): v is string => typeof v === "string" && v.length > 0).join(sep);
}

function sumAmounts(rides: (typeof claimsTable.$inferSelect)[]): string {
  let total = 0;
  for (const r of rides) {
    const v = parseFloat(String(r.claimAmount || "0"));
    if (!isNaN(v)) total += v;
  }
  return total.toFixed(2);
}

interface SubmissionSnapshot {
  invoiceNumber: string;
  confNumber: string;
  serviceDate: string;
  refNumber: string;
  clientNumber: string;
  carNumber: string;
  claimAmount: string | null;
  errorTypeName: string;
  errorDetails: string;
  evidenceNotes: string;
  // Mirrors invoiceGroups.evidenceFiles / portalSubmissions.evidenceFiles —
  // see EvidenceFileRef in lib/api-spec/openapi.yaml.
  evidenceFiles: Array<{ url: string; name?: string | null; size?: number | null }> | null;
  subjectFallback: string;
}

function buildSnapshot(ctx: GroupContext): SubmissionSnapshot {
  const { group, rides, primaryClaim } = ctx;
  const allConfs = joinNonEmpty(rides.map(r => r.confNumber));
  const allDates = joinNonEmpty(Array.from(new Set(rides.map(r => r.date || ""))));
  const allCars = joinNonEmpty(Array.from(new Set(rides.map(r => r.carNumber || ""))));

  const totalAmount = group.totalAmount ?? sumAmounts(rides);
  const subject = `Dispute - Invoice #${group.invoiceNumber} - ${group.errorTypeName || "Claim Correction"} (${rides.length} ride${rides.length === 1 ? "" : "s"})`;
  return {
    invoiceNumber: group.invoiceNumber,
    confNumber: allConfs,
    serviceDate: allDates,
    refNumber: group.invoiceNumber,
    clientNumber: group.clientNumber || primaryClaim.clientNumber || "",
    carNumber: allCars,
    claimAmount: totalAmount ? String(totalAmount) : null,
    errorTypeName: group.errorTypeName || "",
    errorDetails: group.errorDetails || "",
    evidenceNotes: group.evidenceNotes || "",
    evidenceFiles: group.evidenceFiles || null,
    subjectFallback: subject,
  };
}

/**
 * Pure prompt-assembly for the portal/email write-up. Extracted so the
 * deterministic prompt-shape tests in `__tests__/prompt-leg-inputs.test.ts`
 * can assert on the assembled prompt without invoking the LLM. The
 * `promptLegInputs` argument MUST come from `buildPromptLegInputs` — never
 * read the per-leg-context column or the duplicate-of-claim pointer column
 * directly here (the helper is the single source of truth for both).
 */
export function buildPortalDescriptionPrompt(opts: {
  ctx: GroupContext;
  errorType: typeof errorTypesTable.$inferSelect | null;
  disputeReason: string;
  settings: PortalSettings;
  promptLegInputs: PromptLegInputsResult;
  specialCircumstances?: string | null;
}): { prompt: string; systemPrompt: string } {
  const { ctx, errorType, disputeReason, settings, promptLegInputs, specialCircumstances } = opts;
  const { group, rides } = ctx;
  const instructions = errorType?.disputeInstructions || errorType?.emailTemplate || settings.defaultDisputeInstructions;
  const snap = buildSnapshot(ctx);
  // For the direct-email path, the AI-generated text becomes the email body
  // (wrapped with greeting + sign-off later by buildDirectEmailHtml). For
  // both portal paths, the same text lands in a plain-text portal field.
  const isDirectEmail = errorType?.useDirectEmail === true;

  const ridesBlock = promptLegInputs.ridesBlock;

  const groupHeader = `This dispute is filed at the invoice level and covers ${rides.length} ride${rides.length === 1 ? "" : "s"} on a single invoice.

Invoice details:
- Invoice number: ${group.invoiceNumber}
- Client number: ${group.clientNumber || "N/A"}
- Total invoice amount: $${snap.claimAmount || "0.00"}
- Error type: ${group.errorTypeName || "N/A"}
- Group-level error details: ${group.errorDetails || "N/A"}

Affected rides on this invoice:
${ridesBlock}`;

  const evidenceSummary = group.evidenceNotes || rides.map(r => r.evidenceNotes).filter(Boolean).join("; ");

  const formatRules = isDirectEmail
    ? `Write a clear, factual dispute message that:
- States the reason for the dispute/correction request
- References the invoice number (${group.invoiceNumber}) and lists the affected confirmation numbers
- References specific evidence (and notes that supporting files are attached, when applicable)
- Is professional but sounds natural and human — vary phrasing
- Is concise (2-4 paragraphs maximum)
- Does NOT include a greeting line ("Hello,") or a sign-off / signature — those will be added automatically when the message is wrapped into an email`
    : `Write a clear, factual portal submission note that:
- States the reason for the dispute/correction request
- ${group ? `References the invoice number (${group.invoiceNumber}) and lists the affected confirmation numbers` : "References the confirmation number"}
- References specific evidence
- Is professional but sounds natural and human — vary phrasing
- Is concise (2-4 paragraphs maximum)
- Does NOT include email-style greetings or sign-offs (this goes in a portal text field, not an email)`;

  const channelLine = isDirectEmail
    ? "Write a concise dispute message for an NEMT (Non-Emergency Medical Transportation) claim correction request that will be sent as an email to MAS Trip Inventory Resolution."
    : "Write a concise dispute note for an NEMT (Non-Emergency Medical Transportation) claim correction request to be submitted on a support portal.";

  const trimmedSpecial = (specialCircumstances || "").trim();
  // The special-circumstances block has to *reshape* the narrative, not be a
  // tail-appendix. Place it above the format rules and lead with a plainly
  // bossy directive so the model treats it as the spine of the write-up.
  const specialBlock = trimmedSpecial
    ? `CRITICAL CONTEXT — incorporate this into the narrative, do not just append it. This may fundamentally change what the dispute is about; treat it as authoritative and let it shape the framing, the headline argument, and the order of the supporting points. If it conflicts with the surface-level error type, follow this context:
${trimmedSpecial}

`
    : "";

  const prompt = `${channelLine}

${groupHeader}

Reason for dispute (from workflow decision): ${disputeReason}

${evidenceSummary ? `Evidence gathered: ${evidenceSummary}` : ""}
${errorType?.guidance ? `SOP context: ${errorType.guidance}` : ""}

${specialBlock}${instructions ? `IMPORTANT — Follow these guidelines for tone and content:\n${instructions}` : ""}

${formatRules}

Return ONLY the note text, no JSON wrapping.`;

  const systemPrompt = isDirectEmail
    ? "You are a professional NEMT claims dispute specialist. Write the body of a dispute email on behalf of a transportation provider — without the greeting or sign-off (those are added automatically). Each message should sound natural — vary sentence structure and word choice so no two messages are identical. Avoid boilerplate or robotic language. Return only the body text."
    : "You are a professional NEMT claims dispute specialist. Write clear, factual portal submission notes on behalf of a transportation provider. Each note should sound natural — vary sentence structure and word choice so no two notes are identical. Avoid boilerplate or robotic language. Return only the note text.";

  return { prompt, systemPrompt };
}

/**
 * Pure prompt-assembly for the AI readback preflight. Extracted so the
 * deterministic prompt-shape tests can assert on the assembled prompt
 * without invoking the LLM. Per Task #307 §"Done looks like", the readback
 * sees the same per-leg findings the full draft will see — but only when
 * there is something to say (parity guard: byte-equivalent to the legacy
 * prompt when no leg has per-leg context and no sibling-duplicate pointers
 * exist).
 */
export function buildReadbackPrompt(opts: {
  ctx: GroupContext;
  errorType: typeof errorTypesTable.$inferSelect | null;
  reason: string;
  specialCircumstances: string;
  promptLegInputs: PromptLegInputsResult;
}): { prompt: string; systemPrompt: string } {
  const { ctx, errorType, reason, specialCircumstances, promptLegInputs } = opts;
  const headline = `Invoice #${ctx.group.invoiceNumber} (${ctx.rides.length} ride${ctx.rides.length === 1 ? "" : "s"}) — Error Type: ${ctx.group.errorTypeName || errorType?.name || "Unclassified"}.`;
  const guidance = errorType?.guidance ? `\nSOP guidance for this error type: ${errorType.guidance}` : "";
  const treeLine = reason ? `\nDecision-tree outcome: ${reason}` : "";
  const trimmedSpecial = specialCircumstances.trim();
  const specialLine = trimmedSpecial
    ? `\nOperator-supplied special circumstances (this may fundamentally change the framing — let it lead):\n${trimmedSpecial}`
    : "\nOperator-supplied special circumstances: (none)";
  // Parity guard: only inject the per-leg findings block when the
  // operator actually captured per-leg context, the SOP walk produced a
  // transcript, or sibling-duplicate pointers exist on the group.
  // Otherwise the prompt is byte-identical to the legacy. Including the
  // transcript-only case here preserves the readback↔write-up parity
  // promised at the top of this block — Task #377 added transcripts as a
  // first-class context source, and the readback must see the same
  // grounding the full draft will see.
  const perLegBlock = (promptLegInputs.hasPerLegContext || promptLegInputs.hasSopTranscript || promptLegInputs.siblingDuplicateCount > 0)
    ? `\nPer-leg findings the operator captured during the SOP walk (lead with these where they reshape the surface read of the error type):\n${promptLegInputs.ridesBlock}`
    : "";

  const prompt = `You are previewing your understanding of an NEMT claim dispute before drafting the full write-up. Do NOT write the dispute. In 2 to 4 plain-language sentences, restate — in your own words — what the dispute is actually about, given the inputs below. Lead with the core ask, then the key reason. If the operator's special circumstances change the framing from a surface read of the error type, reflect that explicitly in the readback so the operator can spot any misunderstanding.

${headline}${guidance}${treeLine}${perLegBlock}${specialLine}

Return ONLY the 2–4 sentence restatement. No headers, no bullet points, no preamble like "Here is my understanding".`;

  const systemPrompt = "You restate the operator's pending NEMT claim dispute in 2–4 sentences so they can verify the AI is on the same page before you draft the full write-up. Be concrete, specific to the inputs, and never invent facts.";

  return { prompt, systemPrompt };
}

async function generatePortalDescription(
  ctx: GroupContext,
  errorType: typeof errorTypesTable.$inferSelect | null,
  disputeReason: string,
  settings: PortalSettings,
  promptLegInputs: PromptLegInputsResult,
  specialCircumstances?: string | null,
): Promise<string> {
  const { prompt, systemPrompt } = buildPortalDescriptionPrompt({
    ctx, errorType, disputeReason, settings, promptLegInputs, specialCircumstances,
  });

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
    system: systemPrompt,
  });

  const textBlock = message.content.find((b: { type: string }) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("Empty LLM response");
  return (textBlock as { type: "text"; text: string }).text.trim();
}

function buildFallbackDescription(
  ctx: GroupContext,
  disputeReason: string,
  specialCircumstances?: string | null,
): string {
  const { group, rides } = ctx;
  const snap = buildSnapshot(ctx);
  // Lead with the operator's narrative-shaping context so a failed LLM call
  // doesn't silently drop it from the write-up.
  const trimmedSpecial = (specialCircumstances || "").trim();
  const specialPrefix = trimmedSpecial ? `Special Circumstances: ${trimmedSpecial}\n\n` : "";
  const ridesBlock = rides.map((r, i) => `${i + 1}. Conf #${r.confNumber} — ${r.date || "N/A"} — $${r.claimAmount || "0.00"}`).join("\n");
  return `${specialPrefix}Dispute for Invoice Number: ${group.invoiceNumber}
Client Number: ${group.clientNumber || "N/A"}
Total Amount: $${snap.claimAmount || "0.00"}
Error Type: ${group.errorTypeName || "N/A"}
Error Details: ${group.errorDetails || "N/A"}

Affected rides (${rides.length}):
${ridesBlock}

Dispute Reason: ${disputeReason || "N/A"}

Evidence Notes: ${group.evidenceNotes || "N/A"}`;
}

async function loadErrorTypeForContext(ctx: GroupContext): Promise<typeof errorTypesTable.$inferSelect | null> {
  const errorTypeId = ctx.group.errorTypeId || ctx.primaryClaim.errorTypeId;
  if (!errorTypeId) return null;
  const id = parseInt(errorTypeId, 10);
  if (isNaN(id)) return null;
  const [et] = await db.select().from(errorTypesTable).where(eq(errorTypesTable.id, id));
  return et || null;
}

async function transitionContext(opts: {
  ctx: GroupContext;
  newStatus: "Portal Queued" | "Awaiting Response" | "Needs Evidence";
  source: string;
  reason: string;
  actor: { userEmail: string | null; userName: string | null };
}): Promise<void> {
  const { ctx, newStatus, source, reason, actor } = opts;
  await transitionGroupStatus({
    groupId: ctx.group.id,
    newStatus,
    source,
    reason,
    actor,
    systemOverride: true,
  });
}

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

async function resolveContext(body: { invoiceGroupId?: number }): Promise<GroupContext | null> {
  if (!body.invoiceGroupId) return null;
  return loadGroupContextByGroupId(body.invoiceGroupId);
}

async function loadContextForSubmission(sub: typeof portalSubmissionsTable.$inferSelect): Promise<GroupContext | null> {
  return loadGroupContextByGroupId(sub.invoiceGroupId);
}

router.get("/portal-submissions", asyncHandler(async (req, res): Promise<void> => {
  const { status } = req.query;
  const statusStr = typeof status === "string" ? status : undefined;

  const submissions = await db.select().from(portalSubmissionsTable)
    .where(statusStr ? eq(portalSubmissionsTable.status, statusStr as (typeof portalSubmissionsTable.status.enumValues)[number]) : undefined)
    .orderBy(desc(portalSubmissionsTable.createdAt));

  // For each group present, find the latest sibling submitted row and
  // attach it as `completedElsewhere` on every other row in the group.
  // Legacy rows (no submittedInBatchId) surface with runId/runLabel = null.
  const groupIds = Array.from(
    new Set(submissions.map((s) => s.invoiceGroupId).filter((g): g is number => typeof g === "number")),
  );

  type SiblingSuccess = {
    submissionId: number;
    runId: number | null;
    runLabel: string | null;
    submittedAt: string | null;
  };
  const successByGroup = new Map<number, SiblingSuccess>();

  if (groupIds.length > 0) {
    const successRows = await db
      .select({
        id: portalSubmissionsTable.id,
        invoiceGroupId: portalSubmissionsTable.invoiceGroupId,
        submittedAt: portalSubmissionsTable.submittedAt,
        createdAt: portalSubmissionsTable.createdAt,
        runId: portalBatchRunsTable.id,
      })
      .from(portalSubmissionsTable)
      .leftJoin(
        portalBatchRunsTable,
        eq(portalSubmissionsTable.submittedInBatchId, portalBatchRunsTable.batchId),
      )
      .where(and(
        inArray(portalSubmissionsTable.invoiceGroupId, groupIds),
        eq(portalSubmissionsTable.status, "submitted"),
      ))
      .orderBy(
        sql`${portalSubmissionsTable.submittedAt} desc nulls last`,
        desc(portalSubmissionsTable.createdAt),
        desc(portalSubmissionsTable.id),
      );

    // Latest success wins: ORDER BY submittedAt desc nulls last, createdAt
    // desc, id desc → first seen per group is the truly most recent
    // successful submission (drafts can be created early but submitted late).
    for (const row of successRows) {
      if (successByGroup.has(row.invoiceGroupId)) continue;
      successByGroup.set(row.invoiceGroupId, {
        submissionId: row.id,
        runId: row.runId ?? null,
        runLabel: row.runId != null ? `#${row.runId}` : null,
        submittedAt: row.submittedAt ?? (row.createdAt instanceof Date ? row.createdAt.toISOString() : null),
      });
    }
  }

  const enriched = submissions.map((s) => {
    const sibling = successByGroup.get(s.invoiceGroupId);
    const completedElsewhere = sibling && sibling.submissionId !== s.id ? sibling : null;
    return { ...s, completedElsewhere };
  });

  res.json(enriched);
}));

/**
 * Preflight "read it back to me" step. Given the error type, the decision-tree
 * outcome, and any operator-supplied context, the model returns a 2–4 sentence
 * restatement of what the dispute is actually about. Read-only — no DB writes
 * happen here so the operator can re-check freely. A successful call writes a
 * single audit log entry so the activity feed can show that the operator
 * verified AI understanding before generating the full draft.
 */
router.post("/portal-submissions/preflight-understanding", asyncHandler(async (req, res): Promise<void> => {
  const { invoiceGroupId, disputeReason, specialCircumstances } = req.body as {
    invoiceGroupId?: number;
    disputeReason?: string;
    specialCircumstances?: string;
  };
  if (!invoiceGroupId) {
    res.status(400).json({ error: "invoiceGroupId is required" });
    return;
  }

  const ctx = await resolveContext({ invoiceGroupId });
  if (!ctx) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const errorType = await loadErrorTypeForContext(ctx);
  const reason = (disputeReason || "").trim();
  const trimmedSpecial = (specialCircumstances || "").trim();

  // Pre-compute prompt-leg inputs (Task #307 guard #10): the readback sees
  // the same per-leg findings the full draft will see so the operator's
  // verification step can't be silently shorn of new context.
  const rides = ctx.rides as PromptLegRowInput[];
  const treesByLegId = await loadDecisionTreesForLegs(rides);
  const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides, treesByLegId });
  const { prompt, systemPrompt } = buildReadbackPrompt({ ctx, errorType, reason, specialCircumstances: trimmedSpecial, promptLegInputs });

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
    system: systemPrompt,
  });
  const textBlock = message.content.find((b: { type: string }) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    res.status(502).json({ error: "Empty AI response" });
    return;
  }
  const readback = (textBlock as { type: "text"; text: string }).text.trim();

  await db.insert(auditLogsTable).values({
    claimId: ctx.primaryClaim.id,
    invoiceGroupId: ctx.group.id,
    action: "portal_understanding_preflight",
    details: trimmedSpecial
      ? `AI understanding preflight returned (with special circumstances, ${trimmedSpecial.length} chars)`
      : `AI understanding preflight returned (no special circumstances)`,
    metadata: {
      hasSpecialCircumstances: trimmedSpecial.length > 0,
      specialCircumstancesLength: trimmedSpecial.length,
      readbackLength: readback.length,
      ...promptLegAuditCounters(promptLegInputs),
    },
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  });

  res.json({ readback });
}));

router.post("/portal-submissions/generate-preview", asyncHandler(async (req, res): Promise<void> => {
  const { invoiceGroupId, disputeReason, specialCircumstances, understandingReadback } = req.body as {
    invoiceGroupId?: number;
    disputeReason?: string;
    specialCircumstances?: string;
    understandingReadback?: string;
  };
  if (!invoiceGroupId) {
    res.status(400).json({ error: "invoiceGroupId is required" });
    return;
  }
  const trimmedSpecial = (specialCircumstances || "").trim();
  const trimmedReadback = (understandingReadback || "").trim();
  // Universal gate: a confirmed AI understanding readback is required before
  // any draft is generated, even when no special circumstances were supplied.
  // The operator must have seen and approved the AI's restatement first.
  if (trimmedReadback.length === 0) {
    res.status(400).json({ error: "understandingReadback is required to generate a draft. Run /portal-submissions/preflight-understanding first." });
    return;
  }

  const rawCtx = await resolveContext({ invoiceGroupId });
  if (!rawCtx) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const groupId = rawCtx.group.id;
  const totalLegs = rawCtx.rides.length;

  // Filter held legs and already-submitted legs out of the snapshot so the
  // submission only covers the legs the user actually wants to file right now.
  const filtered = await filterRidesForSubmission(rawCtx.rides, groupId);
  if (filtered.rides.length === 0) {
    const heldCount = filtered.excludedHeld.length;
    const subCount = filtered.excludedAlreadySubmitted.length;
    const reasons: string[] = [];
    if (heldCount > 0) reasons.push(`${heldCount} on hold`);
    if (subCount > 0) reasons.push(`${subCount} already submitted`);
    res.status(400).json({
      error: `Nothing to submit — every leg is excluded (${reasons.join(", ") || "no eligible legs"}). Remove a hold or wait for the existing submission to resolve.`,
    });
    return;
  }
  const ctx: GroupContext = { group: rawCtx.group, rides: filtered.rides, primaryClaim: filtered.rides[0] };
  const isPartialSubmission = filtered.rides.length < totalLegs;

  const existingDrafts = await db.select().from(portalSubmissionsTable)
    .where(and(
      eq(portalSubmissionsTable.invoiceGroupId, groupId),
      eq(portalSubmissionsTable.status, "draft"),
    ));
  for (const draft of existingDrafts) {
    await db.update(portalSubmissionsTable).set({ status: "cancelled" })
      .where(eq(portalSubmissionsTable.id, draft.id));
  }

  const settings = await getPortalSettings();
  const errorType = await loadErrorTypeForContext(ctx);
  const reason = disputeReason || "";
  const issueType = determineIssueType(errorType);
  const snap = buildSnapshot(ctx);

  // Build prompt-leg inputs OUTSIDE the try/catch so an inconsistent group
  // surfaces loud (Task #307 guard #10) — the LLM-error fallback below must
  // not mask data-shape problems.
  const rides = ctx.rides as PromptLegRowInput[];
  const treesByLegId = await loadDecisionTreesForLegs(rides);
  const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides, treesByLegId });
  let generatedDescription = "";
  try {
    generatedDescription = await generatePortalDescription(ctx, errorType, reason, settings, promptLegInputs, trimmedSpecial || null);
  } catch (err) {
    logger.warn({ err }, "AI portal description generation failed, using fallback");
    generatedDescription = buildFallbackDescription(ctx, reason, trimmedSpecial || null);
  }

  const attachmentUrls = await collectGroupEvidenceUrls(ctx);
  const gpsBreadcrumbs = resolveGpsBreadcrumbs(issueType, settings.defaultGpsBreadcrumbs);

  logger.info({ groupId: ctx.group.id, primaryClaimId: ctx.primaryClaim.id, attachmentCount: attachmentUrls.length, gpsBreadcrumbs, issueType, rideCount: ctx.rides.length, hasSpecialCircumstances: trimmedSpecial.length > 0 }, "Portal draft: evidence and GPS resolved");

  const [submission] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: ctx.group.id,
    status: "draft",
    issueType,
    subject: snap.subjectFallback,
    requesterEmail: settings.contactEmail,
    transportationProviderName: settings.providerName,
    phoneNumber: settings.contactPhone,
    invoiceNumber: snap.invoiceNumber,
    gpsBreadcrumbsAvailable: gpsBreadcrumbs,
    descriptionHtml: generatedDescription,
    descriptionEditorEmail: req.user?.email ?? null,
    descriptionEditorName: req.user?.displayName ?? null,
    attachmentUrls,
    confNumber: snap.confNumber,
    serviceDate: snap.serviceDate,
    refNumber: snap.refNumber,
    clientNumber: snap.clientNumber,
    carNumber: snap.carNumber,
    claimAmount: snap.claimAmount,
    errorTypeName: snap.errorTypeName,
    errorDetails: snap.errorDetails,
    disputeReason: reason,
    specialCircumstances: trimmedSpecial || null,
    understandingReadback: trimmedReadback || null,
    understandingReadbackAt: trimmedReadback ? new Date() : null,
    evidenceNotes: snap.evidenceNotes,
    evidenceFiles: snap.evidenceFiles,
    attempts: 0,
  }).returning();

  const partialSuffix = isPartialSubmission
    ? ` — partial: ${ctx.rides.length} of ${totalLegs} legs (${filtered.excludedHeld.length} on hold, ${filtered.excludedAlreadySubmitted.length} already submitted)`
    : "";
  const contextSuffix = trimmedSpecial ? " — with operator special circumstances" : "";
  await db.insert(auditLogsTable).values({
    claimId: ctx.primaryClaim.id,
    invoiceGroupId: ctx.group.id,
    action: "portal_draft_created",
    details: `Portal submission draft generated for review (${attachmentUrls.length} evidence files, ${ctx.rides.length} ride${ctx.rides.length === 1 ? "" : "s"})${partialSuffix}${contextSuffix}`,
    metadata: {
      hasSpecialCircumstances: trimmedSpecial.length > 0,
      ...promptLegAuditCounters(promptLegInputs),
      ...(isPartialSubmission ? {
        includedLegs: ctx.rides.map(r => r.confNumber || r.id),
        excludedHeld: filtered.excludedHeld.map(r => r.confNumber || r.id),
        excludedAlreadySubmitted: filtered.excludedAlreadySubmitted.map(r => r.confNumber || r.id),
      } : {}),
    },
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  });

  res.json(submission);
}));

router.put("/portal-submissions/:id/update-draft", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Submission not found" }); return; }
  const editableStatuses = ["draft", "pending", "failed", "dry_run"];
  if (!editableStatuses.includes(existing.status)) {
    res.status(400).json({ error: "Only draft, pending, failed, or dry_run submissions can be edited" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (req.body.subject !== undefined) updates.subject = req.body.subject;
  if (req.body.issueType !== undefined) updates.issueType = req.body.issueType;
  if (req.body.gpsBreadcrumbsAvailable !== undefined) updates.gpsBreadcrumbsAvailable = req.body.gpsBreadcrumbsAvailable;
  if (req.body.requesterEmail !== undefined) updates.requesterEmail = req.body.requesterEmail;
  if (req.body.transportationProviderName !== undefined) updates.transportationProviderName = req.body.transportationProviderName;
  if (req.body.phoneNumber !== undefined) updates.phoneNumber = req.body.phoneNumber;
  if (req.body.invoiceNumber !== undefined) updates.invoiceNumber = req.body.invoiceNumber;

  // Special circumstances editing on the Review card. If the operator changes
  // the context, the previously-confirmed AI readback no longer reflects what
  // the AI was told, so we wipe it (and its timestamp) — the UI will gate
  // Regenerate behind a fresh re-check. If only the readback is supplied
  // (e.g. operator just confirmed a fresh preflight), accept it as-is.
  if (req.body.specialCircumstances !== undefined) {
    const incoming = (req.body.specialCircumstances as string | null | undefined) ?? "";
    const trimmedIncoming = incoming.trim();
    const previous = (existing.specialCircumstances || "").trim();
    updates.specialCircumstances = trimmedIncoming.length > 0 ? trimmedIncoming : null;
    if (trimmedIncoming !== previous) {
      updates.understandingReadback = null;
      updates.understandingReadbackAt = null;
    }
  }
  if (req.body.understandingReadback !== undefined) {
    const incomingReadback = (req.body.understandingReadback as string | null | undefined) ?? "";
    const trimmedIncomingReadback = incomingReadback.trim();
    if (trimmedIncomingReadback.length > 0) {
      updates.understandingReadback = trimmedIncomingReadback;
      updates.understandingReadbackAt = new Date();
    } else {
      updates.understandingReadback = null;
      updates.understandingReadbackAt = null;
    }
  }

  if (req.body.descriptionHtml !== undefined) {
    const newDescription = sanitizeHtml(String(req.body.descriptionHtml ?? ""));
    const previousDescription = existing.descriptionHtml || "";
    if (newDescription !== previousDescription) {
      updates.descriptionHtml = newDescription;
      updates.descriptionEditorEmail = req.user?.email ?? null;
      updates.descriptionEditorName = req.user?.displayName ?? null;
      if (previousDescription) {
        updates.descriptionHistory = pushHistory(existing.descriptionHistory, {
          description: previousDescription,
          generatedAt: (existing.updatedAt instanceof Date ? existing.updatedAt : new Date()).toISOString(),
          editorEmail: existing.descriptionEditorEmail ?? null,
          editorName: existing.descriptionEditorName ?? null,
        });
      }
    }
  }

  const [sub] = await db.update(portalSubmissionsTable).set(updates)
    .where(eq(portalSubmissionsTable.id, id)).returning();

  const specialChanged = req.body.specialCircumstances !== undefined && updates.specialCircumstances !== undefined;
  const readbackChanged = req.body.understandingReadback !== undefined && updates.understandingReadback !== undefined;
  const descriptionChanged = updates.descriptionHtml !== undefined;
  if (descriptionChanged || specialChanged || readbackChanged) {
    const editedParts: string[] = [];
    if (descriptionChanged) editedParts.push("description");
    if (specialChanged) editedParts.push("special circumstances");
    if (readbackChanged && !specialChanged) editedParts.push("AI readback");
    const newSpecial = (updates.specialCircumstances as string | null | undefined) ?? null;
    const newReadback = (updates.understandingReadback as string | null | undefined) ?? null;
    const detailSuffix = specialChanged
      ? (newSpecial && newSpecial.length > 0
        ? " — operator special circumstances updated (readback re-confirmed)"
        : " — operator special circumstances cleared")
      : "";
    await db.insert(auditLogsTable).values({
      claimId: await primaryClaimIdForGroup(existing.invoiceGroupId),
      invoiceGroupId: existing.invoiceGroupId,
      action: "portal_draft_edited",
      details: `Portal submission #${id} ${editedParts.join(", ")} edited${detailSuffix}`,
      metadata: {
        submissionId: id,
        editedFields: editedParts,
        descriptionChanged,
        specialCircumstancesChanged: specialChanged,
        understandingReadbackChanged: readbackChanged,
        hasSpecialCircumstances: newSpecial !== null && newSpecial.length > 0,
        specialCircumstancesLength: newSpecial ? newSpecial.length : 0,
        hasUnderstandingReadback: newReadback !== null && newReadback.length > 0,
      },
      userEmail: req.user?.email ?? null,
      userName: req.user?.displayName ?? null,
    });
  }

  res.json(sub);
}));

const MAX_DESCRIPTION_HISTORY = 5;

type DescriptionHistoryEntry = {
  description: string;
  generatedAt: string;
  editorEmail?: string | null;
  editorName?: string | null;
};

function pushHistory(
  history: DescriptionHistoryEntry[] | null | undefined,
  entry: DescriptionHistoryEntry | null,
): DescriptionHistoryEntry[] {
  const list = Array.isArray(history) ? [...history] : [];
  if (entry && entry.description) list.unshift(entry);
  return list.slice(0, MAX_DESCRIPTION_HISTORY);
}

router.post("/portal-submissions/:id/regenerate", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Submission not found" }); return; }

  const editableStatuses = ["draft", "pending", "failed"];
  if (!editableStatuses.includes(existing.status)) {
    res.status(400).json({ error: "Cannot regenerate text for submissions in this status" });
    return;
  }

  const ctx = await loadContextForSubmission(existing);
  if (!ctx) { res.status(404).json({ error: "Associated claim or group not found" }); return; }

  const settings = await getPortalSettings();
  const errorType = await loadErrorTypeForContext(ctx);

  // Universal preflight gate: a confirmed AI understanding readback is
  // required for any draft generation, including regenerate. The original
  // draft was created with a confirmed readback; if context was later edited
  // without a fresh re-check, update-draft cleared the readback and this
  // guard rejects the regenerate.
  const savedReadback = (existing.understandingReadback || "").trim();
  if (savedReadback.length === 0) {
    res.status(400).json({
      error: "understandingReadback is required to regenerate the draft. Re-confirm AI understanding from the Special Circumstances panel first.",
    });
    return;
  }
  const savedSpecial = (existing.specialCircumstances || "").trim();
  // Pre-compute prompt-leg inputs (Task #307 guard #10): data inconsistency
  // surfaces loud, while LLM API errors still fall back to the template.
  const rides = ctx.rides as PromptLegRowInput[];
  const treesByLegId = await loadDecisionTreesForLegs(rides);
  const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides, treesByLegId });
  let generatedDescription = "";
  try {
    generatedDescription = await generatePortalDescription(ctx, errorType, existing.disputeReason || "", settings, promptLegInputs, savedSpecial || null);
  } catch (err) {
    logger.warn({ err }, "AI portal description regeneration failed, using fallback");
    generatedDescription = buildFallbackDescription(ctx, existing.disputeReason || "", savedSpecial || null);
  }

  const previousDescription = existing.descriptionHtml || "";
  const newHistory = previousDescription
    ? pushHistory(existing.descriptionHistory, {
        description: previousDescription,
        generatedAt: (existing.updatedAt instanceof Date ? existing.updatedAt : new Date()).toISOString(),
        editorEmail: existing.descriptionEditorEmail ?? null,
        editorName: existing.descriptionEditorName ?? null,
      })
    : (existing.descriptionHistory ?? []);

  const [sub] = await db.update(portalSubmissionsTable).set({
    descriptionHtml: generatedDescription,
    descriptionHistory: newHistory,
    descriptionEditorEmail: req.user?.email ?? null,
    descriptionEditorName: req.user?.displayName ?? null,
  }).where(eq(portalSubmissionsTable.id, id)).returning();

  await db.insert(auditLogsTable).values({
    claimId: await primaryClaimIdForGroup(existing.invoiceGroupId),
    invoiceGroupId: existing.invoiceGroupId,
    action: "portal_draft_regenerated",
    details: `Portal submission #${id} description regenerated`,
    metadata: { submissionId: id, ...promptLegAuditCounters(promptLegInputs) },
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  });

  res.json(sub);
}));

router.post("/portal-submissions/:id/revert-description", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { index } = req.body as { index?: number };
  if (typeof index !== "number" || index < 0) {
    res.status(400).json({ error: "index must be a non-negative number" });
    return;
  }

  const [existing] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Submission not found" }); return; }

  const editableStatuses = ["draft", "pending", "failed"];
  if (!editableStatuses.includes(existing.status)) {
    res.status(400).json({ error: "Cannot revert text for submissions in this status" });
    return;
  }

  const history = Array.isArray(existing.descriptionHistory) ? [...existing.descriptionHistory] : [];
  if (index >= history.length) {
    res.status(400).json({ error: "History index out of range" });
    return;
  }

  const [chosen] = history.splice(index, 1);
  const previousDescription = existing.descriptionHtml || "";
  const newHistory: DescriptionHistoryEntry[] = previousDescription
    ? [{
        description: previousDescription,
        generatedAt: (existing.updatedAt instanceof Date ? existing.updatedAt : new Date()).toISOString(),
        editorEmail: existing.descriptionEditorEmail ?? null,
        editorName: existing.descriptionEditorName ?? null,
      }, ...history].slice(0, MAX_DESCRIPTION_HISTORY)
    : history.slice(0, MAX_DESCRIPTION_HISTORY);

  const [sub] = await db.update(portalSubmissionsTable).set({
    descriptionHtml: chosen.description,
    descriptionHistory: newHistory,
    descriptionEditorEmail: chosen.editorEmail ?? null,
    descriptionEditorName: chosen.editorName ?? null,
  }).where(eq(portalSubmissionsTable.id, id)).returning();

  await db.insert(auditLogsTable).values({
    claimId: await primaryClaimIdForGroup(existing.invoiceGroupId),
    invoiceGroupId: existing.invoiceGroupId,
    action: "portal_draft_reverted",
    details: `Portal submission #${id} description reverted to history entry ${index}`,
    metadata: { submissionId: id, historyIndex: index },
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  });

  res.json(sub);
}));

router.post("/portal-submissions/:id/lint", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Submission not found" }); return; }

  const { claim, evidence } = await loadLintInputs(existing);
  if (!claim) { res.status(404).json({ error: "Claim not found for submission" }); return; }

  const results: LintResult[] = lintDraft(existing, claim, evidence);
  res.json(results);
}));

router.post("/portal-submissions/:id/confirm", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Submission not found" }); return; }
  if (existing.status !== "draft") {
    res.status(400).json({ error: "Only draft submissions can be confirmed" });
    return;
  }

  const ack = req.body?.ack === true;

  const { claim, evidence } = await loadLintInputs(existing);
  if (!claim) { res.status(404).json({ error: "Claim not found for submission" }); return; }
  const lintResults = lintDraft(existing, claim, evidence);
  const failures = lintResults.filter(r => r.severity === "fail");
  const warnings = lintResults.filter(r => r.severity === "warn");
  if (failures.length > 0) {
    res.status(422).json({ failures });
    return;
  }
  if (warnings.length > 0 && !ack) {
    res.status(422).json({ failures: warnings });
    return;
  }

  const [sub] = await db.update(portalSubmissionsTable).set({ status: "pending" })
    .where(eq(portalSubmissionsTable.id, id)).returning();

  const ctx = await loadContextForSubmission(existing);
  if (ctx) {
    await transitionContext({
      ctx,
      newStatus: "Portal Queued",
      source: "portal_submission_confirm",
      reason: `Portal submission #${id} confirmed and queued for processing`,
      actor: { userEmail: req.user?.email ?? null, userName: req.user?.displayName ?? null },
    });
  }

  await db.insert(auditLogsTable).values({
    claimId: await primaryClaimIdForGroup(existing.invoiceGroupId),
    invoiceGroupId: existing.invoiceGroupId,
    action: "portal_submission_confirmed",
    details: `Portal submission #${id} confirmed${warnings.length > 0 ? ` with ${warnings.length} warning(s) acknowledged` : ""}`,
    metadata: {
      submissionId: id,
      lintWarningsAcknowledged: warnings.length > 0,
      lintWarnings: warnings,
    },
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  });

  res.json(sub);
}));

router.post("/portal-submissions", asyncHandler(async (req, res): Promise<void> => {
  const { invoiceGroupId, issueType, subject, requesterEmail, transportationProviderName,
    phoneNumber, invoiceNumber, gpsBreadcrumbsAvailable, descriptionHtml, disputeReason,
    specialCircumstances, understandingReadback } = req.body;

  if (!invoiceGroupId) {
    res.status(400).json({ error: "invoiceGroupId is required" });
    return;
  }

  const trimmedSpecial = (specialCircumstances || "").trim();
  const trimmedReadback = (understandingReadback || "").trim();
  // Universal preflight gate: a confirmed AI understanding readback is required
  // for any new draft, regardless of whether special circumstances were given.
  if (trimmedReadback.length === 0) {
    res.status(400).json({ error: "understandingReadback is required to generate a draft. Run /portal-submissions/preflight-understanding first." });
    return;
  }

  const ctx = await resolveContext({ invoiceGroupId });
  if (!ctx) { res.status(404).json({ error: "Invoice group not found" }); return; }

  const actorResult = resolveSubmissionActor(req, req.body);
  if ("error" in actorResult) {
    res.status(actorResult.status).json({ error: actorResult.error });
    return;
  }
  const { actor: submissionActor } = actorResult;
  const isBot = submissionActor.kind === "system";

  if (ctx.group) {
    const phase = getMacroPhase(ctx.group.status);
    if (phase !== "pre-submit") {
      res.status(409).json({
        error: "Group is not in pre-submit",
        expectedState: "pre-submit",
        actualState: phase,
        gate: "phase",
      });
      return;
    }

    if (!isBot) {
      if (ctx.group.understandingReadbackAt == null) {
        res.status(409).json({
          error: "Understanding readback not confirmed",
          expectedState: "readback-confirmed",
          actualState: "no-readback",
          gate: "readback",
        });
        return;
      }

      if (ctx.group.previewGeneratedAt == null) {
        res.status(409).json({
          error: "Preview not generated",
          expectedState: "preview-generated",
          actualState: "no-preview",
          gate: "preview",
        });
        return;
      }
    }

    const legsResult = await allDisputedLegsResolved(ctx.group.id);
    if (!legsResult.ok) {
      res.status(409).json({
        error: "Not all disputed legs are resolved",
        expectedState: "all-legs-resolved",
        actualState: `${legsResult.unresolved}-unresolved`,
        gate: "legs",
      });
      return;
    }

    if (isBot) {
      const bypassPayload = {
        actorType: "system" as const,
        bypassed: ["readback", "preview"],
        requestor: submissionActor.identity,
      };
      await db.insert(auditLogsTable).values({
        claimId: ctx.primaryClaim.id,
        invoiceGroupId: ctx.group.id,
        action: "submission_actor_bypass",
        details: `Bot submission bypassed readback+preview gates`,
        metadata: bypassPayload,
        userEmail: null,
        userName: submissionActor.identity,
      });
      await emitStateEvent({
        eventKey: "group.submission_bypass_used",
        claimId: ctx.primaryClaim.id,
        invoiceGroupId: ctx.group.id,
        actorUserId: submissionActor.identity,
        metadata: bypassPayload,
      });
    }
  }

  const settings = await getPortalSettings();
  const errorType = await loadErrorTypeForContext(ctx);
  const reason = disputeReason || "";
  const snap = buildSnapshot(ctx);

  let generatedDescription = descriptionHtml || "";
  if (!generatedDescription && reason) {
    // Pre-compute prompt-leg inputs OUTSIDE the try/catch (Task #307 guard
    // #10): inconsistent group data surfaces loud rather than being masked
    // by the template fallback below.
    const rides = ctx.rides as PromptLegRowInput[];
    const treesByLegId = await loadDecisionTreesForLegs(rides);
    const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides, treesByLegId });
    try {
      generatedDescription = await generatePortalDescription(ctx, errorType, reason, settings, promptLegInputs, trimmedSpecial || null);
    } catch (err) {
      logger.warn({ err }, "AI portal description generation failed, using fallback");
      generatedDescription = buildFallbackDescription(ctx, reason, trimmedSpecial || null);
    }
  }
  if (!generatedDescription) {
    generatedDescription = buildFallbackDescription(ctx, reason, trimmedSpecial || null);
  }

  const resolvedIssueType = issueType || determineIssueType(errorType);
  const attachmentUrls = await collectGroupEvidenceUrls(ctx);
  const gpsBreadcrumbs = gpsBreadcrumbsAvailable || resolveGpsBreadcrumbs(resolvedIssueType, settings.defaultGpsBreadcrumbs);

  const [submission] = await db.insert(portalSubmissionsTable).values({
    invoiceGroupId: ctx.group.id,
    status: "pending",
    issueType: resolvedIssueType,
    subject: subject || snap.subjectFallback,
    requesterEmail: requesterEmail || settings.contactEmail,
    transportationProviderName: transportationProviderName || settings.providerName,
    phoneNumber: phoneNumber || settings.contactPhone,
    invoiceNumber: invoiceNumber || snap.invoiceNumber,
    gpsBreadcrumbsAvailable: gpsBreadcrumbs,
    descriptionHtml: generatedDescription,
    descriptionEditorEmail: req.user?.email ?? null,
    descriptionEditorName: req.user?.displayName ?? null,
    attachmentUrls,
    confNumber: snap.confNumber,
    serviceDate: snap.serviceDate,
    refNumber: snap.refNumber,
    clientNumber: snap.clientNumber,
    carNumber: snap.carNumber,
    claimAmount: snap.claimAmount,
    errorTypeName: snap.errorTypeName,
    errorDetails: snap.errorDetails,
    disputeReason: reason,
    specialCircumstances: trimmedSpecial || null,
    understandingReadback: trimmedReadback || null,
    understandingReadbackAt: trimmedReadback ? new Date() : null,
    evidenceNotes: snap.evidenceNotes,
    evidenceFiles: snap.evidenceFiles,
    attempts: 0,
  }).returning();

  await transitionContext({
    ctx,
    newStatus: "Portal Queued",
    source: "portal_submission_create",
    reason: `Portal submission created and queued${reason ? ` — reason: ${reason}` : ""}`,
    actor: { userEmail: req.user?.email ?? null, userName: req.user?.displayName ?? null },
  });

  res.status(201).json(submission);
}));

router.get("/portal-submissions/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [sub] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }

  res.json(sub);
}));

router.post("/portal-submissions/:id/retry", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Submission not found" }); return; }

  const retryableStatuses = ["failed", "dry_run"];
  if (!retryableStatuses.includes(existing.status)) {
    res.status(400).json({ error: `Cannot retry a submission in "${existing.status}" status. Only failed or dry run submissions can be retried.` });
    return;
  }

  const [sub] = await db.update(portalSubmissionsTable).set({
    status: "pending",
    errorMessage: null,
  }).where(eq(portalSubmissionsTable.id, id)).returning();

  const ctx = await loadContextForSubmission(existing);
  if (ctx) {
    await transitionContext({
      ctx,
      newStatus: "Portal Queued",
      source: "portal_submission_retry",
      reason: `Portal submission #${id} retried from "${existing.status}" status`,
      actor: { userEmail: req.user?.email ?? null, userName: req.user?.displayName ?? null },
    });
  }

  res.json(sub);
}));

router.post("/portal-submissions/:id/cancel", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Submission not found" }); return; }

  const cancellableStatuses = ["draft", "pending", "failed", "dry_run"];
  if (!cancellableStatuses.includes(existing.status)) {
    res.status(400).json({ error: `Cannot cancel a submission in "${existing.status}" status. ${existing.status === "in_progress" ? "Wait for it to finish processing." : "Already submitted."}` });
    return;
  }

  const [sub] = await db.update(portalSubmissionsTable).set({
    status: "cancelled",
  }).where(eq(portalSubmissionsTable.id, id)).returning();

  if (existing.status === "pending") {
    const otherActive = await db.select().from(portalSubmissionsTable).where(
      and(
        eq(portalSubmissionsTable.invoiceGroupId, existing.invoiceGroupId),
        inArray(portalSubmissionsTable.status, ["pending", "in_progress"]),
      ),
    );
    if (otherActive.length === 0) {
      const ctx = await loadContextForSubmission(existing);
      if (ctx) {
        await transitionContext({
          ctx,
          newStatus: "Needs Evidence",
          source: "portal_submission_cancel",
          reason: `Portal submission #${id} cancelled, no other active submissions — reverting status`,
          actor: { userEmail: req.user?.email ?? null, userName: req.user?.displayName ?? null },
        });
      }
    }
  } else {
    await db.insert(auditLogsTable).values({
      claimId: await primaryClaimIdForGroup(existing.invoiceGroupId),
      invoiceGroupId: existing.invoiceGroupId,
      action: "portal_submission_cancelled",
      details: `Portal submission #${id} cancelled from "${existing.status}" status`,
      metadata: { submissionId: id, previousStatus: existing.status, source: "portal_submission_cancel" },
      userEmail: req.user?.email ?? null,
      userName: req.user?.displayName ?? null,
    });
  }

  res.json(sub);
}));

router.post("/portal-submissions/:id/sandbox-run", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Refuse sandbox runs on rows that are part of an in-flight batch (claimed
  // or actively being submitted). Two concurrent Playwright sessions on the
  // same row would race in the portal and corrupt the submission state.
  const [row] = await db.select({
    status: portalSubmissionsTable.status,
    claimedByBatchId: portalSubmissionsTable.claimedByBatchId,
    claimedByUserName: portalSubmissionsTable.claimedByUserName,
  }).from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id)).limit(1);
  if (!row) { res.status(404).json({ error: "Submission not found" }); return; }
  if (row.status === "in_progress" || row.claimedByBatchId) {
    res.status(409).json({
      error: row.claimedByUserName
        ? `Batch already running by ${row.claimedByUserName}`
        : "This submission is already being processed by an active batch.",
    });
    return;
  }

  const { runSandboxForSubmission } = await import("../lib/batch-processor");
  const updated = await runSandboxForSubmission(id);
  res.json(updated);
}));

router.get("/portal-submissions/:id/activity", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const logs = await db.select().from(botActivityLogTable)
    .where(eq(botActivityLogTable.submissionId, id))
    .orderBy(desc(botActivityLogTable.createdAt));

  res.json(logs);
}));

export default router;
