import { Router, type IRouter } from "express";
import { eq, desc, and, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { portalSubmissionsTable, claimsTable, invoiceGroupsTable, auditLogsTable, botActivityLogTable, errorTypesTable, appSettingsTable, claimEvidenceTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { asyncHandler } from "../lib/asyncHandler";
import { logger } from "../lib/logger";
import { transitionClaimStatus } from "../lib/claim-transitions";
import { transitionGroupStatus } from "../lib/group-transitions";
import { lintDraft, type LintResult } from "../lib/draft-lint";

// NOTE: Confirming a draft, queueing a submission, or retrying a failed
// submission only moves the row to status="pending". The Playwright worker is
// no longer kicked here — pending rows are picked up either (a) by an admin
// clicking "Process Pending" / "Process Selected" on the Portal Submissions
// page, or (b) by the scheduled portal_batch_sweeper cron that runs at
// 8am / 11am / 2pm / 6pm ET on weekdays. This is intentional: admins want
// to batch submissions rather than have the bot fire one row at a time
// the instant it's queued.

async function loadLintInputs(submission: typeof portalSubmissionsTable.$inferSelect) {
  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, submission.claimId));
  let evidence: { evidenceTypeName: string | null }[] = [];
  if (submission.invoiceGroupId) {
    evidence = await db.select({ evidenceTypeName: claimEvidenceTable.evidenceTypeName })
      .from(claimEvidenceTable)
      .where(eq(claimEvidenceTable.invoiceGroupId, submission.invoiceGroupId));
  } else {
    evidence = await db.select({ evidenceTypeName: claimEvidenceTable.evidenceTypeName })
      .from(claimEvidenceTable)
      .where(eq(claimEvidenceTable.claimId, submission.claimId));
  }
  return { claim: claim || null, evidence };
}

const router: IRouter = Router();

interface GroupContext {
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
  groupId: number | null,
): Promise<{
  rides: (typeof claimsTable.$inferSelect)[];
  excludedHeld: (typeof claimsTable.$inferSelect)[];
  excludedAlreadySubmitted: (typeof claimsTable.$inferSelect)[];
}> {
  const excludedHeld = rides.filter(r => r.status === "On Hold");
  let candidate = rides.filter(r => r.status !== "On Hold");
  let excludedAlreadySubmitted: (typeof claimsTable.$inferSelect)[] = [];

  if (groupId && candidate.length > 0) {
    const activeSubs = await db.select({ claimId: portalSubmissionsTable.claimId })
      .from(portalSubmissionsTable)
      .where(and(
        eq(portalSubmissionsTable.invoiceGroupId, groupId),
        inArray(portalSubmissionsTable.status, ["pending", "in_progress", "submitted"] as const),
      ));
    const blockedIds = new Set(activeSubs.map(s => s.claimId));
    excludedAlreadySubmitted = candidate.filter(r => blockedIds.has(r.id));
    candidate = candidate.filter(r => !blockedIds.has(r.id));
  }

  return { rides: candidate, excludedHeld, excludedAlreadySubmitted };
}

async function loadGroupContextByClaimId(claimId: number): Promise<GroupContext | { primaryClaim: typeof claimsTable.$inferSelect; group: null; rides: (typeof claimsTable.$inferSelect)[] } | null> {
  const [claim] = await db.select().from(claimsTable).where(eq(claimsTable.id, claimId));
  if (!claim) return null;
  if (claim.invoiceGroupId) {
    const ctx = await loadGroupContextByGroupId(claim.invoiceGroupId);
    if (ctx) return ctx;
  }
  return { primaryClaim: claim, group: null, rides: [claim] };
}

