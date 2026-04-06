import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimsTable } from "./claims";

export const presenceLogsTable = pgTable("presence_logs", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claimsTable.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  userName: text("user_name"),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("presence_logs_claim_user").on(table.claimId, table.userEmail),
]);

export const insertPresenceLogSchema = createInsertSchema(presenceLogsTable).omit({ id: true });
export type InsertPresenceLog = z.infer<typeof insertPresenceLogSchema>;
export type PresenceLog = typeof presenceLogsTable.$inferSelect;
