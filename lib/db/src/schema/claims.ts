import { pgTable, text, serial, integer, timestamp, numeric, boolean, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoiceGroupsTable } from "./invoice-groups";

export const claimStatusEnum = pgEnum("claim_status", [
  "New", "Needs Review", "Needs Evidence", "Portal Queued", "Generating Email",
  "Ready to Review", "Awaiting Response", "On Hold", "Resolved", "Denied"
]);

export const claimOutcomeEnum = pgEnum("claim_outcome", [
  "Pending", "Approved", "Denied", "Partially Approved", "Non-Issue", "Withdrawn"
]);

export const CLOSURE_REASONS = ["denied_by_payor", "cannot_dispute", "non_issue"] as const;
export type ClosureReason = typeof CLOSURE_REASONS[number];

export const CLOSURE_REASON_LABELS: Record<ClosureReason, string> = {
  denied_by_payor: "Denied by payor",
  cannot_dispute: "Withdrawn — cannot dispute",
  non_issue: "Resolved — non-issue at triage",
};

export const CLOSURE_ACCOUNTABILITY_TAGS = [
  "driver", "dispatcher", "member", "it_system", "our_staff", "external_payor", "other",
] as const;
export type ClosureAccountabilityTag = typeof CLOSURE_ACCOUNTABILITY_TAGS[number];

export const CLOSURE_REVIEW_STATES = ["pending", "addressed"] as const;
export type ClosureReviewState = typeof CLOSURE_REVIEW_STATES[number];

// Re-attestation tracking. When an Approved verdict is recorded, the
// real-world next step happens off-system (operator re-attests in the payor
// portal). The state machine here lets the system know whether that step is
// still owed, parked for someone else, or complete.
//   not_required → outcome is not Approved (default for everything else).
//   pending      → outcome just became Approved, no one has acted yet.
//   queued       → operator parked it for someone with portal access to handle.
//   completed    → an operator confirmed they re-attested in the portal.
export const ATTESTATION_STATES = ["not_required", "pending", "queued", "completed"] as const;
export type AttestationState = typeof ATTESTATION_STATES[number];

export const claimsTable = pgTable("claims", {
  id: serial("id").primaryKey(),
  invoiceGroupId: integer("invoice_group_id").references(() => invoiceGroupsTable.id, { onDelete: "cascade" }),
  confNumber: text("conf_number").notNull(),
  date: text("date"),
  refNumber: text("ref_number"),
  clientNumber: text("client_number"),
  carNumber: text("car_number"),
  errorDetails: text("error_details"),
  errorTypeId: text("error_type_id"),
  errorTypeName: text("error_type_name"),
  claimAmount: numeric("claim_amount", { precision: 12, scale: 2 }),
  status: claimStatusEnum().notNull().default("New"),
  outcome: claimOutcomeEnum().notNull().default("Pending"),
  approvedAmount: numeric("approved_amount", { precision: 12, scale: 2 }),
  invoiceNumbers: text("invoice_numbers"),
  payorEmail: text("payor_email"),
  disputeEmailSent: boolean("dispute_email_sent").notNull().default(false),
  disputeEmailSentAt: text("dispute_email_sent_at"),
  importBatch: text("import_batch"),
  evidenceFiles: jsonb("evidence_files"),
  evidenceNotes: text("evidence_notes"),
  evidenceChecklist: jsonb("evidence_checklist"),
  generatedEmailSubject: text("generated_email_subject"),
  generatedEmailBody: text("generated_email_body"),
  generatedEmailAt: text("generated_email_at"),
  workflowProgress: jsonb("workflow_progress"),
  holdReason: text("hold_reason"),
  holdPendingFrom: text("hold_pending_from"),
  holdPlacedAt: text("hold_placed_at"),
  triageNotes: text("triage_notes"),
  triagedAt: text("triaged_at"),
  closureReason: text("closure_reason"),
  closureCategory: text("closure_category"),
  closureCategoryOther: text("closure_category_other"),
  closureRootCause: text("closure_root_cause"),
  closureRootCauseOther: text("closure_root_cause_other"),
  closureNarrative: text("closure_narrative"),
  closureAccountabilityTags: jsonb("closure_accountability_tags"),
  closureAccountabilityOther: text("closure_accountability_other"),
  closureDrivers: jsonb("closure_drivers"),
  closureDispatchers: jsonb("closure_dispatchers"),
  closureCommunicatedTo: text("closure_communicated_to"),
  closureReviewState: text("closure_review_state"),
  closureAddressedAt: timestamp("closure_addressed_at", { withTimezone: true }),
  closureAddressedBy: text("closure_addressed_by"),
  closureAddressedByEmail: text("closure_addressed_by_email"),
  closureReviewNotes: text("closure_review_notes"),
  // Re-attestation tracking — see ATTESTATION_STATES for the state machine.
  // attestationState is the source of truth; the timestamps/identities are
  // pure audit-trail fields kept on the row so the timeline and queue UIs
  // can render without joining the audit log.
  attestationState: text("attestation_state").notNull().default("not_required"),
  attestedAt: timestamp("attested_at", { withTimezone: true }),
  attestedBy: text("attested_by"),
  attestationNote: text("attestation_note"),
  attestationQueuedAt: timestamp("attestation_queued_at", { withTimezone: true }),
  attestationQueuedBy: text("attestation_queued_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("claims_conf_number_idx").on(table.confNumber),
  index("claims_invoice_group_id_idx").on(table.invoiceGroupId),
  index("claims_status_idx").on(table.status),
  index("claims_date_idx").on(table.date),
  index("claims_created_at_idx").on(table.createdAt),
]);

export const insertClaimSchema = createInsertSchema(claimsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Claim = typeof claimsTable.$inferSelect;