async function collectGroupEvidenceUrls(ctx: { group: typeof invoiceGroupsTable.$inferSelect | null; rides: (typeof claimsTable.$inferSelect)[] }): Promise<string[]> {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (u: unknown) => {
    if (typeof u === "string" && u.length > 0 && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };

  if (ctx.group) {
    const groupEvidence = await db.select({ imageUrl: claimEvidenceTable.imageUrl })
      .from(claimEvidenceTable)
      .where(eq(claimEvidenceTable.invoiceGroupId, ctx.group.id));
    for (const r of groupEvidence) add(r.imageUrl);

    if (ctx.group.evidenceFiles && Array.isArray(ctx.group.evidenceFiles)) {
      for (const f of ctx.group.evidenceFiles as Array<Record<string, string> | string>) {
        add(typeof f === "string" ? f : f.url);
      }
    }
  }

  const rideIds = ctx.rides.map(r => r.id);
  if (rideIds.length > 0) {
    const rideEvidence = await db.select({ imageUrl: claimEvidenceTable.imageUrl })
      .from(claimEvidenceTable)
      .where(inArray(claimEvidenceTable.claimId, rideIds));
    for (const r of rideEvidence) add(r.imageUrl);
  }

  for (const ride of ctx.rides) {
    if (ride.evidenceFiles && Array.isArray(ride.evidenceFiles)) {
      for (const f of ride.evidenceFiles as Array<Record<string, string> | string>) {
        add(typeof f === "string" ? f : f.url);
      }
    }
  }

  return urls;
}

function resolveGpsBreadcrumbs(issueType: string, settingsDefault: string): string {
  if (["Yes", "No", "Unknown"].includes(settingsDefault)) return settingsDefault;
  const isGps = issueType === "GPS Control Deviation";
  return isGps ? "Yes" : "";
}

interface PortalSettings {
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
  evidenceFiles: unknown;
  workflowHistory: unknown;
  subjectFallback: string;
}

function buildSnapshot(ctx: GroupContext | { group: null; primaryClaim: typeof claimsTable.$inferSelect; rides: (typeof claimsTable.$inferSelect)[] }): SubmissionSnapshot {
  const { group, rides, primaryClaim } = ctx;
  const allConfs = joinNonEmpty(rides.map(r => r.confNumber));
  const allDates = joinNonEmpty(Array.from(new Set(rides.map(r => r.date || ""))));
  const allCars = joinNonEmpty(Array.from(new Set(rides.map(r => r.carNumber || ""))));

  if (group) {
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
      workflowHistory: group.workflowProgress || null,
      subjectFallback: subject,
    };
  }
  return {
    invoiceNumber: primaryClaim.invoiceNumbers || "",
    confNumber: primaryClaim.confNumber || "",
    serviceDate: primaryClaim.date || "",
    refNumber: primaryClaim.refNumber || "",
    clientNumber: primaryClaim.clientNumber || "",
    carNumber: primaryClaim.carNumber || "",
    claimAmount: primaryClaim.claimAmount || null,
    errorTypeName: primaryClaim.errorTypeName || "",
    errorDetails: primaryClaim.errorDetails || "",
    evidenceNotes: primaryClaim.evidenceNotes || "",
    evidenceFiles: primaryClaim.evidenceFiles || null,
    workflowHistory: primaryClaim.workflowProgress || null,
    subjectFallback: `Dispute - Conf #${primaryClaim.confNumber || "N/A"} - ${primaryClaim.errorTypeName || "Claim Correction"}`,
  };
}

