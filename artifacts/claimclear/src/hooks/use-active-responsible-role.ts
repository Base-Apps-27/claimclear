// Task #889 — picks the "active" responsible-party role for the
// signed-in user. Multi-role users (e.g. an IT coordinator who is
// also the COO) get a per-role filter on the /my-closures page; this
// hook reads the `?role=` URL query, falls back to the first assigned
// role, and gates the page itself for users with no responsible role.
import { useMemo } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import {
  CLOSURE_RESPONSIBLE_ROLES,
  type ClosureResponsibleRole,
} from "@workspace/vocab";

export interface ActiveResponsibleRoleState {
  roles: ClosureResponsibleRole[];
  activeRole: ClosureResponsibleRole | null;
  hasAccess: boolean;
}

function isValidRole(v: string): v is ClosureResponsibleRole {
  return (CLOSURE_RESPONSIBLE_ROLES as readonly string[]).includes(v);
}

export function useActiveResponsibleRole(
  roleFromQuery: string | null,
): ActiveResponsibleRoleState {
  const { user } = useAuth();
  return useMemo(() => {
    const roles = (user?.responsibleRoles ?? []).filter(isValidRole);
    const hasAccess = roles.length > 0;
    let activeRole: ClosureResponsibleRole | null = null;
    if (roleFromQuery && isValidRole(roleFromQuery) && roles.includes(roleFromQuery)) {
      activeRole = roleFromQuery;
    } else if (hasAccess) {
      activeRole = roles[0]!;
    }
    return { roles, activeRole, hasAccess };
  }, [user?.responsibleRoles, roleFromQuery]);
}
