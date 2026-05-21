import {
  Search,
  Replace,
  History,
  Eye,
  Save,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Plus,
  GitBranch,
  FileText,
  HelpCircle,
  CheckCircle2,
  XCircle,
  Mail,
  Phone,
  Globe,
  Upload,
  Wand2,
  Settings,
  Library,
  ListTree,
  Layers,
  Maximize2,
  Minus,
  Plus as PlusIcon,
  MoreHorizontal,
  Copy,
  Trash2,
  ArrowRight,
  Filter,
  Bot,
  Link2,
  Pencil,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Tokens — mirror the app's cc-* palette (dashboard.tsx, queue.tsx).
// Centralized so the mockup speaks the same color language as production.
// ---------------------------------------------------------------------------
const tone = {
  amber: {
    bg: "hsl(var(--cc-amber-bg))",
    border: "hsl(var(--cc-amber-border))",
    fg: "hsl(var(--cc-amber-fg))",
  },
  purple: {
    bg: "hsl(var(--cc-purple-bg))",
    border: "hsl(var(--cc-purple-border))",
    fg: "hsl(var(--cc-purple-fg))",
  },
  green: {
    bg: "hsl(var(--cc-green-bg))",
    border: "hsl(var(--cc-green-border))",
    fg: "hsl(var(--cc-green-fg))",
  },
  blue: {
    bg: "hsl(var(--cc-blue-bg))",
    border: "hsl(var(--cc-blue-border))",
    fg: "hsl(var(--cc-blue-fg))",
  },
  red: {
    bg: "hsl(0 84% 96%)",
    border: "hsl(0 84% 80%)",
    fg: "hsl(var(--destructive))",
  },
};

function StatusPill({
  variant,
  children,
}: {
  variant: "amber" | "green";
  children: React.ReactNode;
}) {
  const t = tone[variant];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0"
      style={{ color: t.fg, background: t.bg, border: `1px solid ${t.border}` }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.fg }} />
      {children}
    </span>
  );
}

function TopBar() {
  return (
    <div className="h-14 border-b border-border bg-card flex items-center pl-2 pr-3 gap-3 shrink-0">
      <button className="p-1.5 hover:bg-muted rounded-md text-muted-foreground">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <nav className="flex items-center gap-1.5 text-xs min-w-0" aria-label="Breadcrumb">
        <span className="text-muted-foreground">Error Types</span>
        <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Denials</span>
        <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="font-semibold text-foreground truncate">CO-97 — Bundled / Included</span>
      </nav>
      <StatusPill variant="amber">Draft · unsaved</StatusPill>
      <div className="flex-1" />
      <button className="flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium text-foreground hover:bg-muted rounded-md">
        <Search className="w-3.5 h-3.5" /> Find
        <kbd className="ml-1 px-1 py-0.5 text-[10px] bg-muted rounded font-mono">⌘F</kbd>
      </button>
      <button
        className="flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium text-foreground hover:bg-muted rounded-md"
        title="Find & Replace across every SOP — e.g. rename 'modifier 59' to 'modifier XU' across all 47 trees in one pass. Scope: all SOPs in this workspace."
      >
        <Replace className="w-3.5 h-3.5" /> Find &amp; Replace across all SOPs
      </button>
      <button className="flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium text-foreground hover:bg-muted rounded-md">
        <History className="w-3.5 h-3.5" /> History
      </button>
      <button className="flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium text-foreground hover:bg-muted rounded-md">
        <Eye className="w-3.5 h-3.5" /> Preview walk
      </button>
      <div className="w-px h-6 bg-border" />
      <button
        className="flex items-center gap-1.5 px-3 h-8 text-xs font-semibold rounded-md text-primary-foreground"
        style={{ background: "hsl(var(--primary))" }}
      >
        <Save className="w-3.5 h-3.5" /> Save SOP
      </button>
    </div>
  );
}

