import { pgTable, serial, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

// Task #881 — one row per successful OIDC callback so admins can audit
// "who signed in, when, from where" beyond the single `users.last_login_at`
// surfaced by the admin user list (task #849). Indexed on user_id so the
// per-user history page can pull the last N rows cheaply.
export const userLoginsTable = pgTable(
  "user_logins",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    loggedInAt: timestamp("logged_in_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: varchar("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("user_logins_user_id_logged_in_at_idx").on(table.userId, table.loggedInAt),
  ],
);

export type UserLogin = typeof userLoginsTable.$inferSelect;
export type InsertUserLogin = typeof userLoginsTable.$inferInsert;
