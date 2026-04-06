import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { errorTypesTable } from "./error-types";

export const errorDetailMappingsTable = pgTable("error_detail_mappings", {
  id: serial("id").primaryKey(),
  normalizedText: text("normalized_text").notNull().unique(),
  originalText: text("original_text").notNull(),
  errorTypeId: integer("error_type_id").notNull().references(() => errorTypesTable.id),
  errorTypeName: text("error_type_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ErrorDetailMapping = typeof errorDetailMappingsTable.$inferSelect;
