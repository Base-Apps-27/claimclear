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
  ListChecks,
  FileText,
  Lock,
  MessageSquarePlus,
  CheckCircle2,
  AlertTriangle,
  Pencil,
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
 * Updated model: Rides & legs is the PRIMARY surface at the top. Each
 * leg carries its own content (data) AND its own operator-authored
 * context. The AI weaves those per-leg pieces together into the dispute
 * write-up shown in the Review & edit step. There is no separate
 * "aggregate / group context" surface — that concept was removed.
 *
 * Faithful to the real `InvoiceGroupSubmissionGauntlet` shadcn-Card
 * structure: same CardHeader, same per-section pattern (h3 + button on
 * the right + supporting block below), same Separator between sections,
 * same density, same icon vocabulary. The single new section is
 * "Review & edit draft" inserted between "Generate preview" and "Submit
 * to portal".
 */

const draftBody = stripHtmlForTextarea(draftDescriptionHtml);

export default function InlineGauntlet() {
  const [bodyValue, setBodyValue] = useState(draftBody);
  const [subjectValue, setSubjectValue] = useState(draftSubject);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [legsOpen, setLegsOpen] = useState(true);

  const legsWithContext = legs.filter((l) => l.perLegContext).length;
  const legsMissingContext = legs.length - legsWithContext;

  return (
    <div className="cc-scope min-h-screen bg-slate-50 font-sans text-slate-900 p-4">
      {/* This frame mimics the queue's lg:col-span-2 right-side panel.
          PRIMARY card on top is Rides & legs (where per-leg content +
          per-leg context live). The gauntlet sits below it. There is
          intentionally no "Aggregate context" sibling card — that
          concept was removed. */}

      {/* === PRIMARY — Rides & legs (per-leg content + per-leg context) === */}
      <Card className="mb-4">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ListChecks className="h-4 w-4" /> Rides &amp; legs
                <Badge variant="secondary" className="text-[10px] font-normal">
                  {legs.length} legs · all ready
                </Badge>
                {legsMissingContext > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-amber-50 text-amber-800 border border-amber-200"
                  >
                    {legsMissingContext} missing context
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                Each leg carries its own data and the operator's notes for
                that leg. The AI weaves these together when it composes the
                write-up below — no separate group-level context.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setLegsOpen((s) => !s)}
            >
              {legsOpen ? (
                <>
                  <ChevronDown className="h-3 w-3 mr-1" /> Collapse
                </>
              ) : (
                <>
                  <ChevronRight className="h-3 w-3 mr-1" /> Expand
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        {legsOpen && (
          <CardContent className="pt-0 space-y-2">
            {legs.map((leg) => (
              <LegRow key={leg.id} leg={leg} />
            ))}
            <p className="text-[11px] text-muted-foreground pt-1 italic">
              Tip — adding leg context here is what makes the write-up
              specific. Legs without context get a generic mention only.
            </p>
          </CardContent>
        )}
      </Card>

      {/* === GAUNTLET — same shadcn Card, same per-section structure === */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Submission preview
          </CardTitle>
          <CardDescription>
            Confirm the AI's read of the case, then generate, review, and
            submit the dispute write-up.
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
              {legsMissingContext > 0 && (
                <li className="text-amber-700 inline-flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {legsMissingContext} leg{legsMissingContext === 1 ? "" : "s"}{" "}
                  {legsMissingContext === 1 ? "has" : "have"} no operator context —{" "}
                  {legsMissingContext === 1 ? "it gets" : "they get"} a generic mention only.
                </li>
              )}
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
              The AI composed this from each leg's content + each leg's
              operator context (above). Edit freely — your edits override
              the AI draft on submit.
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

            {/* Sources used — collapsible. Per-leg only; no group context. */}
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
                    {legs.length} legs · {legsWithContext} with operator context · {evidenceFiles.length} files · {gpsBreadcrumbs.length} GPS
                  </Badge>
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Edit a leg's context above → click Regenerate to fold it in
                </span>
              </button>
              {sourcesOpen && (
                <div className="border-t border-slate-200 divide-y divide-slate-100 text-xs">
                  {/* Per-leg sources only — content + context, no group layer */}
                  {legs.map((leg) => (
                    <div key={leg.id} className="px-3 py-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <FileText className="h-3 w-3 text-slate-500" />
                        <span className="font-semibold text-[11px] font-mono">
                          #{leg.id}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {leg.confNumber} · {leg.date} · {leg.amount} · GPS Δ {leg.gpsVarianceMeters}m
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
                      <div className="pl-4 space-y-0.5">
                        <p className="text-[10.5px] text-slate-500 leading-snug">
                          <span className="font-semibold text-slate-600">Content:</span>{" "}
                          pickup on file <em>{leg.pickupAddressOnFile}</em>; actual{" "}
                          <em>{leg.pickupAddressActual}</em>. Driver: {leg.driverNote}
                        </p>
                        <p className="text-[11px] text-slate-700 leading-snug">
                          <span className="font-semibold text-slate-700">Context:</span>{" "}
                          {leg.perLegContext ?? (
                            <span className="italic text-amber-800">
                              None added — AI will give this leg a generic mention only. Add notes on the leg above to enrich.
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}

                  {/* Evidence files — attached per leg, never to an abstract group */}
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
                            {f.attachedTo} · {f.size}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* GPS / data */}
                  <div className="px-3 py-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <MapPin className="h-3 w-3 text-slate-500" />
                      <span className="font-semibold text-[11px]">GPS data points (per leg)</span>
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

/* ===================================================================
   Per-leg row — shows content (left) + context (right). The context
   field is the input that drives quality of the AI write-up.
   =================================================================== */
function LegRow({ leg }: { leg: { id: number; confNumber: string; date: string; amount: string; gpsVarianceMeters: number; pickupAddressOnFile: string; pickupAddressActual: string; driverNote: string; perLegContext: string | null; perLegContextSavedAt?: string; perLegContextSavedBy?: string } }) {
  const hasContext = !!leg.perLegContext;
  return (
    <div
      className={`rounded-md border ${
        hasContext ? "border-slate-200 bg-white" : "border-amber-200 bg-amber-50/40"
      }`}
    >
      <div className="px-3 py-2 grid grid-cols-12 gap-3">
        {/* Left — leg identity + content */}
        <div className="col-span-5 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <CheckCircle2 className="h-3 w-3 text-green-600" />
            <span className="font-mono font-semibold text-[12px]">#{leg.id}</span>
            <span className="text-[10px] text-muted-foreground">{leg.confNumber}</span>
            <Badge variant="secondary" className="text-[10px]">
              ready
            </Badge>
          </div>
          <div className="text-[10.5px] text-slate-600 pl-4">
            {leg.date} · {leg.amount} · GPS Δ {leg.gpsVarianceMeters}m
          </div>
          <div className="text-[10.5px] text-slate-500 pl-4 leading-snug">
            On file: <em>{leg.pickupAddressOnFile}</em>
          </div>
          <div className="text-[10.5px] text-slate-500 pl-4 leading-snug">
            Actual: <em>{leg.pickupAddressActual}</em>
          </div>
          <div className="text-[10.5px] text-slate-500 pl-4 italic leading-snug">
            Driver: {leg.driverNote}
          </div>
        </div>

        {/* Right — per-leg context (the operator's note on THIS leg) */}
        <div className="col-span-7 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground inline-flex items-center gap-1">
              <MessageSquarePlus className="h-3 w-3" />
              Context for this leg
              {hasContext && leg.perLegContextSavedAt && (
                <span className="ml-1 normal-case font-normal text-[10px] text-muted-foreground">
                  · saved {leg.perLegContextSavedAt} by {leg.perLegContextSavedBy}
                </span>
              )}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-[10px] text-slate-500"
            >
              <Pencil className="h-3 w-3 mr-1" />
              {hasContext ? "Edit" : "Add"}
            </Button>
          </div>
          {hasContext ? (
            <Textarea
              rows={3}
              defaultValue={leg.perLegContext ?? ""}
              className="text-[11px] leading-snug bg-white"
            />
          ) : (
            <Textarea
              rows={3}
              placeholder="Add the specific reason this leg's flagged data is wrong, what the member / driver / call log confirmed, and any leg-specific quirks. The AI uses this verbatim when it composes the dispute write-up."
              className="text-[11px] leading-snug bg-white border-amber-300 placeholder:text-amber-700/70"
            />
          )}
        </div>
      </div>
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
