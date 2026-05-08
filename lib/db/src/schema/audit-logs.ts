import { pgTable, text, serial, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
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
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_logs_claim_id_idx").on(table.claimId),
  // Composite index powering the per-user activity aggregates that
  // back the streak pip's "today" count and the avatar hover-card
  // heatmap (Task #522). Both queries pin `user_email` and bound
  // `timestamp` to a window, so this column order matches their
  // access pattern.
  index("audit_logs_user_email_timestamp_idx").on(table.userEmail, table.timestamp),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({ id: true, timestamp: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
