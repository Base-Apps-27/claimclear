import type {
  ClaimResponse,
  InvoiceGroupResponse,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, ClipboardCheck } from "lucide-react";
import { formatDateTime } from "@/lib/format";

interface Props {
  claim: ClaimResponse;
  group: InvoiceGroupResponse | null | undefined;
}

// Read-only audit panel that surfaces:
//   1. Whether this leg has had its MAS cancel recorded (by / when / note)
//   2. Whether the parent group's re-attest has been confirmed (by / when / note)
//
// Both rows render only when there is something to show — i.e. either an
// outstanding obligation (so reviewers see the pending state) or a recorded
// stamp (so audit follow-up can answer "who did it, and when?"). When there
// is nothing on either axis the whole card collapses to null so it doesn't
// add visual noise to legs where MAS isn't involved at all.
export function MasReattestHistory({ claim, group }: Props) {
  const legNeedsCancel = claim.masActionRequired === "cancel";
  const legCancelDone = !!claim.masActionCompletedAt;
  const showLegRow = legNeedsCancel || legCancelDone;

  const groupNeedsReattest = group?.reattestRequired === true;
  const groupReattestDone = !!group?.reattestCompletedAt;
  const showReattestRow = groupNeedsReattest || groupReattestDone;

  if (!showLegRow && !showReattestRow) return null;

  return (
    <Card data-testid="mas-reattest-history">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardCheck className="h-4 w-4" />
          MAS history
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {showLegRow && (
          <LegMasCancelRow
            done={legCancelDone}
            completedAt={claim.masActionCompletedAt}
            completedBy={claim.masActionCompletedBy}
            note={claim.masActionNote}
          />
        )}
        {showReattestRow && (
          <GroupReattestRow
            done={groupReattestDone}
            completedAt={group?.reattestCompletedAt}
            completedBy={group?.reattestCompletedBy}
            note={group?.reattestNote}
          />
        )}
      </CardContent>
    </Card>
  );
}

function LegMasCancelRow({
  done,
  completedAt,
  completedBy,
  note,
}: {
  done: boolean;
  completedAt?: string | null;
  completedBy?: string | null;
  note?: string | null;
}) {
  if (done) {
    return (
      <div
        className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        data-testid="mas-history-leg-done"
      >
        <CheckCircle2 className="h-4 w-4 text-emerald-700 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">MAS cancel recorded</span>
            <Badge variant="outline" className="text-[10px] border-emerald-300 bg-white/60 text-emerald-800">
              this leg
            </Badge>
          </div>
          <p
            className="text-xs text-emerald-800/80 mt-0.5"
            data-testid="mas-history-leg-attribution"
          >
            {completedBy ? <>by <span className="font-medium">{completedBy}</span></> : "by unknown user"}
            {completedAt ? <> · {formatDateTime(completedAt)}</> : null}
          </p>
          {note && (
            <p
              className="text-xs mt-1 rounded bg-white/60 px-2 py-1 border border-emerald-200 whitespace-pre-wrap break-words"
              data-testid="mas-history-leg-note"
            >
              {note}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      data-testid="mas-history-leg-pending"
    >
      <Clock className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">MAS cancel not yet recorded</span>
          <Badge variant="outline" className="text-[10px] border-amber-300 bg-white/60 text-amber-800">
            this leg
          </Badge>
        </div>
        <p className="text-xs text-amber-800/80 mt-0.5">
          Use the MAS Action Checklist on the invoice group to mark this leg
          cancelled.
        </p>
      </div>
    </div>
  );
}

function GroupReattestRow({
  done,
  completedAt,
  completedBy,
  note,
}: {
  done: boolean;
  completedAt?: string | null;
  completedBy?: string | null;
  note?: string | null;
}) {
  if (done) {
    return (
      <div
        className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        data-testid="mas-history-reattest-done"
      >
        <CheckCircle2 className="h-4 w-4 text-emerald-700 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">Group re-attest confirmed</span>
            <Badge variant="outline" className="text-[10px] border-emerald-300 bg-white/60 text-emerald-800">
              parent group
            </Badge>
          </div>
          <p
            className="text-xs text-emerald-800/80 mt-0.5"
            data-testid="mas-history-reattest-attribution"
          >
            {completedBy ? <>by <span className="font-medium">{completedBy}</span></> : "by unknown user"}
            {completedAt ? <> · {formatDateTime(completedAt)}</> : null}
          </p>
          {note && (
            <p
              className="text-xs mt-1 rounded bg-white/60 px-2 py-1 border border-emerald-200 whitespace-pre-wrap break-words"
              data-testid="mas-history-reattest-note"
            >
              {note}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      data-testid="mas-history-reattest-pending"
    >
      <Clock className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">Group re-attest not yet confirmed</span>
          <Badge variant="outline" className="text-[10px] border-amber-300 bg-white/60 text-amber-800">
            parent group
          </Badge>
        </div>
        <p className="text-xs text-amber-800/80 mt-0.5">
          The parent group still owes a re-attest in MAS — confirm it from the
          invoice group's MAS Action Checklist.
        </p>
      </div>
    </div>
  );
}
