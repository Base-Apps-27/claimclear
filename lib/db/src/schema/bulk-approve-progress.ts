import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

// Task #755 — durable progress tracker for in-flight bulk-approve runs.
// Replaces the per-process `Map` that the GET
// `/invoice-groups/bulk-approve/:bulkApproveRunId/progress` poll used to
// read from. Persisting the row means a page reload, an API restart,
// or a poll that lands on a different instance behind a load balancer
// all reattach to the same run instead of seeing a 404 and dropping
// the progress bar.
//
// `bulkApproveRunId` is the request-scoped UUID the POST handler also
// stamps onto every audit row, so the natural key doubles as a join
// key into audit_logs if anything wants to correlate.
//
// TTL: rows linger for a short window after `completed_at` so a slow
// final poll still gets terminal counts, then the POST handler deletes
// them on the next pass.
export const bulkApproveProgressTable = pgTable("bulk_approve_progress", {
  bulkApproveRunId: text("bulk_approve_run_id").primaryKey(),
  total: integer("total").notNull().default(0),
  processed: integer("processed").notNull().default(0),
  approved: integer("approved").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("bulk_approve_progress_completed_at_idx").on(table.completedAt),
]);

export type BulkApproveProgressRow = typeof bulkApproveProgressTable.$inferSelect;
