import { pgTable, text, serial, integer, timestamp, numeric, boolean, jsonb, index, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimStatusEnum, claimOutcomeEnum } from "./claims";

export const invoiceGroupsTable = pgTable("invoice_groups", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull(),
  clientNumber: text("client_number"),
  errorDetails: text("error_details"),
  errorTypeId: text("error_type_id"),
  errorTypeName: text("error_type_name"),
  status: claimStatusEnum().notNull().default("New"),
  outcome: claimOutcomeEnum().notNull().default("Pending"),
  approvedAmount: numeric("approved_amount", { precision: 12, scale: 2 }),
  rideCount: integer("ride_count").notNull().default(0),
  // Earliest service date across the group's child claims (calendar
  // MIN over `claims.date`), maintained by `recomputeGroupServiceDate`
  // on every write path that can change the set of children or any
  // child's `date`. Replaces the on-the-fly correlated
  // `MIN(NULLIF(claims.date,'')::date)` subquery so the dashboard
  // "FILE TODAY" hero, the Invoice Queue "must file today" tier, and
  // the Groups list Service Date column all read the same indexed
  // value. NULL when the group has no parseable child date. See
  // Task #350 for the motivation and the drift-check guard.
  serviceDate: date("service_date"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }),
  // ────────────────────────────────────────────────────────────────────────
  // Per-invoice (group-level) state machine columns. Discrete-typed
  // replacement for the legacy `workflow_progress` JSONB blob; see
  // docs/architecture/per-invoice-transition.md §"Schema reshape" for the
  // role each plays. The contracts task owns the transition logic that
  // mutates them.
  // ────────────────────────────────────────────────────────────────────────
  // Group-scoped narrative for the writeup ("here's what's going on with
  // this invoice as a whole"). Per-leg context lives on
  // `claims.per_leg_context`.
  // DEPRECATED (Task #265): replaced by per-leg context + AI-generated draft.
  // Field is kept readable for one release; new writes are no longer made.
  groupContext: text("group_context"),
  // ────────────────────────────────────────────────────────────────────────
  // Editable AI-generated dispute draft (Task #265). The "draft*" pair is
  // what the operator sees in the Submission preview pane and what gets
  // submitted (via portal or email). The "aiBaseline*" pair is the raw AI
  // output captured at last regeneration so we can diff/restore.
  // ────────────────────────────────────────────────────────────────────────
  draftSubject: text("draft_subject"),
  draftDescriptionHtml: text("draft_description_html"),
  aiBaselineSubject: text("ai_baseline_subject"),
  aiBaselineDescriptionHtml: text("ai_baseline_description_html"),
  draftEditedAt: timestamp("draft_edited_at", { withTimezone: true }),
  draftEditedBy: text("draft_edited_by"),
  draftReviewedAt: timestamp("draft_reviewed_at", { withTimezone: true }),
  draftReviewedBy: text("draft_reviewed_by"),
  // Operator-authored "this is what I'm asking for" sentence shown back to
  // the operator before generating the dispute preview.
  understandingReadback: text("understanding_readback"),
  understandingReadbackAt: timestamp("understanding_readback_at", { withTimezone: true }),
  understandingReadbackBy: text("understanding_readback_by"),
  // Stamped on each preview generation; the contracts task uses these to
  // detect that a preview was produced before the operator submits.
  previewGeneratedAt: timestamp("preview_generated_at", { withTimezone: true }),
  previewGeneratedBy: text("preview_generated_by"),
  // Re-attestation tracked at the group level (the "did the payor actually
  // pay us?" loop after Approved). Defaults to false.
  reattestRequired: boolean("reattest_required").notNull().default(false),
  reattestCompletedAt: timestamp("reattest_completed_at", { withTimezone: true }),
  reattestCompletedBy: text("reattest_completed_by"),
  reattestNote: text("reattest_note"),
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
  disputeEmailSent: boolean("dispute_email_sent").notNull().default(false),
  disputeEmailSentAt: text("dispute_email_sent_at"),
  generatedEmailSubject: text("generated_email_subject"),
  generatedEmailBody: text("generated_email_body"),
  generatedEmailAt: text("generated_email_at"),
  // Per-group attachment list. Stored as a JSONB array of file refs alongside
  // the canonical `claim_evidence` rows; the bot worker (collectGroupEvidenceUrls)
  // reads both sources. Schema mirrors `EvidenceFileRef` in `lib/api-spec/openapi.yaml`.
  evidenceFiles: jsonb("evidence_files").$type<Array<{ url: string; name?: string | null; size?: number | null }>>(),
  evidenceNotes: text("evidence_notes"),
  // Operator-tickable checklist mapping evidence-step name → checked. No
  // active reader today; typed as `Record<string, boolean>` so future UI
  // can read/write it without `as unknown` casts.
  evidenceChecklist: jsonb("evidence_checklist").$type<Record<string, boolean>>(),
  payorEmail: text("payor_email"),
  // ────────────────────────────────────────────────────────────────────────
  // Lightweight payor-denial-reason signal (Task #321). Captured when the
  // operator reviews a payor response on Responses Awaiting Review. The
  // column is `text` at the DB level; the API enforces the union from
  // `@workspace/payor-denial-reasons`. This is NOT a closure reason and is
  // intentionally separate from the `closure_*` columns above.
  // ────────────────────────────────────────────────────────────────────────
  payorDenialReason: text("payor_denial_reason"),
  payorDenialReasonNote: text("payor_denial_reason_note"),
  payorDenialReasonAt: timestamp("payor_denial_reason_at", { withTimezone: true }),
  payorDenialReasonBy: text("payor_denial_reason_by"),
  // Set when the operator clicks "I replied — wait for payor again" on the
  // Responses Awaiting Review page. The list query for that page hides the
  // row whenever this timestamp is newer than the latest inbound response's
  // `received_at`; a newer response automatically re-includes the row.
  // Does NOT change `status` or `outcome`.
  awaitingPayorAgainAt: timestamp("awaiting_payor_again_at", { withTimezone: true }),
  importBatch: text("import_batch"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("invoice_groups_invoice_number_idx").on(table.invoiceNumber),
  index("invoice_groups_status_idx").on(table.status),
  index("invoice_groups_outcome_idx").on(table.outcome),
  index("invoice_groups_created_at_idx").on(table.createdAt),
  index("invoice_groups_service_date_idx").on(table.serviceDate),
]);

export const insertInvoiceGroupSchema = createInsertSchema(invoiceGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoiceGroup = z.infer<typeof insertInvoiceGroupSchema>;
export type InvoiceGroup = typeof invoiceGroupsTable.$inferSelect;
