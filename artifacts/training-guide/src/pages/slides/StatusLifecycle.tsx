import { SlideShell, StatusPill } from "@/components/slide-ui";

const STATUSES = [
  {
    label: "New",
    kind: "blue" as const,
    when: "Just imported",
    means: "Fresh from MAS. No one has touched it yet — it shows up in the Review Queue with the raw error attached.",
  },
  {
    label: "Needs Review",
    kind: "amber" as const,
    when: "Imported with no error details",
    means: "We don't yet know if this is a real issue. Open the Review Queue and either pick an Error Type or take a Stage 1 closure exit (Non-Issue or Cannot Dispute).",
  },
  {
    label: "Needs Evidence",
    kind: "orange" as const,
    when: "After Error Type is assigned",
    means: "Real dispute. The leg's disposition is now `classifying` — walk the SOP and attach evidence in the Work Queue.",
  },
  {
    label: "Generating Email",
    kind: "blue" as const,
    when: "Workflow finished, AI is drafting",
    means: "ClaimClear is writing the dispute email. Usually a few seconds — don't navigate away.",
  },
  {
    label: "Ready to Review",
    kind: "amber" as const,
    when: "Draft is waiting on you",
    means: "AI letter or portal preview is ready. Read it, then approve to send or regenerate.",
  },
  {
    label: "Portal Queued",
    kind: "blue" as const,
    when: "After you approve and send",
    means: "Invoice phase is `ready_to_submit`. It sits in line for a bot to file the dispute on the payor portal — phase advances to `submitted` once the bot actually files.",
  },
  {
    label: "Awaiting Response",
    kind: "violet" as const,
    when: "Bot finished submitting",
    means: "Invoice phase is `submitted`. Payor has the dispute — usually 7–14 days. ClaimClear watches the Email Thread and auto-flips status when a substantive reply arrives.",
  },
  {
    label: "On Hold",
    kind: "muted" as const,
    when: "You paused it",
    means: "A `hold_reason` flag suspends the normal phase advancement. Use when you're waiting on a driver, dispatcher, or evidence. Resume when ready.",
  },
  {
    label: "Processed",
    kind: "muted" as const,
    when: "Leg done, invoice not yet packaged",
    means: "This leg's worktree is complete but its sibling legs aren't. Finish the others, then click Ready to package on the invoice.",
  },
  {
    label: "MAS Eligible",
    kind: "violet" as const,
    when: "Approved verdict needs MAS sign-off",
    means: "Invoice phase is `awaiting_reattestation`. The payor said yes, but funds don't release until you re-attest in MAS. Complete the attestation, then mark Resolved.",
  },
  {
    label: "Resolved",
    kind: "green" as const,
    when: "Terminal — favorable close",
    means: "Invoice phase is `closed`. Either money was recovered (operator-confirmed) or the case closed as Non-Issue (closure_reason `non_issue`). Never auto-set; always a human verdict.",
  },
  {
    label: "Denied",
    kind: "red" as const,
    when: "Terminal — payor rejected us",
    means: "Invoice phase is `closed` with closure_reason `denied_by_payor`. Lands in Withdrawals Review for supervisor sign-off and lessons learned.",
  },
];

export default function StatusLifecycle() {
  return (
    <SlideShell
      eyebrow="Reference"
      step={2}
      totalSteps={22}
      title="The Status Badges, Decoded"
      subtitle="Every claim and invoice group has a colored status badge. Under the hood, ClaimClear tracks two canonical things — the invoice's phase and each leg's disposition — and the badge is the operator-facing projection. Here's what each badge means and what action it expects from you."
    >
      <div className="flex-1">
        <div
          className="grid grid-cols-3 gap-[1vw]"
          style={{ marginTop: "0.5vh" }}
        >
          {STATUSES.map((s) => (
            <div
              key={s.label}
              className="bg-white rounded-[0.7vw] border border-primary/10"
              style={{ padding: "1.3vh 1.1vw" }}
            >
              <div
                className="flex items-center justify-between"
                style={{ marginBottom: "0.6vh" }}
              >
                <StatusPill label={s.label} kind={s.kind} size="md" />
              </div>
              <p
                className="font-display text-primary font-semibold"
                style={{ fontSize: "0.85vw" }}
              >
                {s.when}
              </p>
              <p
                className="font-body text-muted"
                style={{
                  fontSize: "0.78vw",
                  marginTop: "0.5vh",
                  lineHeight: "1.4",
                }}
              >
                {s.means}
              </p>
            </div>
          ))}
        </div>
        <div
          className="bg-primary/5 rounded-[0.5vw] border border-primary/10"
          style={{ padding: "1vh 1.2vw", marginTop: "1.2vh" }}
        >
          <p
            className="font-body text-primary"
            style={{ fontSize: "0.85vw", lineHeight: "1.45" }}
          >
            <span className="font-display font-bold">Closures don't have their own badge.</span>{" "}
            Cannot Dispute and Non-Issue (Stage 1, before submission) and Denied by Payor (Stage 2, after the payor rejects us) all close the invoice — the badge becomes Resolved or Denied and the closure_reason field carries the detail. All three land in Withdrawals Review.
          </p>
        </div>
      </div>
    </SlideShell>
  );
}
