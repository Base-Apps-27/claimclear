import { pgTable, text, serial, integer, timestamp, boolean, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimsTable } from "./claims";
import { portalSubmissionsTable } from "./portal-submissions";

export const responseSourceEnum = pgEnum("response_source", [
  "email", "portal", "manual"
]);

export const responseTypeEnum = pgEnum("response_type", [
  "approval", "denial", "partial_approval", "info_request", "acknowledgment", "other"
]);

export const portalResponsesTable = pgTable("portal_responses", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").references(() => claimsTable.id, { onDelete: "set null" }),
  submissionId: integer("submission_id").references(() => portalSubmissionsTable.id, { onDelete: "set null" }),
  source: responseSourceEnum().notNull(),
  responseType: responseTypeEnum().notNull().default("other"),
  subject: text("subject"),
  content: text("content"),
  rawContent: text("raw_content"),
  senderEmail: text("sender_email"),
  senderName: text("sender_name"),
  matchedVia: text("matched_via"),
  matchConfidence: text("match_confidence"),
  portalTicketId: text("portal_ticket_id"),
  externalMessageId: text("external_message_id"),
  processed: boolean("processed").notNull().default(false),
  autoLinked: boolean("auto_linked").notNull().default(false),
  metadata: jsonb("metadata"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("portal_responses_claim_id_idx").on(table.claimId),
  index("portal_responses_submission_id_idx").on(table.submissionId),
  index("portal_responses_source_idx").on(table.source),
  index("portal_responses_external_message_id_idx").on(table.externalMessageId),
  index("portal_responses_processed_idx").on(table.processed),
]);

export const insertPortalResponseSchema = createInsertSchema(portalResponsesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPortalResponse = z.infer<typeof insertPortalResponseSchema>;
export type PortalResponse = typeof portalResponsesTable.$inferSelect;
