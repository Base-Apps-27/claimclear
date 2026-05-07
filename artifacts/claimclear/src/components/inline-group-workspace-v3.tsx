import { useMemo, useState } from "react";
import { useGetInvoiceGroup } from "@workspace/api-client-react";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
} from "@workspace/api-client-react";
import { buildLegResolvedIndex } from "@workspace/leg-state";
import {
  CheckCircle2,
  Circle,
  HelpCircle,
  XCircle,
  Loader2,
  FileText,
  ShieldCheck,
  Send,
  Archive,
  PanelRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RefNumber } from "@/components/ref-number";
import { ClaimDetailV2 } from "@/components/claim-detail-v2";
import { InvoiceGroupActionSlot } from "@/components/invoice-group-action-slot";
import { useUrlParams } from "@/lib/use-url-params";
import { formatCurrency } from "@/lib/format";
import { HideForClerk } from "@/lib/role";
import {
  deriveInvoiceDisputeOutlook,
  type InvoiceDisputeOutlook,
} from "@/lib/whats-next-derivation";

// ─────────────────────────────────────────────────────────────────────
// Queue V3 — Walk-first wizard right-pane (Task #517).
//
// A sibling to the classic InlineGroupWorkspace, mounted at /queue-v3.
// Same data, same mutations — different chrome. Shape:
//   • One-line group header + segmented leg switcher (bound to ?leg=).
//   • Hero: the active leg's SOP walk, embedded via ClaimDetailV2.
//   • Pinned footer: phase ladder (Walk → Preview → Review → Submit)
//     reading real group state (previewGeneratedAt, draftReviewedAt,
//     status) — not just walk-readiness.
//   • Slide-over drawer (Activity / Notes / Thread / MAS) opens from
//     the group header so the SOP hero can stay focused on walking.
//
// Outlook collapses the chrome:
//   - has_disputable → full wizard: leg switcher + hero + 4-step ladder
//     + Submit (existing gauntlet)
//   - reattest_only  → leg switcher + hero + 2-step ladder
//     (Walk → Re-attest), terminator = ReattestModal
//   - nothing_to_do  → no walk needed; chrome collapses to a single
//     close-out card (terminator = closure-launcher / Withdrawn)
//
// All three terminators are reused as-is by mounting
// `InvoiceGroupActionSlot` (`bare`) below the SOP hero — that
// component already routes the outlook to the right pipeline, so the
// wizard inherits every existing mutation, query invalidation, and
// audit-write without duplicating wiring.
// ─────────────────────────────────────────────────────────────────────

function WorkspaceLoadingCard() {
  return (
    <Card>
      <CardContent className="py-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading workspace…
      </CardContent>
    </Card>
  );
}

interface PhaseConfig {
  steps: readonly string[];
  /** Index into `steps` of the currently-active phase. */
  activeIndex: number;
  /** Helper text under the gauntlet row. */
  helper: string;
  /** Right-aligned readiness pill. */
  pill: { label: string; tone: "amber" | "green" | "blue" };
}

interface PhaseInputs {
  outlook: InvoiceDisputeOutlook;
  legCount: number;
  resolvedCount: number;
  previewGenerated: boolean;
  draftReviewed: boolean;
  submitted: boolean;
}

