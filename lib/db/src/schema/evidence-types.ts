import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const evidenceTypesTable = pgTable("evidence_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  category: text("category"),
  acceptsImage: boolean("accepts_image").notNull().default(true),
  acceptsText: boolean("accepts_text").notNull().default(false),
  instructionText: text("instruction_text"),
  instructionImageUrl: text("instruction_image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEvidenceTypeSchema = createInsertSchema(evidenceTypesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEvidenceType = z.infer<typeof insertEvidenceTypeSchema>;
export type EvidenceType = typeof evidenceTypesTable.$inferSelect;
