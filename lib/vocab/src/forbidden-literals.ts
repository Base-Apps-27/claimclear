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

export const VOCAB_ALLOW_DIRECTIVE = "vocab-allow-next-line";
