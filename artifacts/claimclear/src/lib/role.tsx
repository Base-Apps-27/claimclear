import { useAuth } from "@workspace/replit-auth-web";
import type { ReactNode } from "react";
import {
  type Role,
  isClerk,
  isAdmin,
  canSeeAmounts,
  canDoBulk,
  canEditSetup,
} from "./role-helpers";

export {
  type Role,
  isClerk,
  isAdmin,
  canSeeAmounts,
  canDoBulk,
  canEditSetup,
};

export function useRole() {
  const { user } = useAuth();
  return {
    user,
    role: (user?.role ?? null) as Role | null,
    isAdmin: isAdmin(user),
    isClerk: isClerk(user),
    canSeeAmounts: canSeeAmounts(user),
    canDoBulk: canDoBulk(user),
    canEditSetup: canEditSetup(user),
  };
}

export function HideForClerk({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { isClerk: clerk } = useRole();
  if (clerk) return <>{fallback}</>;
  return <>{children}</>;
}
