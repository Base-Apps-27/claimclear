import type { GlossaryEntry } from "./domains";

// ─────────────────────────────────────────────────────────────────────────
// Portal-submission stage. Underlying enum: DB column `status` on
// `portal_submissions`.
//
// COLLISION DECISION: "Pending" here is *not* the same as the *outcome*
// "Pending" — submission-stage.pending means "drafted and about to be
// queued", while outcome.pending means "no terminal verdict yet". We
// keep both labels identical because the contexts are visually distinct
// (Submissions page vs. claim/group outcome chip), and renaming one
// would force schema changes the task explicitly forbids.
// "Queued" / "Submitted" are likewise unique to this domain.
// ─────────────────────────────────────────────────────────────────────────

export const SUBMISSION_STAGES = [
  "draft",
  "pending",
  "queued",
  "in_progress",
  "submitted",
  "failed",
  "cancelled",
  "dry_run",
] as const;

export type SubmissionStage = typeof SUBMISSION_STAGES[number];

export const SUBMISSION_STAGE: Record<SubmissionStage, GlossaryEntry> = {
  draft: {
    enumValue: "draft",
    label: "Draft",
    description: "Submission has been generated but not yet queued for the portal.",
    domain: "submission_stage",
  },
  pending: {
    enumValue: "pending",
    label: "Pending",
    description: "Submission is approved and waiting for the next portal batch to pick it up.",
    domain: "submission_stage",
  },
  queued: {
    enumValue: "queued",
    label: "Queued",
    description: "Submission is in the bot's queue, about to be sent to the portal.",
    domain: "submission_stage",
  },
  in_progress: {
    enumValue: "in_progress",
    label: "In Progress",
    description: "Bot is actively interacting with the portal for this submission.",
    domain: "submission_stage",
  },
  submitted: {
    enumValue: "submitted",
    label: "Submitted",
    description: "Submission completed successfully and is now waiting on a payor response.",
    domain: "submission_stage",
  },
  failed: {
    enumValue: "failed",
    label: "Failed",
    description: "Submission attempt failed. Review the error and either retry or fall back to manual handling.",
    domain: "submission_stage",
  },
  cancelled: {
    enumValue: "cancelled",
    label: "Cancelled",
    description: "Submission was cancelled before being sent to the portal.",
    domain: "submission_stage",
  },
  dry_run: {
    enumValue: "dry_run",
    label: "Dry Run",
    description: "Submission was a rehearsal — the bot walked the portal but did not actually send anything.",
    domain: "submission_stage",
  },
};

export function submissionStageLabel(stage: string): string {
  return SUBMISSION_STAGE[stage as SubmissionStage]?.label ?? stage;
}
