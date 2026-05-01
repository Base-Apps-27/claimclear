import React from "react";
import {
  CheckCircle2,
  CircleDashed,
  Sparkles,
  AlertTriangle,
  AlertCircle,
  Edit2,
  Paperclip,
  MapPin,
  RefreshCw,
  Save,
  Send,
  ChevronRight,
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

export default function InlineGauntlet() {
  return (
    <div className="min-h-screen bg-slate-50 cc-scope font-sans text-slate-900">
      {/* Right-pane chrome — represents what already exists above the gauntlet */}
      <div className="bg-white border-b border-slate-200 px-5 py-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-base font-bold tracking-tight truncate">{group.invoiceNumber}</h1>
            <Badge variant="secondary" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">
              {group.status}
            </Badge>
            <span className="text-xs text-slate-500 font-mono">{group.totalAmount}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-emerald-700 font-medium shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" />
            4 of 4 legs ready
          </div>
        </div>
        <div className="flex items-center gap-1 text-[11px] flex-wrap">
          {legs.map((leg) => (
            <span key={leg.id} className="font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
              #{leg.id}
            </span>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Submission Gauntlet */}
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2 px-1">
            Submission gauntlet
          </h3>
          <div className="flex flex-col gap-1.5">
            {transitionSteps.map((step) => (
              <div
                key={step.key}
                className="flex items-center gap-2.5 bg-white border border-slate-200 rounded-md px-3 py-2 text-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <div className="font-medium text-slate-700">{step.label}</div>
                <div className="text-slate-400 text-[11px] ml-auto">{step.detail}</div>
              </div>
            ))}
            <div className="flex items-center gap-2.5 bg-indigo-50 border-2 border-indigo-300 rounded-md px-3 py-2 text-xs ring-2 ring-indigo-100">
              <div className="w-3.5 h-3.5 rounded-full border-2 border-indigo-500 flex items-center justify-center shrink-0">
                <div className="w-1 h-1 rounded-full bg-indigo-500" />
              </div>
              <div className="font-semibold text-indigo-900">Review &amp; edit draft before submit</div>
              <Badge
                variant="outline"
                className="ml-auto text-[9px] uppercase tracking-wide border-indigo-400 text-indigo-700 bg-white py-0 px-1.5 h-4"
              >
                Current
              </Badge>
            </div>
            <div className="flex items-center gap-2.5 bg-white border border-dashed border-slate-300 rounded-md px-3 py-2 text-xs opacity-60">
              <CircleDashed className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <div className="font-medium text-slate-500">Submit to portal</div>
              <div className="text-slate-400 text-[11px] ml-auto">Pending</div>
            </div>
          </div>
        </div>

        {/* The Review section */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-200 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-semibold text-slate-900">Review &amp; edit draft</h2>
            </div>
            <Badge variant="outline" className="font-mono text-[10px] bg-white">
              Draft
            </Badge>
          </div>

          {/* Draft preview — the dominant block */}
          <div className="p-4 space-y-3 bg-slate-50/50 border-b border-slate-200">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 flex items-center justify-between">
                <span>Subject</span>
                <span className="text-slate-400 normal-case tracking-normal">Editable</span>
              </div>
              <input
                defaultValue={draftSubject}
                className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-md font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                readOnly
              />
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 flex items-center justify-between">
                <span>Message body</span>
                <span className="text-slate-400 normal-case tracking-normal">Rich text · editable</span>
              </div>
              <div
                className="w-full px-3 py-2.5 text-xs bg-white border border-slate-300 rounded-md text-slate-800 leading-relaxed prose prose-xs max-w-none [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 max-h-[280px] overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: draftDescriptionHtml }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
                  <Paperclip className="w-3 h-3" />
                  Attachments ({evidenceFiles.length})
                </div>
                <div className="space-y-1">
                  {evidenceFiles.map((f) => (
                    <div
                      key={f.name}
                      className="flex items-center justify-between gap-2 text-[11px] bg-white border border-slate-200 rounded px-2 py-1"
                    >
                      <div className="truncate min-w-0 flex-1 text-slate-700">{f.name}</div>
                      <Badge
                        variant="secondary"
                        className="text-[9px] py-0 px-1 h-4 bg-slate-100 text-slate-600 shrink-0"
                      >
                        {f.scope}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  GPS breadcrumbs
                </div>
                <div className="flex flex-wrap gap-1">
                  {gpsBreadcrumbs.map((c) => (
                    <Badge
                      key={c}
                      variant="outline"
                      className="text-[10px] font-mono bg-white text-slate-600 border-slate-200 py-0 px-1.5 h-5"
                    >
                      {c}
                    </Badge>
                  ))}
                </div>
                <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Included legs
                </div>
                <div className="flex flex-wrap gap-1">
                  {legs.map((l) => (
                    <Badge
                      key={l.id}
                      variant="outline"
                      className="text-[10px] font-mono bg-white text-slate-600 border-slate-200 py-0 px-1.5 h-5"
                    >
                      #{l.id}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Sources strip */}
          <div className="p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Sources used in this draft
              </div>
              <div className="text-[10px] text-slate-400">Edit any source then regenerate</div>
            </div>

            <SourceRow
              icon={<Sparkles className="w-3.5 h-3.5 text-indigo-500" />}
              label="Group context"
              meta={`${group.groupContextSavedBy} · ${group.groupContextSavedAt}`}
              body={group.groupContext}
            />

            <SourceRow
              icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
              label="Special circumstances"
              meta="Operator note"
              body={specialCircumstances}
            />

            <SourceRow
              icon={<Sparkles className="w-3.5 h-3.5 text-slate-400" />}
              label="SOP guidance applied"
              meta="From error type"
              body={sopGuidance}
              tone="muted"
            />

            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 pt-2">
              Per-leg context (4 legs)
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {legs.map((leg) => {
                const has = !!leg.perLegContext;
                return (
                  <div
                    key={leg.id}
                    className={`text-[11px] border rounded p-2 group/leg ${
                      has ? "bg-white border-slate-200" : "bg-amber-50 border-amber-200"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-mono text-[10px] font-semibold text-slate-700">{leg.confNumber}</div>
                      <button className="text-slate-400 hover:text-indigo-600 opacity-0 group-hover/leg:opacity-100 transition-opacity">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                    {has ? (
                      <div className="text-slate-600 leading-snug line-clamp-3">{leg.perLegContext}</div>
                    ) : (
                      <div className="flex items-start gap-1 text-amber-800 leading-snug">
                        <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>No context — AI will rely on group context only.</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Metadata footer */}
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 flex items-center gap-3 text-[10px] text-slate-500">
            <span>
              Generated <span className="font-medium text-slate-700">{previewMeta.generatedAt}</span>
            </span>
            <span>·</span>
            <span className="font-mono">{previewMeta.model}</span>
            <span>·</span>
            <span>
              {previewMeta.tokensIn} in / {previewMeta.tokensOut} out
            </span>
            <span className="ml-auto">By {previewMeta.generatedBy}</span>
          </div>
        </div>

        {/* Action bar */}
        <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-3 flex items-center gap-2 sticky bottom-3">
          <Button variant="outline" size="sm" className="text-xs h-8">
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            Regenerate from sources
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
      </div>
    </div>
  );
}

function SourceRow({
  icon,
  label,
  meta,
  body,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  meta: string;
  body: string;
  tone?: "default" | "muted";
}) {
  return (
    <div
      className={`group/row border rounded-md p-2.5 text-xs ${
        tone === "muted" ? "bg-slate-50 border-slate-200" : "bg-white border-slate-200"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="font-semibold text-[11px] text-slate-700">{label}</span>
          <span className="text-[10px] text-slate-400">· {meta}</span>
        </div>
        <button className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-600 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <Edit2 className="w-3 h-3" />
          Edit
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
      <div className="text-slate-700 leading-relaxed">{body}</div>
    </div>
  );
}
