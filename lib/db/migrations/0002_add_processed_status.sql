-- 0002_add_processed_status.sql
--
-- Adds the "Processed" value to the claim_status enum so the leg-level
-- projector in artifacts/api-server/src/lib/denormalized-cache.ts can
-- distinguish a leg whose SOP worktree has completed (sop_outcome ∈
-- {portal_dispute, dispute}, no per-leg hold, not yet submitted) from a
-- leg that still needs operator attention (sop_outcome IS NULL).
--
-- Why a dedicated migration file:
--   PostgreSQL forbids ALTER TYPE ... ADD VALUE inside an explicit OR
--   implicit transaction block (the runner batches all statements in a
--   single file as one Query message, which Postgres wraps in an
--   implicit txn). The accompanying backfill therefore lives in
--   0003_backfill_processed_status.sql so this file contains exactly
--   one DDL statement that runs in autocommit.
--
-- Idempotent: `ADD VALUE IF NOT EXISTS` is a no-op if "Processed" is
-- already on the enum (safe to re-run during dev pushes).

ALTER TYPE "public"."claim_status" ADD VALUE IF NOT EXISTS 'Processed' BEFORE 'Portal Queued';
