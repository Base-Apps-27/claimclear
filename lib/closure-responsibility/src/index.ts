// @workspace/closure-responsibility — single source of truth for the
// five-value `closure_responsibility` column written by the slim closure
// intake modal (Task #888). Each responsibility value maps to exactly one
// of three supervisor "responsible roles" so the downstream portal
// (Task #889) and CSV export (Task #890) can route by role without
// recomputing the mapping at each call site.
//
// The legacy free-form `closure_accountability_tags` jsonb column still
// exists for back-compat and is server-derived from this value on the
// `denied_by_payor` confirm path. New code MUST read `closure_responsibility`.

export const CLOSURE_RESPONSIBILITIES = [
  "agent_mistake",
  "driver_mistake",
  "system_error",
  "external_payor",
  "no_one_process_limit",
] as const;

export type ClosureResponsibility = typeof CLOSURE_RESPONSIBILITIES[number];

export const CLOSURE_RESPONSIBLE_ROLES = [
  "contact_center_manager",
  "contractor_relations_coordinator",
  "it_coordinator_or_coo",
] as const;

export type ClosureResponsibleRole = typeof CLOSURE_RESPONSIBLE_ROLES[number];

// Canonical responsibility → role routing table. Used by the slim closure
// modal to render the live "this will be routed to …" badge, by the
// responsible-party portal (Task #889) to bucket the operator's queue, and
// by the per-responsibility CSV export (Task #890).
export const RESPONSIBILITY_TO_ROLE: Record<ClosureResponsibility, ClosureResponsibleRole> = {
  agent_mistake: "contact_center_manager",
  driver_mistake: "contractor_relations_coordinator",
  system_error: "it_coordinator_or_coo",
  external_payor: "it_coordinator_or_coo",
  no_one_process_limit: "it_coordinator_or_coo",
};

// Mapping into the legacy `closure_accountability_tags` jsonb column —
// retained so existing reporting / drawer surfaces that still read tags
// keep working until the next sweep removes them. One value in →
// one tag out.
export const RESPONSIBILITY_TO_LEGACY_TAGS: Record<ClosureResponsibility, string[]> = {
  agent_mistake: ["our_staff"],
  driver_mistake: ["driver"],
  system_error: ["it_system"],
  external_payor: ["external_payor"],
  no_one_process_limit: ["other"],
};

export const CLOSURE_RESPONSIBILITY_LABELS: Record<ClosureResponsibility, string> = {
  agent_mistake: "Agent mistake",
  driver_mistake: "Driver mistake",
  system_error: "System error / data quirk",
  external_payor: "External payor decision",
  no_one_process_limit: "No one — process limit",
};

export const CLOSURE_RESPONSIBLE_ROLE_LABELS: Record<ClosureResponsibleRole, string> = {
  contact_center_manager: "Contact Center Manager",
  contractor_relations_coordinator: "Contractor Relations Coordinator",
  it_coordinator_or_coo: "IT Coordinator / COO",
};

export function closureResponsibilityLabel(value: string | null | undefined): string {
  if (!value) return "";
  return (
    CLOSURE_RESPONSIBILITY_LABELS[value as ClosureResponsibility] ?? value
  );
}

export function closureResponsibleRoleLabel(value: string | null | undefined): string {
  if (!value) return "";
  return (
    CLOSURE_RESPONSIBLE_ROLE_LABELS[value as ClosureResponsibleRole] ?? value
  );
}

export function roleForResponsibility(
  value: string | null | undefined,
): ClosureResponsibleRole | null {
  if (!value) return null;
  return RESPONSIBILITY_TO_ROLE[value as ClosureResponsibility] ?? null;
}

export function legacyTagsForResponsibility(
  value: string | null | undefined,
): string[] | null {
  if (!value) return null;
  return RESPONSIBILITY_TO_LEGACY_TAGS[value as ClosureResponsibility] ?? null;
}

export function isClosureResponsibility(
  value: unknown,
): value is ClosureResponsibility {
  return (
    typeof value === "string" &&
    (CLOSURE_RESPONSIBILITIES as readonly string[]).includes(value)
  );
}
