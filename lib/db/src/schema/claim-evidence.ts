import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimsTable } from "./claims";
import { evidenceTypesTable } from "./evidence-types";
import { invoiceGroupsTable } from "./invoice-groups";

export const claimEvidenceTable = pgTable("claim_evidence", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").references(() => claimsTable.id, { onDelete: "cascade" }),
  invoiceGroupId: integer("invoice_group_id").references(() => invoiceGroupsTable.id, { onDelete: "cascade" }),
  evidenceTypeId: integer("evidence_type_id").references(() => evidenceTypesTable.id, { onDelete: "set null" }),
  evidenceTypeName: text("evidence_type_name").notNull(),
  treeNodeId: text("tree_node_id"),
  imageUrl: text("image_url"),
  notes: text("notes"),
  collectedBy: text("collected_by"),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("claim_evidence_claim_id_idx").on(table.claimId),
]);

export const insertClaimEvidenceSchema = createInsertSchema(claimEvidenceTable).omit({ id: true, collectedAt: true });
export type InsertClaimEvidence = z.infer<typeof insertClaimEvidenceSchema>;
export type ClaimEvidence = typeof claimEvidenceTable.$inferSelect;