async function generatePortalDescription(
  ctx: GroupContext | { group: null; primaryClaim: typeof claimsTable.$inferSelect; rides: (typeof claimsTable.$inferSelect)[] },
  errorType: typeof errorTypesTable.$inferSelect | null,
  disputeReason: string,
  settings: PortalSettings,
): Promise<string> {
  const { group, rides } = ctx;
  const instructions = errorType?.disputeInstructions || errorType?.emailTemplate || settings.defaultDisputeInstructions;
  const snap = buildSnapshot(ctx);
  // For the direct-email path, the AI-generated text becomes the email body
  // (wrapped with greeting + sign-off later by buildDirectEmailHtml). For
  // both portal paths, the same text lands in a plain-text portal field.
  const isDirectEmail = errorType?.useDirectEmail === true;

  const ridesBlock = rides.map((r, i) => `  ${i + 1}. Conf #${r.confNumber} | Service date: ${r.date || "N/A"} | Client: ${r.clientNumber || "N/A"} | Car: ${r.carNumber || "N/A"} | Amount: $${r.claimAmount || "0.00"}`).join("\n");

  const groupHeader = group
    ? `This dispute is filed at the invoice level and covers ${rides.length} ride${rides.length === 1 ? "" : "s"} on a single invoice.

Invoice details:
- Invoice number: ${group.invoiceNumber}
- Client number: ${group.clientNumber || "N/A"}
- Total invoice amount: $${snap.claimAmount || "0.00"}
- Error type: ${group.errorTypeName || "N/A"}
- Group-level error details: ${group.errorDetails || "N/A"}

Affected rides on this invoice:
${ridesBlock}`
    : `Claim details:
- Confirmation number: ${rides[0].confNumber}
- Service date: ${rides[0].date || "N/A"}
- Reference number: ${rides[0].refNumber || "N/A"}
- Client number: ${rides[0].clientNumber || "N/A"}
- Car/vehicle number: ${rides[0].carNumber || "N/A"}
- Claim amount: $${rides[0].claimAmount || "0.00"}
- Error type: ${rides[0].errorTypeName || "N/A"}
- Error details: ${rides[0].errorDetails || "N/A"}`;

  const evidenceSummary = group?.evidenceNotes || rides.map(r => r.evidenceNotes).filter(Boolean).join("; ");

  const formatRules = isDirectEmail
    ? `Write a clear, factual dispute message that:
- States the reason for the dispute/correction request
- ${group ? `References the invoice number (${group.invoiceNumber}) and lists the affected confirmation numbers` : "References the confirmation number"}
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

  const prompt = `${channelLine}

${groupHeader}

Reason for dispute (from workflow decision): ${disputeReason}

${evidenceSummary ? `Evidence gathered: ${evidenceSummary}` : ""}
${errorType?.guidance ? `SOP context: ${errorType.guidance}` : ""}

${instructions ? `IMPORTANT — Follow these guidelines for tone and content:\n${instructions}` : ""}

${formatRules}

Return ONLY the note text, no JSON wrapping.`;

  const systemPrompt = isDirectEmail
    ? "You are a professional NEMT claims dispute specialist. Write the body of a dispute email on behalf of a transportation provider — without the greeting or sign-off (those are added automatically). Each message should sound natural — vary sentence structure and word choice so no two messages are identical. Avoid boilerplate or robotic language. Return only the body text."
    : "You are a professional NEMT claims dispute specialist. Write clear, factual portal submission notes on behalf of a transportation provider. Each note should sound natural — vary sentence structure and word choice so no two notes are identical. Avoid boilerplate or robotic language. Return only the note text.";

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
  ctx: GroupContext | { group: null; primaryClaim: typeof claimsTable.$inferSelect; rides: (typeof claimsTable.$inferSelect)[] },
  disputeReason: string,
): string {
  const { group, rides } = ctx;
  const snap = buildSnapshot(ctx);
  if (group) {
    const ridesBlock = rides.map((r, i) => `${i + 1}. Conf #${r.confNumber} — ${r.date || "N/A"} — $${r.claimAmount || "0.00"}`).join("\n");
    return `Dispute for Invoice Number: ${group.invoiceNumber}
Client Number: ${group.clientNumber || "N/A"}
Total Amount: $${snap.claimAmount || "0.00"}
Error Type: ${group.errorTypeName || "N/A"}
Error Details: ${group.errorDetails || "N/A"}

Affected rides (${rides.length}):
${ridesBlock}

Dispute Reason: ${disputeReason || "N/A"}

Evidence Notes: ${group.evidenceNotes || "N/A"}`;
  }
  const r = rides[0];
  return `Dispute for Confirmation Number: ${r.confNumber || "N/A"}
Service Date: ${r.date || "N/A"}
Reference Number: ${r.refNumber || "N/A"}
Client Number: ${r.clientNumber || "N/A"}
Car Number: ${r.carNumber || "N/A"}
Claim Amount: $${r.claimAmount || "0.00"}
Error Type: ${r.errorTypeName || "N/A"}
Error Details: ${r.errorDetails || "N/A"}

Dispute Reason: ${disputeReason || "N/A"}

Evidence Notes: ${r.evidenceNotes || "N/A"}`;
}

async function loadErrorTypeForContext(ctx: { group: typeof invoiceGroupsTable.$inferSelect | null; primaryClaim: typeof claimsTable.$inferSelect }): Promise<typeof errorTypesTable.$inferSelect | null> {
  const errorTypeId = ctx.group?.errorTypeId || ctx.primaryClaim.errorTypeId;
  if (!errorTypeId) return null;
  const id = parseInt(errorTypeId, 10);
  if (isNaN(id)) return null;
  const [et] = await db.select().from(errorTypesTable).where(eq(errorTypesTable.id, id));
  return et || null;
}

async function transitionContext(opts: {
  ctx: { group: typeof invoiceGroupsTable.$inferSelect | null; primaryClaim: typeof claimsTable.$inferSelect };
  newStatus: "Portal Queued" | "Awaiting Response" | "Needs Evidence";
  source: string;
  reason: string;
  actor: { userEmail: string | null; userName: string | null };
}): Promise<void> {
  const { ctx, newStatus, source, reason, actor } = opts;
  if (ctx.group) {
    await transitionGroupStatus({
      groupId: ctx.group.id,
      newStatus,
      source,
      reason,
      actor,
      systemOverride: true,
    });
  } else {
    await transitionClaimStatus({
      claimId: ctx.primaryClaim.id,
      newStatus,
      source,
      reason,
      actor,
      systemOverride: true,
    });
  }
}

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

