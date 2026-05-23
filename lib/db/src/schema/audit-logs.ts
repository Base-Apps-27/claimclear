import { pgTable, text, serial, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimsTable } from "./claims";
import { invoiceGroupsTable } from "./invoice-groups";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").references(() => claimsTable.id, { onDelete: "set null" }),
  invoiceGroupId: integer("invoice_group_id").references(() => invoiceGroupsTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  details: text("details").notNull(),
  metadata: jsonb("metadata"),
  userEmail: text("user_email"),
  userName: text("user_name"),
  // Task #842. Idempotency key supplied by bot-originated mutation calls.
  // Mirrors `portal_responses.idempotency_key`: derived from
  // `(entityId, action, day-bucket)`, persisted on insert, and protected
  // by a partial unique index so a retried bot mutation can't produce two
  // audit rows for the same logical action. Operator-initiated mutations
  // leave this null.
  idempotencyKey: text("idempotency_key"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_logs_claim_id_idx").on(table.claimId),
  // Composite index powering the per-user activity aggregates that
  // back the streak pip's "today" count and the avatar hover-card
  // heatmap (Task #522). Both queries pin `user_email` and bound
  // `timestamp` to a window, so this column order matches their
  // access pattern.
  index("audit_logs_user_email_timestamp_idx").on(table.userEmail, table.timestamp),
  // Task #842. Structural duplicate guarantee for bot-originated mutations.
  // Partial because operator rows leave the key null.
  uniqueIndex("audit_logs_idempotency_key_uidx")
    .on(table.idempotencyKey)
    .where(sql`idempotency_key IS NOT NULL`),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, timestamp: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
