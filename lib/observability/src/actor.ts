export type TransitionActor =
  | { kind: "user"; email: string; name: string | null }
  | { kind: "system"; scope: string };

export type LegacyActorShape = {
  userEmail: string | null;
  userName: string | null;
};

export function toLegacyActor(actor: TransitionActor): LegacyActorShape {
  if (actor.kind === "user") {
    return { userEmail: actor.email, userName: actor.name };
  }
  return { userEmail: `system@${actor.scope}`, userName: null };
}

export function fromLegacyActor(legacy: LegacyActorShape): TransitionActor {
  const email = legacy.userEmail;
  if (email == null || email === "system" || email.startsWith("system@")) {
    const scope = email == null || email === "system" ? "unknown" : email.slice("system@".length);
    return { kind: "system", scope };
  }
  return { kind: "user", email, name: legacy.userName };
}