async function resolveContext(body: { invoiceGroupId?: number; claimId?: number }): Promise<GroupContext | { group: null; primaryClaim: typeof claimsTable.$inferSelect; rides: (typeof claimsTable.$inferSelect)[] } | null> {
  if (body.invoiceGroupId) {
    return loadGroupContextByGroupId(body.invoiceGroupId);
  }
  if (body.claimId) {
    return loadGroupContextByClaimId(body.claimId);
  }
  return null;
}

async function loadContextForSubmission(sub: typeof portalSubmissionsTable.$inferSelect) {
  if (sub.invoiceGroupId) {
    const ctx = await loadGroupContextByGroupId(sub.invoiceGroupId);
    if (ctx) return ctx;
  }
  return loadGroupContextByClaimId(sub.claimId);
}

router.get("/portal-submissions", asyncHandler(async (req, res): Promise<void> => {
  const { status } = req.query;
  const statusStr = typeof status === "string" ? status : undefined;

  const submissions = await db.select().from(portalSubmissionsTable)
    .where(statusStr ? eq(portalSubmissionsTable.status, statusStr as (typeof portalSubmissionsTable.status.enumValues)[number]) : undefined)
    .orderBy(desc(portalSubmissionsTable.createdAt));

  res.json(submissions);
}));

