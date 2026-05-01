import React from "react";
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
import {
  CheckCircle2,
  Edit2,
  FileText,
  RotateCcw,
  Save,
  Send,
  Paperclip,
  MapPin,
  AlertTriangle,
  Sparkles,
  Car,
  Clock,
  AlertCircle
} from "lucide-react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";

export default function InlineGauntlet() {
  return (
    <div className="min-h-screen bg-muted/30 pb-24 text-foreground font-sans">
      {/* Top Strip - Compact Leg Anchor */}
      <div className="bg-background border-b sticky top-0 z-10 px-6 py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold tracking-tight">{group.invoiceNumber}</h1>
            <Badge variant="secondary" className="bg-blue-50 text-blue-700 hover:bg-blue-50 border-blue-200">
              {group.status}
            </Badge>
            <span className="text-sm text-muted-foreground">{group.totalAmount}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium text-emerald-600">
              <CheckCircle2 className="w-4 h-4" />
              4 of 4 legs ready
            </span>
            <div className="flex gap-2">
              {legs.map((leg) => (
                <a key={leg.id} href={`#leg-${leg.id}`} className="text-xs hover:text-foreground hover:underline">
                  #{leg.id}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto p-6 space-y-8">
        
        {/* Gauntlet Checklist */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">Submission Gauntlet</h3>
          <div className="flex flex-col gap-2">
            {transitionSteps.map((step) => (
              <div key={step.key} className="flex items-center gap-3 bg-background border rounded-md p-3 text-sm shadow-sm opacity-75 grayscale-[0.5]">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <div className="font-medium text-foreground">{step.label}</div>
                <div className="text-muted-foreground text-xs ml-auto">{step.detail}</div>
              </div>
            ))}
            <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-300 rounded-md p-3 text-sm shadow-sm ring-2 ring-indigo-200">
              <div className="w-4 h-4 rounded-full border-2 border-indigo-500 flex items-center justify-center flex-shrink-0">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              </div>
              <div className="font-semibold text-indigo-900">Review &amp; edit draft before submit</div>
              <Badge variant="outline" className="ml-auto text-[10px] uppercase tracking-wide border-indigo-400 text-indigo-700 bg-white">Current step</Badge>
            </div>
            <div className="flex items-center gap-3 bg-background border border-dashed rounded-md p-3 text-sm opacity-50">
              <div className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />
              <div className="font-medium text-slate-500">Submit to portal</div>
              <div className="text-slate-400 text-xs ml-auto">Pending</div>
            </div>
          </div>
        </div>

        {/* The Dominant Block: Review and Finalize */}
        <div className="bg-background border rounded-lg shadow-sm overflow-hidden flex flex-col">
          <div className="bg-slate-50 border-b p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-500" />
              <h2 className="text-lg font-semibold text-foreground">Review and Finalize Submission</h2>
            </div>
            <Badge variant="outline" className="font-mono text-xs bg-white">Draft</Badge>
          </div>

          <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x">
            
            {/* Left Column: Proof of Sources */}
            <div className="w-full lg:w-[400px] xl:w-[450px] bg-slate-50/50 p-5 space-y-6 flex-shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Sources & Evidence</h3>
                <span className="text-xs text-slate-400 font-medium">Auto-synced</span>
              </div>

              {/* Group Context */}
              <div className="space-y-2 group">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5" /> Group Context
                  </div>
                  <button className="text-xs text-blue-600 opacity-0 group-hover:opacity-100 flex items-center gap-1 hover:underline font-medium transition-opacity">
                    <Edit2 className="w-3 h-3" /> Edit
                  </button>
                </div>
                <div className="text-sm bg-white border p-3 rounded-md shadow-sm leading-relaxed text-slate-700">
                  {group.groupContext}
                </div>
              </div>

              {/* SOP Guidance */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> SOP Guidance Applied
                </div>
                <div className="text-sm bg-amber-50/50 border border-amber-100 p-3 rounded-md text-amber-800 leading-relaxed">
                  {sopGuidance}
                </div>
              </div>

              {/* Special Circumstances */}
              <div className="space-y-2 group">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Special Circumstances
                  </div>
                  <button className="text-xs text-blue-600 opacity-0 group-hover:opacity-100 flex items-center gap-1 hover:underline font-medium transition-opacity">
                    <Edit2 className="w-3 h-3" /> Edit
                  </button>
                </div>
                <div className="text-sm bg-white border border-dashed border-slate-300 p-3 rounded-md text-slate-600 italic">
                  "{specialCircumstances}"
                </div>
              </div>

              {/* Per-Leg Context */}
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <Car className="w-3.5 h-3.5" /> Leg Roster & Context
                </div>
                <div className="space-y-2">
                  {legs.map((leg) => (
                    <div key={leg.id} className="bg-white border rounded-md p-3 shadow-sm group hover:border-blue-200 transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs font-mono font-medium text-slate-500">#{leg.id} • {leg.amount}</div>
                        <button className="text-[10px] text-blue-600 opacity-0 group-hover:opacity-100 flex items-center gap-1 hover:underline font-medium transition-opacity">
                          <Edit2 className="w-3 h-3" /> Edit Context
                        </button>
                      </div>
                      {leg.perLegContext ? (
                        <div className="text-sm text-slate-700 leading-snug">
                          {leg.perLegContext}
                        </div>
                      ) : (
                        <div className="text-sm text-amber-600 bg-amber-50 p-2 rounded border border-amber-200/50 flex gap-2 items-start">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>No context provided. The AI will rely solely on group-level context and standard facts for this leg.</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: The Draft & Metadata */}
            <div className="flex-1 flex flex-col bg-white">
              <div className="p-6 flex-1 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Draft Payload</h3>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-8 text-xs bg-slate-50 border-dashed border-slate-300 text-slate-600 hover:bg-slate-100">
                      <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Regenerate from Sources
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Subject */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-500 ml-1">Subject</label>
                    <input 
                      type="text" 
                      defaultValue={draftSubject}
                      className="w-full text-sm font-medium border border-slate-200 rounded-md px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-shadow bg-slate-50/50"
                    />
                  </div>

                  {/* Body Editor */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-500 ml-1 flex justify-between">
                      <span>Message Body</span>
                      <span className="text-[10px] text-slate-400 font-normal">Rich text enabled</span>
                    </label>
                    <div 
                      className="w-full text-sm border border-slate-200 rounded-md px-4 py-3 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-shadow bg-slate-50/50 min-h-[300px] prose prose-sm prose-slate max-w-none focus:outline-none"
                      contentEditable
                      suppressContentEditableWarning
                      dangerouslySetInnerHTML={{ __html: draftDescriptionHtml }}
                    />
                  </div>
                </div>

                {/* Attachments & Payload Details */}
                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                      <Paperclip className="w-3.5 h-3.5" /> Attached Evidence ({evidenceFiles.length})
                    </h4>
                    <div className="space-y-2">
                      {evidenceFiles.map((file, idx) => (
                        <div key={idx} className="flex flex-col gap-0.5 text-sm p-2 rounded border bg-slate-50">
                          <div className="font-medium text-slate-700 truncate">{file.name}</div>
                          <div className="flex justify-between text-xs text-slate-500">
                            <span>{file.size}</span>
                            <Badge variant="secondary" className="text-[10px] h-4 px-1 rounded-sm bg-slate-200 text-slate-600">{file.scope}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" /> Included Telemetry
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {gpsBreadcrumbs.map((crumb) => (
                        <Badge key={crumb} variant="outline" className="text-xs font-mono bg-white text-slate-600 border-slate-200">
                          {crumb}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Metadata Footer */}
              <div className="bg-slate-50 border-t p-3 px-6 flex items-center justify-between text-xs text-slate-500 font-medium">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Generated {previewMeta.generatedAt}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> {previewMeta.model}
                  </span>
                  <span className="text-slate-400">
                    Tokens: {previewMeta.tokensIn} in / {previewMeta.tokensOut} out
                  </span>
                </div>
                <div>By {previewMeta.generatedBy}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Actions Sticky-ish Bar */}
        <div className="flex items-center justify-end gap-3 pt-4">
          <Button variant="outline" className="bg-white">
            <Save className="w-4 h-4 mr-2" /> Save Edits
          </Button>
          <Button className="bg-blue-600 hover:bg-blue-700 text-white px-8 shadow-md">
            Submit to Portal <Send className="w-4 h-4 ml-2" />
          </Button>
        </div>

      </div>
    </div>
  );
}
