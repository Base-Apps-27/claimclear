-- 0047_sop_library_items.sql
--
-- Task #771 — shared library of evidence requirements and decision-tree
-- sub-trees that authors can reuse across error types. Items are copied
-- by value into `error_types.decision_tree` / `evidence_requirements` at
-- insert time, so there is intentionally NO foreign key relationship —
-- editing a library item does not retroactively mutate already-saved
-- decision trees.
--
-- `kind` distinguishes the two flavors:
--   * `evidence_requirement` — payload is an `EvidenceReq` object minus its `id`.
--   * `sub_tree`             — payload is a full `DecisionTree` object.
--
-- Idempotent — safe to re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS sop_library_items (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('evidence_requirement', 'sub_tree')),
  label text NOT NULL,
  description text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sop_library_items IS
  'Task #771 — shared library of reusable evidence requirements and decision-tree sub-trees. Items are copied by value into error_types at insert time; there is intentionally NO foreign key from error_types back to this table.';

COMMIT;
