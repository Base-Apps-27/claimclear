import React, { useState } from "react";
import {
  X,
  ChevronLeft,
  Sparkles,
  AlertTriangle,
  AlertCircle,
  Edit2,
  Paperclip,
  MapPin,
  RefreshCw,
  Save,
  Send,
  CheckCircle2,
} from "lucide-react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import {
  group,
  legs,
  specialCircumstances,
  draftSubject,
  draftDescriptionHtml,
  evidenceFiles,
  gpsBreadcrumbs,
  sopGuidance,
  previewMeta,
  transitionSteps,
} from "./_shared";

type Tab = "draft" | "sources";

export default function SlideOver() {
  const [tab, setTab] = useState<Tab>("draft");

  return (
    <div className="relative min-h-screen bg-slate-50 cc-scope font-sans text-slate-900 overflow-hidden">
      {/* DIMMED BACKGROUND — the right pane the operator came from */}
      <div className="absolute inset-0 p-4 pointer-events-none opacity-30 blur-[1px] select-none">
        <div className="bg-white border border-slate-200 rounded-lg p-4 mb-3">
          <div className="text-sm font-bold mb-2">{group.invoiceNumber}</div>
          <div className="space-y-1.5">
            {legs.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5"
              >
                <span className="font-mono">{l.confNumber}</span>
                <span className="text-slate-500">{l.amount}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          {transitionSteps.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Backdrop tint over the right pane */}
      <div className="absolute inset-0 bg-slate-900/20 pointer-events-none" />

      {/* THE SHEET — fills the right-pane column */}
      <div className="relative bg-white shadow-2xl border-l-4 border-indigo-500 rounded-l-lg ml-3 mt-3 mb-3 mr-0 flex flex-col" style={{ minHeight: "calc(100vh - 24px)" }}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-white flex items-center gap-2 sticky top-0 z-10 rounded-tl-lg">
          <button className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-900 transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <h1 className="text-sm font-semibold text-slate-900 truncate">Review &amp; edit draft</h1>
              <Badge variant="outline" className="font-mono text-[10px] bg-white shrink-0">
                Required
              </Badge>
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
              {group.invoiceNumber} · {legs.length} legs · {group.totalAmount}
            </div>
          </div>
          <button className="p-1 hover:bg-slate-100 rounded text-slate-500 hover:text-slate-900 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-4 pt-3 border-b border-slate-200 flex items-center gap-1 bg-white sticky top-[60px] z-10">
          <TabBtn active={tab === "draft"} onClick={() => setTab("draft")}>
            Draft preview
          </TabBtn>
          <TabBtn active={tab === "sources"} onClick={() => setTab("sources")}>
            Sources ({3 + legs.length})
          </TabBtn>
          <div className="ml-auto text-[10px] text-slate-400 pb-2">
            {previewMeta.tokensIn} in / {previewMeta.tokensOut} out · {previewMeta.model}
          </div>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {tab === "draft" ? (
            <>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Email to portal
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px] bg-white">
                    Editable
                  </Badge>
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 w-14 shrink-0">To</span>
                    <span className="text-slate-700 font-medium">MAS Disputing Portal</span>
                  </div>
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 w-14 shrink-0">Subject</span>
                    <input
                      defaultValue={draftSubject}
                      className="flex-1 px-2 py-1 text-xs bg-white border border-slate-300 rounded text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      readOnly
                    />
                  </div>
                  <div
                    className="mt-2 px-3 py-2.5 text-xs bg-white border border-slate-300 rounded text-slate-800 leading-relaxed prose prose-xs max-w-none [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
                    dangerouslySetInnerHTML={{ __html: draftDescriptionHtml }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
                    <Paperclip className="w-3 h-3" />
                    Attachments ({evidenceFiles.length})
                  </div>
                  <div className="space-y-1">
                    {evidenceFiles.map((f) => (
                      <div
                        key={f.name}
                        className="flex items-center justify-between gap-2 text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1"
                      >
                        <div className="truncate min-w-0 flex-1 text-slate-700">{f.name}</div>
                        <Badge
                          variant="secondary"
                          className="text-[9px] py-0 px-1 h-4 bg-white text-slate-600 shrink-0 border border-slate-200"
                        >
                          {f.scope}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    GPS &amp; legs included
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {gpsBreadcrumbs.map((c) => (
                      <Badge
                        key={c}
                        variant="outline"
                        className="text-[10px] font-mono bg-slate-50 text-slate-600 border-slate-200 py-0 px-1.5 h-5"
                      >
                        {c}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {legs.map((l) => (
                      <Badge
                        key={l.id}
                        variant="outline"
                        className="text-[10px] font-mono bg-slate-50 text-slate-600 border-slate-200 py-0 px-1.5 h-5"
                      >
                        #{l.id}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-indigo-50 border border-indigo-200 rounded-md p-2.5 flex items-start gap-2 text-[11px] text-indigo-900">
                <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Hand-edits are saved with the draft. To re-pull from your context notes, switch to the Sources tab and
                  click Regenerate.
                </span>
              </div>
            </>
          ) : (
            <>
              <SourceCard
                label="Group context"
                meta={`${group.groupContextSavedBy} · ${group.groupContextSavedAt}`}
                body={group.groupContext}
              />
              <SourceCard
                label="Special circumstances"
                meta="Operator note"
                body={specialCircumstances}
                accent="amber"
              />
              <SourceCard label="SOP guidance applied" meta="From error type" body={sopGuidance} muted />

              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 pt-1">
                Per-leg context (4 legs)
              </div>
              {legs.map((leg) => {
                const has = !!leg.perLegContext;
                return (
                  <div
                    key={leg.id}
                    className={`group/row border rounded-md p-2.5 text-xs ${
                      has ? "bg-white border-slate-200" : "bg-amber-50 border-amber-200"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-slate-700">{leg.confNumber}</span>
                        <span className="text-[10px] text-slate-400 font-mono">#{leg.id}</span>
                        <span className="text-[10px] text-slate-400">· {leg.amount}</span>
                      </div>
                      <button className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-600">
                        <Edit2 className="w-3 h-3" />
                        Edit
                      </button>
                    </div>
                    {has ? (
                      <div className="text-slate-700 leading-relaxed">{leg.perLegContext}</div>
                    ) : (
                      <div className="flex items-start gap-1.5 text-amber-800">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>No context provided. AI relied on group context only for this leg.</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Sticky footer */}
        <div className="border-t border-slate-200 bg-white px-4 py-3 sticky bottom-0">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="text-xs h-8">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Regenerate
            </Button>
            <Button variant="outline" size="sm" className="text-xs h-8">
              <Save className="w-3.5 h-3.5 mr-1.5" />
              Save edits
            </Button>
            <Button size="sm" className="text-xs h-8 ml-auto bg-indigo-600 hover:bg-indigo-700">
              Submit to portal
              <Send className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>
          <div className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-2">
            <span>Generated {previewMeta.generatedAt}</span>
            <span>·</span>
            <span>By {previewMeta.generatedBy}</span>
            <span className="ml-auto flex items-center gap-1 text-amber-700">
              <AlertTriangle className="w-3 h-3" />
              Regenerate discards hand-edits
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs font-medium px-3 py-2 border-b-2 transition-colors ${
        active
          ? "border-indigo-500 text-indigo-700"
          : "border-transparent text-slate-500 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

function SourceCard({
  label,
  meta,
  body,
  muted,
  accent,
}: {
  label: string;
  meta: string;
  body: string;
  muted?: boolean;
  accent?: "amber";
}) {
  const tone =
    accent === "amber"
      ? "bg-amber-50 border-amber-200"
      : muted
      ? "bg-slate-50 border-slate-200"
      : "bg-white border-slate-200";
  return (
    <div className={`group/row border rounded-md p-2.5 text-xs ${tone}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {accent === "amber" && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
          <span className="font-semibold text-[11px] text-slate-700">{label}</span>
          <span className="text-[10px] text-slate-400">· {meta}</span>
        </div>
        <button className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-600">
          <Edit2 className="w-3 h-3" />
          Edit
        </button>
      </div>
      <div className="text-slate-700 leading-relaxed">{body}</div>
    </div>
  );
}
