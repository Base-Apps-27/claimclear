import { pgTable, text, serial, integer, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botStatusEnum = pgEnum("bot_status", ["running", "idle", "error", "stopped"]);

export const botInstancesTable = pgTable("bot_instances", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: botStatusEnum().notNull().default("running"),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }).notNull().defaultNow(),
  lastPollAt: timestamp("last_poll_at", { withTimezone: true }),
  submissionsToday: integer("submissions_today").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
  sessionValid: boolean("session_valid").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBotInstanceSchema = createInsertSchema(botInstancesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBotInstance = z.infer<typeof insertBotInstanceSchema>;
export type BotInstance = typeof botInstancesTable.$inferSelect;
