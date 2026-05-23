import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  PauseCircle,
  AlertTriangle,
  Clock,
  Paperclip,
  Inbox,
  Loader2,
} from "lucide-react";
import {
  useRemoveInvoiceGroupHold,
  getGetInvoiceGroupQueryKey,
  getListInvoiceGroupsQueryKey,
  type InvoiceGroupResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast, successToast } from "@/hooks/use-toast";

// Task #837 — `GroupActionBanner` is the single contextual blocker
// banner that sits directly under the hero on the invoice-group detail
// page. It replaces a scatter of inline pills/badges/tooltips with one
// named state, one plain-English reason, and one primary action button.
//
// Variants are derived purely from columns already on `InvoiceGroupResponse`
// — no new schema. Precedence is operator-set first (hold), then
// time-driven (stuck, expiring), then drafting blockers (needs evidence),
// then soft "wait" states (awaiting payor again). When none of those
// apply, the banner renders nothing — default-state groups stay clean.

type Tone = "amber" | "red" | "blue" | "purple";

type Variant = {
  key:
    | "on-hold"
    | "stuck"
    | "expiring-today"
    | "needs-evidence"
    | "awaiting-payor-again";
  tone: Tone;
  icon: ReactNode;
  title: string;
  reason: string;
  action: ReactNode;
};

const TONE: Record<Tone, { bg: string; fg: string; border: string }> = {
  amber: {
    bg: "var(--cc-amber-bg)",
    fg: "var(--cc-amber-fg)",
    border: "var(--cc-amber-border)",
  },
  red: {
    bg: "var(--cc-red-bg)",
    fg: "var(--cc-red-fg)",
    border: "var(--cc-red-border)",
  },
  blue: {
    bg: "var(--cc-blue-bg)",
    fg: "var(--cc-blue-fg)",
    border: "var(--cc-blue-border)",
  },
  purple: {
    bg: "var(--cc-purple-bg)",
    fg: "var(--cc-purple-fg)",
    border: "var(--cc-purple-border)",
  },
};

function isPreSubmitStatus(status: string | null | undefined): boolean {
  return (
    status === "New" ||
    status === "Needs Evidence" ||
    status === "Processed" ||
    status === "Generating Email"
  );
}

