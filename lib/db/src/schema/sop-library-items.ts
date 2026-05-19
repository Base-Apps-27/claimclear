import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sopLibraryItemsTable = pgTable("sop_library_items", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSopLibraryItemSchema = createInsertSchema(sopLibraryItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSopLibraryItem = z.infer<typeof insertSopLibraryItemSchema>;
export type SopLibraryItem = typeof sopLibraryItemsTable.$inferSelect;
