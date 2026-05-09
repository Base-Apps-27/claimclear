import { Router, type IRouter } from "express";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, claimsTable, invoiceGroupsTable, auditLogsTable, botActivityLogTable, errorTypesTable, appSettingsTable, claimEvidenceTable, stateEventsTable, portalBatchRunsTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";

import { asyncHandler } from "../lib/asyncHandler";
import { denyClerk } from "../middlewares/denyClerk";
import { logger } from "../lib/logger";
import { transitionClaimStatus } from "../lib/claim-transitions";
import { transitionGroupStatus } from "../lib/group-transitions";
import { lintDraft, type LintResult } from "../lib/draft-lint";
import { primaryClaimIdForGroup } from "../lib/group-claims";
import { getGroupMacroPhase } from "../lib/macro-phase";
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

// Canonical "this leg cannot be disputed" terminal markers. Mirrors the
// EXCLUSION_DISPOSITIONS / EXCLUSION_OUTCOMES ladder in
// `lib/group-packaging.ts` (Wave-C+ disposition column wins; legacy
// sopOutcome is the fallback for in-flight rows whose disposition writer
// hasn't synced yet). A leg landing on either marker is the operator's
// signed-off "no dispute here" verdict and MUST NOT be passed to the
// portal write-up prompt or have its attachments collected — that was
// the surface bug behind the "both proven correct" 2-leg write-up.
const NON_CONTESTABLE_DISPOSITIONS = new Set(["disposed_withdraw", "disposed_nonissue"]);
const NON_CONTESTABLE_SOP_OUTCOMES = new Set(["cannot_dispute", "non_issue"]);

export function isNonContestable(leg: typeof claimsTable.$inferSelect): boolean {
  if (leg.disposition && leg.disposition !== "unclassified") {
    return NON_CONTESTABLE_DISPOSITIONS.has(leg.disposition);
  }
  return leg.sopOutcome != null && NON_CONTESTABLE_SOP_OUTCOMES.has(leg.sopOutcome);
}

/**
 * Filter rides down to those eligible for inclusion in a new portal submission.
 * Excludes:
 *   - legs currently On Hold (they're being parked while evidence is gathered)
 *   - legs that already have an in-flight submission (pending/in_progress) or a
 *     submitted-and-awaiting-response submission tied to the same group
 *   - legs the operator's SOP walk terminated as non-contestable
 *     (cannot_dispute / non_issue) — these have no dispute to write up and
 *     including them here was the bug behind the "both proven correct"
 *     2-leg write-up. The exclusion runs BEFORE the in-flight check so a
 *     non-contestable leg never counts toward the "already submitted"
 *     short-circuit.
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
  excludedNonContestable: (typeof claimsTable.$inferSelect)[];
}> {
  const excludedHeld = rides.filter(r => r.status === "On Hold");
  const afterHeld = rides.filter(r => r.status !== "On Hold");
  const excludedNonContestable = afterHeld.filter(isNonContestable);
  let candidate = afterHeld.filter(r => !isNonContestable(r));
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

  return { rides: candidate, excludedHeld, excludedAlreadySubmitted, excludedNonContestable };
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

  // Task #398: dollar amounts are deliberately omitted from the prompt —
  // the dispute write-up never reasons about money, and including totals
  // invites cost-framing language that has no place in a portal note.
  const groupHeader = `This dispute is filed at the invoice level and covers ${rides.length} ride${rides.length === 1 ? "" : "s"} on a single invoice.

Invoice details:
- Invoice number: ${group.invoiceNumber}
- Client number: ${group.clientNumber || "N/A"}
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

  const message = await callAnthropicWithRetry(
    {
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
      system: systemPrompt,
    },
    { site: "portal_description", groupId: ctx.group.id },
  );

  const textBlock = message.content.find((b: { type: string }) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new LLMUnavailableError("AI returned an empty response. Please try again in a moment.");
  }
  return (textBlock as { type: "text"; text: string }).text.trim();
}

/**
 * Task #411 audit, Tier 3: the prior `buildFallbackDescription` helper
 * was used as a silent template substitute when the caller provided
 * neither a `descriptionHtml` nor a `disputeReason` to AI-generate from.
 * That meant a bot/admin "submit-now" call with a missing draft would
 * still queue a thin boilerplate write-up to MAS. The route now returns
 * 400 with `code: "missing_description"` instead — see the use site in
 * `POST /portal-submissions`. The helper is intentionally retained as a
 * no-op trap so a future caller that accidentally re-imports it gets a
 * loud runtime failure rather than silently falling back to a template.
 */