function pickVariant(
  group: InvoiceGroupResponse,
  onClearHold: () => void,
  clearingHold: boolean,
): Variant | null {
  const groupId = group.id;
  const queueHref = `/queue?groupId=${groupId}`;

  // 1. Operator-set: hold trumps everything else. Even if the deadline
  //    is ticking, the hold is the explicit thing the operator parked.
  if (group.status === "On Hold" || group.holdReason) {
    return {
      key: "on-hold",
      tone: "amber",
      icon: <PauseCircle className="w-4 h-4 mt-0.5 shrink-0" />,
      title: "On hold",
      reason: group.holdReason
        ? `Paused: ${group.holdReason}. The deadline clock is still ticking.`
        : "Paused by an operator. The deadline clock is still ticking.",
      action: (
        <button
          type="button"
          className="cc-btn cc-btn-sm font-semibold inline-flex items-center gap-1.5"
          style={{
            background: "rgba(255,255,255,0.6)",
            color: TONE.amber.fg,
            borderColor: TONE.amber.border,
          }}
          onClick={onClearHold}
          disabled={clearingHold}
          data-testid="group-action-banner-action"
        >
          {clearingHold && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Clear hold
        </button>
      ),
    };
  }

  // 2. Time-driven: submitted but the payor never acknowledged before
  //    the deadline. Mutually exclusive with `isUrgent` server-side.
  if (group.submittedStuck) {
    return {
      key: "stuck",
      tone: "red",
      icon: <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />,
      title: "Stuck after submission",
      reason:
        "Filed, but the payor never acknowledged before the deadline. Re-check the portal and nudge them.",
      action: (
        <Link
          href={queueHref}
          className="cc-btn cc-btn-sm font-semibold"
          style={{
            background: "rgba(255,255,255,0.6)",
            color: TONE.red.fg,
            borderColor: TONE.red.border,
          }}
          data-testid="group-action-banner-action"
        >
          Re-check portal
        </Link>
      ),
    };
  }

  // 3. Deadline is today (and we're still pre-submit — once filed, the
  //    stuck branch above covers it).
  if (group.isUrgent && isPreSubmitStatus(group.status)) {
    return {
      key: "expiring-today",
      tone: "red",
      icon: <Clock className="w-4 h-4 mt-0.5 shrink-0" />,
      title: "Expiring today",
      reason:
        "The filing deadline is today. File now — tomorrow is too late.",
      action: (
        <Link
          href={queueHref}
          className="cc-btn cc-btn-sm font-semibold"
          style={{
            background: "rgba(255,255,255,0.6)",
            color: TONE.red.fg,
            borderColor: TONE.red.border,
          }}
          data-testid="group-action-banner-action"
        >
          File today
        </Link>
      ),
    };
  }

  // 4. Drafting blocker: explicit "Needs Evidence" status.
  if (group.status === "Needs Evidence") {
    return {
      key: "needs-evidence",
      tone: "purple",
      icon: <Paperclip className="w-4 h-4 mt-0.5 shrink-0" />,
      title: "Needs evidence",
      reason:
        "At least one leg is missing supporting documents. Attach them so the draft can go out.",
      action: (
        <Link
          href={queueHref}
          className="cc-btn cc-btn-sm font-semibold"
          style={{
            background: "rgba(255,255,255,0.6)",
            color: TONE.purple.fg,
            borderColor: TONE.purple.border,
          }}
          data-testid="group-action-banner-action"
        >
          Add evidence
        </Link>
      ),
    };
  }

  // 5. Soft wait: the operator already replied; we're holding for the
  //    payor's next move. Sourced from `awaitingPayorAgainAt`, set on
  //    Responses Awaiting Review when the operator clicks "I replied".
  if (group.awaitingPayorAgainAt) {
    return {
      key: "awaiting-payor-again",
      tone: "blue",
      icon: <Inbox className="w-4 h-4 mt-0.5 shrink-0" />,
      title: "Awaiting payor again",
      reason:
        "You replied. Waiting on the payor's next response — no action needed right now.",
      action: (
        <a
          href="#invoice-thread"
          className="cc-btn cc-btn-sm font-semibold"
          style={{
            background: "rgba(255,255,255,0.6)",
            color: TONE.blue.fg,
            borderColor: TONE.blue.border,
          }}
          data-testid="group-action-banner-action"
        >
          Open thread
        </a>
      ),
    };
  }

  return null;
}

export function GroupActionBanner({
  group,
}: {
  group: InvoiceGroupResponse;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const removeHold = useRemoveInvoiceGroupHold();

  function onClearHold() {
    removeHold.mutate(
      { id: group.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetInvoiceGroupQueryKey(group.id),
          });
          queryClient.invalidateQueries({
            queryKey: getListInvoiceGroupsQueryKey(),
          });
          successToast({ title: "__VERB__", description: "Hold cleared." });
        },
        onError: (err: unknown) =>
          toast({
            title: "Failed to clear hold",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          }),
      },
    );
  }

  const variant = pickVariant(group, onClearHold, removeHold.isPending);
  if (!variant) return null;
  const palette = TONE[variant.tone];

  return (
    <div
      className="rounded-md border px-4 py-3 flex items-start gap-3"
      style={{
        background: palette.bg,
        color: palette.fg,
        borderColor: palette.border,
      }}
      data-testid="group-action-banner"
      data-variant={variant.key}
    >
      <span style={{ color: palette.fg }}>{variant.icon}</span>
      <div className="flex-1 min-w-0">
        <p
          className="text-sm font-semibold leading-tight"
          data-testid="group-action-banner-title"
        >
          {variant.title}
        </p>
        <p
          className="text-xs mt-0.5 opacity-90"
          data-testid="group-action-banner-reason"
        >
          {variant.reason}
        </p>
        <a
          href="#group-detail-section-activity"
          className="text-[11px] mt-1 inline-block underline opacity-80 hover:opacity-100"
          data-testid="group-action-banner-why"
        >
          Why this banner?
        </a>
      </div>
      <div className="shrink-0 self-center">{variant.action}</div>
    </div>
  );
}
