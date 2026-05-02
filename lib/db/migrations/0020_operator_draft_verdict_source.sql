-- Task #343: add `operator_draft` to `claim_verdict.source`.
--
-- Drafts are non-terminal selections saved as the operator picks
-- per-leg verdicts in Step 3 of the Responses Awaiting Review flow.
-- They share the append-only history with the existing two sources
-- and the latest draft per leg wins. Recording a draft must NOT
-- trigger refreshGroupDerivedFields, MAS derivation, or the
-- attestation gate — those side effects only fire when Step 4 is
-- committed and drafts are promoted to `operator_confirmed` in one
-- transaction.
--
-- Idempotent: drops the existing CHECK (whatever its previous
-- vocabulary was) and re-creates it with the wider set.

BEGIN;

ALTER TABLE "claim_verdict" DROP CONSTRAINT IF EXISTS "claim_verdict_source_chk";
ALTER TABLE "claim_verdict" ADD CONSTRAINT "claim_verdict_source_chk"
  CHECK ("claim_verdict"."source" IN ('ai_suggested','operator_confirmed','operator_draft'));

COMMIT;
