import { Link } from "wouter";
import type {
  GroupAttestationHistoryEntry,
  GroupAttestationHistoryLeg,
} from "@workspace/api-client-react";
import {
  Section,
  TonePill,
  TONE_STYLE,
  type Tone,
} from "@/components/cohesion";
import { StateBadge } from "@/components/state-badge";
import {
  ExternalLink,
  CheckCircle2,
  Ban,
  Clock,
  CircleDashed,
} from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";

const OUTCOME_META: Record<
  GroupAttestationHistoryLeg["attestationOutcome"],
  {
    label: string;
    timeLabel: string;
    icon: typeof CheckCircle2;
    tone: Tone;
  }
> = {
  attested: {
    label: "Re-attested",
    timeLabel: "Attested",
    icon: CheckCircle2,
    tone: "green",
  },
  mas_cancelled: {
    label: "MAS cancelled",
    timeLabel: "Cancelled",
    icon: Ban,
    tone: "red",
  },
  queued: {
    label: "Queued for portal user",
    timeLabel: "Queued",
    icon: Clock,
    tone: "blue",
  },
  not_required: {
    label: "Not required",
    timeLabel: "—",
    icon: CircleDashed,
    tone: "muted",
  },
};

export function earliestServiceDate(
  legs: GroupAttestationHistoryLeg[],
): string | null {
  let earliest: string | null = null;
  for (const leg of legs) {
    const d = leg.claim.date ?? null;
    if (!d) continue;
    if (!earliest || d < earliest) earliest = d;
  }
  return earliest;
}

export function CompletedDetailPane({
  entry,
}: {
  entry: GroupAttestationHistoryEntry;
}) {
  const { group, legs } = entry;
  return (
    <div data-testid={`completed-detail-${group.id}`}>
      <Section padded={false}>
        <div className="p-5 space-y-5">
          <header className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-mono text-xl font-semibold tracking-tight">
                  {group.invoiceNumber}
                </h3>
                <TonePill
                  tone="green"
                  className="text-[10px] uppercase tracking-wide font-bold"
                >
                  Re-attested
                </TonePill>
              </div>
              <div className="text-sm text-muted-foreground">
                Payor{" "}
                <span className="font-medium text-foreground">
                  {group.clientNumber ?? "—"}
                </span>
                {" · "}
                {group.errorTypeName ?? "Unclassified"}
              </div>
            </div>
            <Link
              href={`/invoice-groups/${group.id}`}
              className="text-sm text-primary hover:underline inline-flex items-center gap-1.5 shrink-0"
              data-testid={`completed-detail-open-${group.id}`}
            >
              Open invoice group <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </header>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <Field label="Payor">{group.clientNumber ?? "—"}</Field>
            <Field label="Earliest service">
              {formatDate(earliestServiceDate(legs))}
            </Field>
            <Field label="Confirmed">
              {group.reattestCompletedAt
                ? formatDateTime(group.reattestCompletedAt)
                : "—"}
            </Field>
            <Field label="Confirmed by">
              {group.reattestCompletedBy ?? "—"}
            </Field>
          </dl>

          {group.reattestNote && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <div className="text-[11px] uppercase tracking-wide font-bold text-muted-foreground">
                Re-attest note
              </div>
              <div className="mt-1 whitespace-pre-wrap">
                {group.reattestNote}
              </div>
            </div>
          )}

          <section className="space-y-2.5">
            <h4 className="text-[11px] uppercase tracking-wide font-bold text-muted-foreground">
              Per-leg outcomes
            </h4>
            <OutcomeLegend />
            <ul className="space-y-2" data-testid="completed-legs">
              {legs.map((leg) => (
                <CompletedLegRow key={leg.claim.id} leg={leg} />
              ))}
            </ul>
          </section>
        </div>
      </Section>
    </div>
  );
}

function OutcomeLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {(["attested", "mas_cancelled", "queued", "not_required"] as const).map(
        (k) => {
          const m = OUTCOME_META[k];
          return (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: TONE_STYLE[m.tone].fg }}
                aria-hidden="true"
              />
              {m.label}
            </span>
          );
        },
      )}
    </div>
  );
}

function CompletedLegRow({ leg }: { leg: GroupAttestationHistoryLeg }) {
  const { claim, attestationOutcome, outcomeAt, outcomeBy, outcomeNote } = leg;
  const meta = OUTCOME_META[attestationOutcome];
  const Icon = meta.icon;
  const c = TONE_STYLE[meta.tone];
  return (
    <li
      className="flex items-start gap-3 rounded-md border px-3 py-2 text-xs"
      style={{ borderColor: c.border, background: c.bg }}
      data-testid={`completed-leg-${claim.id}`}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0" style={{ color: c.fg }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium">
            {claim.confNumber}
          </span>
          <StateBadge
            variant="outcome"
            value={claim.outcome}
            className="text-[10px] uppercase tracking-wide font-bold"
          />
          <TonePill
            tone={meta.tone}
            className="text-[10px] uppercase tracking-wide font-bold"
            data-testid={`completed-leg-outcome-${claim.id}`}
          >
            {meta.label}
          </TonePill>
        </div>
        <div className="text-muted-foreground mt-1 space-y-0.5">
          {outcomeAt && (
            <div>
              {meta.timeLabel} {formatDateTime(outcomeAt)}
              {outcomeBy ? ` · ${outcomeBy}` : ""}
            </div>
          )}
          {outcomeNote && (
            <div className="italic break-words">"{outcomeNote}"</div>
          )}
        </div>
      </div>
      <Link
        href={`/claims/${claim.id}`}
        className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 shrink-0"
        data-testid={`completed-leg-open-${claim.id}`}
      >
        Open <ExternalLink className="h-3 w-3" />
      </Link>
    </li>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium truncate">{children}</dd>
    </div>
  );
}
