import { SlideShell, StatusPill } from "@/components/slide-ui";

const STATUSES = [
  {
    label: "Needs Review",
    kind: "amber" as const,
    when: "Right after upload",
    means: "We don't yet know if this is a real issue. Classify it in the Review Queue.",
  },
  {
    label: "Needs Evidence",
    kind: "orange" as const,
    when: "After classification = Issue Found",
    means: "Real dispute. You owe it data, evidence, and a workflow run.",
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
    means: "AI letter or portal preview is ready. Read it, then approve or regenerate.",
  },
  {
    label: "Portal Queued",
    kind: "blue" as const,
    when: "After you approve and send",
    means: "Waiting in line for a bot to file the dispute on the payor portal.",
  },
  {
    label: "In Progress",
    kind: "violet" as const,
    when: "Bot is actively working",
    means: "A bot is filling out the form right now. The bot-presence banner shows on the claim.",
  },
  {
    label: "Awaiting Response",
    kind: "violet" as const,
    when: "Bot finished submitting",
    means: "Payor has the dispute. Just wait — usually 7–14 days.",
  },
  {
    label: "On Hold",
    kind: "muted" as const,
    when: "You paused it",
    means: "Missing info, waiting on a driver/dispatcher. Resume when ready.",
  },
  {
    label: "Resolved",
    kind: "green" as const,
    when: "Recovered or accepted",
    means: "Closed with a positive outcome — money recovered, or accepted as a loss after a denial.",
  },
  {
    label: "Denied",
    kind: "red" as const,
    when: "Payor rejected dispute",
    means: "Closure reason: payer_denied. Decide: accept loss, re-dispute, or submit a new invoice.",
  },
  {
    label: "Withdrawn",
    kind: "muted" as const,
    when: "We closed it on our side",
    means: "Closure exit: Cannot Dispute, Accepted Loss, or Non-Issue. The row lands in Withdrawals Review for supervisor sign-off and lessons-learned.",
  },
];

export default function StatusLifecycle() {
  return (
    <SlideShell
      eyebrow="Reference"
      step={2}
      totalSteps={22}
      title="The Status Badges, Decoded"
      subtitle="Every claim and invoice group has a colored status. Here's what each one means and what action it expects from you."
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
              style={{ padding: "1.5vh 1.1vw" }}
            >
              <div
                className="flex items-center justify-between"
                style={{ marginBottom: "0.8vh" }}
              >
                <StatusPill label={s.label} kind={s.kind} size="md" />
              </div>
              <p
                className="font-display text-primary font-semibold"
                style={{ fontSize: "0.9vw" }}
              >
                {s.when}
              </p>
              <p
                className="font-body text-muted"
                style={{
                  fontSize: "0.9vw",
                  marginTop: "0.6vh",
                  lineHeight: "1.45",
                }}
              >
                {s.means}
              </p>
            </div>
          ))}
        </div>
      </div>
    </SlideShell>
  );
}
