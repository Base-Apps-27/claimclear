import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";

export const portalBatchRunsTable = pgTable("portal_batch_runs", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull().unique(),
  status: text("status").notNull(),
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  succeeded: integer("succeeded").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  triggeredBy: text("triggered_by").notNull(),
  triggeredByEmail: text("triggered_by_email"),
  stoppedBy: text("stopped_by"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("portal_batch_runs_started_at_idx").on(table.startedAt),
  index("portal_batch_runs_triggered_by_email_idx").on(table.triggeredByEmail),
]);

export type PortalBatchRun = typeof portalBatchRunsTable.$inferSelect;
export type InsertPortalBatchRun = typeof portalBatchRunsTable.$inferInsert;
