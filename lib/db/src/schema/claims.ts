import { pgTable, text, serial, integer, timestamp, numeric, boolean, jsonb, pgEnum, index, check, date, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { invoiceGroupsTable } from "./invoice-groups";

export const claimStatusEnum = pgEnum("claim_status", [
  "New", "Needs Review", "Needs Evidence", "Processed", "Portal Queued", "Generating Email",
  "Ready to Review", "Awaiting Response", "On Hold", "MAS Eligible", "Expired", "Resolved", "Denied"
]);

export const claimOutcomeEnum = pgEnum("claim_outcome", [
  "Pending", "Approved", "Denied", "Partially Approved", "Non-Issue", "Withdrawn", "No Action Needed"
]);

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchical state machine — Wave B (2026-05-07).
// `disposition` is the canonical per-claim column. The 22-tuple below MUST stay
// byte-identical to `CLAIM_DISPOSITIONS` in `lib/vocab/src/claim-disposition.ts`
// and to the enum value list in migration 0034. Cross-row contract: every
// claim's disposition must belong to `VALID_DISPOSITIONS_BY_PHASE[parent.phase]`
// — enforced at the DB layer by the `validate_disposition_against_phase`
// trigger created in 0034. A parity test in
// `scripts/src/__tests__/enum-parity.test.ts` enforces the cross-file invariant.
// ─────────────────────────────────────────────────────────────────────────────
export const claimDispositionEnum = pgEnum("claim_disposition", [
  "unclassified",
  "classifying",
  "disposed_portal",
  "disposed_email",
  "disposed_withdraw",
  "disposed_nonissue",
  "blocked",
  "duplicate",
  "awaiting_review",
  "verdict_drafted",
  "verdict_approved",
  "verdict_denied",
  "verdict_partial",
  "attest_pending",
  "attest_queued",
  "attested",
  "mas_cancelled",
  "attest_not_required",
  "final_reattested",
  "final_withdrawn",
  "final_denied",
  "final_nonissue",
  "disposed_expired",
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
  // Service date (calendar day), typed as DATE so MIN()/sort/filter are
  // calendar-correct in SQL and the column reads back as a YYYY-MM-DD
  // string in JS via drizzle's `mode: "string"` parser. The importer is
  // responsible for normalizing user-supplied date shapes to ISO at
  // write time (`normalizeServiceDate` in `artifacts/api-server/src/lib
  // /dates.ts`); rows that fail to normalize are rejected with a
  // structured per-row reason rather than silently nulled. Migration
  // 0022 (`0022_typed_claims_date.sql`) converted the column from TEXT
  // to DATE; migration 0021 backfilled all stored values to ISO first.
  date: date("date", { mode: "string" }),
  refNumber: text("ref_number"),
  clientNumber: text("client_number"),
  carNumber: text("car_number"),
  errorDetails: text("error_details"),
  errorTypeId: text("error_type_id"),
  errorTypeName: text("error_type_name"),
  claimAmount: numeric("claim_amount", { precision: 12, scale: 2 }),
  // Discrete denormalized read caches — see Per-Invoice Transition design doc
  // §"Schema reshape". `status` mirrors the parent group's macro phase, and
  // `outcome` mirrors the latest confirmed verdict from `claim_verdict`.
  // Population logic for these moves into the contracts task.
  status: claimStatusEnum().notNull().default("New"),
  outcome: claimOutcomeEnum().notNull().default("Pending"),
  // Wave B (2026-05-07). Canonical per-claim hierarchical-state-machine column.
  // Backfilled by migration 0034 from the (sop_outcome, drop_reason, outcome,
  // attestation_state, included_in_dispute, duplicate_of_claim_id) tuple per
  // `deriveDispositionFromLegacy`. Cross-row contract enforced by the
  // `validate_disposition_against_phase` deferrable trigger. Read-only until
  // Wave D's `setClaimDisposition` becomes its sole writer.
  disposition: claimDispositionEnum("disposition").notNull().default("unclassified"),
  approvedAmount: numeric("approved_amount", { precision: 12, scale: 2 }),
  invoiceNumbers: text("invoice_numbers"),
  payorEmail: text("payor_email"),
  disputeEmailSent: boolean("dispute_email_sent").notNull().default(false),
  disputeEmailSentAt: text("dispute_email_sent_at"),
  // Wave D-PR5 (2026-05-07). Per-leg "how was this filed" signal —
  // pinned values: 'portal' | 'email' | NULL (not yet submitted).
  // Stamped by the writer click sites (portal-submissions
  // create/confirm/retry, batch-processor Direct Email + external
  // bot) and read by the deriver to promote a group from
  // `ready_to_submit` → `submitted` once any child carries a
  // non-null value. CHECK constraint + partial index live in
  // migration 0038. See docs/architecture/state-wave-d-pr5-handoff-prompt.md.
  submittedVia: text("submitted_via"),
  importBatch: text("import_batch"),
  // Per-leg attachment list. Stored as a JSONB array of file refs alongside
  // the canonical `claim_evidence` rows; the bot worker (collectGroupEvidenceUrls)
  // reads both sources. Schema mirrors `EvidenceFileRef` in `lib/api-spec/openapi.yaml`.
  evidenceFiles: jsonb("evidence_files").$type<Array<{ url: string; name?: string | null; size?: number | null }>>(),
  evidenceNotes: text("evidence_notes"),
  // Operator-tickable checklist mapping evidence-step name → checked. No
  // active reader today; typed as `Record<string, boolean>` so future UI
  // can read/write it without `as unknown` casts.
  evidenceChecklist: jsonb("evidence_checklist").$type<Record<string, boolean>>(),
  generatedEmailSubject: text("generated_email_subject"),
  generatedEmailBody: text("generated_email_body"),
  generatedEmailAt: text("generated_email_at"),
  // ────────────────────────────────────────────────────────────────────────
  // Per-leg state machine columns. Replace the legacy
  // `workflow_progress` JSONB column with discrete typed values. See
  // `lib/db/src/enums/leg-state.ts` for the pinned vocabulary and
  // `artifacts/claimclear/src/lib/lifecycle-phase.ts:deriveLegSubStatus`
  // for the derived sub-status projection used by UI surfaces.
  // ────────────────────────────────────────────────────────────────────────
  // Whether this leg participates in the dispute. `false` = excluded
  // (clean leg, no errorTypeId, flows through normal payment).
  includedInDispute: boolean("included_in_dispute").notNull().default(true),
  // Bookmark in the SOP decision tree, for resume.
  sopNodeId: text("sop_node_id"),
  // Append-only path: { nodeId, answer, ts }. The contracts task writes new
  // entries on each sop-advance; never edited in place.
  sopAnswers: jsonb("sop_answers").notNull().default(sql`'[]'::jsonb`),
  // Outcome of the SOP walk. Pinned values: portal_dispute | dispute |
  // hold | cannot_dispute | non_issue. Null while still investigating.
  sopOutcome: text("sop_outcome"),
  // Drop reason when the leg is dropped from the dispute pre-submit. Pinned
  // values: cannot_dispute | non_issue. Same vocabulary as the leg-scoped
  // subset of CLOSURE_REASONS.
  dropReason: text("drop_reason"),
  dropNote: text("drop_note"),
  droppedAt: timestamp("dropped_at", { withTimezone: true }),
  // Stamped when the SOP terminal lands on portal_dispute or dispute (the
  // "ready" signal — leg is included in the next group submission).
  readyAt: timestamp("ready_at", { withTimezone: true }),
  // Per-leg narrative for the writeup, scoped to this leg only. Group-level
  // context lives on `invoice_groups.group_context`.
  perLegContext: text("per_leg_context"),
  // Sibling-duplicate pointer for trip-overriding error types (eligibility,
  // time-too-short-at-facility). When set, this leg shares its primary's
  // SOP finding and is hidden from work surfaces but still counted in the
  // invoice $ rollup. Distinct from the manual `duplicate_claim` closure
  // reason in `lib/closure-options`. See `error_types.trip_overriding` for
  // which error types may carry siblings. Self-FK; SET NULL on primary
  // delete so a stranded duplicate degrades to needs_classification rather
  // than disappearing.
  duplicateOfClaimId: integer("duplicate_of_claim_id").references((): AnyPgColumn => claimsTable.id, { onDelete: "set null" }),
  // MAS Action tracking — the per-leg cancel checklist on the post-response
  // MAS Action phase. Pinned values: cancel | none.
  masActionRequired: text("mas_action_required"),
  masActionCompletedAt: timestamp("mas_action_completed_at", { withTimezone: true }),
  masActionCompletedBy: text("mas_action_completed_by"),
  masActionNote: text("mas_action_note"),
  // The existing holdReason column is kept; its value domain is now
  // constrained at the application layer to LEG_HOLD_REASONS. No CHECK
  // constraint added — backfill normalizes synonyms, unrecognized values
  // fall back to 'other'.
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
  // Wave D-PR1 (2026-05-07). GENERATED ALWAYS AS (status IN (…OPEN_STATUSES…))
  // STORED column, populated by Postgres on every UPDATE that touches `status`.
  // Do NOT write to this column — drizzle-kit and createInsertSchema know it
  // is generated and will reject it. Lockstep with `OPEN_STATUSES` in
  // `lib/leg-state/src/openness.ts` and the `IN (…)` list in migration 0036.
  // See `docs/architecture/state-wave-d-handoff.md` §6.1 for rationale.
  isOpen: boolean("is_open").generatedAlwaysAs(
    sql`status IN ('New','Needs Evidence','Processed','Portal Queued','Generating Email','Ready to Review','Awaiting Response','On Hold')`,
  ),
  // Marks the single global "tour sample" row used by the in-app guided
  // tour so steps 18 / 20 can land on real detail pages with real
  // anchors. Hidden from every normal list/aggregate query and
  // read-only at the API layer (assertNotTourSample). See migration
  // 0029_tour_sample.sql for the singleton-enforcement partial unique
  // index and the seed.
  isTourSample: boolean("is_tour_sample").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("claims_conf_number_idx").on(table.confNumber),
  index("claims_invoice_group_id_idx").on(table.invoiceGroupId),
  index("claims_disposition_idx").on(table.disposition),
  index("claims_invoice_group_disposition_idx").on(table.invoiceGroupId, table.disposition),
  index("claims_status_idx").on(table.status),
  index("claims_date_idx").on(table.date),
  index("claims_created_at_idx").on(table.createdAt),
  index("idx_claims_sop_outcome").on(table.sopOutcome),
  // Used by the readiness-gate query (find duplicates pointing at a primary)
  // and by sibling-listing queries on the leg-detail surface.
  index("idx_claims_duplicate_of_claim_id")
    .on(table.duplicateOfClaimId)
    .where(sql`${table.duplicateOfClaimId} IS NOT NULL`),
  // Partial index supporting the MAS worklist query: per group, find the
  // legs whose cancel hasn't been completed yet.
  index("idx_claims_mas_action_pending")
    .on(table.invoiceGroupId)
    .where(sql`${table.masActionRequired} = 'cancel' AND ${table.masActionCompletedAt} IS NULL`),
  // DB-level value-domain enforcement for the per-leg state machine
  // columns. Pinned vocabulary lives in `lib/db/src/enums/leg-state.ts`.
  check(
    "claims_sop_outcome_chk",
    sql`${table.sopOutcome} IS NULL OR ${table.sopOutcome} IN ('portal_dispute','dispute','hold','cannot_dispute','non_issue')`,
  ),
  check(
    "claims_drop_reason_chk",
    sql`${table.dropReason} IS NULL OR ${table.dropReason} IN ('cannot_dispute','non_issue')`,
  ),
  check(
    "claims_mas_action_required_chk",
    sql`${table.masActionRequired} IS NULL OR ${table.masActionRequired} IN ('cancel','none')`,
  ),
  check(
    "claims_submitted_via_chk",
    sql`${table.submittedVia} IS NULL OR ${table.submittedVia} IN ('portal','email')`,
  ),
  index("claims_submitted_via_idx")
    .on(table.invoiceGroupId)
    .where(sql`${table.submittedVia} IS NOT NULL`),
]);

export const insertClaimSchema = createInsertSchema(claimsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Claim = typeof claimsTable.$inferSelect;
