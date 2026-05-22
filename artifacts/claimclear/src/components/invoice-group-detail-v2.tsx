import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { BackBar } from "@/components/back-bar";
import { useEvidencePreview } from "@/components/evidence-preview-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useInvoiceGroupEvents } from "@/hooks/use-claim-events";
import { useActorCausedTransition } from "@/hooks/use-actor-caused-transition";
import { useTransientFlag } from "@/hooks/use-transient-flag";
import { isPreSubmit as isPreSubmitFn, isInFlight, isClosed, getLifecyclePhase } from "@/lib/lifecycle-phase";
import { partitionTransitions } from "@/lib/transitions-partition";
import { deriveGroupOutcomeFromLegs } from "@/lib/group-outcome";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useGetInvoiceGroup,
  getGetInvoiceGroupQueryKey,
  useGetInvoiceGroupValidTransitions,
  getGetInvoiceGroupValidTransitionsQueryKey,
  useGetInvoiceGroupEmailThread,
  useReplyToInvoiceGroupEmailConversation,
  useSendInvoiceGroupEmail,
  getGetInvoiceGroupEmailThreadQueryKey,
  useCheckEmailResponses,
  useCreateInvoiceGroupNote,
  useCompleteGroupReattest,
  useUpdateInvoiceGroupStatus,
  useHoldInvoiceGroup,
  useRemoveInvoiceGroupHold,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { TONE_STYLE } from "@/components/cohesion";
import { CloseAsNonIssueDialog } from "@/components/close-as-non-issue-dialog";
import { ClosureIntakeDialog } from "@/components/closure/closure-intake-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton, SkeletonSwap } from "@/components/ui/skeleton";
import type {
  ClaimResponse,
  InvoiceGroupDetailResponse,
  InvoiceGroupResponse,
  PortalResponseItem,
  AuditLogResponse,
  NoteResponse,
} from "@workspace/api-client-react";
import {
  Loader2, ChevronLeft, ChevronRight, Edit2, Save, Plus, Paperclip, Send,
  Mail, MessageSquare, Gavel, Stamp, FileText, Activity, Pin, AlertTriangle, CheckCircle2,
  XCircle, Lock, ListChecks, Sparkles, Inbox, Clock, ClipboardCheck,
  ShieldCheck, Layers, History, ArrowRight, PauseCircle, PlayCircle, Copy,
} from "lucide-react";
import { useToast, successToast } from "@/hooks/use-toast";
import { useBreath } from "@/hooks/use-breath";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { formatRelative, absoluteTooltip } from "@/lib/time";
import { HideForClerk } from "@/lib/role";
import { ServiceDateBanner, type ServiceDateReason } from "@/components/service-date-cell";
import { StateBadge } from "@/components/state-badge";
import { outcomeLabel } from "@workspace/vocab";
import { RefNumber } from "@/components/ref-number";
import { OPAQUE_EVIDENCE_NAME_RE } from "@/components/decision-tree/types";

// Task #706 — group/dispute previews list every attachment by name. When
// the persisted `evidence_type_name` is an opaque legacy `ev_<digits>`
// key (or empty), prefer the file basename so users see "manifest.png"
// instead of "ev_1776176562945" or a generic "Evidence" placeholder.
function displayedEvidenceName(
  stored: string | null | undefined,
  url: string | null | undefined,
): string | null {
  const trimmed = (stored ?? "").trim();
  if (trimmed && !OPAQUE_EVIDENCE_NAME_RE.test(trimmed)) return trimmed;
  if (url) return url.split("/").pop() ?? null;
  return null;
}
import { deriveLegSubStatus, type LegSubStatus } from "@workspace/leg-state";
import {
  isOfflineReattestNoteValid,
  canSubmitOfflineReattest,
  canShowOfflineReattestOverride,
  buildOfflineReattestPayload,
} from "@/lib/reattest-offline-modal-helpers";
import { ClosureActions } from "@/components/closure/closure-actions";
import { useClosureConfirmLauncher } from "@/components/closure/closure-launcher";
import {
  pickLatestReviewableResponse,
  getResponseTypeLabel,
} from "@/components/queue-response-review-panel";
import { ActionRow } from "@/components/actions-rail";
import { deriveInvoiceDisputeOutlook } from "@/lib/whats-next-derivation";
import { GroupCommunicationReplyDialog } from "@/components/communication/group-communication-thread";
import {
  mapToGroupConversations,
  pickGroupBannerData,
  htmlBodyToPlainText,
} from "@/components/communication/group-thread-adapter";

// Invoice-group orchestration surface — densified to match
// GroupDetailRedensified mockup 1:1 (Task #263). All chrome lives in the
// .cc-scope wrapper; behavior continues to use the same hooks the prior
// shadcn-card layout did, plus shared subcomponents that the queue
// inline workspace also mounts (InvoiceGroupSubmissionGauntlet,
// GroupCommunicationThread). The detail page keeps its own densified
// inlined legs table; the queue's Panel A uses InvoiceGroupLegsList.
//
// Task #265 removed the group-aggregate-context surface — per-leg
// context now lives directly on each leg row in the queue and the
// editable AI write-up replaces the group-level narrative form.

interface Props {
  groupId: number;
  // Task #767 — set when the operator arrived from the manual-entry
  // intake flow. Renders the purple "Invoice saved" guidance banner at
  // the top of the page so they know to pick error types per leg before
  // walking the SOP. Absorbed from GroupDossierChrome during the D2
  // full-page graduation.
  fromManual?: boolean;
}

/* -------------------------- Card primitives ---------------------------- */

// Task #767 — D2 polish pass. Header `tone` paints the card header strip
// in one of the cc-* accent colors so operators can scan the page by
// color (purple = operator-only escalations, green = group-verdict
// surfaces, amber = blocked / needs action, blue = informational). The
// card body stays white in every tone so the chrome reads as a "stamped
// folder tab" rather than a fully-tinted card.
type CcCardTone = "default" | "purple" | "green" | "amber" | "blue";

const CC_CARD_TONE_STYLE: Record<CcCardTone, React.CSSProperties> = {
  default: {},
  purple:  { background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)", borderColor: "var(--cc-purple-border)" },
  green:   { background: "var(--cc-green-bg)",  color: "var(--cc-green-fg)",  borderColor: "var(--cc-green-border)" },
  amber:   { background: "var(--cc-amber-bg)",  color: "var(--cc-amber-fg)",  borderColor: "var(--cc-amber-border)" },
  blue:    { background: "var(--cc-blue-bg)",   color: "var(--cc-blue-fg)",   borderColor: "var(--cc-blue-border)" },
};

// D2 graduation: card chrome is the mockup's compact "tab header" pattern —
// a thin gray strip with a 10px uppercase title sits flush above a white
// body. Tinted variants paint the strip in the matching palette and pick up
// the matching border on the wrapper so the colored strip doesn't float
// inside a default gray frame.
function CcCard({
  title, action, icon, children, padded = true, testId, tone = "default",
}: {
  title: ReactNode; action?: ReactNode; icon?: ReactNode;
  children: ReactNode; padded?: boolean; testId?: string;
  tone?: CcCardTone;
}) {
  const headerTone = CC_CARD_TONE_STYLE[tone];
  const headerStyle: React.CSSProperties =
    tone === "default"
      ? {
          background: "color-mix(in srgb, var(--cc-muted) 50%, transparent)",
          borderBottom: "1px solid var(--cc-border)",
        }
      : {
          background: headerTone.background,
          color: headerTone.color,
          borderBottom: `1px solid ${headerTone.borderColor}`,
        };
  const titleColor =
    tone === "default" ? "var(--cc-muted-fg)" : "currentColor";
  const cardStyle: React.CSSProperties =
    tone === "default" ? {} : { borderColor: headerTone.borderColor };
  return (
    <div className="cc-card overflow-hidden" data-testid={testId} style={cardStyle}>
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={headerStyle}
      >
        <h3
          className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 m-0"
          style={{ color: titleColor }}
        >
          {icon}{title}
        </h3>
        {action}
      </div>
      <div className={padded ? "p-3" : ""} style={{ background: "var(--cc-card)" }}>{children}</div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      className="flex items-center justify-between py-1.5 text-xs"
      style={{ borderBottom: "1px dashed var(--cc-border)" }}
    >
      <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--cc-muted-fg)" }}>
        {label}
      </span>
      <span className="font-medium text-xs" style={{ color: "var(--cc-fg)" }}>{value}</span>
    </div>
  );
}

