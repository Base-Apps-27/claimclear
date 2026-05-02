import { Badge } from "@/components/ui/badge";
import { WrapTooltip } from "@/components/info-tooltip";
import {
  CLAIM_STATUS,
  OUTCOME,
  claimStatusLabel,
  outcomeLabel,
} from "@workspace/vocab";

// Description map sourced from @workspace/vocab so a single edit to the
// glossary updates every tooltip in the app.
const statusDescriptions: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const entry of Object.values(CLAIM_STATUS)) out[entry.enumValue] = entry.description;
  for (const entry of Object.values(OUTCOME)) out[entry.enumValue] = entry.description;
  return out;
})();

type StatusBadgeProps = {
  status: string;
  className?: string;
};

// Color palette stays here — it's a presentation concern next to the JSX.
const STATUS_COLORS: Record<string, string> = {
  "New": "bg-blue-100 text-blue-800 border-blue-200",
  "Needs Review": "bg-orange-100 text-orange-800 border-orange-200",
  "Needs Evidence": "bg-amber-100 text-amber-800 border-amber-200",
  "Generating Email": "bg-indigo-100 text-indigo-800 border-indigo-200",
  "Ready to Review": "bg-cyan-100 text-cyan-800 border-cyan-200",
  "Awaiting Response": "bg-violet-100 text-violet-800 border-violet-200",
  "On Hold": "bg-purple-100 text-purple-800 border-purple-200",
  // MAS Eligible: positive MAS portal verdict (carrier owes), but
  // re-attestation in MAS still owed. Emerald sits between the
  // green of "Resolved" and the cyan of "Ready to Review" — a
  // verdict has landed but it's not closed yet.
  "MAS Eligible": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "Resolved": "bg-green-100 text-green-800 border-green-200",
  "Denied": "bg-red-100 text-red-800 border-red-200",
  "Pending": "bg-gray-100 text-gray-800 border-gray-200",
  "Approved": "bg-green-100 text-green-800 border-green-200",
  "Partially Approved": "bg-lime-100 text-lime-800 border-lime-200",
  // The "Non-Issue" enum (TitleCase) is the lookup key here — display
  // label comes from the glossary below. vocab-allow-next-line
  "Non-Issue": "bg-slate-100 text-slate-800 border-slate-200",
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colorClass = STATUS_COLORS[status] ?? "bg-gray-100 text-gray-800 border-gray-200";
  const label = CLAIM_STATUS[status as keyof typeof CLAIM_STATUS]
    ? claimStatusLabel(status)
    : outcomeLabel(status) || status;
  const description = statusDescriptions[status];

  if (description) {
    return (
      <WrapTooltip content={description}>
        <Badge variant="outline" className={`${colorClass} ${className} font-medium tracking-tight shadow-none cursor-help`}>
          {label}
        </Badge>
      </WrapTooltip>
    );
  }

  return (
    <Badge variant="outline" className={`${colorClass} ${className} font-medium tracking-tight shadow-none`}>
      {label}
    </Badge>
  );
}
