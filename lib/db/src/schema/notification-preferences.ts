import { pgTable, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const notificationPreferencesTable = pgTable("notification_preferences", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  dailyBrief: boolean("daily_brief").notNull().default(true),
  weeklyDigest: boolean("weekly_digest").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type NotificationPreference = typeof notificationPreferencesTable.$inferSelect;
export type InsertNotificationPreference = typeof notificationPreferencesTable.$inferInsert;