function buildFallbackDescription(
  _ctx: GroupContext,
  _disputeReason: string,
  _specialCircumstances?: string | null,
): never {
  throw new Error(
    "buildFallbackDescription has been removed — submit-now must return 400 missing_description when both descriptionHtml and disputeReason are absent (Task #411).",
  );
}

/**
 * Task #398: surfaced when the LLM is unavailable after every retry
 * attempt. Routes that catch this MUST return a 502 with the message —
 * never substitute a template fallback (that's how operators ended up
 * silently submitting thin write-ups to MAS).
 */
export class LLMUnavailableError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "LLMUnavailableError";
    this.cause = cause;
  }
}

/**
 * Surfaced by `generatePortalDraftForGroup` when the requested invoice
 * group exists but has no rides eligible for inclusion in a fresh
 * draft (everything is held or already submitted). Routes that catch
 * this should translate to a 400 — it's an operator-actionable state
 * (release a hold or wait for the existing submission to resolve).
 */
export class NoEligibleLegsError extends Error {
  readonly excludedHeld: number;
  readonly excludedAlreadySubmitted: number;
  readonly excludedNonContestable: number;
  constructor(
    message: string,
    excludedHeld: number,
    excludedAlreadySubmitted: number,
    excludedNonContestable: number = 0,
  ) {
    super(message);
    this.name = "NoEligibleLegsError";
    this.excludedHeld = excludedHeld;
    this.excludedAlreadySubmitted = excludedAlreadySubmitted;
    this.excludedNonContestable = excludedNonContestable;
  }
}

/**
 * Surfaced by `generatePortalDraftForGroup` when the requested
 * invoice group id does not resolve to a group with at least one ride.
 * Routes that catch this should translate to a 404.
 */
export class GroupNotFoundError extends Error {
  constructor(message = "Invoice group not found") {
    super(message);
    this.name = "GroupNotFoundError";
  }
}

/**
 * Wraps `anthropic.messages.create` with a small retry+backoff loop.
 * Transient blips (rate limits, 5xx, network drops) recover invisibly
 * within ~12s total; persistent failures throw `LLMUnavailableError`
 * so the route can return a clean 502. NEVER returns successfully on
 * a thrown call — the silent template fallback is gone (Task #398).
 *
 * Backoff schedule: 1s, 3s, 8s (4 total attempts).
 *
 * The return is narrowed to the non-streaming `Message` variant via
 * `Extract` (the streaming variant has no `content` field) — every
 * call site here passes non-streaming params, so this cast is sound.
 */
type AnthropicMessage = Extract<
  Awaited<ReturnType<typeof anthropic.messages.create>>,
  { content: unknown }
