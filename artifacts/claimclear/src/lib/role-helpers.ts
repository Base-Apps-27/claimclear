export type Role = "admin" | "user" | "clerk";

type RoleLike = { role?: string | null } | null | undefined;

export function isClerk(user: RoleLike): boolean {
  return user?.role === "clerk";
}

export function isAdmin(user: RoleLike): boolean {
  return user?.role === "admin";
}

export function canSeeAmounts(user: RoleLike): boolean {
  return !isClerk(user);
}

export function canDoBulk(user: RoleLike): boolean {
  return !isClerk(user);
}

export function canEditSetup(user: RoleLike): boolean {
  return !isClerk(user);
}
