import { pgTable, pgEnum, text, serial, integer, timestamp, numeric, boolean, jsonb, index, uniqueIndex, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimStatusEnum, claimOutcomeEnum } from "./claims";

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchical state machine — Wave B (2026-05-07).
// `phase` is the canonical, sequential invoice-as-state-machine column. The
// 7-tuple below MUST stay byte-identical to `INVOICE_PHASES` in
// `lib/vocab/src/invoice-phase.ts` and to the enum value list in migration
// 0034. A parity test in `scripts/src/__tests__/enum-parity.test.ts` enforces
// the cross-file invariant. Wave B backfills this column and reads it for
// derivation; Wave D's `transitionInvoice` becomes its sole writer.
// ─────────────────────────────────────────────────────────────────────────────
export const invoicePhaseEnum = pgEnum("invoice_phase", [
  "triage",
  "ready_to_submit",
  "submitted",
  "response_received",
  "reviewed",
  "awaiting_reattestation",
  "closed",
]);

export const invoiceGroupsTable = pgTable("invoice_groups", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull(),
  clientNumber: text("client_number"),
  errorDetails: text("error_details"),
  errorTypeId: text("error_type_id"),
  errorTypeName: text("error_type_name"),
  status: claimStatusEnum().notNull().default("New"),
  outcome: claimOutcomeEnum().notNull().default("Pending"),
  // Wave B (2026-05-07). Canonical hierarchical-state-machine column. Backfilled
  // by migration 0034 from the (status, outcome, reattest_*, closure_reason)
  // tuple per `derivePhaseFromLegacy`. Read-only until Wave D's writer rewire.
  // `phase_entered_at` is initialised to NOW() at backfill (history precision
  // is recovered later by Wave D's `transitionInvoice`).
  phase: invoicePhaseEnum("phase").notNull().default("triage"),
  phaseEnteredAt: timestamp("phase_entered_at", { withTimezone: true }).notNull().defaultNow(),
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
  // Operator's free-text "Understanding notes" — the narrative-changing
  // context that lands verbatim in the dispute write-up's CRITICAL CONTEXT
  // block. Task #745 split this off `understanding_readback` (which used to
  // double-duty as both the operator's note and the AI restatement) so the
  // verify-then-save gate can compare them.
  specialCircumstances: text("special_circumstances"),
  // The AI's 2–4 sentence restatement of what the dispute is about, given
  // `specialCircumstances` + per-leg findings + decision-tree outcome.
  // Cleared when `specialCircumstances` changes (drift).
  understandingReadback: text("understanding_readback"),
  // The exact `specialCircumstances` text the most recent readback was
  // generated for. Drift anchor: if it differs from the live
  // `specialCircumstances`, the readback is stale and the UI must re-check.
  understandingReadbackForText: text("understanding_readback_for_text"),
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
  // Marks the single global "tour sample" row used by the in-app guided
  // tour so steps 18 / 20 can land on real detail pages with real
  // anchors. Hidden from every normal list/aggregate query and
  // read-only at the API layer (assertNotTourSample). See migration
  // 0029_tour_sample.sql for the singleton-enforcement partial unique
  // index and the seed.
  isTourSample: boolean("is_tour_sample").notNull().default(false),
  // Task #838 — soft-delete / 30-day-undo markers. See migration 0050
  // and the matching block on `claims` for the design notes.
  //
  // `withdrawnAt` — set when a group is withdrawn (outcome=Withdrawn,
  // closureReason=cannot_dispute). Cleared on restore.
  // `draftDiscardedAt` + the two `draftDiscarded*` snapshot columns
  // — set when DELETE /invoice-groups/:id/draft fires; the snapshot
  // lets the admin Restore button repopulate the live draft fields.
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  draftDiscardedAt: timestamp("draft_discarded_at", { withTimezone: true }),
  draftDiscardedSubject: text("draft_discarded_subject"),
  draftDiscardedDescriptionHtml: text("draft_discarded_description_html"),
  // Wave D-PR1 (2026-05-07). GENERATED ALWAYS AS (status IN (…OPEN_STATUSES…))
  // STORED column, populated by Postgres on every UPDATE that touches `status`.
  // Do NOT write to this column. Lockstep with `OPEN_STATUSES` in
  // `lib/leg-state/src/openness.ts` and the `IN (…)` list in migration 0036.
  // See `docs/architecture/state-wave-d-handoff.md` §6.1 for rationale.
  isOpen: boolean("is_open").generatedAlwaysAs(
    sql`status IN ('New','Needs Evidence','Processed','Portal Queued','Generating Email','Ready to Review','Awaiting Response','On Hold')`,
  ),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Task #457: DB-enforced uniqueness on invoice_number. Replaces the
  // prior non-unique `invoice_groups_invoice_number_idx`. The index
  // name matches migration 0031.
  uniqueIndex("invoice_groups_invoice_number_unique").on(table.invoiceNumber),
  index("invoice_groups_status_idx").on(table.status),
  index("invoice_groups_outcome_idx").on(table.outcome),
  index("invoice_groups_created_at_idx").on(table.createdAt),
  index("invoice_groups_service_date_idx").on(table.serviceDate),
  index("invoice_groups_phase_idx").on(table.phase),
]);

export const insertInvoiceGroupSchema = createInsertSchema(invoiceGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoiceGroup = z.infer<typeof insertInvoiceGroupSchema>;
export type InvoiceGroup = typeof invoiceGroupsTable.$inferSelect;