export function buildPhaseConfigV3(inputs: PhaseInputs): PhaseConfig {
  const {
    outlook,
    legCount,
    resolvedCount,
    previewGenerated,
    draftReviewed,
    submitted,
  } = inputs;
  const allWalked = legCount > 0 && resolvedCount === legCount;

  if (outlook === "has_disputable") {
    const steps = ["Walk legs", "Preview", "Review", "Submit"] as const;
    let activeIndex = 0;
    if (submitted) activeIndex = 3;
    else if (draftReviewed) activeIndex = 3;
    else if (previewGenerated) activeIndex = 2;
    else if (allWalked) activeIndex = 1;

    let helper: string;
    if (submitted) helper = "Submitted to the portal.";
    else if (draftReviewed) helper = "Draft reviewed — submit to the portal.";
    else if (previewGenerated) helper = "Preview generated — review the draft, then submit.";
    else if (allWalked) helper = "All legs walked — generate the preview, then submit to the portal.";
    else helper = `Walk all ${legCount} leg${legCount === 1 ? "" : "s"} to unlock Generate preview, then Submit.`;

    let pillLabel: string;
    let pillTone: "amber" | "green" | "blue";
    if (submitted) {
      pillLabel = "Submitted";
      pillTone = "green";
    } else if (draftReviewed) {
      pillLabel = "Ready to submit";
      pillTone = "green";
    } else if (previewGenerated) {
      pillLabel = "Awaiting review";
      pillTone = "blue";
    } else if (allWalked) {
      pillLabel = "Ready to preview";
      pillTone = "blue";
    } else {
      pillLabel = `${resolvedCount} of ${legCount} ready`;
      pillTone = "amber";
    }

    return {
      steps,
      activeIndex,
      helper,
      pill: { label: pillLabel, tone: pillTone },
    };
  }

  if (outlook === "reattest_only") {
    return {
      steps: ["Walk legs", "Re-attest"],
      activeIndex: allWalked ? 1 : 0,
      helper: allWalked
        ? "All legs walked — re-attest survivors in the portal."
        : `Walk all ${legCount} leg${legCount === 1 ? "" : "s"} to unlock Re-attest.`,
      pill: {
        label: allWalked ? "Ready to re-attest" : `${resolvedCount} of ${legCount} ready`,
        tone: allWalked ? "blue" : "amber",
      },
    };
  }

  // nothing_to_do — collapsed: chrome is suppressed by the outer
  // component; this config is informational only.
  return {
    steps: ["Close"],
    activeIndex: 0,
    helper: "Nothing left to dispute — close the invoice out as Withdrawn.",
    pill: { label: "Ready to close", tone: "amber" },
  };
}

function legStateIcon(
  leg: ClaimResponse,
  resolvedIndex: ReturnType<typeof buildLegResolvedIndex>,
) {
  if (leg.includedInDispute === false) {
    return <XCircle className="w-3 h-3" aria-label="excluded" />;
  }
  if (resolvedIndex.isLegResolved(leg)) {
    return <CheckCircle2 className="w-3 h-3" aria-label="resolved" />;
  }
  if (!leg.errorTypeName) {
    return <HelpCircle className="w-3 h-3" aria-label="needs classification" />;
  }
  return <Circle className="w-3 h-3" aria-label="pending" />;
}

function outlookIcon(outlook: InvoiceDisputeOutlook) {
  if (outlook === "has_disputable") return <Send className="w-3.5 h-3.5" />;
  if (outlook === "reattest_only") return <ShieldCheck className="w-3.5 h-3.5" />;
  return <Archive className="w-3.5 h-3.5" />;
}

interface Props {
  groupId: number;
}