function LeftPanelTabs({ active }: { active: string }) {
  const tabs = [
    { key: "outline", label: "Outline", icon: ListTree },
    { key: "palette", label: "Add", icon: Plus },
    { key: "library", label: "Library", icon: Library, hint: "Shared building blocks (evidence reqs, reply templates, sub-trees) reused across SOPs. Edit once, all SOPs that reference it update." },
    { key: "settings", label: "Settings", icon: Settings },
    { key: "ai", label: "AI Builder", icon: Wand2 },
  ];
  return (
    <div className="flex border-b border-border bg-muted/30">
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            title={(t as { hint?: string }).hint}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              isActive
                ? "border-foreground text-foreground bg-card"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-card/60"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function OutlineRow({
  depth,
  label,
  type,
  selected,
  hasChildren,
  expanded = true,
  evidenceCount,
}: {
  depth: number;
  label: string;
  type: "q" | "branch" | "terminal-approve" | "terminal-deny" | "evidence";
  selected?: boolean;
  hasChildren?: boolean;
  expanded?: boolean;
  evidenceCount?: number;
}) {
  const iconForType = {
    q: <HelpCircle className="w-3.5 h-3.5" style={{ color: tone.blue.fg }} />,
    branch: <GitBranch className="w-3.5 h-3.5" style={{ color: tone.purple.fg }} />,
    "terminal-approve": (
      <CheckCircle2 className="w-3.5 h-3.5" style={{ color: tone.green.fg }} />
    ),
    "terminal-deny": <XCircle className="w-3.5 h-3.5" style={{ color: tone.red.fg }} />,
    evidence: <FileText className="w-3.5 h-3.5" style={{ color: tone.amber.fg }} />,
  }[type];
  return (
    <div
      className={`flex items-center gap-1 pr-2 py-1 text-xs rounded cursor-pointer transition-colors overflow-hidden ${
        selected ? "" : "hover:bg-muted/60"
      }`}
      style={{
        paddingLeft: 8 + depth * 12,
        background: selected ? tone.blue.bg : undefined,
        boxShadow: selected ? `inset 0 0 0 1px ${tone.blue.border}` : undefined,
      }}
    >
      {hasChildren ? (
        expanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )
      ) : (
        <span className="w-3 shrink-0" />
      )}
      <span className="shrink-0">{iconForType}</span>
      <span
        className={`truncate min-w-0 flex-1 ${selected ? "font-semibold text-foreground" : "text-foreground"}`}
        title={label}
      >
        {label}
      </span>
      {typeof evidenceCount === "number" && (
        <span
          className="shrink-0 px-1 py-0.5 text-[9px] rounded font-semibold tabular-nums"
          style={{ color: tone.amber.fg, background: tone.amber.bg, border: `1px solid ${tone.amber.border}` }}
        >
          {evidenceCount} ev
        </span>
      )}
    </div>
  );
}

function LeftPanel() {
  return (
    <div className="w-72 border-r border-border bg-card flex flex-col shrink-0">
      <LeftPanelTabs active="outline" />
      <div className="px-2 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search nodes in this SOP…"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-foreground"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1 text-xs">
        <OutlineRow depth={0} label="Start: Did the payor send a remit?" type="q" hasChildren />
        <OutlineRow depth={1} label="Yes → Is bundling code valid?" type="q" hasChildren />
        <OutlineRow depth={2} label="Yes → Check companion claim" type="q" hasChildren selected evidenceCount={3} />
        <OutlineRow depth={3} label="EOB page 1" type="evidence" />
        <OutlineRow depth={3} label="CMS-1500 — companion claim" type="evidence" />
        <OutlineRow depth={3} label="Medical records — op note" type="evidence" />
        <OutlineRow depth={3} label="Found companion → Resubmit w/ modifier" type="terminal-approve" />
        <OutlineRow depth={3} label="No companion → Appeal" type="terminal-approve" />
        <OutlineRow depth={2} label="No → Dispute as incorrect bundling" type="terminal-approve" />
        <OutlineRow depth={1} label="No → Call payor for status" type="q" hasChildren expanded={false} />
        <div className="px-2 mt-2 mb-1 text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">
          Linked from Library
        </div>
        <OutlineRow depth={1} label="EOB page 1 (shared · 8 SOPs)" type="evidence" />
        <OutlineRow depth={1} label="Reply to payor — bundling (shared · 4 SOPs)" type="q" />
      </div>
      <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground bg-muted/30 flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className="uppercase tracking-wider font-semibold">Nodes</span>
          <span className="font-bold tabular-nums text-foreground">12</span>
        </span>
        <span className="w-px h-3 bg-border" aria-hidden />
        <span className="flex items-center gap-1">
          <span className="uppercase tracking-wider font-semibold">Evidence</span>
          <span className="font-bold tabular-nums text-foreground">5</span>
        </span>
        <span className="w-px h-3 bg-border" aria-hidden />
        <span className="flex items-center gap-1">
          <span className="uppercase tracking-wider font-semibold">Linked</span>
          <span className="font-bold tabular-nums text-foreground">2</span>
        </span>
      </div>
    </div>
  );
}

