import { useState } from "react";
import {
  Sparkles,
  Send,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Paperclip,
  MapPin,
  Wand2,
  Save,
  Layers,
  ListChecks,
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
 * E1 — "Preview & edit AI write-up" added INLINE inside the existing
 * submission gauntlet on the queue's right-side panel (col-span-2 of 3).
 *
 * Faithful to the real `InvoiceGroupSubmissionGauntlet` shadcn-Card
 * structure: same CardHeader, same per-section pattern (h3 + button on
 * the right + supporting block below), same Separator between sections,
 * same density, same icon vocabulary. The single enhancement is a NEW
 * "Review & edit draft" section inserted between "Generate preview" and
 * "Submit to portal". Everything above and below it is the gauntlet you
 * already ship — only the missing step is added.
 */

const draftBody = stripHtmlForTextarea(draftDescriptionHtml);

export default function InlineGauntlet() {
  const [bodyValue, setBodyValue] = useState(draftBody);
  const [subjectValue, setSubjectValue] = useState(draftSubject);
  const [sourcesOpen, setSourcesOpen] = useState(true);

  return (
    <div className="cc-scope min-h-screen bg-slate-50 font-sans text-slate-900 p-4">
      {/* This frame mimics the queue's lg:col-span-2 right-side panel.
          The two collapsed cards above the gauntlet are the existing
          sibling cards (Aggregate context + Rides) so the operator can
          see the gauntlet in its real position. */}

      {/* === EXISTING — collapsed sibling: Aggregate context === */}
      <Card className="mb-4">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground font-medium">
              <Layers className="h-4 w-4" /> Aggregate context
              <Badge variant="secondary" className="text-[10px] font-normal ml-1">
                Saved {group.groupContextSavedAt}
              </Badge>
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground">
              <ChevronDown className="h-3 w-3 mr-1" /> Expand
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* === EXISTING — collapsed sibling: Rides & legs === */}
      <Card className="mb-4">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground font-medium">
              <ListChecks className="h-4 w-4" /> Rides &amp; legs
              <span className="text-xs text-muted-foreground font-normal">
                · 4 rides · all ready
              </span>
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground">
              <ChevronDown className="h-3 w-3 mr-1" /> Expand
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* === GAUNTLET — same shadcn Card, same per-section structure === */}
      <Card>
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

          {/* Step 1 — Understanding readback (already confirmed) */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                Understanding readback
                <Badge variant="secondary" className="text-[10px]">
                  Confirmed Apr 28, 11:31 AM
                </Badge>
              </h3>
              <Button size="sm" variant="outline" disabled className="h-7 text-xs">
                Confirm readback
              </Button>
            </div>
            <Textarea
              rows={2}
              readOnly
              className="text-xs bg-slate-50"
              defaultValue="GPS variance is real on all 4 legs but shares one root cause: the member relocated 4/1 to assisted living and the address on file is stale. Confirmed via member call 4/24."
            />
          </section>

          <Separator />

          {/* Step 2 — Generate preview (already generated) */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Generate preview</h3>
              <Button size="sm" variant="outline" className="h-7 text-xs">
                <RefreshCw className="h-3 w-3 mr-1" /> Regenerate preview
              </Button>
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

          {/* === NEW STEP — Review &amp; edit draft (the enhancement) === */}
          <section
            className="space-y-3 rounded-md border border-violet-200 bg-violet-50/40 p-3 -mx-1"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Wand2 className="h-3.5 w-3.5 text-violet-600" />
                Review &amp; edit draft
                <Badge
                  variant="secondary"
                  className="text-[10px] bg-white text-violet-700 border border-violet-200"
                >
                  AI · {previewMeta.model}
                </Badge>
              </h3>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-violet-700">
                <RefreshCw className="h-3 w-3 mr-1" /> Regenerate from sources
              </Button>
            </div>

            <p className="text-xs text-muted-foreground -mt-1">
              This is what the operator will send to{" "}
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
                className="text-sm mt-1 bg-white"
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
                rows={11}
                value={bodyValue}
                onChange={(e) => setBodyValue(e.target.value)}
                className="text-xs leading-relaxed bg-white font-mono"
              />
            </div>

            {/* Sources used — collapsible */}
            <div className="rounded border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setSourcesOpen((s) => !s)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50"
              >
                <span className="flex items-center gap-2 font-semibold">
                  {sourcesOpen ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Sources used by the AI
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    {1 + legs.filter((l) => l.perLegContext).length} context · {evidenceFiles.length} files · {gpsBreadcrumbs.length} GPS
                  </Badge>
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Edit a source → click Regenerate to fold it in
                </span>
              </button>
              {sourcesOpen && (
                <div className="border-t border-slate-200 divide-y divide-slate-100 text-xs">
                  {/* Group context */}
                  <div className="px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Layers className="h-3 w-3 text-violet-600" />
                      <span className="font-semibold text-[11px]">Group context</span>
                      <span className="text-[10px] text-muted-foreground">
                        all 4 legs
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-700 leading-snug pl-4">
                      {group.groupContext}
                    </p>
                  </div>

                  {/* Per-leg context entries */}
                  {legs.map((leg) => (
                    <div key={leg.id} className="px-3 py-2">
                      <div className="flex items-center gap-1.5 mb-1">
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

                  {/* Evidence files */}
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

                  {/* GPS / data */}
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

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                <Lock className="h-3 w-3" /> Edits saved as you type · last saved 11:36 AM
              </span>
              <Button size="sm" className="h-7 text-xs">
                <Save className="h-3 w-3 mr-1" /> Save &amp; mark reviewed
              </Button>
            </div>
          </section>

          <Separator />

          {/* Step 4 — Submit to portal (gate-aware, mirrors "Generate
              preview" pattern with a NEW "draft reviewed" gate added by
              this enhancement) */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Submit to portal</h3>
              <Button size="sm" className="h-7 text-xs">
                <Send className="h-3 w-3 mr-1" /> Submit to Portal
              </Button>
            </div>
            <ul className="space-y-1 text-xs">
              <li className="text-green-700">✓ Every leg resolved (4 ready)</li>
              <li className="text-green-700">✓ Understanding readback confirmed</li>
              <li className="text-green-700">
                ✓ Preview generated {previewMeta.generatedAt}
              </li>
              <li className="text-green-700">
                ✓ Draft reviewed Apr 28, 11:36 AM by {previewMeta.generatedBy}
                <span className="ml-1 text-[10px] font-medium text-violet-700 uppercase tracking-wide">
                  new gate
                </span>
              </li>
            </ul>
            <p className="text-xs text-muted-foreground italic">
              Submit hands the saved write-up to the portal transition — your edits
              are what get sent, not the original AI draft. Submit stays disabled
              until the draft is marked reviewed.
            </p>
          </section>

        </CardContent>
      </Card>
    </div>
  );
}

/** Strip a tiny bit of paragraph HTML so the textarea preview reads naturally. */
function stripHtmlForTextarea(html: string): string {
  return html
    .replace(/<\/p>\s*<p>/g, "\n\n")
    .replace(/<p>/g, "")
    .replace(/<\/p>/g, "")
    .replace(/<strong>/g, "")
    .replace(/<\/strong>/g, "")
    .trim();
}