export function InlineGroupWorkspaceV3({ groupId }: Props) {
  const { get, set } = useUrlParams();
  const legParam = Number.parseInt(get("leg"), 10);
  const urlLegId: number | null =
    Number.isFinite(legParam) && legParam > 0 ? legParam : null;
  const setActiveLegId = (id: number | null) => {
    set({ leg: id == null ? null : String(id) }, false);
  };

  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: group, isLoading } = useGetInvoiceGroup(groupId);

  // Stable hooks must run on every render — derive defaults inside
  // useMemo so the call order doesn't change with `group` arrival.
  const detail: InvoiceGroupDetailResponse | null = useMemo(
    () => (group ? (group as InvoiceGroupDetailResponse) : null),
    [group],
  );
  const rides: ClaimResponse[] = detail?.rides ?? [];
  const resolvedIndex = useMemo(
    () => buildLegResolvedIndex(rides),
    [rides],
  );

  if (isLoading || !detail) {
    return <WorkspaceLoadingCard />;
  }

  // Pick the active leg: explicit URL param wins, otherwise the first
  // leg that still needs walking, otherwise just the first leg. Falls
  // back to null only when the group has no rides at all.
  const explicitLeg = urlLegId
    ? rides.find((r) => r.id === urlLegId) ?? null
    : null;
  const firstUnresolved =
    rides.find(
      (r) =>
        r.includedInDispute !== false && !resolvedIndex.isLegResolved(r),
    ) ?? null;
  const activeLeg: ClaimResponse | null =
    explicitLeg ?? firstUnresolved ?? rides[0] ?? null;

  const { outlook, survivors, dropped } = deriveInvoiceDisputeOutlook(
    detail,
    rides,
  );
  const resolvedCount = rides.filter(
    (r) => r.includedInDispute === false || resolvedIndex.isLegResolved(r),
  ).length;

  // Real phase progression — pulled straight off the group so the
  // ladder reflects the same gates the gauntlet enforces.
  const previewGenerated = !!(detail as { previewGeneratedAt?: string | null })
    .previewGeneratedAt;
  const draftReviewed = !!(detail as { draftReviewedAt?: string | null })
    .draftReviewedAt;
  const submitted =
    !!detail.outcome &&
    detail.outcome !== "Withdrawn" &&
    detail.outcome !== "Non-Issue" &&
    detail.status !== "New" &&
    detail.status !== "Needs Evidence";
  const phase = buildPhaseConfigV3({
    outlook,
    legCount: rides.length,
    resolvedCount,
    previewGenerated,
    draftReviewed,
    submitted,
  });

  // Outlook-specific collapse: when nothing_to_do, suppress the
  // walk-first chrome (leg switcher, SOP hero, gauntlet ladder) and
  // render the close-out card directly. There is nothing to walk per
  // leg, so the wizard collapses to its terminator.
  const collapseToTerminator = outlook === "nothing_to_do";

  const summaryHeader = (
    <div className="cc-group-header" data-testid="v3-group-header">
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <RefNumber value={detail.invoiceNumber} variant="inline" className="font-semibold" />
      <span className="cc-meta">
        {detail.rideCount} ride{detail.rideCount === 1 ? "" : "s"}
        <HideForClerk>
          {" · "}
          {formatCurrency(detail.totalAmount)}
        </HideForClerk>
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-7 px-2 text-xs"
        onClick={() => setDrawerOpen(true)}
        data-testid="v3-open-details-drawer"
        aria-label="Open activity, notes, communication, and MAS panels"
      >
        <PanelRight className="w-3.5 h-3.5 mr-1" />
        Details
      </Button>
      {!collapseToTerminator && rides.length > 0 && (
        <div
          className="cc-segmented"
          role="tablist"
          aria-label="Legs"
          data-testid="v3-leg-switcher"
        >
          {rides.map((leg, i) => {
            const isActive = activeLeg?.id === leg.id;
            return (
              <button
                key={leg.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={isActive ? "is-active" : ""}
                onClick={() => setActiveLegId(leg.id)}
                data-testid={`v3-leg-tab-${leg.id}`}
              >
                Leg {i + 1} {legStateIcon(leg, resolvedIndex)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  // Phase-4 readiness summary — surfaces survivor / dropped counts for
  // the reattest/close branches so the operator gets the same context
  // the classic InvoiceGroupActionSlot card shows in /queue.
  const outlookSummary =
    outlook === "reattest_only"
      ? `${survivors.length} leg${survivors.length === 1 ? "" : "s"} need re-attestation${
          dropped.length > 0
            ? `; ${dropped.length} non-contestable will be cancelled`
            : ""
        }.`
      : outlook === "nothing_to_do"
      ? dropped.length > 0
        ? `${dropped.length} non-contestable / sibling-duplicate leg${dropped.length === 1 ? "" : "s"} — nothing to dispute.`
        : "No legs remain to dispute or re-attest."
      : null;

  // Slide-over drawer — Activity / Notes / Thread / MAS for the
  // active leg. Embeds ClaimDetailV2 in a Sheet so we don't duplicate
  // any of the per-leg surfaces; the wizard hero can then stay
  // focused on walking the SOP. When `nothing_to_do` collapses the
  // chrome, the drawer is the only way into per-leg detail and is
  // disabled when there is no active leg.
  const detailsDrawer = (
    <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto"
        data-testid="v3-details-drawer"
      >
        <SheetHeader>
          <SheetTitle>
            {activeLeg ? (
              <>
                Leg details · <RefNumber value={activeLeg.confNumber} variant="inline" />
              </>
            ) : (
              "Leg details"
            )}
          </SheetTitle>
        </SheetHeader>
        <div className="cc-scope mt-4">
          {activeLeg ? (
            <ClaimDetailV2 claimId={activeLeg.id} embedded />
          ) : (
            <p className="text-sm text-muted-foreground">
              No active leg to show details for.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );

  return (
    <div
      className="cc-scope space-y-3"
      data-testid="inline-group-workspace-v3"
      data-outlook={outlook}
      data-collapsed={collapseToTerminator ? "true" : "false"}
    >
      {summaryHeader}

      {outlookSummary && (
        <div
          className="cc-meta text-xs flex items-center gap-2"
          data-testid="v3-outlook-summary"
        >
          {outlookIcon(outlook)}
          <span>{outlookSummary}</span>
        </div>
      )}

      {/* Hero — the active leg's SOP walk. Reuses ClaimDetailV2 in
          embedded mode so every existing per-leg mutation (reclassify,
          exclude, mark/unmark duplicate, quick-conclude, SOP advance,
          notes) keeps working unchanged. Suppressed when the outlook
          has nothing to walk (nothing_to_do). */}
      {!collapseToTerminator &&
        (activeLeg ? (
          <div data-testid="v3-leg-hero">
            <ClaimDetailV2 claimId={activeLeg.id} embedded />
          </div>
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              This invoice has no legs to walk.
            </CardContent>
          </Card>
        ))}

      {/* Pinned footer — phase ladder reflecting real group state
          (previewGenerated / draftReviewed / submitted). Suppressed
          when the outlook collapses the chrome. */}
      {!collapseToTerminator && (
        <div
          className="cc-footer-card cc-footer-pinned"
          data-testid="v3-pinned-footer"
        >
          <span
            className={`cc-pill cc-pill-${phase.pill.tone}`}
            data-testid="v3-phase-pill"
          >
            {phase.pill.label}
          </span>
          <span className="cc-meta text-xs flex-1 min-w-0">
            {phase.helper}
          </span>
          <ul
            className="cc-gauntlet-row"
            data-testid="v3-gauntlet-steps"
            aria-label="Gauntlet phase"
          >
            {phase.steps.map((label, i) => (
              <li
                key={label}
                className={`cc-gauntlet-step ${
                  i < phase.activeIndex
                    ? "cc-gauntlet-done"
                    : i === phase.activeIndex
                    ? "cc-gauntlet-active"
                    : ""
                }`}
                data-testid={`v3-gauntlet-step-${i}`}
              >
                {i < phase.activeIndex && (
                  <CheckCircle2 className="w-3 h-3" />
                )}
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Phase-4 terminal action — outlook-routed. `bare` strips the
          card chrome since the wizard already provides its own
          framing; jump-to-leg from a `gate: "legs"` submit failure
          still works because the V3 footer rebinds the same callback
          to the segmented switcher. */}
      <InvoiceGroupActionSlot
        group={detail}
        groupId={groupId}
        bare
        onJumpToLeg={(claimId) => setActiveLegId(claimId)}
      />

      {detailsDrawer}
    </div>
  );
}
