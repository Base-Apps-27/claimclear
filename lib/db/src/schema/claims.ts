import { pgTable, text, serial, integer, timestamp, numeric, boolean, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoiceGroupsTable } from "./invoice-groups";

export const claimStatusEnum = pgEnum("claim_status", [
  "New", "Needs Review", "Needs Evidence", "Portal Queued", "Generating Email",
  "Ready to Review", "Awaiting Response", "On Hold", "Resolved", "Denied"
]);

export const claimOutcomeEnum = pgEnum("claim_outcome", [
  "Pending", "Approved", "Denied", "Partially Approved", "Non-Issue"
]);

export const claimsTable = pgTable("claims", {
  id: serial("id").primaryKey(),
  invoiceGroupId: integer("invoice_group_id").references(() => invoiceGroupsTable.id, { onDelete: "cascade" }),
  confNumber: text("conf_number").notNull(),
  date: text("date"),
  refNumber: text("ref_number"),
  clientNumber: text("client_number"),
  carNumber: text("car_number"),
  errorDetails: text("error_details"),
  errorTypeId: text("error_type_id"),
  errorTypeName: text("error_type_name"),
  claimAmount: numeric("claim_amount", { precision: 12, scale: 2 }),
  status: claimStatusEnum().notNull().default("New"),
  outcome: claimOutcomeEnum().notNull().default("Pending"),
  approvedAmount: numeric("approved_amount", { precision: 12, scale: 2 }),
  invoiceNumbers: text("invoice_numbers"),
  payorEmail: text("payor_email"),
  disputeEmailSent: boolean("dispute_email_sent").notNull().default(false),
  disputeEmailSentAt: text("dispute_email_sent_at"),
  importBatch: text("import_batch"),
  evidenceFiles: jsonb("evidence_files"),
  evidenceNotes: text("evidence_notes"),
  evidenceChecklist: jsonb("evidence_checklist"),
  generatedEmailSubject: text("generated_email_subject"),
  generatedEmailBody: text("generated_email_body"),
  generatedEmailAt: text("generated_email_at"),
  workflowProgress: jsonb("workflow_progress"),
  holdReason: text("hold_reason"),
  holdPendingFrom: text("hold_pending_from"),
  holdPlacedAt: text("hold_placed_at"),
  triageNotes: text("triage_notes"),
  triagedAt: text("triaged_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("claims_conf_number_idx").on(table.confNumber),
  index("claims_invoice_group_id_idx").on(table.invoiceGroupId),
  index("claims_status_idx").on(table.status),
  index("claims_date_idx").on(table.date),
  index("claims_created_at_idx").on(table.createdAt),
]);

export const insertClaimSchema = createInsertSchema(claimsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Claim = typeof claimsTable.$inferSelect;
