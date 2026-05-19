-- 0047_error_type_versions.sql
--
-- Task #772 — SOP version history (backend).
-- Append-only audit table that snapshots an error type's row on every
-- successful save (POST or PATCH /api/error-types[/:id]). Powers a
-- list + restore UX so authors can see what an SOP looked like last
-- week and roll back if a save broke something.
--
-- The snapshot is the entire error-type row encoded as JSON; treeNodeCount
-- is denormalized so the listing endpoint can show "X nodes" without
-- having to parse and walk every snapshot.
--
-- Idempotent — safe to re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS error_type_versions (
  id serial PRIMARY KEY,
  error_type_id integer NOT NULL REFERENCES error_types(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  tree_node_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  created_by text,
  comment text
);

CREATE INDEX IF NOT EXISTS error_type_versions_error_type_id_created_at_idx
  ON error_type_versions (error_type_id, created_at DESC);

COMMENT ON TABLE error_type_versions IS
  'Task #772 — append-only snapshot of error_types rows. One row per successful POST/PATCH on /api/error-types; powers the SOP version-history list + restore endpoints.';

COMMIT;
