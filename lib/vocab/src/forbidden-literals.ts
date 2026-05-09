// String literals that must NEVER appear directly in artifact source as
// operator-facing labels. Any occurrence is a vocabulary drift bug:
// the label belongs in `@workspace/vocab`.
//
// The CI guardrail (`scripts/src/check-vocab-drift.ts`) scans
// `artifacts/*/src/**/*.tsx` for these literals. The script also
// allow-lists files that legitimately contain these strings — the
// glossary itself, generated OpenAPI artefacts, and explicitly tagged
// lines via `// vocab-allow-next-line`.

export const FORBIDDEN_LITERALS = [
  // Old leg-conclusion labels — must be rendered through the glossary.
  '"Excluded"',
  '"Dropped"',
  // Wrong casing / wrong separator for "Non-issue".
  '"Non-Issue"',
  '"Non Issue"',
] as const;

// Broader contract (Task #554): a `<Badge>` rendering a state-domain
// JSX expression like `{group.status}`, `{claim.outcome}`, `{verdict.outcome}`,
// `{group.phase}`, `{sub.status}` (submission stage), or `{leg.subStatus}` is
// a state pill and MUST go through `<StateBadge>` so the label, tone, and
// domain-naming tooltip all come from `@workspace/vocab`. The drift scanner
// matches these patterns substring-style on the raw line text — anything
// that's intentionally NOT a state pill (e.g. a decorative chip, a count
// badge, a presentational sandbox) can opt out per-line with
// `// vocab-allow-next-line`.
export const FORBIDDEN_BADGE_STATE_EXPRS = [
  "{group.status}",
  "{group.outcome}",
  "{group.phase}",
  "{group.subStatus}",
  "{claim.status}",
  "{claim.outcome}",
  "{claim.phase}",
  "{claim.subStatus}",
  "{leg.status}",
  "{leg.outcome}",
  "{leg.subStatus}",
  "{verdict.outcome}",
  "{submission.status}",
  "{submission.stage}",
  "{sub.status}",
  "{sub.stage}",
  "{row.status}",
  "{row.outcome}",
  "{row.subStatus}",
] as const;

export const VOCAB_ALLOW_DIRECTIVE = "vocab-allow-next-line";
