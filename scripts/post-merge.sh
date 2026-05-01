#!/bin/bash
set -e
pnpm install --frozen-lockfile
# Apply explicit SQL migrations from lib/db/migrations/ via the
# non-interactive runner. Replaces the previous `drizzle-kit push --force`
# step — push prompts interactively for ambiguous renames and `--force`
# does NOT bypass those prompts (see May-2026 production incident, where
# push silently no-op'd in the production build's non-TTY shell). Dev and
# prod now use the exact same migration path (`pnpm --filter @workspace/db
# run migrate`) so any drift is caught the moment a task merges.
pnpm --filter @workspace/db run migrate
# Regenerate the OpenAPI client first so downstream type builds see fresh source.
pnpm --filter @workspace/api-spec run codegen
# Rebuild composite project declarations so referencing projects don't pick up
# stale .d.ts files in dist/ (which silently masks real type errors).
pnpm exec tsc -b \
  lib/db \
  lib/api-client-react \
  lib/object-storage-web \
  lib/leg-state \
  lib/api-zod \
  lib/integrations-anthropic-ai \
  --force
