import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role").notNull().default("user"),
  status: varchar("status").notNull().default("pending"),
  // Task #889 — jsonb array of responsible-role identifiers
  // (contact_center_manager / contractor_relations_coordinator /
  // it_coordinator_or_coo). Scopes the /my-closures portal. Independent
  // of `role` so a COO can hold both operator access AND a responsible
  // role. Vocabulary lives in `@workspace/closure-responsibility`.
  responsibleRoles: jsonb("responsible_roles").$type<string[]>().notNull().default([]),
  // Task #889 round-3 — explicit "portal-only" marker, set by admins
  // at role-assignment time. When true, AppLayout hides all operator
  // nav and shows only My Closures. Independent of `role` so users
  // who hold a responsible role AND an operator tier keep dual access.
  isPortalOnly: boolean("is_portal_only").notNull().default(false),
  tourVersionSeen: varchar("tour_version_seen"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // Task #880 — stamped by the nightly dormant-account sweep when an
  // approved user is auto-paused for inactivity. Cleared when an admin
  // re-approves. The presence/absence of this column is what the daily
  // brief and Settings UI key off when surfacing "Paused for inactivity"
  // rather than a manual deny.
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