// D2 graduation: compact list-style row used inside the Overrides & Admin
// card. Mirrors the mockup's AdminRow — single line, small icon left, label
// right, hover tint. Replaces the chunky shadcn outline buttons.
function AdminRow({
  label, icon, onClick, disabled, testId, asAnchor, anchorHref, tone = "default",
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  testId?: string;
  asAnchor?: boolean;
  anchorHref?: string;
  tone?: "default" | "destructive";
}) {
  const baseStyle: React.CSSProperties = {
    color: tone === "destructive" ? "var(--cc-red-fg)" : "var(--cc-fg)",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
  const cls =
    "w-full text-left px-2 py-1.5 text-[12px] font-medium rounded flex items-center gap-2 hover:bg-[color-mix(in_srgb,var(--cc-muted)_60%,transparent)] transition-colors";
  if (asAnchor && anchorHref) {
    return (
      <a href={anchorHref} className={cls} style={baseStyle} data-testid={testId}>
        <span className="opacity-70" style={{ color: "var(--cc-muted-fg)" }}>{icon}</span>
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cls}
      style={baseStyle}
      data-testid={testId}
    >
      <span className="opacity-70" style={{ color: "var(--cc-muted-fg)" }}>{icon}</span>
      {label}
    </button>
  );
}

// Task #767 — compact single-row stat for the left-rail Submission
// Summary card. D2 polish pass: green check + timestamp when done,
// dashed-circle + "—" when pending. The `*-state` testid still flips
// between "Yes" / "No" so the contract tests (group-detail-no-submission
// V2 source scans + RAR regression) keep working without a rewrite.
function SubmissionSummaryStat({
  label, value, testId,
}: { label: string; value: string | null | undefined; testId: string }) {
  const done = !!value;
  return (
    <div data-testid={testId} className="flex items-center justify-between gap-2 text-xs">
      <span style={{ color: "var(--cc-muted-fg)" }}>{label}</span>
      <span
        className="flex items-center gap-1 font-medium"
        style={{ color: done ? "var(--cc-success)" : "var(--cc-muted-fg)" }}
      >
        {done ? (
          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
        ) : (
          <Clock className="w-3 h-3" aria-hidden="true" />
        )}
        <span className="mono text-[11px]" data-testid={`${testId}-state`} data-state={done ? "Yes" : "No"}>
          {done ? formatDateTime(value ?? undefined) : "—"}
        </span>
      </span>
    </div>
  );
}

// Task #767 — status-driven accent color for the header rail bar and
// the Submission Summary status pill. Phase-driven (not keyword-
// driven) so every canonical status in `STATUSES_BY_PHASE` maps to a
// stable color and new statuses can't silently fall through to the
// default purple:
//
//   pre-submit (New, Needs Evidence, Processed)
//     → purple — operator still drafting / packaging
//   in-flight (Portal Queued, Generating Email, Awaiting Response)
//     → blue   — waiting on portal/payor, no operator action
//   response-pending (Ready to Review, Needs Review)
//     → green  — payor verdict landed, ready for operator
//   mas-action-required (MAS Eligible)
//     → green  — positive MAS verdict, re-attestation owed
//   on-hold
//     → amber  — manually parked, deadline clock still ticking
//   closed: Resolved → green, Denied / Withdrawn → red
const ACCENT_GREEN  = { bg: "var(--cc-green-bg)",  fg: "var(--cc-green-fg)",  border: "var(--cc-green-border)"  };
const ACCENT_BLUE   = { bg: "var(--cc-blue-bg)",   fg: "var(--cc-blue-fg)",   border: "var(--cc-blue-border)"   };
const ACCENT_AMBER  = { bg: "var(--cc-amber-bg)",  fg: "var(--cc-amber-fg)",  border: "var(--cc-amber-border)"  };
const ACCENT_RED    = { bg: "var(--cc-red-bg)",    fg: "var(--cc-red-fg)",    border: "var(--cc-red-border)"    };
const ACCENT_PURPLE = { bg: "var(--cc-purple-bg)", fg: "var(--cc-purple-fg)", border: "var(--cc-purple-border)" };

function statusAccent(status: string | null | undefined): {
  bg: string; fg: string; border: string;
} {
  if (status === "Denied" || status === "Withdrawn") return ACCENT_RED;
  if (status === "Resolved") return ACCENT_GREEN;
  switch (getLifecyclePhase(status)) {
    case "pre-submit":          return ACCENT_PURPLE;
    case "in-flight":           return ACCENT_BLUE;
    case "response-pending":    return ACCENT_GREEN;
    case "mas-action-required": return ACCENT_GREEN;
    case "on-hold":             return ACCENT_AMBER;
    case "closed":              return ACCENT_GREEN; // Resolved already handled above
    default:                    return ACCENT_PURPLE;
  }
}

/* ----------------------- D2 leg + context primitives ----------------------- */

// Per-leg verdict tone derived from `claims.outcome`. The chip styling mirrors
// the mockup's LegVerdictCard; sub-text is a stable phrase so we don't fan out
// to per-leg detail fetches just to fill a sentence.
function LegVerdictCard({ ride }: { ride: ClaimResponse }) {
  const o = (ride.outcome ?? "Pending") as string;
  const excluded = ride.includedInDispute === false;
  if (o === "Approved") {
    return (
      <div className="cc-card p-3" style={{ background: "color-mix(in srgb, var(--cc-green-bg) 30%, transparent)", borderColor: "var(--cc-green-border)" }}>
        <h3 className="font-bold text-[10px] uppercase tracking-wider mb-1 flex items-center gap-2" style={{ color: "var(--cc-green-fg)" }}>
          <CheckCircle2 className="w-3.5 h-3.5" /> Leg verdict
        </h3>
        <p className="font-bold text-sm" style={{ color: "var(--cc-fg)" }}>{outcomeLabel(o)}</p>
        <p className="text-[11px] font-medium" style={{ color: "var(--cc-muted-fg)" }}>Recoupment reversed.</p>
      </div>
    );
  }
  if (o === "Denied") {
    return (
      <div className="cc-card p-3" style={{ background: "color-mix(in srgb, var(--cc-amber-bg) 40%, transparent)", borderColor: "var(--cc-amber-border)" }}>
        <h3 className="font-bold text-[10px] uppercase tracking-wider mb-1 flex items-center gap-2" style={{ color: "var(--cc-amber-fg)" }}>
          <XCircle className="w-3.5 h-3.5" /> Leg verdict
        </h3>
        <p className="font-bold text-sm" style={{ color: "var(--cc-fg)" }}>{outcomeLabel(o)}</p>
        <p className="text-[11px] font-medium" style={{ color: "var(--cc-muted-fg)" }}>Payor upheld charge.</p>
      </div>
    );
  }
  return (
    <div className="cc-card p-3" style={{ background: "color-mix(in srgb, var(--cc-muted) 40%, transparent)", border: "1px dashed var(--cc-border)" }}>
      <h3 className="font-bold text-[10px] uppercase tracking-wider mb-1 flex items-center gap-2" style={{ color: "var(--cc-muted-fg)" }}>
        <Clock className="w-3.5 h-3.5" /> Leg verdict
      </h3>
      <p className="font-bold text-sm" style={{ color: "var(--cc-fg)" }}>{excluded ? "Excluded from dispute" : "Pending"}</p>
      <p className="text-[11px] font-medium" style={{ color: "var(--cc-muted-fg)" }}>
        {excluded ? "Not part of the active dispute package." : "Awaiting verdict."}
      </p>
    </div>
  );
}

// Per-leg column: header pill + service-date/error-type, single "Walk SOP" CTA
// into the queue (per-leg mutations live in queue chrome — keeping inline
// actions off the dossier per Task #687), evidence rollup, audit excerpt
// filtered to this leg, and the verdict card. Group-level data (special
// circumstances, generated email) is rendered separately below the grid.
function LegColumn({
  ride, legNumber, groupId, auditEntries,
}: {
  ride: ClaimResponse;
  legNumber: number;
  groupId: number;
  auditEntries: AuditLogResponse[];
}) {
  const { open: openEvidencePreview } = useEvidencePreview();
  const sub = deriveLegSubStatus(ride);
  const rideAny = ride as {
    evidenceFiles?: Array<{ url?: string; name?: string | null; filename?: string | null; size?: number | null }> | null;
    evidence?: Array<{ imageUrl?: string | null; evidenceTypeName?: string | null }>;
  };
  type Item = { url: string; name: string; size?: number | null };
  const items: Item[] = [];
  const seen = new Set<string>();
  const add = (url: string | null | undefined, name: string | null | undefined, size?: number | null) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    let n = name ?? null;
    if (!n) {
      try { n = decodeURIComponent(new URL(url, "http://x").pathname.split("/").filter(Boolean).pop() || url); }
      catch { n = url; }
    }
    items.push({ url, name: n, size });
  };
  for (const f of rideAny.evidenceFiles ?? []) add(f?.url ?? null, f?.name ?? f?.filename ?? null, f?.size ?? null);
  for (const e of rideAny.evidence ?? []) add(e?.imageUrl ?? null, displayedEvidenceName(e?.evidenceTypeName, e?.imageUrl));
  const legAudit = auditEntries.filter((a) => a.claimId === ride.id).slice(0, 5);
  const excluded = ride.includedInDispute === false;
  // D2 polish — when the error type involves a GPS deviation we tint the
  // chip amber so the operator's eye lands on the blocking SOP gate at a
  // glance. Same goes for the per-leg evidence section when nothing is
  // attached yet — the empty state becomes an amber "Upload evidence"
  // affordance instead of a flat grey "no attachments" note.
  const isGpsDeviation = /gps/i.test(ride.errorTypeName ?? "");
  const needsEvidence = items.length === 0 && !excluded;
  return (
    <div className={`cc-card overflow-hidden flex flex-col ${excluded ? "opacity-75" : ""}`} data-testid={`leg-column-${ride.id}`}>
      <div className="px-4 py-3 space-y-2" style={{ borderBottom: "1px solid var(--cc-border)", background: "color-mix(in srgb, var(--cc-muted) 30%, transparent)" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold mono leading-tight">
                {ride.confNumber ? <RefNumber value={ride.confNumber} variant="inline" /> : <>#{ride.id}</>}
              </h2>
              <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded border" style={{ background: "var(--cc-card)", color: "var(--cc-muted-fg)", borderColor: "var(--cc-border)" }}>
                Leg {legNumber}
              </span>
              <StateBadge variant="subStatus" value={sub} leg={ride} />
            </div>
            <div className="flex items-center gap-2 text-[11px] mt-1.5 flex-wrap" style={{ color: "var(--cc-muted-fg)" }}>
              <span className="font-bold text-xs mono tracking-tight" style={{ color: "var(--cc-fg)" }}>
                {formatCurrency(ride.claimAmount ?? "0")}
              </span>
              <span>•</span>
              <span className="mono">{ride.date ? formatDateTime(ride.date) : "—"}</span>
              {ride.carNumber && (<><span>•</span><span className="mono">Car {ride.carNumber}</span></>)}
            </div>
            {ride.errorTypeName && (
              isGpsDeviation ? (
                <p
                  className="text-[11px] mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-semibold"
                  style={{
                    background: "var(--cc-amber-bg)",
                    color: "var(--cc-amber-fg)",
                    borderColor: "var(--cc-amber-border)",
                    maxWidth: "100%",
                  }}
                  title={ride.errorTypeName}
                  data-testid={`leg-error-type-gps-${ride.id}`}
                >
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span className="truncate">{ride.errorTypeName}</span>
                </p>
              ) : (
                <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--cc-muted-fg)" }} title={ride.errorTypeName}>
                  {ride.errorTypeName}
                </p>
              )
            )}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <Link
            href={`/queue?groupId=${groupId}&legId=${ride.id}`}
            className="ml-auto text-[11px] font-semibold hover:underline flex items-center gap-1"
            style={{ color: "var(--cc-primary)" }}
            data-testid={`leg-walk-sop-${ride.id}`}
          >
            Walk SOP in queue <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <div className="cc-card overflow-hidden">
          <div className="px-3 py-2 flex justify-between items-center" style={{ background: "color-mix(in srgb, var(--cc-muted) 50%, transparent)", borderBottom: "1px solid var(--cc-border)" }}>
            <h3 className="font-semibold text-[11px] uppercase tracking-wider flex items-center gap-2" style={{ color: "var(--cc-muted-fg)" }}>
              <Paperclip className="w-3.5 h-3.5" /> Per-leg evidence
              <span className="font-normal text-[10px] ml-1" style={{ color: "var(--cc-muted-fg)" }}>({items.length})</span>
            </h3>
          </div>
          <div className="p-2 space-y-1">
            {items.length === 0 ? (
              needsEvidence ? (
                <Link
                  href={`/queue?groupId=${groupId}&legId=${ride.id}`}
                  className="flex items-center justify-center gap-2 px-2 py-3 rounded border-2 border-dashed text-[12px] font-semibold hover:opacity-90 transition-opacity"
                  style={{
                    background: "var(--cc-amber-bg)",
                    color: "var(--cc-amber-fg)",
                    borderColor: "var(--cc-amber-border)",
                  }}
                  data-testid={`leg-upload-evidence-${ride.id}`}
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  Upload evidence
                </Link>
              ) : (
                <p className="text-[11px] italic px-1 py-1" style={{ color: "var(--cc-muted-fg)" }}>No per-leg attachments.</p>
              )
            ) : items.map((f, i) => (
              <button
                key={`${f.url}-${i}`}
                type="button"
                onClick={() => openEvidencePreview({ url: f.url, name: f.name, size: f.size })}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded border text-[12px] hover:border-[var(--cc-primary)]"
                style={{ borderColor: "var(--cc-border)", background: "var(--cc-card)" }}
              >
                <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cc-blue-fg)" }} />
                <span className="font-medium truncate flex-1">{f.name}</span>
                {typeof f.size === "number" && (
                  <span className="text-[10px] mono" style={{ color: "var(--cc-muted-fg)" }}>
                    {f.size > 1024 ? `${Math.round(f.size / 1024)} KB` : `${f.size} B`}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {legAudit.length > 0 && (
          <div className="cc-card p-3">
            <h3 className="font-semibold mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--cc-muted-fg)" }}>
              <History className="w-3.5 h-3.5" /> Per-leg audit
            </h3>
            <div className="space-y-2 pl-1">
              {legAudit.map((a) => (
                <div key={a.id} className="relative pl-3" style={{ borderLeft: "2px solid var(--cc-border)" }}>
                  <p className="text-[10px] mb-0.5 uppercase tracking-wide font-medium" style={{ color: "var(--cc-muted-fg)" }}>
                    <span className="mono">{formatDateTime(a.timestamp)}</span> • {a.userName || a.userEmail || "System"}
                  </p>
                  <p className="text-xs" style={{ color: "var(--cc-fg)" }}>{a.action}{a.details ? ` — ${a.details}` : ""}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <LegVerdictCard ride={ride} />
      </div>
    </div>
  );
}

// Invoice-wide context: Special Context (operator's understanding notes) stacked
// above the AI/portal generated write-up. Both are read-only here — editing
// happens in the queue. Drift is shown as a chip (NOT a CTA override per spec).
function InvoiceWideContext({
  specialCircumstances,
  understandingReadbackForText,
  understandingReadbackAt,
  understandingReadbackBy,
  generatedEmailSubject,
  generatedEmailBody,
  generatedEmailAt,
}: {
  specialCircumstances: string | null | undefined;
  understandingReadbackForText: string | null | undefined;
  understandingReadbackAt: string | null | undefined;
  understandingReadbackBy: string | null | undefined;
  generatedEmailSubject: string | null | undefined;
  generatedEmailBody: string | null | undefined;
  generatedEmailAt: string | null | undefined;
}) {
  const hasSpecial = !!(specialCircumstances && specialCircumstances.trim());
  // Drift anchor: text differs from the snapshot the latest readback was generated for.
  const drift = hasSpecial && understandingReadbackForText != null && understandingReadbackForText !== specialCircumstances;
  const isStale = !!drift;
  const hasGenerated = !!(generatedEmailSubject || generatedEmailBody);
  return (
    <div className="space-y-4">
      <div className="cc-card overflow-hidden" data-testid="invoice-wide-special-context">
        <div className="px-4 py-2.5 flex justify-between items-center" style={{ background: "color-mix(in srgb, var(--cc-muted) 50%, transparent)", borderBottom: "1px solid var(--cc-border)" }}>
          <h3 className="font-semibold text-xs uppercase tracking-wider flex items-center gap-2" style={{ color: "var(--cc-muted-fg)" }}>
            <FileText className="w-3.5 h-3.5" /> Special context
            <span className="font-normal text-[10px] ml-1 normal-case tracking-normal">(invoice-wide)</span>
          </h3>
          {hasSpecial && (
            <span
              className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded border"
              style={
                isStale
                  ? { background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)", borderColor: "var(--cc-amber-border)" }
                  : { background: "var(--cc-green-bg)", color: "var(--cc-green-fg)", borderColor: "var(--cc-green-border)" }
              }
              data-testid="special-context-readback-status"
            >
              {isStale ? "Readback stale" : "Readback fresh"}
            </span>
          )}
        </div>
        <div className="p-4 space-y-3" style={{ background: "var(--cc-card)" }}>
          {hasSpecial ? (
            <>
              <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: "var(--cc-fg)" }}>{specialCircumstances}</p>
              {(understandingReadbackBy || understandingReadbackAt) && (
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide pt-2" style={{ color: "var(--cc-muted-fg)", borderTop: "1px solid var(--cc-border)" }}>
                  {understandingReadbackBy && <span className="font-medium">{understandingReadbackBy}</span>}
                  {understandingReadbackBy && understandingReadbackAt && <span>•</span>}
                  {understandingReadbackAt && <span className="mono">{formatDateTime(understandingReadbackAt)}</span>}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>No special context noted for this invoice yet.</p>
          )}
        </div>
      </div>

      <div className="cc-card overflow-hidden" data-testid="invoice-wide-generated-writeup">
        <div className="px-4 py-2.5 flex justify-between items-center" style={{ background: "color-mix(in srgb, var(--cc-muted) 50%, transparent)", borderBottom: "1px solid var(--cc-border)" }}>
          <h3 className="font-semibold text-xs uppercase tracking-wider flex items-center gap-2" style={{ color: "var(--cc-muted-fg)" }}>
            <Send className="w-3.5 h-3.5" /> Generated write-up
            <span className="font-normal text-[10px] ml-1 normal-case tracking-normal">(invoice-wide)</span>
          </h3>
          <span className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded border" style={{ background: "var(--cc-card)", borderColor: "var(--cc-border)", color: "var(--cc-muted-fg)" }}>Read only</span>
        </div>
        <div style={{ background: "var(--cc-card)" }}>
          {hasGenerated ? (
            <>
              {generatedEmailSubject && (
                <div className="px-4 py-2" style={{ borderBottom: "1px solid var(--cc-border)", background: "color-mix(in srgb, var(--cc-muted) 20%, transparent)" }}>
                  <p className="text-[12px] font-semibold" style={{ color: "var(--cc-fg)" }} title={generatedEmailSubject}>{generatedEmailSubject}</p>
                </div>
              )}
              {generatedEmailAt && (
                <div className="px-4 py-2 text-[10px] uppercase tracking-wide mono" style={{ color: "var(--cc-muted-fg)", borderBottom: "1px solid var(--cc-border)" }}>
                  Generated {formatDateTime(generatedEmailAt)}
                </div>
              )}
              {generatedEmailBody && (
                <div className="p-4">
                  <p className="text-[12px] leading-relaxed whitespace-pre-line" style={{ color: "var(--cc-fg)" }}>{generatedEmailBody}</p>
                </div>
              )}
            </>
          ) : (
            <p className="px-4 py-3 text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>No dispute write-up generated yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Phase-aware Primary Action tile. Maps invoice lifecycle + outlook to a
// single CTA so operators always have one clear next step. Mirrors the D2
// mockup's left-rail "PRIMARY ACTION" block. Drift on Special Context is
// shown as a chip on the context card and does NOT override this CTA.
function PrimaryActionTile({
  group, outlook, anyDisputableLegs, anyDisputableNeedsEvidence,
}: {
  group: InvoiceGroupResponse;
  outlook: "has_disputable" | "reattest_only" | "nothing_to_do";
  anyDisputableLegs: boolean;
  anyDisputableNeedsEvidence: boolean;
}) {
  const groupId = group.id;
  type Cta = { label: string; sub: string; href?: string; tone?: "primary" | "muted" | "good" | "warn" };
  let cta: Cta;
  if (isClosed(group.status)) {
    cta = {
      label: `Closed${group.outcome ? ` — ${outcomeLabel(group.outcome)}` : ""}`,
      sub: group.closureReason || (group.updatedAt ? `Closed ${formatRelative(group.updatedAt)}` : "View-only"),
      tone: "muted",
    };
  } else if (isInFlight(group.status)) {
    if (group.status === "Awaiting Response") {
      cta = {
        label: "Awaiting payor response",
        sub: group.disputeEmailSentAt ? `Submitted ${formatRelative(group.disputeEmailSentAt)}` : "Submission in flight",
        tone: "muted",
      };
    } else if (group.status === "Ready to Review") {
      cta = { label: "Review response", sub: "New verdict from payor", href: `/responses-awaiting-review/${groupId}`, tone: "good" };
    } else {
      cta = { label: "Submission in flight", sub: `Status: ${group.status}`, tone: "muted" };
    }
  } else if (outlook === "nothing_to_do" || !anyDisputableLegs) {
    cta = { label: "Close group", sub: "No legs left to act on", href: `#closure-actions`, tone: "warn" };
  } else if (outlook === "reattest_only") {
    cta = { label: "Re-attest in MAS", sub: "No dispute path — re-attest only", href: `/queue?groupId=${groupId}`, tone: "warn" };
  } else if (anyDisputableNeedsEvidence) {
    cta = { label: "Open in queue", sub: "Walk SOP & build submission", href: `/queue?groupId=${groupId}`, tone: "primary" };
  } else {
    cta = { label: "Open in queue", sub: "Final check before portal", href: `/queue?groupId=${groupId}`, tone: "primary" };
  }
  const bg =
    cta.tone === "primary" ? "var(--cc-primary)" :
    cta.tone === "good"    ? "var(--cc-green-fg)" :
    cta.tone === "warn"    ? "var(--cc-amber-fg)" :
                              "var(--cc-muted)";
  const fg =
    cta.tone === "muted" ? "var(--cc-fg)" : "white";
  const body = (
    <div className="w-full flex items-center justify-between px-4 py-3 rounded-md transition-colors group shadow-sm border" style={{ background: bg, color: fg, borderColor: bg }}>
      <div className="text-left min-w-0">
        <div className="font-semibold text-sm truncate">{cta.label}</div>
        <div className="text-[10px] opacity-80 mt-0.5 font-medium truncate">{cta.sub}</div>
      </div>
      {cta.href && <ArrowRight className="w-5 h-5 opacity-80 group-hover:translate-x-1 transition-transform shrink-0 ml-2" />}
    </div>
  );
  return (
    <div className="flex flex-col gap-2" data-testid="primary-action-tile">
      <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: "var(--cc-muted-fg)" }}>Primary action</div>
      {cta.href ? (
        cta.href.startsWith("#") ? (
          <a href={cta.href} onClick={(e) => { e.preventDefault(); document.querySelector(cta.href!)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
            {body}
          </a>
        ) : (
          <Link href={cta.href}>{body}</Link>
        )
      ) : body}
    </div>
  );
}

function Kpi({ label, value, sub, tone = "neutral", testId }: {
  label: string; value: ReactNode; sub?: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad"; testId?: string;
}) {
  const c =
    tone === "good" ? "var(--cc-success)" :
    tone === "warn" ? "var(--cc-warning)" :
    tone === "bad"  ? "var(--cc-destructive)" : "var(--cc-fg)";
  // Task #767 — D2 polish. Tiles render as flush cells inside the
  // outer divide-x strip (no per-tile border / card frame). Padding
  // is intentionally larger than the old boxed version so the row
  // reads as a proper band of money summary, not a thin toolbar.
  return (
    <div className="flex-1 px-4 py-3" data-testid={testId} style={{ borderColor: "var(--cc-border)" }}>
      <div className="text-[10px] uppercase tracking-wide font-semibold mb-1"
           style={{ color: "var(--cc-muted-fg)" }}>{label}</div>
      <div className="text-2xl font-bold mono leading-tight" style={{ color: c }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>{sub}</div>}
    </div>
  );
}

/* --------------------------- Helpers ----------------------------------- */

// Same contract as claim-detail-v2: every relative-time render uses
// the shared `lib/time` module, with hover-for-absolute-time tooltip
// surfaced on the label itself (#562).
function relativeTime(iso: string | null | undefined): React.ReactNode {
  if (!iso) return <>—</>;
  const rel = formatRelative(iso) || "—";
  return <span title={absoluteTooltip(iso)}>{rel}</span>;
}

function auditIcon(action: string) {
  const a = action.toLowerCase();
  if (a.includes("note")) return <Pin className="w-3 h-3" />;
  if (a.includes("email") || a.includes("reply")) return <Mail className="w-3 h-3" />;
  if (a.includes("evidence") || a.includes("attach")) return <Paperclip className="w-3 h-3" />;
  if (a.includes("sop") || a.includes("walk") || a.includes("submit") || a.includes("package")) return <Send className="w-3 h-3" />;
  if (a.includes("classif") || a.includes("complete") || a.includes("approve")) return <CheckCircle2 className="w-3 h-3" />;
  if (a.includes("hold") || a.includes("exclude") || a.includes("reattest")) {
    return <AlertTriangle className="w-3 h-3" />;
  }
  if (a.includes("context")) return <Edit2 className="w-3 h-3" />;
  if (a.includes("close") || a.includes("withdraw") || a.includes("denied")) return <XCircle className="w-3 h-3" />;
  if (a.includes("create")) return <FileText className="w-3 h-3" />;
  return <Clock className="w-3 h-3" />;
}

function auditTone(action: string): string {
  const a = action.toLowerCase();
  if (a.includes("email") || a.includes("reply")) return "var(--cc-purple-fg)";
  if (a.includes("hold") || a.includes("exclude") || a.includes("reattest")) {
    return "var(--cc-warning)";
  }
  if (a.includes("classif") || a.includes("approve") || a.includes("complete")) {
    return "var(--cc-success)";
  }
  if (a.includes("note") || a.includes("context") || a.includes("sop") || a.includes("submit") || a.includes("package")) {
    return "var(--cc-blue-fg)";
  }
  if (a.includes("denied") || a.includes("close") || a.includes("withdraw")) {
    return "var(--cc-destructive)";
  }
  return "var(--cc-muted-fg)";
}

function authorInitial(name: string | null | undefined): string {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase() || "?";
}

/* Offline re-attest override (Task #333) — pure helpers live in
   src/lib/reattest-offline-modal-helpers.ts so the right-rail flow can
   be regression-tested from node:test without dragging the page's
   hook graph into the test runtime (Task #335). */

/* ====================== Denied by Payor confirm row =================== */

/**
 * Right-rail trigger for the LIGHT Denied-by-Payor confirm dialog.
 * Mirrors the visual contract of the buttons emitted by <ClosureActions>
 * (ActionRow, destructive tone, same disabled gate when no response is on
 * file) but routes through useClosureConfirmLauncher instead of the full
 * structured intake — the payor decided this outcome and the response
 * is the record, so the operator just confirms.
 *
 * If the group is already closed via this reason, we render the same
 * "already closed via this lane" hint <ClosureActions> would, so the
 * rail's affordances stay consistent across closed/open groups.
 */
function DeniedByPayorConfirmRow({
  groupId,
  outcome,
  closureReason,
  hasResponse,
  responses,
  onAfterSuccess,
}: {
  groupId: number;
  outcome: string | null | undefined;
  closureReason: string | null | undefined;
  hasResponse: boolean;
  responses: PortalResponseItem[];
  onAfterSuccess?: () => void;
}) {
  const launcher = useClosureConfirmLauncher();
  // vocab-allow-next-line — comparing the API enum literals.
  const alreadyClosedHere = outcome === "Denied" && closureReason === "denied_by_payor";

  if (alreadyClosedHere) {
    return (
      <p
        className="text-xs italic"
        style={{ color: "var(--cc-muted-fg)" }}
        data-testid="v2-group-close-denied-by-payor-already"
      >
        Already closed via Denied by Payor.
      </p>
    );
  }

  const latestResponse = pickLatestReviewableResponse(responses);

  return (
    <>
      <ActionRow
        label="Denied by Payor"
        sub="Payor formally denied — recorded response required"
        disabled={!hasResponse}
        disabledReason={
          hasResponse
            ? "Close because the payor formally denied this group."
            : "Disabled because no portal or email response has been recorded yet."
        }
        testId="v2-group-close-denied-by-payor"
        onClick={() =>
          launcher.open({
            target: { kind: "group", id: groupId },
            response: latestResponse
              ? {
                  responseId: latestResponse.id,
                  source: latestResponse.source,
                  senderName: latestResponse.senderName,
                  senderEmail: latestResponse.senderEmail,
                  receivedAt: latestResponse.receivedAt,
                  responseType: latestResponse.responseType,
                  responseTypeLabel: getResponseTypeLabel(latestResponse.responseType),
                  aiSummary: latestResponse.aiSummary,
                }
              : null,
            onSuccess: () => onAfterSuccess?.(),
          })
        }
      />
      {launcher.dialog}
    </>
  );
}

/* ============================== Page ================================== */

export function InvoiceGroupDetailV2({ groupId, fromManual = false }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const isClerk = user?.role === "clerk";
  const { data: group, isLoading } = useGetInvoiceGroup(groupId, {
    query: { queryKey: getGetInvoiceGroupQueryKey(groupId), enabled: !!groupId },
  });

  // ─────────────────────────────────────────────────────────────────────
  // "Invoice shipped" microinteraction (Task #325). When this group's
  // status flips out of pre-submit (New / Needs Evidence) into in-flight
  // (Portal Queued / Generating Email / Awaiting Response) while the
  // page is mounted — driven by the submission gauntlet's submit-now
  // path or by an SSE broadcast from a collaborator — briefly draw a
  // check inside the group's status pill. We deliberately suppress the
  // animation when the change came from a different operator (so a
  // collaborator's submission doesn't feel like the current user's
  // win). Mirrors the leg-level "you finished a thing" flourish on
  // claim-detail-v2 (Task #315).
  // ─────────────────────────────────────────────────────────────────────
  const { lastGroupUpdateBy } = useInvoiceGroupEvents(groupId);
  // Task #509 — `useTransientFlag` owns the one-shot timers; the
  // gated transition watcher below uses `useActorCausedTransition`.
  // The two flags stay distinct (justShipped for the pill flourish,
  // justCleared for the card fade) so a future tweak to one doesn't
  // re-style the other.
  const { active: justShipped, fire: fireJustShipped } = useTransientFlag(500);
  const { active: justCleared, fire: fireJustCleared } = useTransientFlag(800);

  const replyMutation = useReplyToInvoiceGroupEmailConversation();
  // Legacy threads (pre-conversationId) can't `createReply` against any
  // Graph message — fall back to a fresh send via this mutation so the
  // operator's reply still goes out and is persisted under the group.
  const freshSendMutation = useSendInvoiceGroupEmail();
  const checkEmailMutation = useCheckEmailResponses();
  const createNoteMutation = useCreateInvoiceGroupNote();
  // #687 — note-delete, group-hold place/release, and per-leg
  // MAS-cancel mutations were removed from this page. Hold
  // place/release lives only in the V3HoldExit hero (A); note delete
  // and per-leg MAS cancel live only in queue chrome.
  const updateStatusMutation = useUpdateInvoiceGroupStatus();
  // MAS re-attest mutation — used by the admin "recorded offline"
  // override modal in the right rail (Task #333). The standard
  // checklist-driven completion now lives on Responses Awaiting Review
  // so the detail page right rail is a quiet status panel pointing the
  // operator there.
  const completeReattestMutation = useCompleteGroupReattest();
  // Task #767 — Place/Release hold + Withdraw + Close-as-non-issue
  // were absorbed from GroupDossierChrome into the left-rail
  // "Overrides & Admin" panel as part of the D2 full-page graduation.
  const holdMutation = useHoldInvoiceGroup();
  const removeHoldMutation = useRemoveInvoiceGroupHold();
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [closeNonIssueOpen, setCloseNonIssueOpen] = useState(false);

  /* ---- Group note composer (POST /invoice-groups/:id/notes) ---- */
  const [newNote, setNewNote] = useState("");
  // Task #833 — compact Communication card pairs with a full-thread reply
  // dialog (the same one ConversationSection mounts). The card itself is
  // a one-line summary now; everything substantive — reading prior
  // messages in full, composing a reply with To/CC/Subject/attachments/AI
  // upgrade — lives inside this dialog so operators read & reply on the
  // same surface.
  const [threadDialogOpen, setThreadDialogOpen] = useState(false);
  const [threadScrollTargetId, setThreadScrollTargetId] = useState<string | null>(null);
  // Save-confirmation breath replaces the success toast for routine saves
  // (Task #316). Errors still toast via the mutation's onError below.
  const noteBreath = useBreath();

  /* #687 — group-hold prompt removed; only V3HoldExit hero (A) places
     or releases holds now. */


  /* ---- Admin override modal (Task #333). Lets an admin record that
     the MAS re-attest happened outside the in-app checklist (paper
     log, after-the-fact correction). Requires a >=10-char trimmed
     note + an explicit confirm checkbox before the submit button
     enables. The non-admin path on this page is a quiet status panel
     pointing the operator at Responses Awaiting Review for the real
     checklist work. */
  const [offlineModalOpen, setOfflineModalOpen] = useState(false);
  const [offlineNote, setOfflineNote] = useState("");
  const [offlineConfirmed, setOfflineConfirmed] = useState(false);
  // Inline error surface for the override modal. Toasts are easy to
  // miss when the user's eyes are on the form, so 400 ("note too
  // short" — server-side validation) and 403 ("admin only") responses
  // are also pinned next to the submit row. Cleared on every retry,
  // on close, and on success.
  const [offlineErrorMsg, setOfflineErrorMsg] = useState<string | null>(null);
  const [offlineErrorKind, setOfflineErrorKind] = useState<"forbidden" | "validation" | "other" | null>(null);
  const offlineNoteTrim = offlineNote.trim();
  const offlineNoteValid = isOfflineReattestNoteValid(offlineNote);
  const canSubmitOffline = canSubmitOfflineReattest({
    note: offlineNote,
    confirmed: offlineConfirmed,
    isPending: completeReattestMutation.isPending,
  });
  function resetOfflineForm() {
    setOfflineNote("");
    setOfflineConfirmed(false);
    setOfflineErrorMsg(null);
    setOfflineErrorKind(null);
  }

  const { data: validTransitions } = useGetInvoiceGroupValidTransitions(groupId, {
    query: {
      queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId),
      enabled: groupId > 0,
    },
  });

  const detail = group as InvoiceGroupDetailResponse | undefined;
  const allRides: ClaimResponse[] = detail?.rides ?? [];
  // Task #555 — the Legs Queue's default surface is "actionable":
  // legs that are *both* in the dispute and not a sibling-duplicate
  // pointer. Excluded rows (Non-issue / withdrawn from dispute) and
  // duplicates of another leg in the same group both collapse behind
  // the "+N hidden" disclosure so the operator's primary view stays
  // focused on legs that actually need a decision.
  const disputedRides = useMemo(
    () =>
      allRides.filter(
        (r) =>
          r.includedInDispute !== false &&
          (r.duplicateOfClaimId == null),
      ),
    [allRides],
  );
  const hiddenCount = allRides.length - disputedRides.length;
  const isPreSubmit = group?.status === "New" || group?.status === "Needs Evidence";

  useActorCausedTransition<string>({
    key: `group:${groupId}`,
    lastUpdateBy: lastGroupUpdateBy,
    currentValue: group?.status,
    // Two milestone moments share the pill flourish:
    //   • "shipped" — pre-submit → in-flight (dispute is out the door)
    //   • "cleared" — every open claim resolved and the group closes
    //                 (Resolved / Denied / Withdrawn). Same visual,
    //                 no confetti — the day-complete burst is reserved
    //                 for end-of-day, per-group close-outs are quieter.
    isTransition: (prev, next) =>
      (isPreSubmitFn(prev) && isInFlight(next)) ||
      (!isClosed(prev) && isClosed(next)),
    onTransition: (next, prev) => {
      fireJustShipped();
      // Card-level fade ONLY on the cleared transition so the operator
      // perceives the *card* as completing. CSS animation is 700ms;
      // flag duration is 800ms to give a small post-animation buffer.
      if (!isClosed(prev) && isClosed(next)) {
        fireJustCleared();
      }
    },
  });

  /* Aggregate-context state removed in Task #265 — per-leg context lives
     on each leg row in the queue and the editable AI write-up replaces
     the group-level narrative form. */

  /* ---- KPI strip values ---- */
  const totalExposure = useMemo(() => {
    return allRides.reduce(
      (sum, r) => sum + Number(r.claimAmount ?? 0),
      0,
    );
  }, [allRides]);
  const inDisputeAmount = useMemo(() => {
    return disputedRides
      .filter((r) => r.outcome !== "Approved")
      .reduce((sum, r) => sum + Number(r.claimAmount ?? 0), 0);
  }, [disputedRides]);
  const inDisputeCount = useMemo(
    () => disputedRides.filter((r) => r.outcome !== "Approved").length,
    [disputedRides],
  );
  const excludedAmount = useMemo(() => {
    return allRides
      .filter((r) => r.includedInDispute === false)
      .reduce((sum, r) => sum + Number(r.claimAmount ?? 0), 0);
  }, [allRides]);
  const recoveredAmount = useMemo(() => {
    return allRides.reduce(
      (sum, r) => sum + Number(r.approvedAmount ?? 0),
      0,
    );
  }, [allRides]);
  const daysInQueue = useMemo(() => {
    if (!group?.createdAt) return 0;
    const ms = Date.now() - new Date(group.createdAt).getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
  }, [group?.createdAt]);

  /* ---- Disputed-only filter ----
     Default to showing ALL legs so excluded ones (e.g. Non-issue) still
     appear — greyed out via `opacity-60` on the row — instead of being
     silently dropped. The KPI strip and group header both claim N legs
     exist, so the table needs to match. The operator can still toggle
     "Disputed only" to focus the table on actionable legs. */
  // Task #555 — Legs Queue defaults to disputed-only; the disclosure
  // surfaces excluded / sibling-duplicate rows on demand.
  const [disputedOnly, setDisputedOnly] = useState(true);
  // Horizontal scroll strip for the legs grid when there are 3+ legs.
  // Chevron buttons in the section header drive it via scrollBy().
  const legsStripRef = useRef<HTMLDivElement | null>(null);
  const visibleRides = disputedOnly ? disputedRides : allRides;

  /* ---- Notes / Audit (from detail payload) ---- */
  const visibleNotes = useMemo<NoteResponse[]>(() => {
    if (!detail?.notes) return [];
    return detail.notes
      .filter((n) => n.type === "manual" || n.type === "system" || n.type === "bot")
      .slice()
      .sort(
        (a, b) =>
          new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      );
  }, [detail?.notes]);
  const sortedAudit = useMemo<AuditLogResponse[]>(() => {
    if (!detail?.auditLogs) return [];
    return detail.auditLogs
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [detail?.auditLogs]);

  /* ---- Communication thread ---- */
  const { data: emailThread } = useGetInvoiceGroupEmailThread(groupId);
  const legIdToLabel = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of allRides) {
      map.set(r.id, r.confNumber ? `${r.confNumber}` : `Leg #${r.id}`);
    }
    return map;
  }, [allRides]);
  const conversations = useMemo(
    () => mapToGroupConversations(emailThread, legIdToLabel),
    [emailThread, legIdToLabel],
  );
  // Task #833 — the latest conversation is what the compact Communication
  // card summarizes and what the full-thread reply dialog opens against.
  // When the group has no conversations yet (pre-payor-response), the
  // dialog stays unrenderable and the card shows an empty-state.
  const latestConversation = useMemo(() => {
    if (conversations.length === 0) return null;
    return [...conversations].sort(
      (a, b) =>
        new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime(),
    )[0];
  }, [conversations]);
  // Task #833 — deep-link handler. The "Responses Awaiting Review" panel
  // links here as `/invoice-groups/:id#invoice-thread` (open thread, no
  // scroll target) and `/invoice-groups/:id#response-{messageId}` (open
  // thread and scroll the dialog's conversation panel to that message).
  // Watch the hash on mount, and also on `hashchange` so navigating
  // between two response links within the same page still re-opens the
  // dialog on the right message.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const applyHash = () => {
      const hash = window.location.hash || "";
      if (hash === "#invoice-thread") {
        if (latestConversation) {
          setThreadScrollTargetId(null);
          setThreadDialogOpen(true);
        }
      } else if (hash.startsWith("#response-")) {
        if (latestConversation) {
          setThreadScrollTargetId(hash.slice("#response-".length));
          setThreadDialogOpen(true);
        }
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [latestConversation]);
  const computedBanner = useMemo(
    () => pickGroupBannerData(emailThread),
    [emailThread],
  );
  const [bannerDismissedAt, setBannerDismissedAt] = useState<string | null>(null);
  const bannerData =
    computedBanner &&
    (!bannerDismissedAt || computedBanner.timestamp > bannerDismissedAt)
      ? computedBanner
      : null;

  function invalidateGroup() {
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: getGetInvoiceGroupValidTransitionsQueryKey(groupId) });
    qc.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
  }

  // Task #265 removed onSaveGroupContext — the group-aggregate-context
  // surface no longer exists; per-leg context lives directly on each
  // leg row in the queue.
  //
  // The communications/email-thread wiring (Task #240) and the extracted
  // submission gauntlet (Task #232) are configured higher up in this
  // component (see toast/emailThread/conversations/replyMutation setup
  // around the data-loading section).

  function onSyncInbox() {
    checkEmailMutation.mutate(
      { data: { hoursBack: 24 } },
      {
        onSuccess: () => {
          successToast({ title: "__VERB__", description: "Inbox synced — pulled new payor replies into the thread." });
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupEmailThreadQueryKey(groupId) });
          qc.invalidateQueries({ queryKey: getGetInvoiceGroupQueryKey(groupId) });
        },
        onError: (e: unknown) =>
          toast({
            title: "Sync failed",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  function onSubmitNote() {
    const trimmed = newNote.trim();
    if (!trimmed) return;
    createNoteMutation.mutate(
      { id: groupId, data: { content: trimmed } },
      {
        // Task #411 audit, Tier 4: optimistically splice the new note
        // into the cached invoice-group detail so it renders instantly
        // instead of vanishing until the next SSE-triggered refetch
        // (the "submit → empty list briefly → reappears" flicker).
        onSuccess: (created) => {
          setNewNote("");
          noteBreath.trigger();
          if (created) {
            qc.setQueryData<InvoiceGroupDetailResponse | undefined>(
              getGetInvoiceGroupQueryKey(groupId),
              (prev: InvoiceGroupDetailResponse | undefined) => {
                if (!prev) return prev;
                const existing: NoteResponse[] = Array.isArray(prev.notes) ? prev.notes : [];
                if (existing.some((n: NoteResponse) => n.id === created.id)) return prev;
                return { ...prev, notes: [created, ...existing] };
              },
            );
          }
          invalidateGroup();
        },
        onError: (e: unknown) =>
          toast({
            title: "Failed to add note",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  }

  /* Task #767 — onPlaceHold / onClearHold returned here (left rail
     "Overrides & Admin" panel) when GroupDossierChrome was absorbed
     into the D2 3-col page. Note delete is still queue-chrome-only;
     V3HoldExit hero (A) remains the queue-side hold surface. */
  function onPlaceHold() {
    const reason = holdReason.trim();
    if (!reason) return;
    holdMutation.mutate(
      { id: groupId, data: { reason } },
      {
        onSuccess: () => {
          invalidateGroup();
          successToast({ title: "__VERB__", description: "Group placed on hold." });
          setHoldOpen(false);
          setHoldReason("");
        },
        onError: (err: unknown) =>
          toast({
            title: "Failed to place on hold",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          }),
      },
    );
  }
  function onClearHold() {
    removeHoldMutation.mutate(
      { id: groupId },
      {
        onSuccess: () => {
          invalidateGroup();
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

  const isReady = !isLoading && !!group && !!detail;
  const isAlreadyClosed = group?.status === "Resolved" || group?.status === "Denied";

  return (
    <div className="cc-scope min-h-screen p-6" style={{ background: "var(--cc-bg)", color: "var(--cc-fg)" }} data-testid="invoice-group-detail-v2">
      <SkeletonSwap
        loading={!isReady}
        className="max-w-[1440px] mx-auto"
        skeleton={
          <div className="space-y-4" data-testid="invoice-group-detail-v2-skeleton">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
      {group && detail ? (
      <div className="space-y-4">
        {/* Read-only banner shown when this is the global "tour sample"
            row (seeded by migration 0029). The pair exists only so the
            in-app guided tour can anchor steps 18 & 20 on a real detail
            page. Mutations are blocked at the API layer. */}
        {(detail as { isTourSample?: boolean })?.isTourSample && (
          <div
            className="text-xs px-3 py-2 rounded border flex items-center gap-2"
            style={{ background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)", borderColor: "var(--cc-border)" }}
            data-testid="tour-sample-banner"
          >
            <Sparkles className="w-3.5 h-3.5 flex-shrink-0" />
            <span>
              <strong>Tour sample.</strong> This is the read-only group used by the in-app tour. Edits are disabled.
            </span>
          </div>
        )}

        {/* Task #767 — guidance banner absorbed from the retired
            GroupDossierChrome. Set by `?from=manual` query param when
            the operator arrived from the manual-entry intake flow so
            they know to pick error types per leg before walking the
            SOP. */}
        {fromManual && (
          <div
            className="rounded-md border px-4 py-3 flex items-start gap-3"
            style={{
              background: TONE_STYLE.purple.bg,
              borderColor: TONE_STYLE.purple.border,
              color: TONE_STYLE.purple.fg,
            }}
            data-testid="banner-from-manual"
          >
            <Sparkles className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              Invoice saved. Pick an error type for each leg below to start triage,
              then walk the SOP and queue the dispute.
            </div>
          </div>
        )}

        {/* Back + breadcrumb (hybrid).
            ──────────────────────────────────────────────────────────────
            Previously the breadcrumb labeled the first crumb "Invoice
            groups" but linked to "/" — which redirects to /dashboard.
            Operators clicking "Invoice groups" expecting to return to
            the list landed on the dashboard instead. The crumb is now
            honest, and the explicit Back button gives true N-1 so a user
            who arrived from the queue / dashboard / response review still
            returns where they came from. */}
        <BackBar
          fallbackHref="/invoice-groups"
          crumbs={[
            { label: "Invoice groups", href: "/invoice-groups" },
            {
              label: group.invoiceNumber ? (
                <RefNumber value={group.invoiceNumber} variant="inline" />
              ) : (
                <span className="mono">#{group.id}</span>
              ),
              mono: true,
            },
          ]}
          testId="invoice-group-back-bar"
        />
        {/* Hidden compatibility marker — older e2e selectors looked for
            a `leg-back-to-group`-shaped affordance on the parent page. The
            BackBar replaces both, but we keep the import alive without a
            stale node so a future refactor sees the intentional removal. */}

        {/* Accent header */}
        <div
          className={`cc-card p-4${justCleared ? " cc-card-just-cleared" : ""}`}
          data-just-cleared={justCleared ? "true" : undefined}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              {/* Task #767 — accent bar color reflects the group's
                  status tone so operators can scan the header in one
                  glance (green = verdict in hand, blue = in-flight,
                  amber = blocked / on hold, red = denied / withdrawn,
                  purple = pre-submit drafting). */}
              <div className="w-1 h-12 rounded" style={{ background: statusAccent(group.status).fg }} />
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide font-semibold mb-0.5"
                     style={{ color: "var(--cc-muted-fg)" }}>
                  Invoice group
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold mono inline-flex items-center gap-2">
                    {group.invoiceNumber ? (
                      <RefNumber value={group.invoiceNumber} variant="chip" />
                    ) : (
                      <span>#{group.id}</span>
                    )}
                  </h1>
                  {/* Task #555 — phase chip is now the primary state
                       affordance on this surface; the database-stored
                       `status` is demoted to a small "(cached)" sub-
                       label so operators can still spot drift between
                       the computed phase and the persisted column
                       without it dominating the header. */}
                  <StateBadge
                    variant="phase"
                    value={(group as { phase?: string }).phase ?? "triage"}
                    justTransitioned={justShipped}
                    data-testid="header-phase-chip"
                  />
                  <span
                    className="text-[10px] font-normal"
                    style={{ color: "var(--cc-muted-fg)" }}
                    data-testid="header-status-cached"
                  >
                    (cached: {group.status})
                  </span>
                  {/* Task #555 — computed group outcome lives in the
                       header so the operator's first glance answers
                       "where did this dispute land?" without scrolling
                       to the verdict card. The value is recomputed
                       from per-leg verdicts on every render via the
                       shared helper; the persisted `group.outcome`
                       column is intentionally NOT read here so a stale
                       row never misleads the surface. */}
                  {(() => {
                    const computed = deriveGroupOutcomeFromLegs(allRides).outcome;
                    if (!computed) return null;
                    return (
                      <StateBadge
                        variant="outcome"
                        value={computed}
                        data-testid="header-computed-outcome"
                      />
                    );
                  })()}
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>·</span>
                  <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                    {group.errorTypeName ? <>{group.errorTypeName} · </> : null}
                    <span className="font-medium mono" style={{ color: "var(--cc-fg)" }}>
                      {allRides.length} leg{allRides.length === 1 ? "" : "s"}
                    </span>
                    <HideForClerk>
                      {" · "}
                      <span className="font-medium mono" style={{ color: "var(--cc-fg)" }}>
                        {formatCurrency(group.totalAmount ?? "0")}
                      </span>
                    </HideForClerk>
                  </span>
                </div>
                <div className="text-xs mt-1.5" style={{ color: "var(--cc-muted-fg)" }}>
                  {group.updatedAt ? (
                    <>Updated <span className="font-medium" style={{ color: "var(--cc-fg)" }}>{relativeTime(group.updatedAt)}</span> · </>
                  ) : null}
                  {daysInQueue}d in queue
                  {inDisputeCount > 0
                    ? ` · ${inDisputeCount} of ${allRides.length} legs in dispute`
                    : null}
                  {/* #687 — read-only hold meta line. Place/release lives
                      in the V3HoldExit hero in A only. */}
                  {group.holdReason ? (
                    <>
                      {" · "}
                      <span
                        data-testid="group-header-hold-meta"
                        title={
                          (group as { holdPlacedAt?: string | null }).holdPlacedAt
                            ? `Placed ${formatDateTime(
                                (group as { holdPlacedAt?: string | null })
                                  .holdPlacedAt as string,
                              )}${
                                (group as { holdPendingFrom?: string | null })
                                  .holdPendingFrom
                                  ? ` · pending from ${
                                      (group as { holdPendingFrom?: string | null })
                                        .holdPendingFrom
                                    }`
                                  : ""
                              }`
                            : undefined
                        }
                      >
                        On hold:{" "}
                        <span className="font-medium" style={{ color: "var(--cc-fg)" }}>
                          {group.holdReason}
                        </span>
                      </span>
                    </>
                  ) : null}
                </div>
                {/* Service-date strip (Task #353). Re-uses the same enum
                    the list cell consumes so the empty-state language is
                    identical across surfaces. Hidden when no group id is
                    available (defensive — the header always has one). */}
                {group.id != null ? (
                  <div className="mt-1.5">
                    <ServiceDateBanner
                      groupId={group.id as number}
                      earliestDate={(group as { earliestDate?: string | null }).earliestDate ?? null}
                      reason={(group as { serviceDateReason?: ServiceDateReason | null }).serviceDateReason ?? null}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Task #555 — single sectioned "Transitions" dropdown.
                   Top section is *Phase actions* (Submit dispute,
                   Mark MAS Eligible, Place on hold / Clear hold) —
                   visible to every operator and gated by the server's
                   valid-transitions response. Bottom section is
                   *Status overrides* — admin-only, lists every
                   server-allowed status (typically backwards
                   transitions) so non-admins never see the raw enum.
                   Submit itself still lives inside the gauntlet because
                   that's where the readback / leg-resolution gates
                   live; the menu item scrolls to the gauntlet so the
                   operator lands on the actual submit button with all
                   its context. */}
              {(() => {
                // Task #555 — partition the server's `validStatuses`
                // into Phase actions vs Status overrides by comparing
                // each candidate's lifecycle phase against the
                // group's current phase using PHASE_ORDER:
                //   • Forward / same-phase / on-hold  → phase action
                //     (the operational menu every operator sees)
                //   • Backward in phase order         → status override
                //     (admin-only escape hatch — typically un-doing
                //     a transition the workflow already advanced past)
                // Hold and Clear hold both flow through this filter
                // — the server only lists "On Hold" while clearing is
                // possible and only lists the un-hold target while
                // already on hold, so we don't need to second-guess
                // it with hardcoded current-status checks. Submit
                // itself is not a status (it's a side-effecting
                // action that emits a status change), so we surface
                // it whenever the current phase is pre-submit.
                const allowed = validTransitions?.validStatuses ?? [];
                const { overrideStatuses } =
                  partitionTransitions(group?.status, allowed, !!isAdmin);
                // #687 — Place-/Clear-hold dropdown items removed; hold
                // is owned by the V3HoldExit hero in A.
                const showSubmit = isPreSubmitFn(group?.status);
                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5"
                        style={{ border: "1px solid var(--cc-border)" }}
                        data-testid="header-transitions-trigger"
                      >
                        Transitions
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[220px]">
                      <DropdownMenuLabel data-testid="transitions-section-phase">
                        Phase actions
                      </DropdownMenuLabel>
                      {/* Task #659 — submission no longer happens on this
                          page. Operators reach the gauntlet from the queue
                          via the dossier's "Process this invoice in the
                          queue →" CTA. The Submit dispute dropdown item
                          and gauntlet card are intentionally removed.
                          Task #681 — "Mark MAS Eligible" dropdown item
                          also removed; the queue is the only operator
                          surface that mutates state. The auto-import
                          path in pages/import.tsx still uses the hook. */}
                      {/* #687 — Place/Clear hold dropdown items removed.
                          Hold is now owned by the V3HoldExit hero in A
                          (inline-group-workspace-mini.tsx). */}
                      <DropdownMenuItem
                        disabled
                        data-testid="header-phase-empty"
                      >
                        No phase actions available
                      </DropdownMenuItem>
                      {overrideStatuses.length > 0 && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel data-testid="transitions-section-overrides">
                            Status overrides (admin)
                          </DropdownMenuLabel>
                          {overrideStatuses.map((s) => (
                            <DropdownMenuItem
                              key={s}
                              disabled={updateStatusMutation.isPending}
                              onSelect={() =>
                                updateStatusMutation.mutate(
                                  { id: groupId, data: { status: s } },
                                  {
                                    onSuccess: () => {
                                      invalidateGroup();
                                      successToast({
                                        title: "__VERB__",
                                        description: `Status set to ${s}.`,
                                        duration: 3000,
                                      });
                                    },
                                    onError: (e: unknown) =>
                                      toast({
                                        title: "Could not update status",
                                        description:
                                          e instanceof Error ? e.message : String(e),
                                        variant: "destructive",
                                      }),
                                  },
                                )
                              }
                              data-testid={`header-status-override-${s}`}
                            >
                              {s}
                            </DropdownMenuItem>
                          ))}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Response-received banner — D2 polish: compact blue strip with
            a one-line truncated preview and a Jump-to-thread anchor that
            scrolls to the Communication card in the right rail. The
            previous amber-bordered banner was rendering the full payor
            email body (raw HTML / inline <script> text included),
            producing a ~30-line wall instead of a one-line tease. The
            preview is sanitized to a single line below so the truncate
            class can actually clip it. */}
        {bannerData && (() => {
          const oneLinePreview = (bannerData.preview ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 240);
          return (
            <div
              className="flex items-start gap-3 px-4 py-2.5"
              style={{
                background: "var(--cc-blue-bg)",
                borderTop: "1px solid var(--cc-blue-border)",
                borderBottom: "1px solid var(--cc-blue-border)",
              }}
              data-testid="response-received-banner"
            >
              <MessageSquare
                className="w-4 h-4 mt-0.5 shrink-0"
                style={{ color: "var(--cc-blue-fg)" }}
              />
              <div className="flex-1 min-w-0 text-sm" style={{ color: "var(--cc-blue-fg)" }}>
                <p className="font-semibold mb-0.5">
                  New response from payor
                  {bannerData.subject ? <> · {bannerData.subject}</> : null}
                  {" · "}
                  {relativeTime(bannerData.timestamp)}
                </p>
                {oneLinePreview && (
                  <p className="opacity-90 truncate max-w-4xl">
                    "{oneLinePreview}"
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href="#invoice-thread"
                  className="cc-btn cc-btn-sm"
                  style={{
                    background: "rgba(255,255,255,0.5)",
                    color: "var(--cc-blue-fg)",
                    borderColor: "var(--cc-blue-border)",
                  }}
                  data-testid="response-received-banner-jump"
                >
                  Jump to thread
                </a>
                <button
                  title="Mark read"
                  className="w-7 h-7 rounded inline-flex items-center justify-center"
                  style={{ color: "var(--cc-blue-fg)", opacity: 0.7 }}
                  onClick={(e) => {
                    e.preventDefault();
                    setBannerDismissedAt(computedBanner?.timestamp ?? null);
                  }}
                  data-testid="response-received-banner-dismiss"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })()}

        {/* KPI strip — money tiles hidden for clerks (sums of nulls
            would otherwise leak as $0.00). D2 polish (Task #767): a
            single divide-x strip inside one card frame instead of five
            boxed tiles, so the row reads as one band of summary data
            instead of competing for attention with the body cards. */}
        <div className={`cc-card flex ${isClerk ? "" : "divide-x"}`} style={{ borderColor: "var(--cc-border)" }}>
          <HideForClerk>
            <Kpi
              label="Total exposure"
              value={formatCurrency(totalExposure.toFixed(2))}
              sub={`${allRides.length} leg${allRides.length === 1 ? "" : "s"}`}
              testId="kpi-total-exposure"
            />
            <Kpi
              label="In dispute"
              value={formatCurrency(inDisputeAmount.toFixed(2))}
              sub={`${inDisputeCount} leg${inDisputeCount === 1 ? "" : "s"}`}
              tone="warn"
              testId="kpi-in-dispute"
            />
            <Kpi
              label="Non-issue"
              value={formatCurrency(excludedAmount.toFixed(2))}
              sub={hiddenCount > 0 ? `${hiddenCount} leg${hiddenCount === 1 ? "" : "s"}` : "—"}
              testId="kpi-excluded"
            />
            <Kpi
              label="Recovered"
              value={formatCurrency(recoveredAmount.toFixed(2))}
              sub={recoveredAmount > 0 ? "approved" : "—"}
              tone="good"
              testId="kpi-recovered"
            />
          </HideForClerk>
          <Kpi
            label="Days in queue"
            value={String(daysInQueue)}
            tone={daysInQueue > 12 ? "warn" : "neutral"}
            testId="kpi-days-in-queue"
          />
        </div>

        {/* D2 3-col shell (Task #767). LEFT 260px = orientation +
            admin (Primary Action → Submission Summary → Group Details
            → MAS Action → Overrides & Admin → Close this group).
            CENTER flex-1 = the actual body (Disputed Legs + Invoice-
            wide context). RIGHT 320px = ambient surfaces
            (Communication → Payor responses → Group Evidence → Notes
            → Activity history → Sync inbox). Replaces the legacy
            8/4 grid + the now-retired GroupDossierChrome top panel. */}
        <div className="flex gap-4 items-start" data-testid="group-detail-3col-shell">

          {/* LEFT — orientation + admin (260px) */}
          <aside className="w-[260px] shrink-0 space-y-4" data-testid="group-detail-left-rail">

            {/* Phase-aware Primary Action — single next-step CTA so
                the operator's first glance answers "what do I do
                next?". Mutations live in queue chrome / ClosureActions
                / MAS panel below — this card just routes. */}
            <PrimaryActionTile
              group={group}
              outlook={deriveInvoiceDisputeOutlook(group, allRides).outlook}
              anyDisputableLegs={disputedRides.length > 0}
              anyDisputableNeedsEvidence={group.status === "Needs Evidence"}
            />

            {/* Submission Summary — read-only snapshot of where this
                group is in the submission pipeline. Absorbed from
                GroupDossierChrome (Task #767). Stats stack vertically
                in the narrow 260px rail instead of the chrome's
                3-column grid. */}
            <CcCard
              title="Submission summary"
              icon={<FileText className="w-3.5 h-3.5" />}
              testId="group-detail-submission-summary-readonly"
              action={(() => {
                // Task #767 — status pill picks up the same accent
                // palette as the header rail bar so the operator's eye
                // is drawn to "where is this group right now" without
                // reading the text first (Ready to Review = green pill,
                // Awaiting Response = blue, On Hold = amber, etc).
                const tone = statusAccent(group.status);
                return (
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border"
                    style={{ background: tone.bg, color: tone.fg, borderColor: tone.border }}
                    data-testid="group-detail-submission-summary-status"
                  >
                    {group.status || "—"}
                  </span>
                );
              })()}
            >
              <div className="text-[11px] mb-3" style={{ color: "var(--cc-muted-fg)" }}>
                Read-only snapshot of where this group is in the
                submission pipeline. Operator actions live in the queue.
              </div>
              <div className="space-y-2">
                <SubmissionSummaryStat
                  label="Preview generated"
                  value={(group as { previewGeneratedAt?: string | null }).previewGeneratedAt ?? null}
                  testId="group-detail-summary-preview-at"
                />
                <SubmissionSummaryStat
                  label="Draft reviewed"
                  value={(group as { draftReviewedAt?: string | null }).draftReviewedAt ?? null}
                  testId="group-detail-summary-reviewed-at"
                />
                <SubmissionSummaryStat
                  label="Last submitted"
                  value={group.disputeEmailSentAt ?? null}
                  testId="group-detail-summary-submitted-at"
                />
              </div>
              <Link
                href={`/queue?group=${groupId}`}
                data-testid="group-detail-cta-process-in-queue"
                className="mt-3 pt-3 -mx-3 -mb-3 px-3 py-3 flex items-center justify-between gap-3 hover:opacity-90 transition-opacity rounded-b"
                style={{ borderTop: "1px solid var(--cc-border)", color: "var(--cc-fg)" }}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: "var(--cc-purple-fg)" }} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium">Process in queue</div>
                    <div className="text-[10px] mt-0.5" style={{ color: "var(--cc-muted-fg)" }}>
                      Triage, preview, review, send.
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 flex-shrink-0" />
              </Link>
            </CcCard>

            {/* Group details — moved here from the legacy 8-col area
                so static metadata reads as orientation in the left
                rail (D2 layout). */}
            <CcCard
                title="Group details"
                icon={<FileText className="w-3.5 h-3.5" />}
                testId="group-details-card"
                action={
                  <Link
                    href={`/invoice-groups/${groupId}`}
                    className="cc-btn text-xs gap-1 inline-flex items-center px-2 py-1"
                    style={{ border: "1px solid var(--cc-border)" }}
                  >
                    <Edit2 className="w-3 h-3" /> Edit
                  </Link>
                }
              >
                <div className="space-y-0">
                  <FieldRow label="Invoice #" value={group.invoiceNumber ? <RefNumber value={group.invoiceNumber} variant="inline" /> : <span className="mono">#{group.id}</span>} />
                  <FieldRow
                    label="Member ID"
                    value={(() => {
                      const id = group.clientNumber || allRides.find((r) => r.clientNumber)?.clientNumber;
                      return id ? <span className="mono">{id}</span> : <span style={{ color: "var(--cc-muted-fg)" }}>—</span>;
                    })()}
                  />
                  <FieldRow
                    label="Drivers"
                    value={(() => {
                      const cars = Array.from(
                        new Set(allRides.map((r) => r.carNumber).filter((c): c is string => !!c && c.trim().length > 0)),
                      );
                      return cars.length > 0
                        ? <span className="mono">{cars.map((c) => `Car ${c}`).join(", ")}</span>
                        : <span style={{ color: "var(--cc-muted-fg)" }}>—</span>;
                    })()}
                  />
                  <FieldRow
                    label="Submitted"
                    value={
                      group.disputeEmailSentAt
                        ? <span className="mono">{formatDateTime(group.disputeEmailSentAt)}</span>
                        : <span style={{ color: "var(--cc-muted-fg)" }}>—</span>
                    }
                  />
                  <FieldRow
                    label="Error type"
                    value={group.errorTypeName || <span style={{ color: "var(--cc-muted-fg)" }}>—</span>}
                  />
                  <FieldRow
                    label="Closure reason"
                    value={
                      group.closureReason
                        ? group.closureReason
                        : <span style={{ color: "var(--cc-muted-fg)" }}>n/a</span>
                    }
                  />
                </div>
              </CcCard>
              {/* MAS action — quiet status panel (Task #333). The actual
                cancel-in-MAS + re-attest checklist lives on the
                Responses Awaiting Review (RAR) workspace; this card
                points the operator there instead of duplicating the
                playbook in the right rail. Admins get a subdued
                "Mark as already re-attested" link below the panel
                that opens the offline-recording override modal. */}
            {group.reattestRequired && (
              <CcCard
                title="MAS action"
                icon={<Stamp className="w-3.5 h-3.5" />}
                testId="group-reattest-summary-card"
                action={
                  <span
                    className="text-xs px-2 py-0.5 rounded font-semibold"
                    style={
                      group.reattestCompletedAt
                        ? { background: "var(--cc-green-bg)", color: "var(--cc-green-fg)" }
                        : { background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)" }
                    }
                  >
                    {group.reattestCompletedAt ? "Reattest complete" : "Reattest required"}
                  </span>
                }
              >
                {group.reattestCompletedAt ? (
                  <div className="space-y-2" data-testid="group-reattest-complete">
                    <p className="text-xs" style={{ color: "var(--cc-fg)" }}>
                      Reattestation complete · <span className="mono">{formatDateTime(group.reattestCompletedAt)}</span>
                      {group.reattestCompletedBy ? ` by ${group.reattestCompletedBy}` : ""}
                    </p>
                    {group.reattestNote && (
                      <p className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>{group.reattestNote}</p>
                    )}
                  </div>
                ) : (
                  <div data-testid="group-reattest-pending" className="space-y-3">
                    {/* #687 — MasActionChecklist mount removed from the
                         detail page. Per-leg MAS cancel is owned by the
                         queue chrome; the admin-only "recorded offline"
                         override below stays here for re-attest. */}
                    {canShowOfflineReattestOverride({
                      isAdmin,
                      reattestRequired: !!group.reattestRequired,
                      reattestCompletedAt: group.reattestCompletedAt,
                    }) && (
                      <div
                        className="pt-2 mt-1"
                        style={{ borderTop: "1px dashed var(--cc-border)" }}
                        data-testid="reattest-admin-overrides"
                      >
                        <div
                          className="text-[10px] uppercase tracking-wide mb-1"
                          style={{ color: "var(--cc-muted-fg)" }}
                        >
                          Admin overrides
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            resetOfflineForm();
                            setOfflineModalOpen(true);
                          }}
                          className="text-xs hover:underline inline-flex items-center gap-1"
                          style={{ color: "var(--cc-amber-fg)" }}
                          data-testid="button-open-mark-reattested-offline"
                        >
                          <ClipboardCheck className="w-3 h-3" /> Mark as already re-attested →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </CcCard>
            )}

              {/* Overrides & admin — operator-only escalations (Task #767,
                  absorbed from GroupDossierChrome). D2 graduation
                  consolidates Place/Release hold, Withdraw, Reclassify,
                  Mark duplicates, AND Close-this-group into a single
                  card with compact list-style rows (mockup's AdminRow). */}
              <CcCard
                title="Overrides & Admin"
                testId="group-detail-overrides-card"
                tone="purple"
                padded={false}
                action={
                  <span className="text-[9px] uppercase tracking-wider font-bold opacity-70">
                    Operator only
                  </span>
                }
              >
                <div className="p-1.5 flex flex-col gap-0.5">
                  {group.status === "On Hold" ? (
                    <AdminRow
                      label="Release hold"
                      icon={<PlayCircle className="w-3.5 h-3.5" />}
                      onClick={onClearHold}
                      disabled={removeHoldMutation.isPending}
                      testId="group-detail-action-release-group-hold"
                    />
                  ) : (
                    <AdminRow
                      label="Place on hold"
                      icon={<PauseCircle className="w-3.5 h-3.5" />}
                      onClick={() => setHoldOpen(true)}
                      disabled={isAlreadyClosed || holdMutation.isPending}
                      testId="group-detail-action-place-group-hold"
                    />
                  )}
                  <AdminRow
                    label="Withdraw"
                    icon={<XCircle className="w-3.5 h-3.5" />}
                    onClick={() => setWithdrawOpen(true)}
                    testId="group-detail-action-withdraw-group"
                  />
                  <AdminRow
                    label="Close as non-issue"
                    icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                    onClick={() => setCloseNonIssueOpen(true)}
                    testId="group-detail-action-close-as-non-issue"
                  />
                  <AdminRow
                    label="Reclassify legs"
                    icon={<Layers className="w-3.5 h-3.5" />}
                    asAnchor
                    anchorHref="#group-detail-section-legs"
                    testId="group-detail-action-reclassify-group"
                  />
                  <AdminRow
                    label="Mark duplicates"
                    icon={<Copy className="w-3.5 h-3.5" />}
                    asAnchor
                    anchorHref="#group-detail-section-legs"
                    testId="group-detail-action-mark-duplicate"
                  />
                </div>

                {/* Close-this-group footer (mockup pattern) — sits inside
                    the same Overrides card on a muted strip, with the
                    Denied-by-Payor confirm row + Cannot-Dispute trigger
                    (when not yet submitted) as compact reasons. */}
                <div
                  className="p-2 space-y-1.5"
                  style={{
                    borderTop: "1px solid var(--cc-border)",
                    background: "color-mix(in srgb, var(--cc-muted) 30%, transparent)",
                  }}
                  data-testid="group-closure-card"
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-1" style={{ color: "var(--cc-muted-fg)" }}>
                    <CheckCircle2 className="w-3 h-3" /> Close this group
                  </div>
                  {isAlreadyClosed ? (
                    <p className="text-[11px] italic px-1" style={{ color: "var(--cc-muted-fg)" }}>
                      Already closed — outcome <strong>{outcomeLabel(group.outcome)}</strong>
                      {group.closureReason ? ` · ${group.closureReason}` : ""}.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <DeniedByPayorConfirmRow
                        groupId={groupId}
                        outcome={group.outcome}
                        closureReason={group.closureReason}
                        hasResponse={!!validTransitions?.hasResponse}
                        responses={detail.responses ?? []}
                        onAfterSuccess={invalidateGroup}
                      />
                      {!validTransitions?.hasBeenSubmitted && (
                        <div id="closure-actions">
                          <ClosureActions
                            target={{ kind: "invoice_group", id: groupId }}
                            outcome={group.outcome}
                            closureReason={group.closureReason}
                            triggers={[
                              {
                                reason: "cannot_dispute" as const,
                                label: "Withdraw — Cannot Dispute",
                                sub: "No clear path to recover",
                                disabledReason:
                                  "Close because we decided not to dispute (no clear path to recover).",
                                testId: "v2-group-close-cannot-dispute",
                              },
                            ]}
                            onAfterSuccess={invalidateGroup}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CcCard>
            </aside>

            {/* CENTER — disputed legs body + invoice-wide context. */}
            <section className="flex-1 min-w-0 space-y-4" data-testid="group-detail-center">
              {/* Scroll anchor for the "Reclassify legs" / "Mark duplicates"
                  buttons in the left-rail Overrides & admin card. */}
              <div id="group-detail-section-legs" data-testid="group-detail-section-legs" aria-hidden="true" />
              {/* D2 graduation (Task #767): per-leg column grid + full-width
                invoice-wide context replace the legacy rides/legs table.
                Each LegColumn surfaces evidence + audit excerpt + verdict
                for one leg; per-leg mutations stay in queue chrome and the
                column's only inline CTA is "Walk SOP in queue". The +N
                hidden disclosure for excluded/duplicate legs is preserved. */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Layers className="w-3.5 h-3.5" style={{ color: "var(--cc-muted-fg)" }} />
                Disputed legs
                <span className="text-xs font-normal" style={{ color: "var(--cc-muted-fg)" }}>
                  · {allRides.length} leg{allRides.length === 1 ? "" : "s"} · {inDisputeCount} disputed
                </span>
                {/* 3+ legs: hint that the strip scrolls + paging chevrons */}
                {visibleRides.length >= 3 && (
                  <span className="text-[11px] font-normal ml-1 inline-flex items-center gap-1.5" style={{ color: "var(--cc-muted-fg)" }}>
                    · scroll
                    <button
                      type="button"
                      onClick={() => legsStripRef.current?.scrollBy({ left: -380, behavior: "smooth" })}
                      className="cc-btn p-0.5 rounded"
                      style={{ border: "1px solid var(--cc-border)" }}
                      aria-label="Scroll legs left"
                      data-testid="legs-strip-prev"
                    >
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => legsStripRef.current?.scrollBy({ left: 380, behavior: "smooth" })}
                      className="cc-btn p-0.5 rounded"
                      style={{ border: "1px solid var(--cc-border)" }}
                      aria-label="Scroll legs right"
                      data-testid="legs-strip-next"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="cc-btn text-xs px-2 py-1"
                  style={
                    disputedOnly
                      ? { border: "1px solid var(--cc-border)", color: "var(--cc-muted-fg)" }
                      : { background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }
                  }
                  onClick={() => setDisputedOnly(!disputedOnly)}
                  data-testid="legs-hidden-disclosure"
                >
                  {disputedOnly
                    ? `+${hiddenCount} hidden — show`
                    : "Hide excluded / duplicates"}
                </button>
              )}
            </div>

            {visibleRides.length === 0 ? (
              <div className="cc-card px-4 py-3 text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                No legs to show.
              </div>
            ) : visibleRides.length >= 3 ? (
              /* 3+ legs: horizontal scroll strip with snap. Each column is
                 a fixed 360px so the rest of the page (invoice-wide context,
                 right rail) never shifts as the operator pages through legs.
                 Edge mask gradients hint at more content off-screen. */
              <div className="relative">
                <div
                  ref={legsStripRef}
                  className="overflow-x-auto pb-2 snap-x snap-mandatory"
                  style={{
                    scrollbarWidth: "thin",
                    WebkitMaskImage:
                      "linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)",
                    maskImage:
                      "linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)",
                  }}
                  data-testid="leg-columns-strip"
                >
                  <div className="flex gap-4 items-start px-1">
                    {visibleRides.map((r, idx) => (
                      <div
                        key={r.id}
                        className="snap-start shrink-0"
                        style={{ width: "360px" }}
                      >
                        <LegColumn
                          ride={r}
                          legNumber={idx + 1}
                          groupId={groupId}
                          auditEntries={detail?.auditLogs ?? []}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* 1–2 legs: keep the 50/50 grid — no scroll needed. */
              <div
                className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start"
                data-testid="leg-columns-grid"
              >
                {visibleRides.map((r, idx) => (
                  <LegColumn
                    key={r.id}
                    ride={r}
                    legNumber={idx + 1}
                    groupId={groupId}
                    auditEntries={detail?.auditLogs ?? []}
                  />
                ))}
              </div>
            )}

            {/* INVOICE-WIDE divider + stacked Special Context / Generated Write-up */}
            <div className="pt-2">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-px flex-1" style={{ background: "var(--cc-border)" }} />
                <h3 className="text-[10px] font-bold uppercase tracking-wider px-2" style={{ color: "var(--cc-muted-fg)" }}>Invoice-wide</h3>
                <div className="h-px flex-1" style={{ background: "var(--cc-border)" }} />
              </div>
              <InvoiceWideContext
                specialCircumstances={group.specialCircumstances}
                understandingReadbackForText={(group as { understandingReadbackForText?: string | null }).understandingReadbackForText}
                understandingReadbackAt={(group as { understandingReadbackAt?: string | null }).understandingReadbackAt}
                understandingReadbackBy={(group as { understandingReadbackBy?: string | null }).understandingReadbackBy}
                generatedEmailSubject={group.generatedEmailSubject}
                generatedEmailBody={group.generatedEmailBody}
                generatedEmailAt={group.generatedEmailAt}
              />
            </div>
            </section>

            {/* RIGHT — ambient surfaces (320px) */}
            <aside className="w-[320px] shrink-0 space-y-4" data-testid="group-detail-right-rail">

              {/* Task #833 — Notes promoted to the top of the right
                  rail. Notes are the single most operationally important
                  thing on this page; burying them below Communication
                  and the ambient cards forced operators to scroll past
                  noise to read them. All of the card's behavior
                  (history list, add-note form, breath animation) is
                  unchanged — only its stacking position moved. */}
            <CcCard
              title={
                <>
                  Notes
                  <span className="text-xs font-normal ml-1" style={{ color: "var(--cc-muted-fg)" }}>
                    · {visibleNotes.length}
                  </span>
                </>
              }
              icon={<Pin className="w-3.5 h-3.5" />}
              testId="notes-card"
            >
              {visibleNotes.length === 0 ? (
                <div className="text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No notes recorded for this group yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleNotes.slice(0, 6).map((n) => (
                    <div key={n.id} className="text-sm flex gap-2 items-start group/group-note" data-testid={`note-${n.id}`}>
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0"
                        style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}
                      >
                        {authorInitial(n.author)}
                      </div>
                      <div className="flex-1 min-w-0 text-xs">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="font-semibold">{n.author || "Unknown"}</span>
                          <span style={{ color: "var(--cc-muted-fg)" }}>{relativeTime(n.createdAt)}</span>
                        </div>
                        <div style={{ color: "var(--cc-fg)" }}>{n.content}</div>
                      </div>
                      {/* #687 — group-note delete control removed; notes
                          are deleted from the queue chrome only. */}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--cc-border)" }}>
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={2}
                  placeholder="Add a note for this invoice group…"
                  className="cc-input w-full text-xs"
                  style={{
                    background: "var(--cc-bg)",
                    border: "1px solid var(--cc-border)",
                    color: "var(--cc-fg)",
                    padding: "6px 8px",
                    borderRadius: 4,
                    resize: "vertical",
                  }}
                  data-testid="group-note-textarea"
                />
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    onClick={onSubmitNote}
                    disabled={
                      !newNote.trim() ||
                      createNoteMutation.isPending ||
                      noteBreath.breathing
                    }
                    className={cn(
                      "cc-btn text-xs gap-1 inline-flex items-center px-2.5 py-1.5",
                      noteBreath.className,
                    )}
                    style={{
                      background: "var(--cc-purple-fg)",
                      color: "white",
                      opacity:
                        !newNote.trim() ||
                        createNoteMutation.isPending ||
                        noteBreath.breathing
                          ? 0.6
                          : 1,
                    }}
                    data-testid="group-note-submit-button"
                  >
                    {createNoteMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Plus className="w-3.5 h-3.5" />
                    )}
                    Add note
                  </button>
                </div>
              </div>
            </CcCard>

              {/* Communication thread */}
            <div id="invoice-thread" />
            {(() => {
              // Task #833 — Communication card is now a compact summary
              // that hands off to a full-thread reply dialog. Header keeps
              // the verdict tone + total message count (same affordances
              // as before); body shows inbound/outbound split, the latest
              // message's sender + timestamp + one-line snippet, and an
              // "Open thread" button. The inline 5-message stack and
              // quick-reply input go away — they made the rail tall and
              // noisy with bodies that were truncated to 320 chars
              // anyway. Reading and replying both live in the dialog now.
              const verdict = deriveGroupOutcomeFromLegs(allRides).outcome;
              const cardTone: CcCardTone =
                verdict === "Approved" ? "green" :
                verdict === "Denied"   ? "amber" :
                                         "default";
              const messageCount = conversations.reduce((acc, c) => acc + c.messages.length, 0);
              const inboundCount = conversations.reduce(
                (acc, c) => acc + c.messages.filter((m) => m.direction === "inbound").length,
                0,
              );
              const outboundCount = messageCount - inboundCount;
              const flatNewestFirst = conversations
                .flatMap((c) => c.messages.map((m) => ({ m, convSubject: c.subject })))
                .sort(
                  (a, b) =>
                    new Date(b.m.timestamp).getTime() - new Date(a.m.timestamp).getTime(),
                );
              const latest = flatNewestFirst[0];
              const latestSnippet = latest
                ? (() => {
                    const raw = (latest.m.bodyPreview || "").replace(/\s+/g, " ").trim();
                    return raw.length > 160 ? raw.slice(0, 157) + "…" : raw;
                  })()
                : "";
              const openThread = () => {
                if (!latestConversation) return;
                setThreadScrollTargetId(null);
                setThreadDialogOpen(true);
              };
              return (
            <CcCard
              title={
                <>
                  Communication
                  <span className="text-xs font-normal ml-1" style={{ color: cardTone === "default" ? "var(--cc-muted-fg)" : "currentColor", opacity: cardTone === "default" ? 1 : 0.75 }}>
                    · {messageCount} message{messageCount === 1 ? "" : "s"}
                  </span>
                </>
              }
              icon={<Mail className="w-3.5 h-3.5" />}
              testId="communication-card"
              padded={false}
              tone={cardTone}
              action={
                verdict && verdict !== "Pending" ? (
                  <span
                    className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border bg-white/60"
                    style={{ borderColor: "currentColor" }}
                    data-testid="communication-card-verdict-pill"
                  >
                    Group verdict · {outcomeLabel(verdict)}
                  </span>
                ) : undefined
              }
            >
              {/* Task #833 — compact body: inbound/outbound split,
                  latest message header (sender · timestamp), single-line
                  snippet, primary "Open thread" button, and the quiet
                  inbox-sync link preserved beneath it. Everything
                  substantive lives in the dialog opened by the button
                  (see <GroupCommunicationReplyDialog/> below). */}
              <div data-testid="group-comms-compact-summary">
                {messageCount === 0 ? (
                  <div className="text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                    No messages on this thread yet.
                  </div>
                ) : (
                  <>
                    <div className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: "var(--cc-muted-fg)" }}>
                      <span data-testid="group-comms-inbound-count">{inboundCount} received</span>
                      {" · "}
                      <span data-testid="group-comms-outbound-count">{outboundCount} sent</span>
                    </div>
                    {latest && (
                      <div
                        className="text-xs rounded p-2 mb-2"
                        style={{
                          background: "color-mix(in srgb, var(--cc-muted) 40%, transparent)",
                          border: "1px solid var(--cc-border)",
                        }}
                        data-testid="group-comms-latest-message"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-semibold truncate" style={{ color: "var(--cc-fg)" }}>
                            {latest.m.direction === "inbound"
                              ? latest.m.senderName || "Payor"
                              : `Outbound · ${latest.m.senderName || "Operator"}`}
                          </span>
                          <span className="text-[10px] shrink-0" style={{ color: "var(--cc-muted-fg)" }}>
                            {formatDateTime(latest.m.timestamp)}
                          </span>
                        </div>
                        {latestSnippet && (
                          <p className="text-[11px] opacity-90 line-clamp-1" style={{ color: "var(--cc-fg)" }}>
                            {latestSnippet}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={openThread}
                  disabled={!latestConversation}
                  className="cc-btn cc-btn-sm cc-btn-primary w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs"
                  data-testid="group-comms-open-thread"
                  title={
                    latestConversation
                      ? "Read the full thread and reply"
                      : "No conversation to open yet"
                  }
                >
                  <Mail className="w-3.5 h-3.5" />
                  {messageCount === 0 ? "Open thread" : "Open thread & reply"}
                </button>
                {/* Inbox sync action — preserved from the legacy stack so
                    the affordance survives the slim-down. */}
                {onSyncInbox && (
                  <div className="mt-2 flex items-center justify-end text-[10px]" style={{ color: "var(--cc-muted-fg)" }}>
                    <button
                      type="button"
                      onClick={onSyncInbox}
                      disabled={checkEmailMutation.isPending}
                      className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
                      data-testid="group-comms-sync-inbox"
                    >
                      {checkEmailMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Inbox className="w-3 h-3" />
                      )}
                      Sync inbox
                    </button>
                  </div>
                )}
              </div>
            </CcCard>
              );
            })()}
            {/* Task #833 — the full-thread reply dialog. Rendered at the
                rail level (not inside the compact card) so it survives
                if/when the card itself unmounts, and so the deep-link
                hash effect (above) can drive it without reaching into
                child state. The same dialog is also mounted by
                ConversationSection for the responses-awaiting-review
                page; this is the detail-page mount. */}
            {latestConversation && (
              <GroupCommunicationReplyDialog
                open={threadDialogOpen}
                onOpenChange={(open) => {
                  setThreadDialogOpen(open);
                  if (!open) setThreadScrollTargetId(null);
                }}
                conversation={latestConversation}
                groupId={group.id}
                isSending={replyMutation.isPending || freshSendMutation.isPending}
                scrollToMessageId={threadScrollTargetId}
                onReply={async (input) => {
                  try {
                    // Legacy threads (pre-conversationId) — there's no Graph
                    // message to reply against, so send a fresh email tied
                    // to the group instead. Same outcome from the operator's
                    // POV: the message goes out and appears in the thread.
                    if (!input.conversationId) {
                      await freshSendMutation.mutateAsync({
                        id: groupId,
                        data: {
                          subject: input.subject,
                          bodyText: htmlBodyToPlainText(input.bodyHtml),
                          to: input.to,
                          cc: input.cc.length > 0 ? input.cc : undefined,
                          attachments:
                            input.attachments.length > 0 ? input.attachments : undefined,
                        },
                      });
                    } else {
                      await replyMutation.mutateAsync({
                        id: groupId,
                        conversationId: input.conversationId,
                        data: {
                          subject: input.subject,
                          bodyText: htmlBodyToPlainText(input.bodyHtml),
                          to: input.to,
                          cc: input.cc.length > 0 ? input.cc : undefined,
                          attachments:
                            input.attachments.length > 0 ? input.attachments : undefined,
                        },
                      });
                    }
                    successToast({
                      title: "__VERB__",
                      description: `Reply sent to ${input.to.join(", ")}`,
                    });
                    await qc.invalidateQueries({
                      queryKey: getGetInvoiceGroupEmailThreadQueryKey(groupId),
                    });
                    await qc.invalidateQueries({
                      queryKey: getGetInvoiceGroupQueryKey(groupId),
                    });
                  } catch (err) {
                    toast({
                      title: "Failed to send reply",
                      description:
                        err instanceof Error ? err.message : "Please try again.",
                      variant: "destructive",
                    });
                    // Re-throw so the composer preserves the draft for retry.
                    throw err;
                  }
                }}
              />
            )}

              {/* Post-submit verdict + responses */}
            <CcCard
              title="Payor responses & per-leg verdict"
              icon={<Gavel className="w-3.5 h-3.5" />}
              testId="group-response-summary-card"
            >
              {isPreSubmit ? (
                <div
                  className="flex items-center gap-2 text-xs p-2.5 rounded"
                  style={{ background: "var(--cc-muted)", color: "var(--cc-muted-fg)" }}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>
                    Activates after this group is submitted to portal.
                    Per-leg verdicts are recorded here and surface read-only on each leg page.
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: "var(--cc-muted-fg)" }}>
                      Group verdict
                    </div>
                    {(() => {
                      // Task #555 — never trust `group.outcome`; the
                      // canonical verdict is computed from per-leg
                      // verdicts via the shared helper so the rail's
                      // outcome cannot drift behind a leg edit.
                      const computedOutcome =
                        deriveGroupOutcomeFromLegs(allRides).outcome;
                      return computedOutcome !== "Pending";
                    })() ? (
                      <div className="text-sm space-y-1 p-3 rounded" style={{ background: "var(--cc-muted)" }}>
                        <div className="flex items-center gap-2">
                          <StateBadge
                            variant="outcome"
                            value={deriveGroupOutcomeFromLegs(allRides).outcome}
                            data-testid="group-verdict-outcome"
                          />
                          {group.closureReason && (
                            <span className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                              · {group.closureReason}
                            </span>
                          )}
                        </div>
                        {group.approvedAmount && (
                          <HideForClerk>
                            <p className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                              Approved amount: {formatCurrency(group.approvedAmount)}
                            </p>
                          </HideForClerk>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm italic" style={{ color: "var(--cc-muted-fg)" }} data-testid="group-verdict-empty">
                        No verdict recorded yet.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: "var(--cc-muted-fg)" }}>
                      Payor responses
                    </div>
                    {(() => {
                      const responses = detail.responses ?? [];
                      if (responses.length === 0) {
                        return (
                          <p className="text-sm italic" style={{ color: "var(--cc-muted-fg)" }} data-testid="group-responses-empty">
                            No responses received yet.
                          </p>
                        );
                      }
                      return (
                        <ul className="space-y-2">
                          {responses.slice(0, 5).map((r: PortalResponseItem) => (
                            <li
                              key={r.id}
                              className="rounded p-2.5 text-sm"
                              style={{ border: "1px solid var(--cc-border)", background: "var(--cc-muted)" }}
                              data-testid={`group-response-${r.id}`}
                            >
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "var(--cc-purple-bg)", color: "var(--cc-purple-fg)" }}>
                                  {r.responseType}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ border: "1px solid var(--cc-border)", color: "var(--cc-muted-fg)" }}>
                                  {r.source}
                                </span>
                                {r.subject && (
                                  <span className="text-xs font-medium truncate">{r.subject}</span>
                                )}
                                <span className="text-xs ml-auto" style={{ color: "var(--cc-muted-fg)" }}>
                                  {r.senderName || r.senderEmail || "Unknown sender"}
                                </span>
                              </div>
                              {r.aiSummary && (
                                <p className="text-xs line-clamp-2" style={{ color: "var(--cc-muted-fg)" }}>
                                  {r.aiSummary}
                                </p>
                              )}
                            </li>
                          ))}
                          {responses.length > 5 && (
                            <li className="text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                              +{responses.length - 5} more — see legacy page for the full thread.
                            </li>
                          )}
                        </ul>
                      );
                    })()}
                  </div>
                </div>
              )}
            </CcCard>

                {/* Scroll anchor — Task #767, was on the retired chrome. */}
              <div id="group-detail-section-evidence" data-testid="group-detail-section-evidence" aria-hidden="true" />
              {(() => {
                // Show the same union of attachments the bot worker
                // submits via collectGroupEvidenceUrls: JSONB column +
                // canonical claim_evidence rows (group-level + per-leg).
                type FileEntry = { url: string; name?: string | null; legNumber?: number | null };
                const items: FileEntry[] = [];
                const seen = new Set<string>();
                const add = (url: string | null | undefined, name: string | null | undefined, legNumber: number | null) => {
                  if (!url || seen.has(url)) return;
                  seen.add(url);
                  items.push({ url, name: name ?? null, legNumber });
                };
                for (const f of (detail.evidenceFiles ?? [])) add(f?.url, f?.name ?? null, null);
                const groupRows = (detail as { groupEvidence?: Array<{ imageUrl?: string | null; evidenceTypeName?: string | null }> }).groupEvidence ?? [];
                for (const r of groupRows) add(r?.imageUrl ?? null, displayedEvidenceName(r?.evidenceTypeName, r?.imageUrl), null);
                allRides.forEach((ride, idx) => {
                  const rideAny = ride as { evidenceFiles?: Array<{ url?: string; filename?: string | null; name?: string | null }> | null; evidence?: Array<{ imageUrl?: string | null; evidenceTypeName?: string | null }> };
                  for (const f of (rideAny.evidenceFiles ?? [])) add(f?.url ?? null, (f as { name?: string | null }).name ?? f?.filename ?? null, idx + 1);
                  for (const r of (rideAny.evidence ?? [])) add(r?.imageUrl ?? null, displayedEvidenceName(r?.evidenceTypeName, r?.imageUrl), idx + 1);
                });
                return (
                  <CcCard
                    title={
                      <>
                        Group evidence
                        {items.length > 0 && (
                          <span className="text-xs font-normal ml-1" style={{ color: "var(--cc-muted-fg)" }}>
                            · {items.length} file{items.length === 1 ? "" : "s"}
                          </span>
                        )}
                      </>
                    }
                    icon={<Paperclip className="w-3.5 h-3.5" />}
                    testId="group-evidence-card"
                    padded={false}
                  >
                    {items.length === 0 ? (
                      <div className="px-3 py-3 text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                        No evidence attached yet.
                      </div>
                    ) : items.map((f, i) => {
                      const name = f.name || (() => {
                        try {
                          const path = new URL(f.url, "http://x").pathname;
                          const last = path.split("/").filter(Boolean).pop() || f.url;
                          return decodeURIComponent(last);
                        } catch {
                          return f.url;
                        }
                      })();
                      return (
                        <div
                          key={`${f.url}-${i}`}
                          className="px-3 py-1.5 text-xs flex items-center gap-2"
                          style={{ borderBottom: i < items.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                        >
                          <Paperclip className="w-3 h-3 flex-shrink-0" style={{ color: "var(--cc-muted-fg)" }} />
                          <span className="font-medium flex-1 truncate">{name}</span>
                          {f.legNumber != null && (() => {
                            // D2 polish — L1 reads as blue, L2 as purple so the
                            // operator's eye can immediately tell which leg of the
                            // group an attachment belongs to. Anything beyond L2
                            // falls back to the muted token.
                            const tone =
                              f.legNumber === 1
                                ? { bg: "var(--cc-blue-bg)", fg: "var(--cc-blue-fg)", border: "var(--cc-blue-border)" }
                                : f.legNumber === 2
                                ? { bg: "var(--cc-purple-bg)", fg: "var(--cc-purple-fg)", border: "var(--cc-purple-border)" }
                                : { bg: "var(--cc-muted)", fg: "var(--cc-muted-fg)", border: "var(--cc-border)" };
                            return (
                              <span
                                className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded border uppercase"
                                style={{ background: tone.bg, color: tone.fg, borderColor: tone.border }}
                                data-testid={`group-evidence-leg-chip-L${f.legNumber}`}
                              >
                                L{f.legNumber}
                              </span>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </CcCard>
                );
              })()}

              {/* Task #833 — Notes card moved to the top of the right
                  rail; the old copy that lived here has been removed. */}

              {/* Scroll anchor — Task #767, was on the retired chrome. */}
            <div id="group-detail-section-activity" data-testid="group-detail-section-activity" aria-hidden="true" />
            {/* Activity history — was "Audit timeline". Renamed to read
                like a standard activity feed (what happened, when, by
                whom) instead of a system-audit log; data shape is
                unchanged. Kept in sync with the per-leg surface in
                claim-detail-v2.tsx. */}
            <CcCard
              title="Activity history"
              icon={<Activity className="w-3.5 h-3.5" />}
              testId="audit-timeline-card"
              padded={false}
            >
              {sortedAudit.length === 0 ? (
                <div className="px-4 py-3 text-xs italic" style={{ color: "var(--cc-muted-fg)" }}>
                  No activity recorded for this invoice yet.
                </div>
              ) : (
                sortedAudit.slice(0, 12).map((e, i, arr) => {
                  // Task #334: render the admin "recorded offline" override
                  // (mas_reattest_recorded_offline) with an unmistakable
                  // amber ShieldCheck + "Admin override" badge so reviewers
                  // can tell it apart from a normal mas_reattest_completed
                  // row. The trimmed offlineNote and the recorded-by email
                  // are surfaced inline (the note is on the audit row's
                  // metadata; see the offline branch in
                  // routes/invoice-groups.ts).
                  const isOfflineOverride =
                    e.action === "mas_reattest_recorded_offline";
                  const meta =
                    isOfflineOverride && e.metadata && typeof e.metadata === "object"
                      ? (e.metadata as Record<string, unknown>)
                      : null;
                  const offlineNoteFromMeta =
                    meta && typeof meta.offlineNote === "string"
                      ? meta.offlineNote.trim()
                      : "";
                  return (
                    <div
                      key={e.id}
                      className="px-4 py-2 flex items-start gap-2 text-xs"
                      style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                      data-testid={`audit-${e.id}`}
                    >
                      <div
                        className="mt-0.5 flex-shrink-0"
                        style={{ color: isOfflineOverride ? "var(--cc-amber-fg)" : auditTone(e.action) }}
                      >
                        {isOfflineOverride ? <ShieldCheck className="w-3 h-3" /> : auditIcon(e.action)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap" style={{ color: "var(--cc-fg)" }}>
                          <span>{e.details || e.action}</span>
                          {isOfflineOverride && (
                            <span
                              data-testid={`audit-${e.id}-admin-override-badge`}
                              className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-[1px] rounded"
                              style={{
                                background: "var(--cc-amber-bg)",
                                color: "var(--cc-amber-fg)",
                                border: "1px solid var(--cc-amber-fg)",
                              }}
                            >
                              Admin override
                            </span>
                          )}
                        </div>
                        {isOfflineOverride && offlineNoteFromMeta && (
                          <div
                            data-testid={`audit-${e.id}-offline-note`}
                            className="text-[11px] mt-1 px-2 py-1 rounded whitespace-pre-wrap break-words"
                            style={{
                              background: "var(--cc-amber-bg)",
                              border: "1px solid var(--cc-amber-fg)",
                              color: "var(--cc-fg)",
                            }}
                          >
                            <span className="font-semibold" style={{ color: "var(--cc-amber-fg)" }}>
                              Offline note:
                            </span>{" "}
                            {offlineNoteFromMeta}
                          </div>
                        )}
                        <div className="text-[11px]" style={{ color: "var(--cc-muted-fg)" }}>
                          {isOfflineOverride ? (
                            <>
                              <span data-testid={`audit-${e.id}-recorded-by`}>
                                Recorded by{" "}
                                <span className="font-medium" style={{ color: "var(--cc-fg)" }}>
                                  {e.userEmail || e.userName || "system"}
                                </span>
                              </span>
                              {" · "}
                              {relativeTime(e.timestamp)}
                            </>
                          ) : (
                            <>
                              {(e.userName || e.userEmail || "system")} · {relativeTime(e.timestamp)}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CcCard>

              {/* Footer hint surfacing the inbox-sync action also in the rail */}
            <div className="text-[11px] text-center" style={{ color: "var(--cc-muted-fg)" }}>
              <button
                onClick={onSyncInbox}
                disabled={checkEmailMutation.isPending}
                className="cc-btn text-[11px] gap-1 inline-flex items-center px-2 py-1"
                style={{ border: "1px solid var(--cc-border)" }}
                data-testid="rail-sync-inbox"
              >
                {checkEmailMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Inbox className="w-3 h-3" />
                )}
                Sync inbox
              </button>
            </div>
            </aside>
          </div>
        </div>
        ) : null}
        </SkeletonSwap>

              {/* Admin offline-recording override modal. Amber chrome
                makes it visually distinct from a normal completion;
                the submit button stays disabled until the trimmed
                note hits 10 chars AND the operator ticks the
                acknowledgement checkbox. */}
            {group && canShowOfflineReattestOverride({
              isAdmin,
              reattestRequired: !!group.reattestRequired,
              reattestCompletedAt: group.reattestCompletedAt,
            }) && (
              <Dialog
                open={offlineModalOpen}
                onOpenChange={(next) => {
                  setOfflineModalOpen(next);
                  if (!next) resetOfflineForm();
                }}
              >
                <DialogContent
                  className="max-w-lg"
                  data-testid="reattest-offline-modal"
                  style={{
                    borderTop: "4px solid var(--cc-amber-fg)",
                  }}
                >
                  <DialogHeader>
                    <div
                      className="-mx-6 -mt-6 px-6 py-3 mb-3 flex items-center gap-2"
                      style={{
                        background: "var(--cc-amber-bg)",
                        color: "var(--cc-amber-fg)",
                        borderBottom: "1px solid var(--cc-amber-fg)",
                      }}
                    >
                      <AlertTriangle className="w-4 h-4" />
                      <DialogTitle className="text-sm font-semibold m-0" style={{ color: "var(--cc-amber-fg)" }}>
                        Mark MAS re-attest as already done (admin override)
                      </DialogTitle>
                    </div>
                    <DialogDescription className="text-xs" style={{ color: "var(--cc-muted-fg)" }}>
                      Use this only when the re-attest happened outside the
                      app — paper log, MAS-side correction, or
                      after-the-fact reconciliation. The activity timeline
                      will show a distinct &quot;recorded offline&quot;
                      entry instead of the standard checklist completion.
                      Bypasses the cancel-completeness gate.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor="offline-note-textarea"
                        className="block text-xs font-medium mb-1"
                        style={{ color: "var(--cc-fg)" }}
                      >
                        What happened? <span style={{ color: "var(--cc-amber-fg)" }}>*</span>
                      </label>
                      <textarea
                        id="offline-note-textarea"
                        value={offlineNote}
                        onChange={(e) => setOfflineNote(e.target.value)}
                        placeholder="When/where the re-attest was actually performed (min 10 chars)…"
                        rows={4}
                        className="w-full rounded text-xs px-2 py-1.5"
                        style={{
                          border: "1px solid var(--cc-border)",
                          background: "var(--cc-input-bg, transparent)",
                          color: "var(--cc-fg)",
                        }}
                        data-testid="textarea-offline-note"
                      />
                      <div
                        className="mt-1 text-[11px] flex justify-between"
                        style={{ color: offlineNoteValid ? "var(--cc-muted-fg)" : "var(--cc-amber-fg)" }}
                      >
                        <span>{offlineNoteValid ? "Note looks good." : `Need ${Math.max(0, 10 - offlineNoteTrim.length)} more characters.`}</span>
                        <span className="mono">{offlineNoteTrim.length}/10</span>
                      </div>
                    </div>
                    <label
                      className="flex items-start gap-2 text-xs cursor-pointer"
                      style={{ color: "var(--cc-fg)" }}
                    >
                      <input
                        type="checkbox"
                        checked={offlineConfirmed}
                        onChange={(e) => setOfflineConfirmed(e.target.checked)}
                        className="mt-0.5"
                        data-testid="checkbox-offline-confirm"
                      />
                      <span>
                        I confirm the MAS re-attest has already been completed
                        outside this app and I am recording it here for the audit trail.
                      </span>
                    </label>
                    {/* Inline error surface — pinned to the form so the
                        operator's eyes don't have to leave the modal to
                        understand a 400/403. Coloured rose for
                        forbidden, amber for validation, slate for
                        anything else. Toast also fires as a secondary
                        cue. */}
                    {offlineErrorMsg && (
                      <div
                        role="alert"
                        data-testid="offline-error-inline"
                        data-error-kind={offlineErrorKind ?? "other"}
                        className="text-xs px-2 py-1.5 rounded flex items-start gap-1.5"
                        style={
                          offlineErrorKind === "forbidden"
                            ? { background: "var(--cc-rose-bg)", color: "var(--cc-rose-fg)", border: "1px solid var(--cc-rose-fg)" }
                            : offlineErrorKind === "validation"
                              ? { background: "var(--cc-amber-bg)", color: "var(--cc-amber-fg)", border: "1px solid var(--cc-amber-fg)" }
                              : { background: "var(--cc-muted-bg, transparent)", color: "var(--cc-fg)", border: "1px solid var(--cc-border)" }
                        }
                      >
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>
                          <strong className="font-semibold mr-1">
                            {offlineErrorKind === "forbidden"
                              ? "Admin only:"
                              : offlineErrorKind === "validation"
                                ? "Note rejected:"
                                : "Could not record:"}
                          </strong>
                          {offlineErrorMsg}
                        </span>
                      </div>
                    )}
                  </div>
                  <DialogFooter className="gap-2">
                    <button
                      type="button"
                      onClick={() => setOfflineModalOpen(false)}
                      className="cc-btn text-xs px-3 py-1.5"
                      style={{ background: "transparent", color: "var(--cc-fg)", border: "1px solid var(--cc-border)" }}
                      data-testid="button-offline-cancel"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!canSubmitOffline}
                      onClick={() => {
                        if (!canSubmitOffline) return;
                        // Clear any prior inline error before retrying
                        // so the user sees a fresh state during the
                        // request.
                        setOfflineErrorMsg(null);
                        setOfflineErrorKind(null);
                        completeReattestMutation.mutate(
                          {
                            id: groupId,
                            data: buildOfflineReattestPayload(offlineNote),
                          },
                          {
                            onSuccess: () => {
                              invalidateGroup();
                              setOfflineModalOpen(false);
                              resetOfflineForm();
                              successToast({
                                title: "__VERB__",
                                description: "Recorded as re-attested (offline) — activity timeline now shows the override entry.",
                                duration: 3500,
                              });
                            },
                            onError: (e: unknown) => {
                              // Pull the server's status code + body
                              // out of the axios-shaped error so we can
                              // route the inline copy by 400 vs 403 vs
                              // generic. Toast still fires as a
                              // secondary surface in case the modal
                              // closes mid-error.
                              let status: number | null = null;
                              let serverMsg: string | null = null;
                              if (e != null && typeof e === "object" && "response" in e) {
                                const ax = e as { response?: { status?: number; data?: { error?: string } } };
                                status = ax.response?.status ?? null;
                                serverMsg = ax.response?.data?.error ?? null;
                              }
                              const fallback = e instanceof Error ? e.message : String(e);
                              const kind: "forbidden" | "validation" | "other" =
                                status === 403 ? "forbidden" : status === 400 ? "validation" : "other";
                              const inlineMsg =
                                kind === "forbidden"
                                  ? (serverMsg ?? "You don't have permission to record an offline re-attest. This action is admin-only.")
                                  : kind === "validation"
                                    ? (serverMsg ?? "The note didn't pass server-side validation. It needs at least 10 characters after trimming.")
                                    : (serverMsg ?? fallback);
                              setOfflineErrorMsg(inlineMsg);
                              setOfflineErrorKind(kind);
                              toast({
                                title: "Could not record offline re-attest",
                                description: inlineMsg,
                                variant: "destructive",
                              });
                            },
                          },
                        );
                      }}
                      className="cc-btn text-xs px-3 py-1.5 inline-flex items-center gap-1"
                      style={{
                        background: canSubmitOffline ? "var(--cc-amber-fg)" : "var(--cc-muted)",
                        color: "white",
                        opacity: canSubmitOffline ? 1 : 0.6,
                        cursor: canSubmitOffline ? "pointer" : "not-allowed",
                      }}
                      data-testid="button-submit-offline-reattest"
                    >
                      {completeReattestMutation.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <ClipboardCheck className="w-3 h-3" />
                      )}
                      Mark as re-attested
                    </button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

        {/* Task #767 — hold / withdraw / close-as-non-issue dialogs were
            absorbed from the retired GroupDossierChrome. Modal portals,
            so their position in the JSX tree doesn't matter visually;
            kept at the bottom of the page for code locality with the
            other dialog mounts. */}
        <Dialog open={holdOpen} onOpenChange={setHoldOpen}>
          <DialogContent className="max-w-md" data-testid="group-detail-place-hold-modal">
            <DialogHeader>
              <DialogTitle>Place group on hold</DialogTitle>
              <DialogDescription>
                The group will be removed from operator queues until the hold is
                cleared. The reason is recorded in the audit trail.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="group-hold-reason" className="text-xs">Reason</Label>
              <Textarea
                id="group-hold-reason"
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="Why is this group going on hold?"
                rows={3}
                data-testid="group-detail-hold-reason-input"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setHoldOpen(false)} disabled={holdMutation.isPending}>
                Cancel
              </Button>
              <Button
                onClick={onPlaceHold}
                disabled={!holdReason.trim() || holdMutation.isPending}
                data-testid="group-detail-hold-confirm-button"
              >
                {holdMutation.isPending ? "Placing…" : "Place on hold"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {withdrawOpen ? (
          <ClosureIntakeDialog
            open={withdrawOpen}
            onOpenChange={setWithdrawOpen}
            target={{ kind: "group", id: groupId }}
            reason="cannot_dispute"
            onSuccess={invalidateGroup}
          />
        ) : null}

        <CloseAsNonIssueDialog
          open={closeNonIssueOpen}
          onOpenChange={setCloseNonIssueOpen}
          groupId={groupId}
          onSuccess={invalidateGroup}
        />
  
      </div>
    );
  }
  