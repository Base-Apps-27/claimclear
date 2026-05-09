import { WrapTooltip } from "@/components/info-tooltip";
import {
  CLAIM_STATUS,
  OUTCOME,
  INVOICE_PHASE,
  VERDICT_OUTCOME,
  SUBMISSION_STAGE,
  LEG_SUB_STATUS,
  claimStatusLabel,
  outcomeLabel,
  invoicePhaseLabel,
  submissionStageLabel,
  legSubStatusLabel,
  legSubStatusDisplayLabel,
  type LegLikeForDisplay,
} from "@workspace/vocab";
import {
  deriveLegSubStatus,
  type LegForSubStatus,
  type LegSubStatus,
} from "@workspace/leg-state";
import { TonePill } from "@/components/cohesion/tone-pill";
import { toneForRow, toneForStatus, type RowForTone, type Tone } from "@/components/cohesion/tone";

// ─────────────────────────────────────────────────────────────────────
// StateBadge — the ONLY place state pills are rendered in operator-
// facing surfaces (Task #554). One component, six variants, sourced
// from `@workspace/vocab` for label + tooltip and from the cohesion
// tone palette for color. Each pill always carries a tooltip naming
// its domain ("Phase — outer-tier lifecycle bucket", etc.) so an
// operator can never confuse "Needs Review" the workflow status with
// "Needs Review" the queue tab.
//
// Adding a new domain? Extend `StateBadgeVariant`, add helpers below,
// update the `StateLegend` popover, and document the variant in
// `docs/vocabulary.md` ("How to render state in the UI").
// ─────────────────────────────────────────────────────────────────────

export type StateBadgeVariant =
  | "phase"
  | "status"
  | "subStatus"
  | "verdict"
  | "outcome"
  | "stage";

export interface StateBadgeProps {
  variant: StateBadgeVariant;
  /** Enum value for the variant. Required for every variant except
   * `subStatus` when `leg` is provided (in which case the value is
   * derived from the row). */
  value?: string | null;
  /** subStatus only: derive value from a leg row, and use the row to
   * pick the more specific reason-aware label (e.g. "Non-contestable"
   * vs the default "Non-issue"). */
  leg?: LegForSubStatus & LegLikeForDisplay;
  /** status only: pull tone from the row's canonical `disposition`
   * column (Wave-C row-aware tone). */
  row?: RowForTone;
  className?: string;
  justTransitioned?: boolean;
  /** Optional second line appended to the badge tooltip. Used to
   * surface the underlying status alongside a phase chip when the
   * raw-status column has been collapsed into the phase pill (Task #558). */
  tooltipExtra?: string;
  "data-testid"?: string;
}

export const STATE_BADGE_DOMAIN_LABEL: Record<StateBadgeVariant, string> = {
  phase: "Phase",
  status: "Workflow status",
  subStatus: "Per-leg sub-status",
  verdict: "Per-leg verdict",
  outcome: "Outcome",
  stage: "Submission stage",
};

export const STATE_BADGE_DOMAIN_DEFINITION: Record<StateBadgeVariant, string> = {
  phase: "outer-tier lifecycle bucket of the invoice group",
  status: "claim/group workflow status — denormalized cache of phase",
  subStatus: "inner-tier per-leg state inside the Pre-submit phase",
  verdict: "per-leg payor verdict captured during response review",
  outcome: "terminal disposition of a claim or invoice group",
  stage: "portal submission stage tracked by the bot",
};

function phaseTone(phase: string | null | undefined): Tone {
  switch (phase) {
    case "triage":
    case "ready_to_submit":
    case "submitted":
    case "response_received":
      return "blue";
    case "reviewed":
    case "awaiting_reattestation":
      return "green";
    case "closed":
      return "muted";
    default:
      return "muted";
  }
}

function subStatusTone(s: LegSubStatus): Tone {
  switch (s) {
    case "investigating":
      return "blue";
    case "needs_classification":
    case "blocked":
      return "amber";
    case "ready":
      return "green";
    case "dropped":
    case "excluded":
    case "duplicate":
    case "frozen":
    default:
      return "muted";
  }
}

function verdictTone(v: string | null | undefined): Tone {
  switch (v) {
    case "approved":
    case "Approved":
    case "partially_approved":
    case "Partial":
    case "Partially Approved":
      return "green";
    case "denied":
    case "Denied":
      return "red";
    case "needs_more_info":
      return "amber";
    case "no_decision":
    default:
      return "muted";
  }
}

