import { pgTable, text, serial, integer, timestamp, numeric, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoiceGroupsTable } from "./invoice-groups";

export const portalSubmissionStatusEnum = pgEnum("portal_submission_status", [
  "draft", "pending", "in_progress", "submitted", "failed", "cancelled", "dry_run"
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
  attachmentUrls: jsonb("attachment_urls"),
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
  evidenceFiles: jsonb("evidence_files"),
  workflowHistory: jsonb("workflow_history"),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("portal_submissions_invoice_group_id_idx").on(table.invoiceGroupId),
  index("portal_submissions_status_idx").on(table.status),
]);

export const insertPortalSubmissionSchema = createInsertSchema(portalSubmissionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPortalSubmission = z.infer<typeof insertPortalSubmissionSchema>;
export type PortalSubmission = typeof portalSubmissionsTable.$inferSelect;
