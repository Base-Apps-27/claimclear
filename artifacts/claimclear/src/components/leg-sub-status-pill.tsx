import {
  type LegForSubStatus,
  type LegSubStatus,
} from "@workspace/leg-state";
import { legSubStatusLabel as glossarySubStatusLabel } from "@workspace/vocab";
import { StateBadge } from "@/components/state-badge";

// Thin facade over `<StateBadge variant="subStatus" …>`. Kept so the
// many in-tree call sites (group legs panel, queue per-leg row, leg
// conclusion row) don't all need to import StateBadge directly. The
// rendering, label, and tooltip all flow through StateBadge — Task #554
// makes StateBadge the single state-pill renderer in operator-facing
// surfaces.

interface LegSubStatusPillProps {
  subStatus?: LegSubStatus;
  leg?: LegForSubStatus;
  className?: string;
  justTransitioned?: boolean;
}

export function LegSubStatusPill({
  subStatus,
  leg,
  className = "",
  justTransitioned = false,
}: LegSubStatusPillProps) {
  return (
    <StateBadge
      variant="subStatus"
      value={subStatus}
      leg={leg}
      className={className}
      justTransitioned={justTransitioned}
    />
  );
}

// Re-export the glossary helper under the local name so existing
// importers continue to compile. New code should import directly from
// `@workspace/vocab`.
export { glossarySubStatusLabel as legSubStatusLabel };
