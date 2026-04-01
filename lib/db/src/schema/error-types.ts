import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertErrorTypeSchema = createInsertSchema(errorTypesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertErrorType = z.infer<typeof insertErrorTypeSchema>;
export type ErrorType = typeof errorTypesTable.$inferSelect;
