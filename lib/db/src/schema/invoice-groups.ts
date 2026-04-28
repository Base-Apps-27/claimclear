import { pgTable, text, serial, integer, timestamp, numeric, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimStatusEnum, claimOutcomeEnum } from "./claims";

export const invoiceGroupsTable = pgTable("invoice_groups", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull(),
  clientNumber: text("client_number"),
  errorDetails: text("error_details"),
  errorTypeId: text("error_type_id"),
  errorTypeName: text("error_type_name"),
  status: claimStatusEnum().notNull().default("New"),
  outcome: claimOutcomeEnum().notNull().default("Pending"),
  approvedAmount: numeric("approved_amount", { precision: 12, scale: 2 }),
  rideCount: integer("ride_count").notNull().default(0),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }),
  workflowProgress: jsonb("workflow_progress"),
  holdReason: text("hold_reason"),
  holdPendingFrom: text("hold_pending_from"),
  holdPlacedAt: text("hold_placed_at"),
  triageNotes: text("triage_notes"),
  triagedAt: text("triaged_at"),
  closureReason: text("closure_reason"),
  disputeEmailSent: boolean("dispute_email_sent").notNull().default(false),
  disputeEmailSentAt: text("dispute_email_sent_at"),
  generatedEmailSubject: text("generated_email_subject"),
  generatedEmailBody: text("generated_email_body"),
  generatedEmailAt: text("generated_email_at"),
  evidenceFiles: jsonb("evidence_files"),
  evidenceNotes: text("evidence_notes"),
  evidenceChecklist: jsonb("evidence_checklist"),
  payorEmail: text("payor_email"),
  importBatch: text("import_batch"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("invoice_groups_invoice_number_idx").on(table.invoiceNumber),
  index("invoice_groups_status_idx").on(table.status),
  index("invoice_groups_outcome_idx").on(table.outcome),
  index("invoice_groups_created_at_idx").on(table.createdAt),
]);

export const insertInvoiceGroupSchema = createInsertSchema(invoiceGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoiceGroup = z.infer<typeof insertInvoiceGroupSchema>;
export type InvoiceGroup = typeof invoiceGroupsTable.$inferSelect;
