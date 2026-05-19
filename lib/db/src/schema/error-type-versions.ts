import { pgTable, integer, serial, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { errorTypesTable } from "./error-types";

export const errorTypeVersionsTable = pgTable("error_type_versions", {
  id: serial("id").primaryKey(),
  errorTypeId: integer("error_type_id")
    .notNull()
    .references(() => errorTypesTable.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot").notNull(),
  treeNodeCount: integer("tree_node_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by"),
  comment: text("comment"),
}, (table) => [
  index("error_type_versions_error_type_id_created_at_idx").on(
    table.errorTypeId,
    table.createdAt.desc(),
  ),
]);

export const insertErrorTypeVersionSchema = createInsertSchema(errorTypeVersionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertErrorTypeVersion = z.infer<typeof insertErrorTypeVersionSchema>;
export type ErrorTypeVersion = typeof errorTypeVersionsTable.$inferSelect;
