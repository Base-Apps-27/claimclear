// Pure helpers driving the SOP terminal renderer. Source of truth for
// terminal selection is `outcomeRole` from @workspace/leg-state.

import { outcomeRole, type LegForOutcomeRole } from "@workspace/leg-state";

export type TerminalKind = "include" | "closed" | "hold" | "duplicate" | "none";

export function terminalKindForLeg(leg: LegForOutcomeRole): TerminalKind {
  const role = outcomeRole(leg);
  switch (role) {
    case "include":
      return "include";
    case "cannot_dispute":
    case "non_issue":
    case "internal":
      return "closed";
    case "hold":
      return "hold";
    case "duplicate":
      return "duplicate";
    case "none":
      return "none";
  }
}

// Channel hint for the include terminal — derived from error_type,
// never from sopOutcome (Guard #2/#9).

export type ChannelHint =
  | { kind: "configured"; channel: "portal" | "email" }
  | { kind: "missing" };

export interface ErrorTypeChannelInput {
  useDirectEmail?: boolean | null;
}

export function channelHintForErrorType(
  errorType?: ErrorTypeChannelInput | null,
): ChannelHint {
  if (!errorType) return { kind: "missing" };
  const direct = errorType.useDirectEmail;
  if (direct === true) return { kind: "configured", channel: "email" };
  if (direct === false) return { kind: "configured", channel: "portal" };
  return { kind: "missing" };
}

export function channelHintLabel(hint: ChannelHint): string {
  if (hint.kind === "missing") return "Channel: not configured";
  return hint.channel === "email" ? "Channel: via email" : "Channel: via portal";
}
