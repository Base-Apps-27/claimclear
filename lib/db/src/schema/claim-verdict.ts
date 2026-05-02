import { pgTable, serial, integer, text, timestamp, numeric, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { claimsTable } from "./claims";

// Append-only history of per-leg verdicts. Each row captures one moment in
// time — an AI suggestion (`source = 'ai_suggested'`, with confidence and
// reasoning, no operator) or an operator confirmation (`source =
// 'operator_confirmed'`, with optional inspection_time_ms for calibration).
//
// "Latest verdict per claim" is a (claim_id, created_at DESC) lookup —
// there is no `is_current` column. The denormalized cache lives at
// `claims.outcome` and is repopulated by the contracts task on every write.
export const claimVerdictTable = pgTable(
  "claim_verdict",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claim_id")
      .notNull()
      .references(() => claimsTable.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    outcome: text("outcome").notNull(),
    note: text("note"),
    // AI suggestions only; null for operator confirmations.
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    reasoning: text("reasoning"),
    // user id; null for AI suggestions.
    createdBy: text("created_by"),
    // Operator confirmations only; null for AI suggestions. Captures how long
    // the operator looked at the AI suggestion before confirming, which the
    // calibration line on the verdict picker uses to surface "are operators
    // rubber-stamping?" signals.
    inspectionTimeMs: integer("inspection_time_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_claim_verdict_claim_created").on(
      table.claimId,
      sql`${table.createdAt} DESC`,
    ),
    index("idx_claim_verdict_source_outcome").on(
      table.source,
      table.outcome,
      sql`${table.createdAt} DESC`,
    ),
    // DB-level value-domain enforcement. Pinned vocabulary lives in
    // `lib/db/src/enums/leg-state.ts` (VERDICT_SOURCE / VERDICT_OUTCOMES).
    check(
      "claim_verdict_source_chk",
      sql`${table.source} IN ('ai_suggested','operator_confirmed','operator_draft')`,
    ),
    check(
      "claim_verdict_outcome_chk",
      sql`${table.outcome} IN ('Approved','Denied','Partial')`,
    ),
  ],
);

export const insertClaimVerdictSchema = createInsertSchema(claimVerdictTable).omit({
  id: true,
  createdAt: true,
});
export type InsertClaimVerdict = z.infer<typeof insertClaimVerdictSchema>;
export type ClaimVerdict = typeof claimVerdictTable.$inferSelect;
