import { pgTable, text, serial, integer, timestamp, numeric, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoiceGroupsTable } from "./invoice-groups";

export const portalSubmissionStatusEnum = pgEnum("portal_submission_status", [
  "draft", "pending", "in_progress", "submitted", "failed", "cancelled", "dry_run"
]);

// Task #738. Per-submission outcome of the most recent
// `portal_response_sync` scrape attempt. Surfaces alongside
// `lastScrapedAt`/`lastScrapeError` on the Portal Submissions row so the
// drawer + the System Health drill-down can render scrape state
// without re-joining to `cron_runs.metadata.perSubmission[]`.
//   new_reply — at least one fresh portal message was posted to
//               `portal_responses` for this submission on the run
//   no_change — reader succeeded; nothing new since last scrape
//   error     — reader / poster threw, or the gate was busy
export const portalScrapeOutcomeEnum = pgEnum("portal_scrape_outcome", [
  "new_reply", "no_change", "error",
]);

export const portalSubmissionsTable = pgTable("portal_submissions", {
  id: serial("id").primaryKey(),
  invoiceGroupId: integer("invoice_group_id").notNull().references(() => invoiceGroupsTable.id, { onDelete: "cascade" }),
  status: portalSubmissionStatusEnum().notNull().default("pending"),
  issueType: text("issue_type"),
  subject: text("subject"),
  requesterEmail: text("requester_email"),
  transportationProviderName: text("transportation_provider_name"),
  phoneNumber: text("phone_number"),
  invoiceNumber: text("invoice_number"),
  gpsBreadcrumbsAvailable: text("gps_breadcrumbs_available"),
  descriptionHtml: text("description_html"),
  descriptionEditorEmail: text("description_editor_email"),
  descriptionEditorName: text("description_editor_name"),
  descriptionHistory: jsonb("description_history").$type<Array<{ description: string; generatedAt: string; editorEmail?: string | null; editorName?: string | null }>>().default([]),
  // Flat URL list snapshotted from `collectGroupEvidenceUrls(...)` at draft
  // time and consumed by both the bot worker (`batch-worker.ts`) and the
  // direct-email dispatcher (`direct-email-dispatch.ts`). Always a string
  // array on rows produced after Task #389; legacy rows may be null.
  attachmentUrls: jsonb("attachment_urls").$type<string[]>(),
  // Per-leg breakdown for this group submission (Task #485). One entry per
  // disputed leg in input order: `{ legId, confNumber, ticked, error? }`.
  // Populated at draft creation with `ticked: false` for every leg, then
  // overwritten by the producer after the bot worker run using the worker's
  // `perLeg[]` return. The list page now renders one row per group and the
  // drawer reads this column directly to show the per-leg outcome breakdown.
  // Legacy per-leg rows created before Task #485 keep `legs = []`; the
  // drawer falls back to a degraded "details unavailable" notice for those.
  legs: jsonb("legs").$type<Array<{ legId: number; confNumber: string | null; ticked: boolean; error?: string | null }>>().notNull().default([]),
  confNumber: text("conf_number"),
  serviceDate: text("service_date"),
  refNumber: text("ref_number"),
  clientNumber: text("client_number"),
  carNumber: text("car_number"),
  claimAmount: numeric("claim_amount", { precision: 12, scale: 2 }),
  errorTypeName: text("error_type_name"),
  errorDetails: text("error_details"),
  disputeReason: text("dispute_reason"),
  // Operator-supplied "special circumstances" text that reshapes the AI dispute
  // narrative — e.g. "MAS pushed an address update after the ride completed".
  // Persisted with the draft so regenerate keeps the same context, and so the
  // review card can show + edit it. Free-form, may be null/empty.
  specialCircumstances: text("special_circumstances"),
  // The 2–4 sentence "read it back to me" restatement the AI produced, which
  // the operator confirmed before we generated the full write-up. Cleared
  // whenever specialCircumstances changes so the gate forces a fresh re-check.
  understandingReadback: text("understanding_readback"),
  understandingReadbackAt: timestamp("understanding_readback_at", { withTimezone: true }),
  evidenceNotes: text("evidence_notes"),
  // Per-submission attachment list snapshotted from `invoice_groups.evidenceFiles`
  // at draft time. Schema mirrors `EvidenceFileRef` in `lib/api-spec/openapi.yaml`.
  evidenceFiles: jsonb("evidence_files").$type<Array<{ url: string; name?: string | null; size?: number | null }>>(),
  portalTicketId: text("portal_ticket_id"),
  screenshotUrl: text("screenshot_url"),
  errorMessage: text("error_message"),
  submittedAt: text("submitted_at"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(4),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  // Set when a batch run claims this row so other users can see it is "Queued"
  // for the active run (still status='pending' until the worker picks it up).
  // Cleared when the row leaves the queue (in_progress, submitted, failed,
  // cancelled) or when the run releases it on completion/abort.
  claimedByBatchId: text("claimed_by_batch_id"),
  claimedByUserName: text("claimed_by_user_name"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  // Persisted reference to the batch run that brought this row to status
  // 'submitted'. Unlike `claimedByBatchId` (which is cleared the moment a
  // row leaves the pending queue), this column is set once on the
  // pending → submitted transition and never overwritten, so the Portal
  // Submissions list can render "Already submitted in run #N" pills on
  // sibling rows whose invoice group has an in-the-clear submission
  // elsewhere. Joined against `portal_batch_runs.batch_id` to resolve the
  // numeric run id used in the user-facing label.
  submittedInBatchId: text("submitted_in_batch_id"),
  // Task #738. Stamped by `syncPortalResponsesForSubmission` for every
  // ticket that was actually considered on a `portal_response_sync`
  // run (skipped synthetic / no-ticket rows are NOT written so the
  // column is honest about what was checked). The drawer + the
  // sortable "Last checked" column on Portal Submissions read these
  // three fields directly.
  lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
  lastScrapeOutcome: portalScrapeOutcomeEnum("last_scrape_outcome"),
  lastScrapeError: text("last_scrape_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("portal_submissions_invoice_group_id_idx").on(table.invoiceGroupId),
  index("portal_submissions_status_idx").on(table.status),
  index("portal_submissions_last_scraped_at_idx").on(table.lastScrapedAt),
]);

export const insertPortalSubmissionSchema = createInsertSchema(portalSubmissionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPortalSubmission = z.infer<typeof insertPortalSubmissionSchema>;
export type PortalSubmission = typeof portalSubmissionsTable.$inferSelect;
