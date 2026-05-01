import { useState } from "react";
import {
  Sparkles,
  Send,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Paperclip,
  MapPin,
  Wand2,
  Save,
  Layers,
  ListChecks,
  X,
  ExternalLink,
  FileText,
  Lock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../../ui/card";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import { Input } from "../../ui/input";
import { Badge } from "../../ui/badge";
import { Separator } from "../../ui/separator";
import {
  group,
  legs,
  draftSubject,
  draftDescriptionHtml,
  evidenceFiles,
  gpsBreadcrumbs,
  previewMeta,
} from "./_shared";

/**
 * E2 — "Preview & edit AI write-up" opens as a SLIDE-OVER on top of the
 * queue's right-side panel. Same shadcn-Card design language as the real
 * gauntlet — but instead of expanding the gauntlet card, "Generate
 * preview" leaves the gauntlet small and surfaces a takeover sheet so
 * the operator gets a focused review surface and the gauntlet's other
 * steps stay visible underneath when dismissed.
 *
 * What you see in this canvas frame:
 *   • Background: the right-side panel with sibling cards collapsed and
 *     the gauntlet showing a NEW compact "Preview generated · Review
 *     draft →" row instead of the editable surface.
 *   • Foreground: the slide-over sheet (~520w of the 880w frame) with
 *     the same editable preview content as E1, plus its own Submit
 *     button at the bottom of the sheet.
 */

const draftBody = stripHtmlForTextarea(draftDescriptionHtml);

export default function SlideOver() {
  const [bodyValue, setBodyValue] = useState(draftBody);
  const [subjectValue, setSubjectValue] = useState(draftSubject);
  const [sourcesOpen, setSourcesOpen] = useState(true);

  return (
    <div className="cc-scope min-h-screen bg-slate-50 font-sans text-slate-900 relative overflow-hidden">

      {/* === BACKGROUND — dimmed right-pane behind the slide-over === */}
      <div
        className="absolute inset-0 p-4 pointer-events-none"
        aria-hidden="true"
        style={{ filter: "saturate(0.6)" }}
      >
        <Card className="mb-4 opacity-70">
          <CardHeader className="py-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground font-medium">
                <Layers className="h-4 w-4" /> Aggregate context
              </CardTitle>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </div>
          </CardHeader>
        </Card>

        <Card className="mb-4 opacity-70">
          <CardHeader className="py-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground font-medium">
                <ListChecks className="h-4 w-4" /> Rides &amp; legs
                <span className="text-xs text-muted-foreground font-normal">
                  · 4 rides · all ready
                </span>
              </CardTitle>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </div>
          </CardHeader>
        </Card>

        {/* Background gauntlet — note the new compact "Review draft" row
            replaces the editable surface from E1. */}
        <Card className="opacity-80">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Submission preview
            </CardTitle>
            <CardDescription>
              Confirm the AI's read of the case, then generate the dispute
              submission preview.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  Understanding readback
                  <Badge variant="secondary" className="text-[10px]">
                    Confirmed Apr 28, 11:31 AM
                  </Badge>
                </h3>
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Generate preview</h3>
              </div>
              <ul className="space-y-1 text-xs">
                <li className="text-green-700">✓ Every leg resolved (4 ready)</li>
                <li className="text-green-700">✓ Understanding readback confirmed</li>
                <li className="text-green-700">
                  ✓ Preview generated {previewMeta.generatedAt}
                </li>
              </ul>
            </section>

            <Separator />

            {/* The compact replacement for the editable surface — opens
                the slide-over instead of expanding inline. */}
            <section className="rounded-md border border-violet-200 bg-violet-50 p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold flex items-center gap-2">
                  <Wand2 className="h-3.5 w-3.5 text-violet-600" />
                  Draft ready for review
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  Generated from {1 + legs.filter((l) => l.perLegContext).length} context entries · {evidenceFiles.length} files · {gpsBreadcrumbs.length} GPS
                </div>
              </div>
              <Button size="sm" className="h-7 text-xs flex-shrink-0">
                Review &amp; edit draft <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </section>

            <Separator />

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Submit to portal</h3>
                <Button size="sm" disabled className="h-7 text-xs">
                  <Send className="h-3 w-3 mr-1" /> Submit to Portal
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Submit unlocks once the draft has been reviewed.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>

      {/* === SCRIM === */}
      <div
        className="absolute inset-0 bg-slate-900/30"
        aria-hidden="true"
      />

      {/* === SLIDE-OVER SHEET (right side) === */}
      <aside
        className="absolute top-0 right-0 bottom-0 bg-white border-l border-slate-200 shadow-2xl flex flex-col"
        style={{ width: 540 }}
        role="dialog"
        aria-label="Review and edit draft"
      >
        {/* Close button — floats over the Card header */}
        <button
          type="button"
          className="absolute top-3 right-3 z-10 text-muted-foreground hover:text-slate-900 p-1"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Body — same Card primitives the gauntlet uses, just hosted
            inside a sheet shell so it can host its own sticky footer. */}
        <Card className="flex-1 flex flex-col rounded-none border-0 shadow-none overflow-hidden">
          <CardHeader className="pr-10">
            <CardTitle className="text-base flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-violet-600" /> Review &amp; edit draft
            </CardTitle>
            <CardDescription>
              <span className="font-mono font-medium text-slate-700">{group.invoiceNumber}</span>
              {" · "}{group.errorTypeName}{" · "}{legs.length} legs · {group.totalAmount}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto space-y-4">

          {/* Provenance pill */}
          <div className="flex items-center justify-between text-xs">
            <Badge
              variant="secondary"
              className="text-[10px] bg-violet-50 text-violet-700 border border-violet-200"
            >
              AI · {previewMeta.model} · {previewMeta.tokensIn} in / {previewMeta.tokensOut} out
            </Badge>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-violet-700">
              <RefreshCw className="h-3 w-3 mr-1" /> Regenerate from sources
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            This is what the operator will send to the{" "}
            <span className="font-medium">{group.errorTypeName}</span> portal.
            Edit freely — your edits override the AI draft on submit.
          </p>

          {/* Subject */}
          <div>
            <label className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
              Subject
            </label>
            <Input
              value={subjectValue}
              onChange={(e) => setSubjectValue(e.target.value)}
              className="text-sm mt-1"
            />
          </div>

          {/* Body */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
                Dispute write-up
              </label>
              <span className="text-[10px] text-muted-foreground">
                {bodyValue.length} chars · ~{Math.round(bodyValue.length / 5)} words
              </span>
            </div>
            <Textarea
              rows={14}
              value={bodyValue}
              onChange={(e) => setBodyValue(e.target.value)}
              className="text-xs leading-relaxed font-mono"
            />
          </div>

          {/* Sources used — collapsible */}
          <div className="rounded border border-slate-200 bg-slate-50">
            <button
              type="button"
              onClick={() => setSourcesOpen((s) => !s)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-100"
            >
              <span className="flex items-center gap-2 font-semibold">
                {sourcesOpen ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Sources used by the AI
                <Badge variant="secondary" className="text-[10px] font-normal bg-white">
                  {1 + legs.filter((l) => l.perLegContext).length} context · {evidenceFiles.length} files · {gpsBreadcrumbs.length} GPS
                </Badge>
              </span>
              <span className="text-[10px] text-muted-foreground">
                Edit a source → Regenerate
              </span>
            </button>
            {sourcesOpen && (
              <div className="border-t border-slate-200 divide-y divide-slate-200 text-xs bg-white">
                <div className="px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-1.5">
                      <Layers className="h-3 w-3 text-violet-600" />
                      <span className="font-semibold text-[11px]">Group context</span>
                      <span className="text-[10px] text-muted-foreground">all 4 legs</span>
                    </span>
                    <a
                      href="#"
                      className="text-[10px] text-violet-700 inline-flex items-center gap-0.5 hover:underline"
                    >
                      Open <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                  <p className="text-[11px] text-slate-700 leading-snug pl-4">
                    {group.groupContext}
                  </p>
                </div>

                {legs.map((leg) => (
                  <div key={leg.id} className="px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1.5">
                        <FileText className="h-3 w-3 text-slate-500" />
                        <span className="font-semibold text-[11px] font-mono">
                          #{leg.id}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {leg.confNumber} · {leg.amount}
                        </span>
                        {!leg.perLegContext && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200"
                          >
                            no leg context
                          </Badge>
                        )}
                      </span>
                      <a
                        href="#"
                        className="text-[10px] text-violet-700 inline-flex items-center gap-0.5 hover:underline"
                      >
                        Open <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                    <p className="text-[11px] text-slate-700 leading-snug pl-4">
                      {leg.perLegContext ?? (
                        <span className="italic text-muted-foreground">
                          None added — AI fell back to group context for this leg.
                        </span>
                      )}
                    </p>
                  </div>
                ))}

                <div className="px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Paperclip className="h-3 w-3 text-slate-500" />
                    <span className="font-semibold text-[11px]">Evidence attached</span>
                  </div>
                  <ul className="pl-4 space-y-0.5">
                    {evidenceFiles.map((f) => (
                      <li
                        key={f.name}
                        className="flex items-center justify-between text-[11px] text-slate-700"
                      >
                        <span className="truncate">{f.name}</span>
                        <span className="text-[10px] text-muted-foreground ml-2 flex-shrink-0">
                          {f.scope} · {f.size}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <MapPin className="h-3 w-3 text-slate-500" />
                    <span className="font-semibold text-[11px]">GPS data points</span>
                  </div>
                  <div className="pl-4 flex flex-wrap gap-1">
                    {gpsBreadcrumbs.map((g) => (
                      <Badge
                        key={g}
                        variant="secondary"
                        className="text-[10px] font-mono font-normal"
                      >
                        {g}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sheet footer — sticky actions */}
        <footer className="border-t border-slate-200 px-4 py-3 bg-slate-50 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Lock className="h-3 w-3" /> Edits saved as you type · last saved 11:36 AM
            </span>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs">
              <Save className="h-3 w-3 mr-1" /> Save &amp; close
            </Button>
            <Button size="sm" className="h-8 text-xs">
              <Send className="h-3 w-3 mr-1" /> Save &amp; submit to Portal
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function stripHtmlForTextarea(html: string): string {
  return html
    .replace(/<\/p>\s*<p>/g, "\n\n")
    .replace(/<p>/g, "")
    .replace(/<\/p>/g, "")
    .replace(/<strong>/g, "")
    .replace(/<\/strong>/g, "")
    .trim();
}
