import { pgTable, bigserial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimsTable } from "./claims";
import { invoiceGroupsTable } from "./invoice-groups";

// Append-only observability log for state transitions in the per-leg /
// per-invoice model. Distinct from `audit_logs` (the human-facing activity
// feed) — `state_events` is structured machine-data: per-event-key counts,
// time-in-phase histograms, AI vs operator timing, etc.
//
// All inserts go through the `emitStateEvent` helper; never throws.
export const stateEventsTable = pgTable(
  "state_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    eventKey: text("event_key").notNull(),
    claimId: integer("claim_id").references(() => claimsTable.id, {
      onDelete: "set null",
    }),
    invoiceGroupId: integer("invoice_group_id").references(
      () => invoiceGroupsTable.id,
      { onDelete: "set null" },
    ),
    // null for system / bot / AI-driven events.
    actorUserId: text("actor_user_id"),
    // For inspection-time, time-in-phase, etc.; null when not relevant.
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_state_events_event_key_created").on(
      table.eventKey,
      sql`${table.createdAt} DESC`,
    ),
    index("idx_state_events_group_created").on(
      table.invoiceGroupId,
      sql`${table.createdAt} DESC`,
    ),
  ],
);

export const insertStateEventSchema = createInsertSchema(stateEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertStateEvent = z.infer<typeof insertStateEventSchema>;
export type StateEvent = typeof stateEventsTable.$inferSelect;