function outcomeTone(o: string | null | undefined): Tone {
  switch (o) {
    case "Approved":
    case "Partially Approved":
      return "green";
    case "Denied":
      return "red";
    case "Withdrawn":
    // vocab-allow-next-line — switching on the API enum value, not a UI label.
    case "Non-Issue":
    case "Pending":
    default:
      return "muted";
  }
}

function stageTone(s: string | null | undefined): Tone {
  switch (s) {
    case "submitted":
    case "in_progress":
      return "green";
    case "queued":
    case "pending":
    case "draft":
      return "blue";
    case "failed":
      return "red";
    case "cancelled":
    case "dry_run":
    default:
      return "muted";
  }
}

function labelFor(
  variant: StateBadgeVariant,
  value: string,
  leg?: LegLikeForDisplay,
): string {
  switch (variant) {
    case "phase":
      return invoicePhaseLabel(value);
    case "status":
      // Status pills are commonly fed an outcome string (Resolved,
      // Approved) on the closed lane — fall through to outcomeLabel
      // so those keep rendering correctly.
      return CLAIM_STATUS[value as keyof typeof CLAIM_STATUS]
        ? claimStatusLabel(value)
        : outcomeLabel(value) || value;
    case "subStatus":
      return leg
        ? legSubStatusDisplayLabel(value as LegSubStatus, leg)
        : legSubStatusLabel(value);
    case "verdict":
      // Tolerate both VERDICT_OUTCOME (lowercase wire enum on
      // claim_responses) and OUTCOME (TitleCase wire enum on
      // claim_verdict) — same vocabulary, different tables.
      return (
        VERDICT_OUTCOME[value as keyof typeof VERDICT_OUTCOME]?.label ??
        OUTCOME[value as keyof typeof OUTCOME]?.label ??
        value
      );
    case "outcome":
      return outcomeLabel(value);
    case "stage":
      return submissionStageLabel(value);
  }
}

function descriptionFor(
  variant: StateBadgeVariant,
  value: string,
): string | undefined {
  switch (variant) {
    case "phase":
      return INVOICE_PHASE[value as keyof typeof INVOICE_PHASE]?.description;
    case "status":
      return (
        CLAIM_STATUS[value as keyof typeof CLAIM_STATUS]?.description ??
        OUTCOME[value as keyof typeof OUTCOME]?.description
      );
    case "subStatus":
      return LEG_SUB_STATUS[value as LegSubStatus]?.description;
    case "verdict":
      return (
        VERDICT_OUTCOME[value as keyof typeof VERDICT_OUTCOME]?.description ??
        OUTCOME[value as keyof typeof OUTCOME]?.description
      );
    case "outcome":
      return OUTCOME[value as keyof typeof OUTCOME]?.description;
    case "stage":
      return SUBMISSION_STAGE[value as keyof typeof SUBMISSION_STAGE]
        ?.description;
  }
}

function toneFor(
  variant: StateBadgeVariant,
  value: string,
  row?: RowForTone,
): Tone {
  switch (variant) {
    case "phase":
      return phaseTone(value);
    case "status":
      return row ? toneForRow(row) : toneForStatus(value);
    case "subStatus":
      return subStatusTone(value as LegSubStatus);
    case "verdict":
      return verdictTone(value);
    case "outcome":
      return outcomeTone(value);
    case "stage":
      return stageTone(value);
  }
}

export function StateBadge({
  variant,
  value,
  leg,
  row,
  className,
  justTransitioned,
  tooltipExtra,
  "data-testid": dataTestId,
}: StateBadgeProps) {
  const resolvedValue =
    value ?? (variant === "subStatus" && leg ? deriveLegSubStatus(leg) : "");
  if (!resolvedValue) return null;

  const label = labelFor(variant, resolvedValue, leg);
  const description = descriptionFor(variant, resolvedValue);
  const tone = toneFor(variant, resolvedValue, row);
  const baseTooltip = `${STATE_BADGE_DOMAIN_LABEL[variant]} — ${
    description ?? STATE_BADGE_DOMAIN_DEFINITION[variant]
  }`;
  const tooltip = tooltipExtra ? `${baseTooltip} · ${tooltipExtra}` : baseTooltip;

  return (
    <WrapTooltip content={tooltip}>
      <span className="inline-flex cursor-help">
        <TonePill
          tone={tone}
          className={className}
          justTransitioned={justTransitioned}
          data-testid={dataTestId ?? `state-badge-${variant}-${resolvedValue}`}
        >
          {label}
        </TonePill>
      </span>
    </WrapTooltip>
  );
}
