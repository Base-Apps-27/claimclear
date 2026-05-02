import { pgTable, text, serial, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const errorTypesTable = pgTable("error_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  guidance: text("guidance"),
  recommendedActions: text("recommended_actions"),
  disputeReasonsLibrary: jsonb("dispute_reasons_library"),
  evidenceRequirements: jsonb("evidence_requirements"),
  decisionTree: jsonb("decision_tree"),
  emailTemplate: text("email_template"),
  disputeInstructions: text("dispute_instructions"),
  useGpsControlDeviation: boolean("use_gps_control_deviation").notNull().default(false),
  useDirectEmail: boolean("use_direct_email").notNull().default(false),
  // Trip-overriding error types bind every leg of a trip identically — the
  // finding ("member ineligible on this date", "patient at facility too long")
  // doesn't change leg-by-leg. When true, the SOP entry on a sibling leg
  // offers a one-click "Mark as Sibling duplicate of CLM-X" prompt instead
  // of forcing a redundant SOP walk. Default false; flip on the error-types
  // admin page for eligibility-family + time-at-facility error types.
  tripOverriding: boolean("trip_overriding").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertErrorTypeSchema = createInsertSchema(errorTypesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertErrorType = z.infer<typeof insertErrorTypeSchema>;
export type ErrorType = typeof errorTypesTable.$inferSelect;
