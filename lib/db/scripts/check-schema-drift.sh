#!/usr/bin/env bash
# Catch schema drift before it ships.
#
# How it works:
#   1. Copy the existing migrations folder (lib/db/drizzle) to a sibling
#      scratch folder.
#   2. Run `drizzle-kit generate` against that scratch folder, using the
#      current schema TS files as input.
#   3. Diff the scratch folder against the real migrations folder. If they
#      differ, drizzle-kit would have produced a new migration, which means
#      the SQL migrations are out of sync with the schema TS files (drift).
#
# Exit codes:
#   0 - no drift
#   1 - drift detected (or unexpected error)
#
# This script is intentionally side-effect free against the real
# `lib/db/drizzle/` directory: it only writes inside `lib/db/.drift-check/`,
# which is removed on exit.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DRIZZLE_DIR="$DB_DIR/drizzle"
SCRATCH_DIR="$DB_DIR/.drift-check"

DIFF_FILE="$(mktemp -t schema-drift.XXXXXX.diff)"

cleanup() {
  rm -rf "$SCRATCH_DIR"
  rm -f "$DIFF_FILE"
}
trap cleanup EXIT

if [ ! -d "$DRIZZLE_DIR" ]; then
  echo "❌ Could not find migrations folder at $DRIZZLE_DIR" >&2
  exit 1
fi

rm -rf "$SCRATCH_DIR"
mkdir -p "$SCRATCH_DIR"
cp -R "$DRIZZLE_DIR/." "$SCRATCH_DIR/"

cd "$DB_DIR"

# `--out` must be a path relative to the current working directory (drizzle-kit
# rejects absolute paths and prefixes them with `./`). The scratch folder lives
# directly under lib/db so a simple relative reference works.
SCRATCH_REL=".drift-check"

# drizzle-kit's config loader requires DATABASE_URL to be set, but `generate`
# never actually opens a connection — it only diffs schema TS files against the
# meta snapshots on disk. A placeholder value is enough to satisfy the loader.
GEN_OUTPUT=$(
  DATABASE_URL="${DATABASE_URL:-postgres://drift-check@localhost/drift-check}" \
  npx --no-install drizzle-kit generate \
    --dialect postgresql \
    --schema ./src/schema/index.ts \
    --out "$SCRATCH_REL" \
    --breakpoints 2>&1
) || {
  echo "❌ drizzle-kit generate failed:" >&2
  echo "$GEN_OUTPUT" >&2
  exit 1
}

if diff -r "$DRIZZLE_DIR" "$SCRATCH_DIR" > "$DIFF_FILE" 2>&1; then
  echo "✅ No schema drift: lib/db/drizzle is in sync with lib/db/src/schema."
  exit 0
fi

echo "❌ Schema drift detected!" >&2
echo "" >&2
echo "Running 'drizzle-kit generate' would produce changes — the SQL" >&2
echo "migrations under lib/db/drizzle/ are out of sync with the Drizzle" >&2
echo "schema TypeScript files under lib/db/src/schema/." >&2
echo "" >&2
echo "To fix: run 'pnpm --filter @workspace/db exec drizzle-kit generate'" >&2
echo "and commit the resulting SQL + meta snapshot files." >&2
echo "" >&2
echo "Diff (real drizzle/ vs what generate would produce):" >&2
echo "----------------------------------------------------" >&2
cat "$DIFF_FILE" >&2
exit 1
