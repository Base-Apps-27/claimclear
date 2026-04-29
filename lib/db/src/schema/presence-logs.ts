import { pgTable, text, serial, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const presenceLogsTable = pgTable("presence_logs", {
  id: serial("id").primaryKey(),
  resourceType: text("resource_type").notNull(),
  resourceId: integer("resource_id").notNull(),
  userEmail: text("user_email").notNull(),
  userName: text("user_name"),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("presence_logs_resource_user").on(table.resourceType, table.resourceId, table.userEmail),
  index("presence_logs_resource_idx").on(table.resourceType, table.resourceId),
]);

export const insertPresenceLogSchema = createInsertSchema(presenceLogsTable).omit({ id: true });
export type InsertPresenceLog = z.infer<typeof insertPresenceLogSchema>;
export type PresenceLog = typeof presenceLogsTable.$inferSelect;