function NodeCard({
  title,
  subtitle,
  type,
  selected,
  evidenceCount,
  channelHint,
  linked,
  className = "",
}: {
  title: string;
  subtitle?: string;
  type: "question" | "branch" | "terminal-approve" | "terminal-deny";
  selected?: boolean;
  evidenceCount?: number;
  channelHint?: "email" | "phone" | "portal";
  linked?: boolean;
  className?: string;
}) {
  const palette =
    type === "question"
      ? { bg: "hsl(var(--card))", border: tone.blue.border, headerBg: tone.blue.bg, fg: tone.blue.fg, label: "Question" }
      : type === "branch"
        ? { bg: "hsl(var(--card))", border: tone.purple.border, headerBg: tone.purple.bg, fg: tone.purple.fg, label: "Branch" }
        : type === "terminal-approve"
          ? { bg: tone.green.bg, border: tone.green.border, headerBg: "transparent", fg: tone.green.fg, label: "Outcome" }
          : { bg: tone.red.bg, border: tone.red.border, headerBg: "transparent", fg: tone.red.fg, label: "Dead-end" };
  const icon = {
    question: <HelpCircle className="w-3 h-3" style={{ color: palette.fg }} />,
    branch: <GitBranch className="w-3 h-3" style={{ color: palette.fg }} />,
    "terminal-approve": <CheckCircle2 className="w-3 h-3" style={{ color: palette.fg }} />,
    "terminal-deny": <XCircle className="w-3 h-3" style={{ color: palette.fg }} />,
  }[type];
  const channelIcon = channelHint
    ? {
        email: <Mail className="w-3 h-3" />,
        phone: <Phone className="w-3 h-3" />,
        portal: <Globe className="w-3 h-3" />,
      }[channelHint]
    : null;
  return (
    <div
      className={`absolute rounded-md border-2 shadow-sm w-52 transition-all ${className}`}
      style={{
        background: palette.bg,
        borderColor: selected ? tone.blue.fg : palette.border,
        boxShadow: selected
          ? `0 0 0 2px hsl(var(--background)), 0 0 0 4px ${tone.blue.fg}`
          : undefined,
      }}
    >
      <div
        className="px-2.5 py-1 border-b border-current/10 flex items-center gap-1.5"
        style={{ background: palette.headerBg }}
      >
        {icon}
        <span
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: palette.fg }}
        >
          {palette.label}
        </span>
        {linked && (
          <span
            className="ml-auto flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded font-semibold"
            style={{ color: tone.purple.fg, background: tone.purple.bg, border: `1px solid ${tone.purple.border}` }}
          >
            <Link2 className="w-2.5 h-2.5" /> linked
          </span>
        )}
      </div>
      <div className="px-2.5 py-2">
        <div className="text-xs font-medium text-foreground leading-snug">{title}</div>
        {subtitle && <div className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</div>}
        {(evidenceCount || channelIcon) && (
          <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-border/60">
            {channelIcon && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                {channelIcon}
                <span className="capitalize">{channelHint}</span>
              </span>
            )}
            {evidenceCount && (
              <span
                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-semibold tabular-nums"
                style={{ color: tone.amber.fg, background: tone.amber.bg, border: `1px solid ${tone.amber.border}` }}
              >
                <FileText className="w-2.5 h-2.5" /> {evidenceCount}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Edge({
  x1, y1, x2, y2, label, insertHint,
}: {
  x1: number; y1: number; x2: number; y2: number;
  label?: string;
  insertHint?: boolean;
}) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const dx = x2 - x1;
  const c1x = x1 + dx * 0.25;
  const c1y = y1 + (y2 - y1) * 0.5;
  const c2x = x2 - dx * 0.25;
  const c2y = y2 - (y2 - y1) * 0.5;
  return (
    <>
      <path
        d={`M ${x1} ${y1} C ${c1x} ${c1y} ${c2x} ${c2y} ${x2} ${y2}`}
        stroke="hsl(var(--muted-foreground) / 0.55)"
        strokeWidth="1.5"
        fill="none"
      />
      {label && (
        <g>
          <rect
            x={midX - 22}
            y={midY - 9}
            width="44"
            height="18"
            rx="9"
            fill="hsl(var(--card))"
            stroke="hsl(var(--border))"
          />
          <text
            x={midX}
            y={midY + 3}
            textAnchor="middle"
            fontSize="10"
            fill="hsl(var(--foreground))"
            fontWeight="600"
          >
            {label}
          </text>
        </g>
      )}
      {insertHint && (
        <g>
          <circle
            cx={midX + 30}
            cy={midY}
            r="9"
            fill={tone.blue.fg}
            stroke="hsl(var(--background))"
            strokeWidth="2"
          />
          <text
            x={midX + 30}
            y={midY + 3.5}
            textAnchor="middle"
            fontSize="12"
            fill="white"
            fontWeight="700"
          >
            +
          </text>
        </g>
      )}
    </>
  );
}

function CanvasArea() {
  return (
    <div
      className="flex-1 relative overflow-hidden"
      style={{
        backgroundImage:
          "radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)",
        backgroundSize: "18px 18px",
      }}
    >
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: "none" }}>
        <Edge x1={205} y1={68} x2={205} y2={140} label="Yes" insertHint />
        <Edge x1={205} y1={222} x2={130} y2={300} label="Yes" />
        <Edge x1={205} y1={222} x2={310} y2={300} label="No" />
        <Edge x1={130} y1={382} x2={60} y2={460} label="Found" />
        <Edge x1={130} y1={382} x2={210} y2={460} label="None" />
        <Edge x1={310} y1={382} x2={310} y2={460} />
        <Edge x1={420} y1={68} x2={520} y2={140} label="No" />
        <Edge x1={520} y1={222} x2={520} y2={300} label="Status" />
      </svg>

      <NodeCard
        className="left-[100px] top-[25px]"
        type="question"
        title="Did the payor send a remit?"
      />
      <NodeCard
        className="left-[100px] top-[140px]"
        type="question"
        title="Is the bundling code valid for the procedure?"
        evidenceCount={2}
      />
      <NodeCard
        className="left-[25px] top-[300px]"
        type="question"
        title="Check companion claim — was it billed separately?"
        selected
        evidenceCount={3}
        channelHint="portal"
      />
      <NodeCard
        className="left-[205px] top-[300px]"
        type="terminal-deny"
        title="Dispute as incorrect bundling"
      />
      <NodeCard
        className="left-[-45px] top-[460px]"
        type="terminal-approve"
        title="Resubmit with modifier 59"
      />
      <NodeCard
        className="left-[105px] top-[460px]"
        type="terminal-approve"
        title="Submit appeal w/ op note"
        linked
      />
      <NodeCard
        className="left-[205px] top-[460px]"
        type="terminal-deny"
        title="Close — patient responsibility"
      />
      <NodeCard
        className="left-[415px] top-[140px]"
        type="question"
        title="Call payor for claim status"
        channelHint="phone"
      />
      <NodeCard
        className="left-[415px] top-[300px]"
        type="branch"
        title="Branch on payor response"
        subtitle="3 outcomes"
      />

      <div className="absolute top-3 left-3 flex items-center gap-1 bg-card border border-border rounded-md shadow-sm">
        <button className="p-1.5 hover:bg-muted rounded-l-md"><PlusIcon className="w-3.5 h-3.5" /></button>
        <button className="p-1.5 hover:bg-muted"><Minus className="w-3.5 h-3.5" /></button>
        <div className="w-px h-4 bg-border" />
        <button className="p-1.5 hover:bg-muted"><Maximize2 className="w-3.5 h-3.5" /></button>
        <span className="px-2 text-[10px] text-muted-foreground font-semibold tabular-nums">100%</span>
      </div>

      <div
        className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold"
        style={{ color: tone.blue.fg, background: tone.blue.bg, border: `1px solid ${tone.blue.border}` }}
      >
        <Filter className="w-3 h-3" />
        Highlighting: nodes with evidence reqs
      </div>

      <div className="absolute bottom-3 right-3 bg-card border border-border rounded-md shadow-md overflow-hidden">
        <div className="px-2 py-0.5 text-[9px] text-muted-foreground bg-muted/60 font-semibold uppercase tracking-wider border-b border-border">
          Minimap
        </div>
        <div
          className="w-44 h-28 relative"
          style={{
            background:
              "radial-gradient(circle, hsl(var(--border)) 0.5px, transparent 0.5px) hsl(var(--muted) / 0.5)",
            backgroundSize: "6px 6px",
          }}
        >
          <div className="absolute inset-2 grid grid-cols-3 gap-1">
            <div className="rounded-sm" style={{ background: tone.blue.fg, opacity: 0.7 }} />
            <div className="rounded-sm" style={{ background: tone.blue.fg, opacity: 0.7 }} />
            <div />
            <div className="rounded-sm" style={{ background: tone.blue.fg, opacity: 0.7 }} />
            <div className="rounded-sm" style={{ background: tone.red.fg, opacity: 0.7 }} />
            <div />
            <div className="rounded-sm" style={{ background: tone.green.fg, opacity: 0.7 }} />
            <div className="rounded-sm" style={{ background: tone.green.fg, opacity: 0.7 }} />
            <div className="rounded-sm" style={{ background: tone.red.fg, opacity: 0.7 }} />
          </div>
          <div
            className="absolute left-1 top-1 w-20 h-12 rounded-sm pointer-events-none"
            style={{
              border: `2px solid ${tone.blue.fg}`,
              background: `${tone.blue.fg}1a`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function InspectorField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="px-3 py-2.5 border-b border-border">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </div>
      {children}
      {hint && <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function ChipRow({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground font-mono border border-border">
          {i}
        </span>
      ))}
    </div>
  );
}

function AIRewriteButton({ label = "Rewrite with AI" }: { label?: string }) {
  return (
    <button
      className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors"
      style={{ color: tone.purple.fg, background: "transparent", borderColor: tone.purple.border }}
    >
      <Wand2 className="w-3 h-3" /> {label}
    </button>
  );
}

function RightInspector() {
  return (
    <div className="w-80 border-l border-border bg-card flex flex-col shrink-0">
      {/* Header — icon tile + summary chips, matches editor inspector */}
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <div className="flex items-start gap-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
            style={{ background: tone.blue.bg, border: `1px solid ${tone.blue.border}` }}
          >
            <HelpCircle className="w-3.5 h-3.5" style={{ color: tone.blue.fg }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold leading-none">
              Question step
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
              n_check_companion
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button className="p-1 hover:bg-muted rounded"><Copy className="w-3.5 h-3.5 text-muted-foreground" /></button>
            <button className="p-1 hover:bg-muted rounded"><Trash2 className="w-3.5 h-3.5 text-muted-foreground" /></button>
            <button className="p-1 hover:bg-muted rounded"><MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" /></button>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-2 text-[10px]">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold tabular-nums"
            style={{ color: tone.purple.fg, background: tone.purple.bg, border: `1px solid ${tone.purple.border}` }}
          >
            <GitBranch className="w-2.5 h-2.5" /> 2 branches
          </span>
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold tabular-nums"
            style={{ color: tone.amber.fg, background: tone.amber.bg, border: `1px solid ${tone.amber.border}` }}
          >
            <FileText className="w-2.5 h-2.5" /> 3 ev
          </span>
        </div>
      </div>

      <div className="flex border-b border-border bg-muted/30">
        {["Content", "Branches", "Evidence", "Advanced"].map((t, i) => (
          <button
            key={t}
            className={`flex-1 py-2 text-[10px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${
              i === 0
                ? "border-foreground text-foreground bg-card"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-card/60"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        <InspectorField label="Node label">
          <input
            type="text"
            defaultValue="Check companion claim"
            className="w-full px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-foreground"
          />
        </InspectorField>

        <InspectorField label="Question text shown to operator">
          <textarea
            rows={3}
            defaultValue="Search the payor portal for a companion claim billed by the rendering provider on the same date of service. Was one billed separately?"
            className="w-full px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-foreground resize-none"
          />
          <AIRewriteButton />
        </InspectorField>

        <InspectorField label="Instructions / help text">
          <textarea
            rows={2}
            defaultValue="Look for the same CPT family on a sibling claim. If found, note the claim ID."
            className="w-full px-2 py-1.5 text-xs border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-foreground resize-none"
          />
          <AIRewriteButton label="Tighten with AI" />
        </InspectorField>

        <InspectorField label="Channel hint">
          <div className="flex gap-1">
            {[
              { i: <Globe className="w-3 h-3" />, l: "Portal", on: true },
              { i: <Phone className="w-3 h-3" />, l: "Phone", on: false },
              { i: <Mail className="w-3 h-3" />, l: "Email", on: false },
            ].map((c) => (
              <button
                key={c.l}
                className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-md border transition-colors ${
                  c.on
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {c.i} {c.l}
              </button>
            ))}
          </div>
        </InspectorField>

        <InspectorField
          label="Evidence requirements (3)"
          hint="Drag to reorder. Click a chip to convert to a Library reference."
        >
          <div className="space-y-1.5">
            {[
              { l: "EOB page 1", linked: false, ev: 8 },
              { l: "CMS-1500 — companion claim", linked: true, ev: 4 },
              { l: "Medical records — op note", linked: false, ev: 3 },
            ].map((e) => (
              <div
                key={e.l}
                className="p-1.5 rounded-md flex items-center gap-1.5"
                style={{
                  background: "hsl(var(--cc-amber-bg) / 0.4)",
                  border: `1px solid ${tone.amber.border}`,
                }}
              >
                <FileText className="w-3 h-3 shrink-0" style={{ color: tone.amber.fg }} />
                <span className="text-[11px] font-medium truncate flex-1">{e.l}</span>
                {e.linked && (
                  <span
                    className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded font-semibold tabular-nums"
                    style={{ color: tone.purple.fg, background: tone.purple.bg, border: `1px solid ${tone.purple.border}` }}
                  >
                    <Link2 className="w-2.5 h-2.5" /> shared · {e.ev}
                  </span>
                )}
                <button className="p-0.5 hover:bg-background/60 rounded">
                  <Pencil className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            ))}
            <button className="w-full mt-1 flex items-center justify-center gap-1 text-[10px] py-1 border border-dashed border-border rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <Plus className="w-3 h-3" /> Add evidence req
            </button>
            <button
              className="w-full flex items-center justify-center gap-1 text-[10px] py-1 border border-dashed rounded-md transition-colors"
              style={{ color: tone.purple.fg, borderColor: tone.purple.border }}
            >
              <Library className="w-3 h-3" /> Insert from Library
            </button>
          </div>
        </InspectorField>

        <InspectorField label="Filename template">
          <input
            type="text"
            defaultValue="{claim_id}_companion_{invoice_number}"
            className="w-full px-2 py-1.5 text-xs font-mono border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-foreground"
          />
          <div className="mt-1.5">
            <ChipRow items={["{claim_id}", "{invoice_number}", "{dos}", "{leg_number}", "{payor}", "{doc_type}"]} />
          </div>
          <div className="text-[10px] text-muted-foreground mt-1.5">
            Preview: <span className="font-mono text-foreground">CLM-7421_companion_INV-8830</span>
          </div>
        </InspectorField>

        <InspectorField label="Branches">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-[11px]">
              <span
                className="px-1.5 py-0.5 rounded font-semibold"
                style={{ color: tone.green.fg, background: tone.green.bg, border: `1px solid ${tone.green.border}` }}
              >
                Found
              </span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="text-foreground truncate">Resubmit with modifier 59</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span
                className="px-1.5 py-0.5 rounded font-semibold"
                style={{ color: tone.red.fg, background: tone.red.bg, border: `1px solid ${tone.red.border}` }}
              >
                None
              </span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="text-foreground truncate">Submit appeal w/ op note</span>
            </div>
          </div>
        </InspectorField>
      </div>

      <div
        className="border-t border-border px-3 py-2 flex items-start gap-1.5"
        style={{ background: "hsl(var(--cc-amber-bg) / 0.5)" }}
      >
        <Layers className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: tone.amber.fg }} />
        <div className="text-[10px]" style={{ color: tone.amber.fg }}>
          <span className="font-semibold">Heads up:</span> &ldquo;CMS-1500 — companion claim&rdquo; is a{" "}
          <span className="font-semibold">Library evidence</span> used by 4 SOPs. Editing it here updates all 4.
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="h-8 border-t border-border bg-card flex items-center px-3 gap-4 text-[10px] text-muted-foreground shrink-0">
      <span className="flex items-center gap-1">
        <span className="uppercase tracking-wider font-semibold">Nodes</span>
        <span className="font-bold tabular-nums text-foreground">12</span>
      </span>
      <span className="w-px h-3 bg-border" aria-hidden />
      <span className="flex items-center gap-1">
        <span className="uppercase tracking-wider font-semibold">Evidence</span>
        <span className="font-bold tabular-nums text-foreground">5</span>
      </span>
      <span className="w-px h-3 bg-border" aria-hidden />
      <span className="flex items-center gap-1">
        <span className="uppercase tracking-wider font-semibold">Linked</span>
        <span className="font-bold tabular-nums text-foreground">2</span>
      </span>
      <span className="w-px h-3 bg-border" aria-hidden />
      <span className="flex items-center gap-1" style={{ color: tone.amber.fg }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.amber.fg }} />
        <span className="font-semibold uppercase tracking-wider">Unsaved</span>
      </span>
      <span>Last saved 2 min ago</span>
      <div className="flex-1" />
      <span className="flex items-center gap-1">
        <Bot className="w-3 h-3" /> AI suggestions:{" "}
        <span className="font-bold tabular-nums text-foreground">2</span>
      </span>
      <span className="w-px h-3 bg-border" aria-hidden />
      <span className="font-mono">v23 · edited by you</span>
    </div>
  );
}

function Annotation({
  className,
  num,
  title,
  body,
}: {
  className: string;
  num: number;
  title: string;
  body: string;
}) {
  return (
    <div className={`absolute z-30 ${className}`}>
      <div className="flex items-start gap-2">
        <div
          className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 shadow tabular-nums"
          style={{
            background: tone.amber.fg,
            color: "hsl(var(--card))",
            boxShadow: `0 0 0 2px ${tone.amber.border}`,
          }}
        >
          {num}
        </div>
        <div
          className="rounded-md p-2 shadow-sm w-56"
          style={{ background: tone.amber.bg, border: `1px solid ${tone.amber.border}` }}
        >
          <div className="text-[11px] font-semibold" style={{ color: tone.amber.fg }}>
            {title}
          </div>
          <div className="text-[10px] mt-0.5 leading-snug" style={{ color: tone.amber.fg }}>
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FullPageEditor() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <div className="relative w-full h-screen max-h-[960px] flex flex-col border border-border overflow-hidden">
        <TopBar />
        <div className="flex-1 flex min-h-0">
          <LeftPanel />
          <CanvasArea />
          <RightInspector />
        </div>
        <StatusBar />

        <Annotation
          num={1}
          className="left-[290px] top-[60px]"
          title="Settings tab (was 'Details')"
          body="Error-type Name, Category, Description, Custom dispute instructions live here — out of the way until needed."
        />
        <Annotation
          num={2}
          className="left-[290px] top-[155px]"
          title="AI Builder tab (was 'AI Analyzer')"
          body="Paste raw SOP text → AI generates the tree. Same feature, promoted to a first-class panel."
        />
        <Annotation
          num={3}
          className="left-[640px] top-[300px]"
          title="Insert-between (+ on edge)"
          body="Hover any connector to insert a new node. No more delete-and-rewire."
        />
        <Annotation
          num={4}
          className="right-[360px] top-[180px]"
          title="AI rewrite, in context"
          body="Per-field 'Rewrite with AI' beside every question and instruction — text-editor convenience without leaving the inspector."
        />
        <Annotation
          num={5}
          className="right-[360px] bottom-[170px]"
          title="Shared Library badge"
          body="Any node or evidence req can be a shared, referenced item. Edit once, propagates everywhere."
        />
        <Annotation
          num={6}
          className="left-[290px] top-[3px]"
          title="Find & Replace across all SOPs"
          body="The big lever for the 'edit one thing across 8 trees' problem."
        />
      </div>
    </div>
  );
}
