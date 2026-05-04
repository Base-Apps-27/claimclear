import { pgTable, text, serial, integer, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimsTable } from "./claims";
import { invoiceGroupsTable } from "./invoice-groups";
import { portalSubmissionsTable } from "./portal-submissions";

export const outboundEmailKindEnum = pgEnum("outbound_email_kind", [
  "dispute", "follow_up", "manual", "daily_brief"
]);

export const outboundEmailsTable = pgTable("outbound_emails", {
  id: serial("id").primaryKey(),
  messageId: text("message_id"),
  conversationId: text("conversation_id"),
  claimId: integer("claim_id").references(() => claimsTable.id, { onDelete: "set null" }),
  invoiceGroupId: integer("invoice_group_id").references(() => invoiceGroupsTable.id, { onDelete: "set null" }),
  submissionId: integer("submission_id").references(() => portalSubmissionsTable.id, { onDelete: "set null" }),
  kind: outboundEmailKindEnum().notNull(),
  subject: text("subject"),
  recipients: jsonb("recipients"),
  bodyPreview: text("body_preview"),
  // Names of the files attached to this outbound message, in send order.
  // jsonb of `string[]` so the thread bubble can render "Attached: foo.pdf,
  // bar.png" without a join. Null when no attachments were sent.
  attachmentNames: jsonb("attachment_names").$type<string[] | null>(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  sentByUserEmail: text("sent_by_user_email"),
  sentByUserName: text("sent_by_user_name"),
  // Task #398: short excerpt of the send error when the Outlook/SMTP
  // attempt threw. Null when the send succeeded. Lets the daily-brief
  // route persist one row per attempted recipient (success or failure)
  // so the System Health "Last daily brief" panel can show what
  // happened per recipient without re-running the cron.
  errorExcerpt: text("error_excerpt"),
  // Task #398: jsonb bag for kind-specific context. Daily-brief rows
  // store `{ roleVariant: "admin"|"operator", briefRunId }` so the
  // health detail panel can render the per-role outcome and tie rows
  // back to a specific cron_runs row.
  metadata: jsonb("metadata"),
}, (table) => [
  index("outbound_emails_claim_id_idx").on(table.claimId),
  index("outbound_emails_invoice_group_id_idx").on(table.invoiceGroupId),
  index("outbound_emails_conversation_id_idx").on(table.conversationId),
]);

export const insertOutboundEmailSchema = createInsertSchema(outboundEmailsTable).omit({ id: true, sentAt: true });
export type InsertOutboundEmail = z.infer<typeof insertOutboundEmailSchema>;
export type OutboundEmail = typeof outboundEmailsTable.$inferSelect;
