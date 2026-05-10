import "./_queue_v2.css";
import {
  AlertCircle,
  Clock,
  FileText,
  Filter,
  PauseCircle,
  Search,
  Sparkles,
  Tag,
} from "lucide-react";
import type { ReactNode } from "react";

export const Icons = {
  AlertCircle,
  Clock,
  FileText,
  Filter,
  PauseCircle,
  Search,
  Sparkles,
  Tag,
};

export type Tier = "today" | "tomorrow" | "soon" | "week" | "later";

export type RowData = {
  id: string;
  invoice: string;
  rides: number;
  service: string;
  tier: Tier;
  errorType: string;
  ready: number;
  investigating: number;
  nonContestable: number;
  nonIssue: number;
  needsClassification: number;
  readyToGenerate?: boolean;
  onHold?: boolean;
  holdReason?: string;
  selected?: boolean;
};

export const ROWS: RowData[] = [
  {
    id: "r1",
    invoice: "INV-2026-0487",
    rides: 3,
    service: "Apr 24",
    tier: "today",
    errorType: "Mileage mismatch",
    ready: 1,
    investigating: 2,
    nonContestable: 0,
    nonIssue: 0,
    needsClassification: 0,
    selected: true,
  },
  {
    id: "r2",
    invoice: "INV-2026-0488",
    rides: 2,
    service: "Apr 25",
    tier: "today",
    errorType: "Ineligible enrollee",
    ready: 0,
    investigating: 1,
    nonContestable: 0,
    nonIssue: 0,
    needsClassification: 1,
  },
  {
    id: "r3",
    invoice: "INV-2026-0491",
    rides: 5,
    service: "Apr 26",
    tier: "tomorrow",
    errorType: "Auth missing",
    ready: 4,
    investigating: 0,
    nonContestable: 1,
    nonIssue: 0,
    needsClassification: 0,
    readyToGenerate: true,
  },
  {
    id: "r4",
    invoice: "INV-2026-0494",
    rides: 4,
    service: "Apr 27",
    tier: "soon",
    errorType: "Duplicate trip",
    ready: 2,
    investigating: 1,
    nonContestable: 1,
    nonIssue: 0,
    needsClassification: 0,
  },
  {
    id: "r5",
    invoice: "INV-2026-0501",
    rides: 6,
    service: "Apr 30",
    tier: "week",
    errorType: "Ineligible enrollee",
    ready: 1,
    investigating: 3,
    nonContestable: 1,
    nonIssue: 1,
    needsClassification: 0,
  },
  {
    id: "r6",
    invoice: "INV-2026-0473",
    rides: 2,
    service: "Apr 22",
    tier: "soon",
    errorType: "Mileage mismatch",
    ready: 0,
    investigating: 0,
    nonContestable: 0,
    nonIssue: 0,
    needsClassification: 0,
    onHold: true,
    holdReason: "Awaiting client docs · 3d",
  },
  {
    id: "r7",
    invoice: "INV-2026-0468",
    rides: 3,
    service: "Apr 21",
    tier: "later",
    errorType: "Auth missing",
    ready: 2,
    investigating: 1,
    nonContestable: 0,
    nonIssue: 0,
    needsClassification: 0,
    onHold: true,
    holdReason: "Manually parked · 5d",
  },
];

export function tierPill(tier: Tier): { label: string; cls: string } {
  switch (tier) {
    case "today":
      return { label: "Today", cls: "qv-tier qv-tier-today" };
    case "tomorrow":
      return { label: "Tomorrow", cls: "qv-tier qv-tier-tomorrow" };
    case "soon":
      return { label: "≤3d", cls: "qv-tier qv-tier-soon" };
    case "week":
      return { label: "≤7d", cls: "qv-tier qv-tier-week" };
    case "later":
      return { label: "Later", cls: "qv-tier qv-tier-later" };
  }
}

export function Breakdown({ row }: { row: RowData }) {
  const items: Array<{ label: string; n: number; tone: string }> = [
    { label: "Ready", n: row.ready, tone: "qv-tone-green" },
    { label: "Investigating", n: row.investigating, tone: "qv-tone-amber" },
    { label: "Non-contestable", n: row.nonContestable, tone: "qv-tone-purple" },
    { label: "Non-issue", n: row.nonIssue, tone: "qv-tone-muted" },
  ];
  return (
    <div className="qv-breakdown">
      {items.map((it, i) => (
        <span key={it.label} className={`qv-breakdown-cell ${it.n === 0 ? "qv-breakdown-zero" : ""}`}>
          <span className={`qv-dot ${it.tone}`} />
          <span className="qv-breakdown-num">{it.n}</span>
          <span className="qv-breakdown-label">{it.label}</span>
          {i < items.length - 1 && <span className="qv-breakdown-sep">·</span>}
        </span>
      ))}
      {row.needsClassification > 0 && (
        <span className="qv-pill qv-pill-red qv-pill-strong">
          <Icons.AlertCircle className="w-3 h-3" />
          Needs classification {row.needsClassification}
        </span>
      )}
      {row.readyToGenerate && (
        <span className="qv-pill qv-pill-green qv-pill-strong">
          <Icons.Sparkles className="w-3 h-3" />
          Ready to generate
        </span>
      )}
    </div>
  );
}

