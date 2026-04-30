import type { ReactNode } from "react";
import { TONE_STYLE, toneForStatus, type Tone } from "./tone";
import { WrapTooltip } from "@/components/info-tooltip";

const statusDescriptions: Record<string, string> = {
  "New": "Claim just entered the system. Next: Review the claim details and move to evidence gathering.",
  "Needs Review": "Claim imported with no error details. Check the portal, then classify as non-issue or define the error type.",
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
  "Non-Issue": "Classified as non-issue. No action needed — financial impact set to $0.",
};

export type StatusPillProps = {
  tone?: Tone;
  children: ReactNode;
  className?: string;
};

export function StatusPill({ tone = "muted", children, className = "" }: StatusPillProps) {
  const c = TONE_STYLE[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${className}`}
      style={{ background: c.bg, color: c.fg }}
    >
      {children}
    </span>
  );
}

export type StatusPillForStatusProps = {
  status: string;
  className?: string;
};

export function StatusPillForStatus({ status, className }: StatusPillForStatusProps) {
  const tone = toneForStatus(status);
  const description = statusDescriptions[status];
  const pill = <StatusPill tone={tone} className={className}>{status}</StatusPill>;
  if (!description) return pill;
  return (
    <WrapTooltip content={description}>
      <span className="cursor-help">{pill}</span>
    </WrapTooltip>
  );
}
