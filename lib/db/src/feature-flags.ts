// Single module that exports the boolean feature flags gating staged rollouts.
//
// Read from process.env at module load time. Defaults are intentional: a
// missing or unparseable env var means the rollout is OFF. Every downstream
// surface that gates on a flag must import from this file rather than read
// process.env directly, so feature-flag values stay queryable from one place
// and so a single grep tells you which surfaces a flag affects.

// Gates the per-claim → per-invoice transition (claims live as legs inside
// invoice groups; per-leg verdicts; MAS Action phase). Default false; flip
// to true after the cutover task ships and all downstream UI is in place.
export const PER_INVOICE_TRANSITION_ENABLED =
  process.env.PER_INVOICE_TRANSITION_ENABLED === "true";
