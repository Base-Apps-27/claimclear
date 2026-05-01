import React, { useState } from "react";
import { 
  X, CheckCircle2, FileText, MapPin, AlertTriangle, AlertCircle, RefreshCw, 
  Save, Send, Edit2, CircleDashed, Check, Paperclip, File, Clock,
  ChevronRight, BrainCircuit, User
} from "lucide-react";
import { 
  group, legs, specialCircumstances, aiRestatement, aiRestatementGeneratedAt,
  draftSubject, draftDescriptionHtml, evidenceFiles, gpsBreadcrumbs, sopGuidance,
  previewMeta, transitionSteps
} from "./_shared";

export default function SlideOver() {
  return (
    <div className="flex h-screen w-full bg-[#f8f9fa] overflow-hidden cc-scope font-sans">
      {/* BACKGROUND: The Queue / Gauntlet Context (Dimmed) */}
      <div className="w-1/3 h-full border-r bg-white p-6 opacity-40 blur-[1px] pointer-events-none flex flex-col gap-6 select-none overflow-hidden">
        <div>
          <div className="text-sm font-semibold mb-1">{group.invoiceNumber}</div>
          <div className="text-xs text-muted-foreground">{group.clientNumber} · {group.totalAmount}</div>
          <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-medium">
            <AlertTriangle className="w-3 h-3" />
            {group.errorTypeName}
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Legs (4)</div>
          <div className="space-y-2">
            {legs.map((leg) => {
              const hasCtx = !!leg.perLegContext;
              return (
                <div key={leg.id} className="p-3 border rounded-md bg-white">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-mono text-xs font-medium">{leg.confNumber}</div>
                    <div className="text-xs text-muted-foreground">{leg.amount}</div>
                  </div>
                  <div className={`text-[11px] flex items-center gap-1 ${hasCtx ? "text-muted-foreground" : "text-amber-700"}`}>
                    {hasCtx ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                        Context saved
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-3 h-3 text-amber-500" />
                        No leg context
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-3 mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Submission Gauntlet</div>
          <div className="space-y-0 relative before:absolute before:inset-0 before:ml-[11px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
            {transitionSteps.map((step, idx) => (
              <div key={step.key} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active pb-4">
                <div className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-white bg-green-500 text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                  <Check className="w-3 h-3" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-3 rounded-md border bg-white shadow-sm">
                  <div className="font-medium text-xs text-slate-900">{step.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{step.detail}</div>
                </div>
              </div>
            ))}
            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active pb-4">
              <div className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-white bg-indigo-500 text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 ring-2 ring-indigo-200">
                <div className="w-1.5 h-1.5 rounded-full bg-white" />
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-3 rounded-md border-2 border-indigo-300 bg-indigo-50 shadow-sm">
                <div className="font-semibold text-xs text-indigo-900">Review &amp; edit draft</div>
                <div className="text-[10px] text-indigo-700 mt-0.5">In progress — see panel</div>
              </div>
            </div>
            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
              <div className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-white bg-slate-200 text-slate-400 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                <CircleDashed className="w-3 h-3" />
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-3 rounded-md border border-dashed bg-white/60 shadow-sm opacity-60">
                <div className="font-medium text-xs text-slate-500">Submit to portal</div>
                <div className="text-[10px] text-slate-400 mt-0.5">Pending review</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* FOREGROUND: The Slide-Over Sheet */}
      <div className="w-2/3 h-full bg-white shadow-2xl z-10 flex flex-col border-l border-slate-200 translate-x-0 transition-transform duration-300 relative">
        
        {/* HEADER */}
        <div className="px-6 py-4 border-b flex items-center justify-between bg-white shrink-0 sticky top-0 z-20">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Review and finalize submission</h1>
            <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
              <span className="font-mono">{group.invoiceNumber}</span>
              <span>·</span>
              <span>{legs.length} legs</span>
              <span>·</span>
              <span>{group.totalAmount}</span>
            </div>
          </div>
          <button className="p-2 hover:bg-slate-100 rounded-md transition-colors text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* SCROLLABLE CONTENT */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          <div className="max-w-5xl mx-auto grid grid-cols-12 gap-8">
            
            {/* LEFT COL: SOURCES */}
            <div className="col-span-5 space-y-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-4 pb-2 border-b">
                <BrainCircuit className="w-4 h-4 text-blue-600" />
                Sources & Inputs
              </div>

              {/* Group Context */}
              <SourceItem 
                title="Group Context" 
                meta={`By ${group.groupContextSavedBy} on ${group.groupContextSavedAt}`}
              >
                {group.groupContext}
              </SourceItem>

              {/* Leg Contexts */}
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex justify-between items-center">
                  <span>Per-Leg Context</span>
                </div>
                {legs.map(leg => (
                  <SourceItem 
                    key={leg.id}
                    title={leg.confNumber} 
                    meta={leg.perLegContextSavedAt ? `Saved ${leg.perLegContextSavedAt}` : 'No context provided'}
                    empty={!leg.perLegContext}
                  >
                    {leg.perLegContext || "No specific context provided for this leg. The AI will rely on group context."}
                  </SourceItem>
                ))}
              </div>

              {/* Special Circumstances */}
              <SourceItem title="Special Circumstances">
                {specialCircumstances}
              </SourceItem>

              {/* SOP Guidance */}
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 relative group">
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800 mb-1.5 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" />
                  SOP Guidance Applied
                </div>
                <div className="text-xs text-amber-900 leading-relaxed">
                  {sopGuidance}
                </div>
              </div>

            </div>

            {/* RIGHT COL: DRAFT */}
            <div className="col-span-7 space-y-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-4 pb-2 border-b">
                <FileText className="w-4 h-4 text-purple-600" />
                Generated Draft
              </div>

              {/* The Editor Frame */}
              <div className="rounded-lg border bg-white shadow-sm overflow-hidden flex flex-col focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
                <div className="px-4 py-3 border-b bg-slate-50/50 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-16 shrink-0">To:</span>
                    <span className="text-sm font-medium">MAS Disputing Portal</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide w-16 shrink-0">Subject:</span>
                    <input 
                      type="text" 
                      className="text-sm font-medium w-full bg-transparent border-none focus:outline-none focus:ring-0 p-0 text-slate-900" 
                      defaultValue={draftSubject} 
                    />
                  </div>
                </div>
                
                <div 
                  className="p-5 text-sm text-slate-800 leading-relaxed min-h-[300px] outline-none prose prose-sm max-w-none prose-p:my-2"
                  contentEditable
                  suppressContentEditableWarning
                  dangerouslySetInnerHTML={{ __html: draftDescriptionHtml }}
                />
              </div>

              {/* Evidence & Breadcrumbs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-md border bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                    Attached Evidence ({evidenceFiles.length})
                  </div>
                  <div className="space-y-2">
                    {evidenceFiles.map((file, i) => (
                      <div key={i} className="flex items-start justify-between group/file">
                        <div className="flex items-start gap-2 min-w-0">
                          <File className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-700 truncate" title={file.name}>{file.name}</div>
                            <div className="text-[10px] text-slate-500 flex gap-1.5">
                              <span>{file.size}</span>
                              <span>·</span>
                              <span className="bg-slate-100 px-1 rounded text-slate-600">{file.scope}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    GPS Breadcrumbs
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {gpsBreadcrumbs.map((bc, i) => (
                      <span key={i} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium border border-blue-100">
                        {bc}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* FOOTER ACTIONS & METADATA */}
        <div className="border-t bg-white shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-20">
          <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
            
            <div className="flex flex-col gap-1 text-[10px] text-slate-500">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1"><User className="w-3 h-3" /> Generated by {previewMeta.generatedBy}</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {previewMeta.generatedAt}</span>
              </div>
              <div className="flex items-center gap-3 opacity-70">
                <span>Model: {previewMeta.model}</span>
                <span>·</span>
                <span>{previewMeta.tokensIn} in / {previewMeta.tokensOut} out</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:pointer-events-none disabled:opacity-50 border border-slate-200 bg-white hover:bg-slate-100 hover:text-slate-900 h-9 px-4 py-2 gap-2 text-slate-600">
                <RefreshCw className="w-4 h-4" />
                Regenerate from sources
              </button>
              
              <button className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:pointer-events-none disabled:opacity-50 bg-white text-blue-600 hover:bg-blue-50 hover:text-blue-700 border border-blue-200 h-9 px-4 py-2 gap-2 shadow-sm">
                <Save className="w-4 h-4" />
                Save edits
              </button>

              <button className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:pointer-events-none disabled:opacity-50 bg-blue-600 text-white hover:bg-blue-700 h-9 px-6 py-2 gap-2 shadow-sm">
                <Send className="w-4 h-4" />
                Submit to Portal
              </button>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

function SourceItem({ title, meta, children, empty = false }: { title: string, meta?: string, children: React.ReactNode, empty?: boolean }) {
  return (
    <div className="rounded-md border bg-white p-3 relative group">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs font-semibold text-slate-800">{title}</div>
        <button className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-600 hover:text-blue-800 text-[10px] font-medium flex items-center gap-1">
          <Edit2 className="w-3 h-3" /> Edit
        </button>
      </div>
      <div className={`text-xs leading-relaxed ${empty ? 'text-slate-400 italic' : 'text-slate-600'}`}>
        {children}
      </div>
      {meta && (
        <div className="text-[10px] text-slate-400 mt-2 border-t pt-1.5">
          {meta}
        </div>
      )}
    </div>
  );
}