>;
async function callAnthropicWithRetry(
  params: Parameters<typeof anthropic.messages.create>[0],
  context: { site: string; groupId?: number },
): Promise<AnthropicMessage> {
  const delaysMs = [1000, 3000, 8000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      return (await anthropic.messages.create(params)) as AnthropicMessage;
    } catch (err) {
      lastErr = err;
      if (attempt === delaysMs.length) break;
      const delay = delaysMs[attempt];
      logger.warn(
        { err, attempt: attempt + 1, nextDelayMs: delay, site: context.site, groupId: context.groupId },
        "Anthropic call failed, retrying",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new LLMUnavailableError(
    "AI is currently unavailable. Please try again in a moment.",
    lastErr,
  );
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
  // Wave D-PR5: stamp `claims.submitted_via` on the cascaded child
  // legs so the deriver promotes the group from `ready_to_submit` →
  // `submitted` on the same write. Pass 'portal' on the create /
  // confirm / retry sites; omit on the cancel site (which reverts to
  // Needs Evidence and does NOT mark the dispute as filed).
  submittedVia?: "portal" | "email";
}): Promise<void> {
  const { ctx, newStatus, source, reason, actor, submittedVia } = opts;
  await transitionGroupStatus({
    groupId: ctx.group.id,
    newStatus,
    source,
    reason,
    actor,
    systemOverride: true,
    childFields: submittedVia ? { submittedVia } : undefined,
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

/**
 * Task #485 legacy fallback: rows created before the `legs` JSONB column
 * existed have `legs = []` (the migration's default). To keep the new
 * one-row-per-group UI consistent across pre- and post-migration history,
 * synthesize a per-leg breakdown for those rows from the invoice group's
 * claims, with `ticked: false` and no per-leg error (the legacy worker
 * never recorded per-leg outcomes, so the most we can show is the legs
 * that were eligible at the time). Bulk-fetches claims for every legacy
 * row in one query so the list endpoint stays a single round-trip.
 */
async function enrichLegacyLegs<T extends { id: number; invoiceGroupId: number; legs: Array<{ legId: number; confNumber: string | null; ticked: boolean; error?: string | null }> }>(
  rows: T[],
): Promise<T[]> {
  const legacyGroupIds = Array.from(new Set(
    rows.filter((r) => !r.legs || r.legs.length === 0).map((r) => r.invoiceGroupId),
  ));
  if (legacyGroupIds.length === 0) return rows;

  const claims = await db
    .select({ id: claimsTable.id, invoiceGroupId: claimsTable.invoiceGroupId, confNumber: claimsTable.confNumber })
    .from(claimsTable)
    .where(inArray(claimsTable.invoiceGroupId, legacyGroupIds))
    .orderBy(claimsTable.id);

  const byGroup = new Map<number, Array<{ legId: number; confNumber: string | null; ticked: boolean; error: null }>>();
  for (const c of claims) {
    if (c.invoiceGroupId == null) continue;
    const list = byGroup.get(c.invoiceGroupId) ?? [];
    list.push({ legId: c.id, confNumber: c.confNumber ?? null, ticked: false, error: null });
    byGroup.set(c.invoiceGroupId, list);
  }

  return rows.map((r) => {
    if (r.legs && r.legs.length > 0) return r;
    const fallback = byGroup.get(r.invoiceGroupId) ?? [];
    return { ...r, legs: fallback };
  });
}

/**
 * Task #564 — Portal Submissions invoice-first cleanup.
 *
 * Bulk-enrich submission rows with:
 *   - `groupMacroPhase`: derived from the parent invoice_groups row via
 *     `getGroupMacroPhase`, so the UI can render the macro phase as the
 *     primary state chip and the Submission Stage as a subordinate chip
 *     ("In-flight · Submitted").
 *   - per-leg `readyAt` + `wasReadyAtSubmission`: powers the
 *     "Ready-at-submission snapshot" panel in the drawer. A leg counts
 *     as having been `ready` at submission time when claims.ready_at
 *     is non-null AND <= the submission's createdAt.
 *
 * Bulk-fetches claims and groups in single queries so the list endpoint
 * stays a single round-trip even at scale.
 */
async function enrichSnapshotAndPhase<
  T extends {
    id: number;
    invoiceGroupId: number;
    createdAt: Date | string | null;
    legs: Array<{ legId: number; confNumber: string | null; ticked: boolean; error?: string | null }>;
  },
>(rows: T[]): Promise<Array<T & { groupMacroPhase: string | null; legs: Array<T["legs"][number] & { readyAt: string | null; wasReadyAtSubmission: boolean }> }>> {
  if (rows.length === 0) return rows as never;

  const groupIds = Array.from(new Set(rows.map((r) => r.invoiceGroupId)));
  const legIds = Array.from(new Set(rows.flatMap((r) => r.legs.map((l) => l.legId))));

  const [groups, legRows] = await Promise.all([
    db
      .select({
        id: invoiceGroupsTable.id,
        phase: invoiceGroupsTable.phase,
        status: invoiceGroupsTable.status,
        reattestRequired: invoiceGroupsTable.reattestRequired,
        reattestCompletedAt: invoiceGroupsTable.reattestCompletedAt,
      })
      .from(invoiceGroupsTable)
      .where(inArray(invoiceGroupsTable.id, groupIds)),
    legIds.length > 0
      ? db
          .select({ id: claimsTable.id, readyAt: claimsTable.readyAt })
          .from(claimsTable)
          .where(inArray(claimsTable.id, legIds))
      : Promise.resolve([] as Array<{ id: number; readyAt: Date | null }>),
  ]);

  const phaseByGroup = new Map<number, string>();
  for (const g of groups) {
    phaseByGroup.set(g.id, getGroupMacroPhase(g));
  }
  const readyAtByLeg = new Map<number, Date | null>();
  for (const l of legRows) readyAtByLeg.set(l.id, l.readyAt ?? null);

  return rows.map((r) => {
    const submittedFreezeMs = r.createdAt instanceof Date ? r.createdAt.getTime() : (r.createdAt ? new Date(r.createdAt).getTime() : null);
    const enrichedLegs = r.legs.map((leg) => {
      const readyAt = readyAtByLeg.get(leg.legId) ?? null;
      const readyMs = readyAt ? readyAt.getTime() : null;
      const wasReadyAtSubmission =
        readyMs != null && submittedFreezeMs != null && readyMs <= submittedFreezeMs;
      return {
        ...leg,
        readyAt: readyAt ? readyAt.toISOString() : null,
        wasReadyAtSubmission,
      };
    });
    return {
      ...r,
      legs: enrichedLegs,
      groupMacroPhase: phaseByGroup.get(r.invoiceGroupId) ?? null,
    };
  });
}

/**
 * Single-row convenience wrapper. Mutation endpoints (create draft,
 * update, retry, cancel, …) all return a single submission and must
 * include the schema-required `legs[].wasReadyAtSubmission` field, so
 * every response site funnels through here.
 */
async function enrichOne<
  T extends {
    id: number;
    invoiceGroupId: number;
    createdAt: Date | string | null;
    legs: Array<{ legId: number; confNumber: string | null; ticked: boolean; error?: string | null }>;
  },
>(row: T) {
  const [legacyEnriched] = await enrichLegacyLegs([row]);
  const [enriched] = await enrichSnapshotAndPhase([legacyEnriched]);
  return enriched;
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

  const withSibling = submissions.map((s) => {
    const sibling = successByGroup.get(s.invoiceGroupId);
    const completedElsewhere = sibling && sibling.submissionId !== s.id ? sibling : null;
    return { ...s, completedElsewhere };
  });
  const enriched = await enrichLegacyLegs(withSibling);
  const withSnapshot = await enrichSnapshotAndPhase(enriched);

  res.json(withSnapshot);
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

  let message: AnthropicMessage;
  try {
    message = await callAnthropicWithRetry(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
        system: systemPrompt,
      },
      { site: "readback_preflight", groupId: ctx.group.id },
    );
  } catch (err) {
    if (err instanceof LLMUnavailableError) {
      logger.error({ err: err.cause, groupId: ctx.group.id }, "AI readback preflight failed after retries");
      res.status(502).json({ error: err.message });
      return;
    }
    throw err;
  }
  const textBlock = message.content.find((b: { type: string }) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    res.status(502).json({ error: "AI returned an empty response. Please try again in a moment." });
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

/**
 * Shared LLM-driven draft pipeline for an invoice group. Used by the
 * standalone `/portal-submissions/generate-preview` endpoint AND by the
 * gauntlet's `/invoice-groups/:id/preview-generated` and `/draft/regenerate`
 * handlers so a single Generate-preview click in the UI both creates the
 * portal_submissions draft row AND populates the group's draft fields.
 *
 * Behavior:
 *   - Loads the group + rides, filters out held + already-submitted legs.
 *   - Cancels any existing draft rows for the group (keeps a single
 *     latest-draft semantic for downstream readers like the bot worker).
 *   - Calls the LLM with the same prompt the legacy route used.
 *   - Inserts a new draft row in `portal_submissions` (status="draft").
 *   - Writes the `portal_draft_created` audit row (preserves the audit
 *     contract pinned by `audit-prompt-leg-counters.test.ts`).
 *   - Returns the inserted row + its subject/description so callers can
 *     mirror those values onto `invoice_groups.draftSubject`/etc.
 *
 * Error contract — callers MUST translate:
 *   - `GroupNotFoundError`     → 404
 *   - `NoEligibleLegsError`    → 400
 *   - `LLMUnavailableError`    → 502 (never silently swallow — Task #398)
 */
export interface GeneratePortalDraftOpts {
  invoiceGroupId: number;
  disputeReason?: string;
  specialCircumstances?: string | null;
  understandingReadback?: string | null;
}

export interface GeneratePortalDraftResult {
  submission: typeof portalSubmissionsTable.$inferSelect;
  subject: string;
  descriptionHtml: string;
}

export async function generatePortalDraftForGroup(
  opts: GeneratePortalDraftOpts,
  req: { user?: { email?: string | null; displayName?: string | null } | null },
): Promise<GeneratePortalDraftResult> {
  const trimmedSpecial = (opts.specialCircumstances || "").trim();
  const trimmedReadback = (opts.understandingReadback || "").trim();
  // Understanding readback is OPTIONAL — when the operator has nothing
  // extra to add about the case overall, an empty readback is a valid
  // signal and the AI prompt simply omits that section.

  const rawCtx = await resolveContext({ invoiceGroupId: opts.invoiceGroupId });
  if (!rawCtx) throw new GroupNotFoundError();

  const groupId = rawCtx.group.id;
  const totalLegs = rawCtx.rides.length;

  // Filter held legs and already-submitted legs out of the snapshot so the
  // submission only covers the legs the user actually wants to file right now.
  const filtered = await filterRidesForSubmission(rawCtx.rides, groupId);
  if (filtered.rides.length === 0) {
    const heldCount = filtered.excludedHeld.length;
    const subCount = filtered.excludedAlreadySubmitted.length;
    const ncCount = filtered.excludedNonContestable.length;
    const reasons: string[] = [];
    if (heldCount > 0) reasons.push(`${heldCount} on hold`);
    if (subCount > 0) reasons.push(`${subCount} already submitted`);
    if (ncCount > 0) reasons.push(`${ncCount} non-contestable`);
    throw new NoEligibleLegsError(
      `Nothing to submit — every leg is excluded (${reasons.join(", ") || "no eligible legs"}). Remove a hold, withdraw a non-contestable verdict, or wait for the existing submission to resolve.`,
      heldCount,
      subCount,
      ncCount,
    );
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
  const reason = opts.disputeReason || "";
  const issueType = determineIssueType(errorType);
  const snap = buildSnapshot(ctx);

  // Task #307 guard #10: an inconsistent group surfaces loud here (before
  // the LLM call) rather than being masked by retry. Task #398: there is
  // no silent template fallback for LLM failures — a persistent outage
  // bubbles up `LLMUnavailableError` so route handlers can return 502 to
  // the UI rather than hand the operator a thin write-up they didn't ask
  // for.
  const rides = ctx.rides as PromptLegRowInput[];
  const treesByLegId = await loadDecisionTreesForLegs(rides);
  const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides, treesByLegId });
  const generatedDescription = await generatePortalDescription(
    ctx, errorType, reason, settings, promptLegInputs, trimmedSpecial || null,
  );

  const attachmentUrls = await collectGroupEvidenceUrls(ctx);
  const gpsBreadcrumbs = resolveGpsBreadcrumbs(issueType, settings.defaultGpsBreadcrumbs);

  logger.info({
    groupId: ctx.group.id,
    primaryClaimId: ctx.primaryClaim.id,
    attachmentCount: attachmentUrls.length,
    gpsBreadcrumbs,
    issueType,
    rideCount: ctx.rides.length,
    hasSpecialCircumstances: trimmedSpecial.length > 0,
  }, "Portal draft: evidence and GPS resolved");

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
    // Task #485: record one entry per disputed leg at draft time so the list
    // page can render an "N legs" pill and the drawer can show the per-leg
    // breakdown. `ticked` starts false on every leg; the producer overwrites
    // this column with worker outcomes after a real submission run.
    legs: ctx.rides.map((r) => ({
      legId: r.id,
      confNumber: r.confNumber || null,
      ticked: false,
    })),
  }).returning();

  const partialSuffix = isPartialSubmission
    ? ` — partial: ${ctx.rides.length} of ${totalLegs} legs (${filtered.excludedHeld.length} on hold, ${filtered.excludedAlreadySubmitted.length} already submitted, ${filtered.excludedNonContestable.length} non-contestable)`
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
        excludedNonContestable: filtered.excludedNonContestable.map(r => r.confNumber || r.id),
      } : {}),
    },
    userEmail: req.user?.email ?? null,
    userName: req.user?.displayName ?? null,
  });

  return {
    submission,
    subject: submission.subject ?? snap.subjectFallback,
    descriptionHtml: generatedDescription,
  };
}

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

  try {
    const { submission } = await generatePortalDraftForGroup(
      { invoiceGroupId, disputeReason, specialCircumstances, understandingReadback },
      req,
    );
    res.json(await enrichOne(submission));
  } catch (err) {
    if (err instanceof GroupNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof NoEligibleLegsError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof LLMUnavailableError) {
      logger.error({ err: err.cause, groupId: invoiceGroupId }, "AI portal description generation failed after retries");
      res.status(502).json({ error: err.message });
      return;
    }
    throw err;
  }
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

  res.json(await enrichOne(sub));
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

  // The understanding readback is OPTIONAL — regenerate uses whatever
  // saved readback the operator typed (or none at all). The AI prompt
  // handles a null/empty readback by simply omitting that section.
  const savedReadback = (existing.understandingReadback || "").trim();
  const savedSpecial = (existing.specialCircumstances || "").trim();
  // Task #307 guard #10: data inconsistency still surfaces loud here.
  // Task #398: LLM API errors return 502 (no silent template fallback) so
  // an outage doesn't quietly replace the operator's reviewed draft with
  // boilerplate when they hit Regenerate.
  const rides = ctx.rides as PromptLegRowInput[];
  const treesByLegId = await loadDecisionTreesForLegs(rides);
  const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides, treesByLegId });
  let generatedDescription: string;
  try {
    generatedDescription = await generatePortalDescription(ctx, errorType, existing.disputeReason || "", settings, promptLegInputs, savedSpecial || null);
  } catch (err) {
    if (err instanceof LLMUnavailableError) {
      logger.error({ err: err.cause, groupId: ctx.group.id, submissionId: id }, "AI portal description regeneration failed after retries");
      res.status(502).json({ error: err.message });
      return;
    }
    throw err;
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

  res.json(await enrichOne(sub));
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

  res.json(await enrichOne(sub));
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
  // Task #411 Tier 3: when ack=true and we're about to bypass lint
  // warnings, require a written reason so the audit row names WHY
  // the override happened. We deliberately enforce the floor server-
  // side (min 10 chars after trim) so a programmatic caller can't
  // submit ack:true with an empty reason — the contract is the same
  // for the UI, the bot, and curl.
  const bypassReasonRaw = (req.body?.bypassReason ?? "") as string;
  const bypassReason = typeof bypassReasonRaw === "string" ? bypassReasonRaw.trim() : "";
  const MIN_BYPASS_REASON_LENGTH = 10;

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
  if (warnings.length > 0 && ack && bypassReason.length < MIN_BYPASS_REASON_LENGTH) {
    res.status(400).json({
      error: `bypassReason is required and must be at least ${MIN_BYPASS_REASON_LENGTH} characters when bypassing lint warnings`,
      code: "missing_bypass_reason",
      field: "bypassReason",
    });
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
      submittedVia: "portal",
    });
  }

  // Task #411 audit, Tier 3: when the operator clicked "Submit anyway"
  // through the lint-warnings dialog, record that as its own dedicated
  // audit row (`lint_warnings_bypassed`) so the timeline shows BOTH the
  // bypass event and the subsequent confirm — not a single blended row
  // that hides the bypass inside metadata. The bypass row is written
  // first so it appears immediately above the confirm row in the
  // descending-by-createdAt audit log.
  const primaryClaimIdForAudit = await primaryClaimIdForGroup(existing.invoiceGroupId);
  if (warnings.length > 0 && ack) {
    await db.insert(auditLogsTable).values({
      claimId: primaryClaimIdForAudit,
      invoiceGroupId: existing.invoiceGroupId,
      action: "lint_warnings_bypassed",
      // The operator's typed bypassReason is included in the human
      // `details` string so the activity feed surfaces it without
      // having to drill into metadata. The same string is also
      // stored in `metadata.bypassReason` so downstream tooling can
      // read it programmatically without parsing free text.
      details: `Operator bypassed ${warnings.length} lint warning(s) on submission #${id}: ${warnings.map(w => w.ruleKey).join(", ")} — reason: ${bypassReason}`,
      metadata: {
        submissionId: id,
        bypassedCount: warnings.length,
        bypassedWarnings: warnings,
        bypassReason,
      },
      userEmail: req.user?.email ?? null,
      userName: req.user?.displayName ?? null,
    });
  }

  await db.insert(auditLogsTable).values({
    claimId: primaryClaimIdForAudit,
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

  res.json(await enrichOne(sub));
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
  // Understanding readback is now OPTIONAL — only persisted/used in the
  // prompt when the operator types something. An empty readback is a
  // valid "nothing extra to add" signal and is no longer a gate.

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
    const phase = getGroupMacroPhase(ctx.group);
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
      // Note: the understanding readback is OPTIONAL — no gate here. The
      // preview gate is still enforced so the operator has at least seen
      // and reviewed the AI-generated dispute write-up before it ships.
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
        bypassed: ["preview"],
        requestor: submissionActor.identity,
      };
      await db.insert(auditLogsTable).values({
        claimId: ctx.primaryClaim.id,
        invoiceGroupId: ctx.group.id,
        action: "submission_actor_bypass",
        details: `Bot submission bypassed preview gate`,
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
    // Task #307 guard #10: inconsistent group data surfaces loud here.
    // Task #398: LLM API errors return 502 (no silent template fallback)
    // so the bot/admin caller knows the draft couldn't be generated and
    // can retry, rather than receiving boilerplate they didn't ask for.
    const rides = ctx.rides as PromptLegRowInput[];
    const treesByLegId = await loadDecisionTreesForLegs(rides);
    const promptLegInputs = buildPromptLegInputs({ legs: rides, groupLegs: rides, treesByLegId });
    try {
      generatedDescription = await generatePortalDescription(ctx, errorType, reason, settings, promptLegInputs, trimmedSpecial || null);
    } catch (err) {
      if (err instanceof LLMUnavailableError) {
        logger.error({ err: err.cause, groupId: ctx.group.id }, "AI portal description generation failed after retries (POST /portal-submissions)");
        res.status(502).json({ error: err.message });
        return;
      }
      throw err;
    }
  }
  if (!generatedDescription) {
    // Task #411 audit, Tier 3: previously this branch silently
    // substituted a hard-coded boilerplate template via
    // `buildFallbackDescription`, which meant a bot/admin "submit-now"
    // call with no draft would still queue a thin write-up to MAS that
    // nobody reviewed. We now refuse: the caller must supply either
    // `descriptionHtml` (a finished draft to send verbatim) or
    // `disputeReason` (text to AI-generate from). Returning a stable
    // `code` lets the bot retry path distinguish "I forgot the draft"
    // from "the LLM is down" (502) without string-matching errors.
    res.status(400).json({
      error: "Either descriptionHtml or disputeReason is required to create a portal submission.",
      code: "missing_description",
    });
    return;
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
    // Task #485: same as the draft path above — one legs entry per disputed
    // leg, ticked=false. The producer overwrites this with worker outcomes.
    legs: ctx.rides.map((r) => ({
      legId: r.id,
      confNumber: r.confNumber || null,
      ticked: false,
    })),
  }).returning();

  await transitionContext({
    ctx,
    newStatus: "Portal Queued",
    source: "portal_submission_create",
    reason: `Portal submission created and queued${reason ? ` — reason: ${reason}` : ""}`,
    actor: { userEmail: req.user?.email ?? null, userName: req.user?.displayName ?? null },
    submittedVia: "portal",
  });

  res.status(201).json(await enrichOne(submission));
}));

