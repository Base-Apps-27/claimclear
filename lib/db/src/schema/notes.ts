import { pgTable, text, serial, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimsTable } from "./claims";

export const noteTypeEnum = pgEnum("note_type", [
  "manual", "email", "email_sent", "reply_parsed",
  "status_change", "outcome_recorded", "system", "bot"
]);

export const notesTable = pgTable("notes", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claimsTable.id, { onDelete: "cascade" }),
  type: noteTypeEnum().notNull().default("manual"),
  content: text("content").notNull(),
  author: text("author"),
  emailSubject: text("email_subject"),
  extractedInvoiceNumbers: text("extracted_invoice_numbers"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("notes_claim_id_idx").on(table.claimId),
]);

export const insertNoteSchema = createInsertSchema(notesTable).omit({ id: true, createdAt: true });
export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Note = typeof notesTable.$inferSelect;
