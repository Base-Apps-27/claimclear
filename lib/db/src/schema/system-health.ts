import { pgTable, text, serial, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const cronRunsTable = pgTable("cron_runs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"),
  message: text("message"),
  metadata: jsonb("metadata"),
}, (table) => [
  index("cron_runs_job_name_started_idx").on(table.jobName, table.startedAt),
  index("cron_runs_started_idx").on(table.startedAt),
]);

export type CronRun = typeof cronRunsTable.$inferSelect;

export const emailBouncesTable = pgTable("email_bounces", {
  id: serial("id").primaryKey(),
  recipientEmail: text("recipient_email"),
  originalMessageId: text("original_message_id"),
  conversationId: text("conversation_id"),
  subject: text("subject"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  rawExcerpt: text("raw_excerpt"),
  matchedOutboundId: text("matched_outbound_id"),
  matchedClaimId: text("matched_claim_id"),
  matchedInvoiceGroupId: text("matched_invoice_group_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("email_bounces_received_idx").on(table.receivedAt),
  index("email_bounces_recipient_idx").on(table.recipientEmail),
]);

export type EmailBounce = typeof emailBouncesTable.$inferSelect;

export const connectorHealthTable = pgTable("connector_health", {
  connectorName: text("connector_name").primaryKey(),
  status: text("status").notNull(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  metadata: jsonb("metadata"),
});

export type ConnectorHealth = typeof connectorHealthTable.$inferSelect;