router.post("/portal-submissions/generate-preview", asyncHandler(async (req, res): Promise<void> => {
  const { invoiceGroupId, claimId, disputeReason } = req.body;
  if (!invoiceGroupId && !claimId) {
    res.status(400).json({ error: "invoiceGroupId or claimId is required" });
    return;
  }

  const rawCtx = await resolveContext({ invoiceGroupId, claimId });
  if (!rawCtx) { res.status(404).json({ error: "Invoice group or claim not found" }); return; }

  const groupIdForCancel = rawCtx.group?.id ?? null;
  const totalLegs = rawCtx.rides.length;

  // Filter held legs and already-submitted legs out of the snapshot so the
  // submission only covers the legs the user actually wants to file right now.
  const filtered = await filterRidesForSubmission(rawCtx.rides, groupIdForCancel);
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
  const ctx: GroupContext | { group: null; primaryClaim: typeof claimsTable.$inferSelect; rides: (typeof claimsTable.$inferSelect)[] } =
    rawCtx.group
      ? { group: rawCtx.group, rides: filtered.rides, primaryClaim: filtered.rides[0] }
      : { group: null, rides: filtered.rides, primaryClaim: filtered.rides[0] };
  const isPartialSubmission = filtered.rides.length < totalLegs;

  const existingDrafts = await db.select().from(portalSubmissionsTable)
    .where(and(
      groupIdForCancel
        ? eq(portalSubmissionsTable.invoiceGroupId, groupIdForCancel)
        : eq(portalSubmissionsTable.claimId, ctx.primaryClaim.id),
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

  let generatedDescription = "";
  try {
    generatedDescription = await generatePortalDescription(ctx, errorType, reason, settings);
  } catch (err) {
    logger.warn({ err }, "AI portal description generation failed, using fallback");
    generatedDescription = buildFallbackDescription(ctx, reason);
  }

  const attachmentUrls = await collectGroupEvidenceUrls(ctx);
  const gpsBreadcrumbs = resolveGpsBreadcrumbs(issueType, settings.defaultGpsBreadcrumbs);

  logger.info({ groupId: ctx.group?.id, claimId: ctx.primaryClaim.id, attachmentCount: attachmentUrls.length, gpsBreadcrumbs, issueType, rideCount: ctx.rides.length }, "Portal draft: evidence and GPS resolved");

  const [submission] = await db.insert(portalSubmissionsTable).values({
    claimId: ctx.primaryClaim.id,
    invoiceGroupId: ctx.group?.id ?? null,
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
    evidenceNotes: snap.evidenceNotes,
    evidenceFiles: snap.evidenceFiles as never,
    workflowHistory: snap.workflowHistory as never,
    attempts: 0,
  }).returning();

  const partialSuffix = isPartialSubmission
    ? ` — partial: ${ctx.rides.length} of ${totalLegs} legs (${filtered.excludedHeld.length} on hold, ${filtered.excludedAlreadySubmitted.length} already submitted)`
    : "";
  await db.insert(auditLogsTable).values({
    claimId: ctx.primaryClaim.id,
    invoiceGroupId: ctx.group?.id ?? null,
    action: "portal_draft_created",
    details: `Portal submission draft generated for review (${attachmentUrls.length} evidence files, ${ctx.rides.length} ride${ctx.rides.length === 1 ? "" : "s"})${partialSuffix}`,
    metadata: isPartialSubmission ? {
      includedLegs: ctx.rides.map(r => r.confNumber || r.id),
      excludedHeld: filtered.excludedHeld.map(r => r.confNumber || r.id),
      excludedAlreadySubmitted: filtered.excludedAlreadySubmitted.map(r => r.confNumber || r.id),
    } : undefined,
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

  if (req.body.descriptionHtml !== undefined) {
    const newDescription = req.body.descriptionHtml;
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

  if (updates.descriptionHtml !== undefined) {
    await db.insert(auditLogsTable).values({
      claimId: existing.claimId,
      invoiceGroupId: existing.invoiceGroupId,
      action: "portal_draft_edited",
      details: `Portal submission #${id} description manually edited`,
      metadata: { submissionId: id },
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

  let generatedDescription = "";
  try {
    generatedDescription = await generatePortalDescription(ctx, errorType, existing.disputeReason || "", settings);
  } catch (err) {
    logger.warn({ err }, "AI portal description regeneration failed, using fallback");
    generatedDescription = buildFallbackDescription(ctx, existing.disputeReason || "");
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
    claimId: existing.claimId,
    invoiceGroupId: existing.invoiceGroupId,
    action: "portal_draft_regenerated",
    details: `Portal submission #${id} description regenerated`,
    metadata: { submissionId: id },
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
    claimId: existing.claimId,
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
    claimId: existing.claimId,
    invoiceGroupId: existing.invoiceGroupId ?? null,
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
  const { invoiceGroupId, claimId, issueType, subject, requesterEmail, transportationProviderName,
    phoneNumber, invoiceNumber, gpsBreadcrumbsAvailable, descriptionHtml, disputeReason } = req.body;

  if (!invoiceGroupId && !claimId) {
    res.status(400).json({ error: "invoiceGroupId or claimId is required" });
    return;
  }

  const ctx = await resolveContext({ invoiceGroupId, claimId });
  if (!ctx) { res.status(404).json({ error: "Invoice group or claim not found" }); return; }

  const settings = await getPortalSettings();
  const errorType = await loadErrorTypeForContext(ctx);
  const reason = disputeReason || "";
  const snap = buildSnapshot(ctx);

  let generatedDescription = descriptionHtml || "";
  if (!generatedDescription && reason) {
    try {
      generatedDescription = await generatePortalDescription(ctx, errorType, reason, settings);
    } catch (err) {
      logger.warn({ err }, "AI portal description generation failed, using fallback");
      generatedDescription = buildFallbackDescription(ctx, reason);
    }
  }
  if (!generatedDescription) {
    generatedDescription = buildFallbackDescription(ctx, reason);
  }

  const resolvedIssueType = issueType || determineIssueType(errorType);
  const attachmentUrls = await collectGroupEvidenceUrls(ctx);
  const gpsBreadcrumbs = gpsBreadcrumbsAvailable || resolveGpsBreadcrumbs(resolvedIssueType, settings.defaultGpsBreadcrumbs);

  const [submission] = await db.insert(portalSubmissionsTable).values({
    claimId: ctx.primaryClaim.id,
    invoiceGroupId: ctx.group?.id ?? null,
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
    evidenceNotes: snap.evidenceNotes,
    evidenceFiles: snap.evidenceFiles as never,
    workflowHistory: snap.workflowHistory as never,
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
    const otherActiveWhere = existing.invoiceGroupId
      ? and(
          eq(portalSubmissionsTable.invoiceGroupId, existing.invoiceGroupId),
          inArray(portalSubmissionsTable.status, ["pending", "in_progress"]),
        )
      : and(
          eq(portalSubmissionsTable.claimId, existing.claimId),
          inArray(portalSubmissionsTable.status, ["pending", "in_progress"]),
        );
    const otherActive = await db.select().from(portalSubmissionsTable).where(otherActiveWhere);
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
      claimId: existing.claimId,
      invoiceGroupId: existing.invoiceGroupId ?? null,
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
