import { Badge } from "@/components/ui/badge";
import { WrapTooltip } from "@/components/info-tooltip";

const statusDescriptions: Record<string, string> = {
  "New": "Claim just entered the system. Next: Review the claim details and move to evidence gathering.",
  "Needs Evidence": "Evidence must be collected before this claim can proceed. Next: Gather GPS logs, driver statements, and supporting documents.",
  "Generating Email": "The system is generating a dispute email for this claim. Next: Wait for email generation to complete, then review.",
  "Ready to Review": "The dispute email or submission is ready for staff review. Next: Review the generated content and approve or edit before sending.",
  "Awaiting Response": "Dispute has been submitted to the payor portal. Next: Wait for the payor's response — check back periodically.",
  "On Hold": "Claim is paused, usually waiting for additional information. Next: Follow up on the pending item and resume processing.",
  "Resolved": "Claim has been successfully resolved with a favorable outcome. No further action needed.",
  "Denied": "The dispute was denied by the payor. Review if a re-dispute or appeal is possible.",
  "Portal Queued": "Claim is queued for automated portal submission. Next: The bot will pick this up and submit it.",
  "Pending": "Outcome has not yet been determined. The claim is still being processed.",
  "Approved": "The payor approved the dispute. Funds should be recovered.",
  "Partially Approved": "The payor approved part of the disputed amount. Review the approved amount vs. claimed.",
};

type StatusBadgeProps = {
  status: string;
  className?: string;
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  let colorClass = "bg-gray-100 text-gray-800 border-gray-200";

  switch (status) {
    case "New":
      colorClass = "bg-blue-100 text-blue-800 border-blue-200";
      break;
    case "Needs Evidence":
      colorClass = "bg-amber-100 text-amber-800 border-amber-200";
      break;
    case "Generating Email":
      colorClass = "bg-indigo-100 text-indigo-800 border-indigo-200";
      break;
    case "Ready to Review":
      colorClass = "bg-cyan-100 text-cyan-800 border-cyan-200";
      break;
    case "Awaiting Response":
      colorClass = "bg-violet-100 text-violet-800 border-violet-200";
      break;
    case "On Hold":
      colorClass = "bg-purple-100 text-purple-800 border-purple-200";
      break;
    case "Resolved":
      colorClass = "bg-green-100 text-green-800 border-green-200";
      break;
    case "Denied":
      colorClass = "bg-red-100 text-red-800 border-red-200";
      break;
    case "Pending":
      colorClass = "bg-gray-100 text-gray-800 border-gray-200";
      break;
    case "Approved":
      colorClass = "bg-green-100 text-green-800 border-green-200";
      break;
    case "Partially Approved":
      colorClass = "bg-lime-100 text-lime-800 border-lime-200";
      break;
  }

  const description = statusDescriptions[status];

  if (description) {
    return (
      <WrapTooltip content={description}>
        <Badge variant="outline" className={`${colorClass} ${className} font-medium tracking-tight shadow-none cursor-help`}>
          {status}
        </Badge>
      </WrapTooltip>
    );
  }

  return (
    <Badge variant="outline" className={`${colorClass} ${className} font-medium tracking-tight shadow-none`}>
      {status}
    </Badge>
  );
}