router.get("/portal-submissions/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [sub] = await db.select().from(portalSubmissionsTable).where(eq(portalSubmissionsTable.id, id));
  if (!sub) { res.status(404).json({ error: "Submission not found" }); return; }

  const [enriched] = await enrichLegacyLegs([sub]);
  const [withSnapshot] = await enrichSnapshotAndPhase([enriched]);
  res.json(withSnapshot);
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
      submittedVia: "portal",
    });
  }

  res.json(await enrichOne(sub));
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

  res.json(await enrichOne(sub));
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
  res.json(await enrichOne(updated));
}));

router.get("/portal-submissions/:id/activity", asyncHandler(async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const logs = await db.select().from(botActivityLogTable)
    .where(eq(botActivityLogTable.submissionId, id))
    .orderBy(desc(botActivityLogTable.createdAt));

  res.json(logs);
}));

// POST /invoice-groups/bulk-submit-to-portal — Task #631 follow-up.
// Bulk equivalent of POST /portal-submissions for groups whose draft
// has already been marked reviewed. Each group is gated independently;
// failures land in `skipped` with a stable reason string instead of
// aborting the batch. Mirrors the per-row breakdown shape used by
// /invoice-groups/bulk-assign-error-type so the toast surface is
// consistent ("Queued 12, skipped 3 (#INV-… not_reviewed)").
//
// Mounted on the portal-submissions router (instead of the
// invoice-groups router) because every helper this endpoint touches —
// resolveContext, allDisputedLegsResolved, getPortalSettings,
// loadErrorTypeForContext, determineIssueType, buildSnapshot,
// collectGroupEvidenceUrls, resolveGpsBreadcrumbs, transitionContext —
// lives in this file and is intentionally module-private. Routing
// matches the OpenAPI path /invoice-groups/bulk-submit-to-portal
// because both routers share a common mount in routes/index.ts.
// Mirrors `/invoice-groups/bulk-assign-error-type` — clerks can read
// invoice groups but cannot file disputes, so the endpoint must be
// gated server-side as well as in the rail UI.
router.post("/invoice-groups/bulk-submit-to-portal", denyClerk, asyncHandler(async (req, res): Promise<void> => {
  const { groupIds } = req.body ?? {};
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    res.status(400).json({ error: "groupIds array is required" });
    return;
  }

  const requestedIds = (groupIds as Array<string | number>)
    .map((id) => Number(id))
    .filter((id) => !isNaN(id));

  type Skipped = { id: number; refNumber: string | null; reason: string };
  type Queued = { id: number; refNumber: string | null; submissionId: number };
  const skipped: Skipped[] = [];
  const queuedItems: Queued[] = [];

  const settings = await getPortalSettings();

  for (const gid of requestedIds) {
    const ctx = await resolveContext({ invoiceGroupId: gid });
    if (!ctx) {
      skipped.push({ id: gid, refNumber: null, reason: "not_found" });
      continue;
    }
    const refNumber = ctx.group.invoiceNumber;

    const phase = getGroupMacroPhase(ctx.group);
    if (phase !== "pre-submit") {
      skipped.push({ id: gid, refNumber, reason: "not_pre_submit" });
      continue;
    }

    if (ctx.group.draftReviewedAt == null) {
      skipped.push({ id: gid, refNumber, reason: "not_reviewed" });
      continue;
    }
    // Explicit error-type gate. The single-group preview/confirm flow
    // forces classification before the draft is even reviewable, but
    // the bulk path takes any selection from the operator so we must
    // refuse unclassified rows here — otherwise loadErrorTypeForContext
    // returns null and determineIssueType() silently falls back to
    // "Other Issue or Question", which would file a generic dispute.
    if (!ctx.group.errorTypeId && !ctx.primaryClaim.errorTypeId) {
      skipped.push({ id: gid, refNumber, reason: "error_type_unset" });
      continue;
    }
    const draftHtml = (ctx.group.draftDescriptionHtml || "").trim();
    if (!draftHtml) {
      skipped.push({ id: gid, refNumber, reason: "draft_empty" });
      continue;
    }

    const legsResult = await allDisputedLegsResolved(ctx.group.id);
    if (!legsResult.ok) {
      skipped.push({ id: gid, refNumber, reason: "legs_unresolved" });
      continue;
    }

    // Mirror the same in-flight guard the single-group POST relies on
    // via filterRidesForSubmission — if the group already has an
    // active submission row we must not double-queue it. NB: the
    // check + insert are not wrapped in a transaction because
    // `transitionGroupStatus` is also non-transactional and the
    // single-group POST /portal-submissions has the same TOCTOU
    // window (see lines ~1665+). Tightening this should be done as
    // a cross-cutting refactor on both call sites at once so the
    // guard semantics stay identical.
    const activeSubs = await db.select({ id: portalSubmissionsTable.id })
      .from(portalSubmissionsTable)
      .where(and(
        eq(portalSubmissionsTable.invoiceGroupId, ctx.group.id),
        inArray(portalSubmissionsTable.status, ["pending", "in_progress", "submitted"] as const),
      ));
    if (activeSubs.length > 0) {
      skipped.push({ id: gid, refNumber, reason: "already_submitted" });
      continue;
    }

    const errorType = await loadErrorTypeForContext(ctx);
    const snap = buildSnapshot(ctx);
    const resolvedIssueType = determineIssueType(errorType);
    const attachmentUrls = await collectGroupEvidenceUrls(ctx);
    const gpsBreadcrumbs = resolveGpsBreadcrumbs(resolvedIssueType, settings.defaultGpsBreadcrumbs);
    const trimmedReadback = (ctx.group.understandingReadback || "").trim();

    const [submission] = await db.insert(portalSubmissionsTable).values({
      invoiceGroupId: ctx.group.id,
      status: "pending",
      issueType: resolvedIssueType,
      subject: ctx.group.draftSubject || snap.subjectFallback,
      requesterEmail: settings.contactEmail,
      transportationProviderName: settings.providerName,
      phoneNumber: settings.contactPhone,
      invoiceNumber: snap.invoiceNumber,
      gpsBreadcrumbsAvailable: gpsBreadcrumbs,
      descriptionHtml: draftHtml,
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
      disputeReason: "",
      specialCircumstances: null,
      understandingReadback: trimmedReadback || null,
      understandingReadbackAt: trimmedReadback ? new Date() : null,
      evidenceNotes: snap.evidenceNotes,
      evidenceFiles: snap.evidenceFiles,
      attempts: 0,
      legs: ctx.rides.map((r) => ({
        legId: r.id,
        confNumber: r.confNumber || null,
        ticked: false,
      })),
    }).returning();

    await transitionContext({
      ctx,
      newStatus: "Portal Queued",
      source: "portal_submission_bulk_create",
      reason: "Bulk-queued from reviewed-draft filter",
      actor: { userEmail: req.user?.email ?? null, userName: req.user?.displayName ?? null },
      submittedVia: "portal",
    });

    queuedItems.push({ id: gid, refNumber, submissionId: submission.id });
  }

  res.json({
    success: true,
    queued: queuedItems.length,
    queuedItems,
    skipped,
  });
}));

export default router;
