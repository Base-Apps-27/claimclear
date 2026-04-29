#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db push-force
# Regenerate the OpenAPI client first so downstream type builds see fresh source.
pnpm --filter @workspace/api-spec run codegen
# Rebuild composite project declarations so referencing projects don't pick up
# stale .d.ts files in dist/ (which silently masks real type errors).
pnpm exec tsc -b lib/db lib/api-client-react lib/object-storage-web --force
