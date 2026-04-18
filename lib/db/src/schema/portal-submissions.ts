import { pgTable, text, serial, integer, timestamp, numeric, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimsTable } from "./claims";
import { invoiceGroupsTable } from "./invoice-groups";

export const portalSubmissionStatusEnum = pgEnum("portal_submission_status", [
  "draft", "pending", "in_progress", "submitted", "failed", "cancelled", "dry_run"
]);

export const portalSubmissionsTable = pgTable("portal_submissions", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claimsTable.id, { onDelete: "cascade" }),
  invoiceGroupId: integer("invoice_group_id").references(() => invoiceGroupsTable.id, { onDelete: "set null" }),
  status: portalSubmissionStatusEnum().notNull().default("pending"),
  issueType: text("issue_type"),
  subject: text("subject"),
  requesterEmail: text("requester_email"),
  transportationProviderName: text("transportation_provider_name"),
  phoneNumber: text("phone_number"),
  invoiceNumber: text("invoice_number"),
  gpsBreadcrumbsAvailable: text("gps_breadcrumbs_available"),
  descriptionHtml: text("description_html"),
  descriptionHistory: jsonb("description_history").$type<Array<{ description: string; generatedAt: string }>>().default([]),
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
  evidenceNotes: text("evidence_notes"),
  evidenceFiles: jsonb("evidence_files"),
  workflowHistory: jsonb("workflow_history"),
  portalTicketId: text("portal_ticket_id"),
  screenshotUrl: text("screenshot_url"),
  errorMessage: text("error_message"),
  submittedAt: text("submitted_at"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("portal_submissions_claim_id_idx").on(table.claimId),
  index("portal_submissions_status_idx").on(table.status),
]);

export const insertPortalSubmissionSchema = createInsertSchema(portalSubmissionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPortalSubmission = z.infer<typeof insertPortalSubmissionSchema>;
export type PortalSubmission = typeof portalSubmissionsTable.$inferSelect;
