import { pgTable, text, serial, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { portalSubmissionsTable } from "./portal-submissions";
import { botInstancesTable } from "./bot-instances";

export const botActivityLogTable = pgTable("bot_activity_log", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id").notNull().references(() => portalSubmissionsTable.id, { onDelete: "cascade" }),
  botInstanceId: integer("bot_instance_id").references(() => botInstancesTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  success: boolean("success").notNull().default(true),
  message: text("message"),
  screenshotPath: text("screenshot_path"),
  pageHtmlPath: text("page_html_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("bot_activity_log_submission_id_idx").on(table.submissionId),
]);

export const insertBotActivityLogSchema = createInsertSchema(botActivityLogTable).omit({ id: true, createdAt: true });
export type InsertBotActivityLog = z.infer<typeof insertBotActivityLogSchema>;
export type BotActivityLog = typeof botActivityLogTable.$inferSelect;
