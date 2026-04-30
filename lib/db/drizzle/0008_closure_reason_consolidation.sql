-- Task #160: Consolidate closure reasons.
-- Old set: payer_denied, not_contestable, accepted_loss, non_issue
-- New set: denied_by_payor, cannot_dispute, non_issue
-- Mapping:
--   payer_denied    -> denied_by_payor
--   accepted_loss   -> denied_by_payor (was Withdrawn; outcome stays Withdrawn but reason becomes denied_by_payor)
--   not_contestable -> cannot_dispute
--   non_issue       -> non_issue (unchanged)

UPDATE "claims" SET "closure_reason" = 'denied_by_payor' WHERE "closure_reason" IN ('payer_denied', 'accepted_loss');--> statement-breakpoint
UPDATE "claims" SET "closure_reason" = 'cannot_dispute' WHERE "closure_reason" = 'not_contestable';--> statement-breakpoint
UPDATE "invoice_groups" SET "closure_reason" = 'denied_by_payor' WHERE "closure_reason" IN ('payer_denied', 'accepted_loss');--> statement-breakpoint
UPDATE "invoice_groups" SET "closure_reason" = 'cannot_dispute' WHERE "closure_reason" = 'not_contestable';--> statement-breakpoint
UPDATE "claim_evidence" SET "closure_reason_at_attach" = 'denied_by_payor' WHERE "closure_reason_at_attach" IN ('payer_denied', 'accepted_loss');--> statement-breakpoint
UPDATE "claim_evidence" SET "closure_reason_at_attach" = 'cannot_dispute' WHERE "closure_reason_at_attach" = 'not_contestable';--> statement-breakpoint

-- Backfill any legacy Denied rows that never had a closure_reason recorded
-- (pre-Task #160 the simple "outcome = Denied" path stored NULL). Going
-- forward, every Denied outcome must carry closureReason = 'denied_by_payor',
-- so legacy NULLs would otherwise show up as "(no reason)" everywhere.
UPDATE "claims"
   SET "closure_reason" = 'denied_by_payor'
 WHERE "outcome" = 'Denied' AND "closure_reason" IS NULL;--> statement-breakpoint
UPDATE "invoice_groups"
   SET "closure_reason" = 'denied_by_payor'
 WHERE "outcome" = 'Denied' AND "closure_reason" IS NULL;