export function ErrorChip({ name }: { name: string }) {
  return (
    <span className="qv-error-chip">
      <Icons.Tag className="w-3 h-3" />
      {name}
    </span>
  );
}

export function HoldRibbon({ reason }: { reason?: string }) {
  return (
    <span className="qv-pill qv-pill-muted qv-pill-hold">
      <Icons.PauseCircle className="w-3 h-3" />
      On hold{reason ? ` · ${reason}` : ""}
    </span>
  );
}

/* ── Page-level chrome shared by every variant ───────────────────────── */

export function PageTitle({ openCount, onHoldCount }: { openCount: number; onHoldCount: number }) {
  return (
    <div className="qv-page-title">
      <h2>Invoice queue</h2>
      <p>
        Pre-submit groups that need engagement. Earliest service date first.{" "}
        <span className="qv-meta-strong">{openCount}</span> open ·{" "}
        <span className="qv-meta-strong">{onHoldCount}</span> on hold.
      </p>
    </div>
  );
}

export function UrgencyHero({ todayCount }: { todayCount: number }) {
  return (
    <div className="qv-urgency">
      <div className="qv-urgency-num">{todayCount}</div>
      <div className="qv-urgency-body">
        <div className="qv-urgency-title">Must file today</div>
        <div className="qv-urgency-sub">EOD deadline · click a row to start a Walk</div>
      </div>
    </div>
  );
}

export function ClassificationStrip({ count }: { count: number }) {
  return (
    <div className="qv-class-strip">
      <Icons.FileText className="w-4 h-4" />
      <span className="qv-class-title">Classification Inbox</span>
      <span className="qv-pill qv-pill-amber qv-pill-strong">{count} unclassified</span>
      <span className="qv-meta">Triage every group with an unclassified leg first.</span>
      <button className="qv-btn qv-btn-ghost qv-btn-sm" style={{ marginLeft: "auto" }}>
        Open ▾
      </button>
    </div>
  );
}

export function FilterStrip({
  withSearch = true,
  showActiveChips = true,
  extraRight,
}: {
  withSearch?: boolean;
  showActiveChips?: boolean;
  extraRight?: ReactNode;
}) {
  return (
    <div className="qv-filter-wrap">
      <div className="qv-filter-strip">
        {/* Engagement segmented */}
        <div className="qv-segmented" role="group">
          <button className="is-active">Needs engagement</button>
          <button>All</button>
        </div>
        {/* Filters popover trigger */}
        <button className="qv-btn qv-btn-sm">
          <Icons.Filter className="w-3.5 h-3.5" />
          Filters
          <span className="qv-tag">2</span>
        </button>
        {/* Hide past-deadline segmented */}
        <div className="qv-segmented" role="group">
          <button className="is-active">Hide past-deadline</button>
          <button>Show</button>
        </div>
        {withSearch && (
          <div className="qv-search">
            <Icons.Search className="w-3.5 h-3.5" />
            <input placeholder="Search invoice #, client #, error type…" />
          </div>
        )}
        {extraRight && <div style={{ marginLeft: "auto" }}>{extraRight}</div>}
      </div>
      {showActiveChips && (
        <div className="qv-chip-row">
          <span className="qv-meta">Active filters:</span>
          <span className="qv-chip qv-chip-blue">
            Outlook: Ready to review <span className="qv-chip-x">×</span>
          </span>
          <span className="qv-chip qv-chip-amber">
            Error type: Mileage mismatch <span className="qv-chip-x">×</span>
          </span>
          <span className="qv-chip qv-chip-red">
            Expiring: Today + Tomorrow <span className="qv-chip-x">×</span>
          </span>
          <button className="qv-link qv-link-xs">Clear all</button>
        </div>
      )}
    </div>
  );
}

export function FrameShell({ children }: { children: ReactNode }) {
  return (
    <div className="qv-scope" style={{ width: 1280, minHeight: 900 }}>
      {children}
    </div>
  );
}
