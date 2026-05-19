import {
  Search,
  Replace,
  History,
  Eye,
  Sparkles,
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
  Image as ImageIcon,
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

function TopBar() {
  return (
    <div className="h-12 border-b border-border bg-card flex items-center px-3 gap-2 shrink-0">
      <button className="p-1.5 hover:bg-muted rounded">
        <ChevronLeft className="w-4 h-4 text-muted-foreground" />
      </button>
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">SOPs</span>
        <ChevronRight className="w-3 h-3 text-muted-foreground" />
        <span className="text-muted-foreground">Denials</span>
        <ChevronRight className="w-3 h-3 text-muted-foreground" />
        <span className="font-medium text-foreground">CO-97 — Bundled / Included</span>
      </div>
      <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200">
        Draft · unsaved
      </span>
      <div className="flex-1" />
      <button className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted rounded">
        <Search className="w-3.5 h-3.5" /> Find
        <kbd className="ml-1 px-1 py-0.5 text-[10px] bg-muted rounded font-mono">⌘F</kbd>
      </button>
      <button className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted rounded">
        <Replace className="w-3.5 h-3.5" /> Find & Replace across all SOPs
      </button>
      <button className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted rounded">
        <History className="w-3.5 h-3.5" /> History
      </button>
      <button className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted rounded">
        <Eye className="w-3.5 h-3.5" /> Preview SOP walk
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-foreground text-background hover:opacity-90 rounded">
        <Save className="w-3.5 h-3.5" /> Save
      </button>
    </div>
  );
}

function LeftPanelTabs({ active }: { active: string }) {
  const tabs = [
    { key: "outline", label: "Outline", icon: ListTree },
    { key: "palette", label: "Add", icon: Plus },
    { key: "library", label: "Library", icon: Library },
    { key: "settings", label: "Settings", icon: Settings },
    { key: "ai", label: "AI Builder", icon: Sparkles },
  ];
  return (
    <div className="flex border-b border-border bg-card">
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium border-b-2 ${
              isActive
                ? "border-foreground text-foreground bg-background"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
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
    q: <HelpCircle className="w-3.5 h-3.5 text-blue-600" />,
    branch: <GitBranch className="w-3.5 h-3.5 text-violet-600" />,
    "terminal-approve": <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />,
    "terminal-deny": <XCircle className="w-3.5 h-3.5 text-red-600" />,
    evidence: <FileText className="w-3.5 h-3.5 text-amber-600" />,
  }[type];
  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 text-xs rounded cursor-pointer ${
        selected ? "bg-blue-50 ring-1 ring-blue-300" : "hover:bg-muted/60"
      }`}
      style={{ paddingLeft: 8 + depth * 14 }}
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
      {iconForType}
      <span className={`truncate ${selected ? "font-medium text-foreground" : "text-foreground"}`}>
        {label}
      </span>
      {typeof evidenceCount === "number" && (
        <span className="ml-auto px-1.5 py-0 text-[9px] rounded bg-amber-100 text-amber-700 font-medium">
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
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-muted/50 border border-border rounded focus:outline-none focus:ring-1 focus:ring-foreground"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1 text-xs">
        <OutlineRow depth={0} label="Start: Did the payor send a remit?" type="q" hasChildren />
        <OutlineRow depth={1} label="Yes → Is bundling code valid?" type="q" hasChildren />
        <OutlineRow depth={2} label="Yes → Check companion claim" type="q" hasChildren selected evidenceCount={3} />
        <OutlineRow depth={3} label="📎 EOB page 1" type="evidence" />
        <OutlineRow depth={3} label="📎 CMS-1500 — companion claim" type="evidence" />
        <OutlineRow depth={3} label="📎 Medical records — op note" type="evidence" />
        <OutlineRow depth={3} label="Found companion → Resubmit w/ modifier" type="terminal-approve" />
        <OutlineRow depth={3} label="No companion → Appeal" type="terminal-approve" />
        <OutlineRow depth={2} label="No → Dispute as incorrect bundling" type="terminal-approve" />
        <OutlineRow depth={1} label="No → Call payor for status" type="q" hasChildren expanded={false} />
        <div className="px-2 mt-2 text-[10px] font-medium uppercase text-muted-foreground tracking-wider">
          Linked from Library
        </div>
        <OutlineRow depth={1} label="🔗 EOB page 1 (shared · 8 SOPs)" type="evidence" />
        <OutlineRow depth={1} label="🔗 Reply to payor — bundling (shared · 4 SOPs)" type="q" />
      </div>
      <div className="border-t border-border p-2 text-[10px] text-muted-foreground bg-muted/30">
        12 nodes · 5 evidence reqs · 2 linked from library
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
  const styles = {
    question: "bg-white border-blue-300",
    branch: "bg-white border-violet-300",
    "terminal-approve": "bg-green-50 border-green-400",
    "terminal-deny": "bg-red-50 border-red-400",
  }[type];
  const icon = {
    question: <HelpCircle className="w-3 h-3 text-blue-600" />,
    branch: <GitBranch className="w-3 h-3 text-violet-600" />,
    "terminal-approve": <CheckCircle2 className="w-3 h-3 text-green-700" />,
    "terminal-deny": <XCircle className="w-3 h-3 text-red-700" />,
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
      className={`absolute rounded-lg border-2 shadow-sm w-52 ${styles} ${
        selected ? "ring-2 ring-blue-500 ring-offset-2" : ""
      } ${className}`}
    >
      <div className="px-2.5 py-1.5 border-b border-current/10 flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {type === "question" ? "Question" : type === "branch" ? "Branch" : type === "terminal-approve" ? "Outcome" : "Dead-end"}
        </span>
        {linked && (
          <span className="ml-auto flex items-center gap-0.5 text-[9px] text-violet-700 bg-violet-100 px-1 py-0.5 rounded">
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
              <span className="flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded font-medium">
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
        stroke="#94a3b8"
        strokeWidth="1.5"
        fill="none"
      />
      {label && (
        <g>
          <rect x={midX - 22} y={midY - 9} width="44" height="18" rx="9" fill="white" stroke="#cbd5e1" />
          <text x={midX} y={midY + 3} textAnchor="middle" fontSize="10" fill="#475569" fontWeight="500">
            {label}
          </text>
        </g>
      )}
      {insertHint && (
        <g>
          <circle cx={midX + 30} cy={midY} r="9" fill="#2563eb" stroke="white" strokeWidth="2" />
          <text x={midX + 30} y={midY + 3.5} textAnchor="middle" fontSize="12" fill="white" fontWeight="700">+</text>
        </g>
      )}
    </>
  );
}

function CanvasArea() {
  return (
    <div className="flex-1 relative bg-[radial-gradient(circle,#e5e7eb_1px,transparent_1px)] [background-size:18px_18px] overflow-hidden">
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
        <button className="p-1.5 hover:bg-muted"><PlusIcon className="w-3.5 h-3.5" /></button>
        <button className="p-1.5 hover:bg-muted"><Minus className="w-3.5 h-3.5" /></button>
        <div className="w-px h-4 bg-border" />
        <button className="p-1.5 hover:bg-muted"><Maximize2 className="w-3.5 h-3.5" /></button>
        <span className="px-2 text-[10px] text-muted-foreground font-medium">100%</span>
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 bg-blue-50 border border-blue-200 rounded-md text-[10px] text-blue-800 font-medium">
        <Filter className="w-3 h-3" />
        Highlighting: nodes with evidence reqs
      </div>

      <div className="absolute bottom-3 right-3 bg-card border border-border rounded shadow-sm overflow-hidden">
        <div className="px-2 py-0.5 text-[9px] text-muted-foreground bg-muted/40 font-medium">MINIMAP</div>
        <div className="w-44 h-28 bg-muted/30 relative">
          <div className="absolute inset-2 grid grid-cols-3 gap-1">
            <div className="bg-blue-300/60 rounded-sm" />
            <div className="bg-blue-300/60 rounded-sm" />
            <div />
            <div className="bg-blue-300/60 rounded-sm" />
            <div className="bg-red-300/60 rounded-sm" />
            <div />
            <div className="bg-green-300/60 rounded-sm" />
            <div className="bg-green-300/60 rounded-sm" />
            <div className="bg-red-300/60 rounded-sm" />
          </div>
          <div className="absolute left-1 top-1 w-20 h-12 border-2 border-foreground rounded-sm pointer-events-none" />
        </div>
      </div>
    </div>
  );
}

function InspectorField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="px-3 py-2.5 border-b border-border">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
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
    <button className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-violet-700 hover:bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">
      <Wand2 className="w-3 h-3" /> {label}
    </button>
  );
}

function RightInspector() {
  return (
    <div className="w-80 border-l border-border bg-card flex flex-col shrink-0">
      <div className="h-10 px-3 flex items-center justify-between border-b border-border bg-card">
        <div className="flex items-center gap-2 text-xs">
          <HelpCircle className="w-3.5 h-3.5 text-blue-600" />
          <span className="font-medium">Question node</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-1 hover:bg-muted rounded"><Copy className="w-3.5 h-3.5 text-muted-foreground" /></button>
          <button className="p-1 hover:bg-muted rounded"><Trash2 className="w-3.5 h-3.5 text-muted-foreground" /></button>
          <button className="p-1 hover:bg-muted rounded"><MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" /></button>
        </div>
      </div>

      <div className="flex border-b border-border">
        {["Content", "Branches", "Evidence", "Advanced"].map((t, i) => (
          <button
            key={t}
            className={`flex-1 py-2 text-[11px] font-medium border-b-2 ${
              i === 0
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
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
            className="w-full px-2 py-1.5 text-xs border border-border rounded focus:outline-none focus:ring-1 focus:ring-foreground"
          />
        </InspectorField>

        <InspectorField label="Question text shown to operator">
          <textarea
            rows={3}
            defaultValue="Search the payor portal for a companion claim billed by the rendering provider on the same date of service. Was one billed separately?"
            className="w-full px-2 py-1.5 text-xs border border-border rounded focus:outline-none focus:ring-1 focus:ring-foreground resize-none"
          />
          <AIRewriteButton />
        </InspectorField>

        <InspectorField label="Instructions / help text">
          <textarea
            rows={2}
            defaultValue="Look for the same CPT family on a sibling claim. If found, note the claim ID."
            className="w-full px-2 py-1.5 text-xs border border-border rounded focus:outline-none focus:ring-1 focus:ring-foreground resize-none"
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
                className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded border ${
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
              <div key={e.l} className="p-1.5 border border-border rounded bg-background flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-amber-600 shrink-0" />
                <span className="text-[11px] font-medium truncate flex-1">{e.l}</span>
                {e.linked && (
                  <span className="flex items-center gap-0.5 text-[9px] text-violet-700 bg-violet-100 px-1 py-0.5 rounded">
                    <Link2 className="w-2.5 h-2.5" /> shared · {e.ev}
                  </span>
                )}
                <button className="p-0.5 hover:bg-muted rounded">
                  <Pencil className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            ))}
            <button className="w-full mt-1 flex items-center justify-center gap-1 text-[10px] py-1 border border-dashed border-border rounded text-muted-foreground hover:bg-muted hover:text-foreground">
              <Plus className="w-3 h-3" /> Add evidence req
            </button>
            <button className="w-full flex items-center justify-center gap-1 text-[10px] py-1 border border-dashed border-violet-300 rounded text-violet-700 hover:bg-violet-50">
              <Library className="w-3 h-3" /> Insert from Library
            </button>
          </div>
        </InspectorField>

        <InspectorField label="Filename template">
          <input
            type="text"
            defaultValue="{claim_id}_companion_{invoice_number}"
            className="w-full px-2 py-1.5 text-xs font-mono border border-border rounded focus:outline-none focus:ring-1 focus:ring-foreground"
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
              <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-medium">Found</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="text-foreground truncate">Resubmit with modifier 59</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-medium">None</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
              <span className="text-foreground truncate">Submit appeal w/ op note</span>
            </div>
          </div>
        </InspectorField>
      </div>

      <div className="border-t border-border p-2.5 bg-amber-50/50">
        <div className="flex items-start gap-1.5">
          <Layers className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-[10px] text-amber-900">
            <span className="font-semibold">Heads up:</span> "CMS-1500 — companion claim" is a <span className="font-semibold">Library evidence</span> used by 4 SOPs. Editing it here updates all 4.
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="h-7 border-t border-border bg-card flex items-center px-3 gap-4 text-[10px] text-muted-foreground shrink-0">
      <span>12 nodes · 5 evidence reqs · 2 linked from library</span>
      <span className="text-amber-700">● Unsaved changes</span>
      <span>Last saved 2 min ago</span>
      <div className="flex-1" />
      <span className="flex items-center gap-1"><Bot className="w-3 h-3" /> AI suggestions: 2</span>
      <span>v23 · edited by you</span>
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
        <div className="w-6 h-6 rounded-full bg-amber-400 text-amber-950 text-[11px] font-bold flex items-center justify-center shrink-0 shadow ring-2 ring-amber-200">
          {num}
        </div>
        <div className="bg-amber-50 border border-amber-300 rounded-md p-2 shadow-sm w-56">
          <div className="text-[11px] font-semibold text-amber-900">{title}</div>
          <div className="text-[10px] text-amber-800 mt-0.5 leading-snug">{body}</div>
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
