import { useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import {
  useCreateClaim,
  useListInvoiceGroups,
  getListClaimsQueryKey,
  getListInvoiceGroupsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InfoTooltip } from "@/components/info-tooltip";
import {
  PageHeader, Section, TONE_STYLE, ToneButton,
} from "@/components/cohesion";
import {
  ActionsRail, ActionsRailRecommended, ActionGroup, ActionRow,
} from "@/components/actions-rail";
import {
  Save, X, Layers, FileText, User, DollarSign, Sparkles,
  Truck, AlertCircle, CheckCircle2, Loader2, Info,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";

type Form = {
  confNumber: string;
  date: string;
  refNumber: string;
  clientNumber: string;
  carNumber: string;
  errorDetails: string;
  claimAmount: string;
  payorEmail: string;
};

const EMPTY_FORM: Form = {
  confNumber: "",
  date: "",
  refNumber: "",
  clientNumber: "",
  carNumber: "",
  errorDetails: "",
  claimAmount: "",
  payorEmail: "",
};

function parseInvoiceNumber(refNumber: string): string | null {
  const trimmed = refNumber.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 1 && /^\d+$/.test(parts[0])) return parts[0];
  return null;
}

export default function ClaimNew() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const createClaim = useCreateClaim();

  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [recentlySaved, setRecentlySaved] = useState<{ confNumber: string; id: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const parsedInvoiceNumber = useMemo(() => parseInvoiceNumber(form.refNumber), [form.refNumber]);

  const lookupParams = { search: parsedInvoiceNumber ?? undefined, limit: 5 };
  const { data: groupLookup } = useListInvoiceGroups(
    lookupParams,
    {
      query: {
        enabled: !!parsedInvoiceNumber,
        queryKey: getListInvoiceGroupsQueryKey(lookupParams),
      },
    },
  );

  const linkedGroup = useMemo(() => {
    if (!parsedInvoiceNumber || !groupLookup?.groups) return null;
    return groupLookup.groups.find(g => g.invoiceNumber === parsedInvoiceNumber) ?? null;
  }, [parsedInvoiceNumber, groupLookup]);

  const update = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const submit = async (mode: "triage" | "add-another") => {
    setSaveError(null);
    if (!form.confNumber.trim()) {
      setSaveError("Confirmation number is required.");
      return null;
    }
    try {
      const result = await createClaim.mutateAsync({ data: form });
      queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
      if (mode === "triage") {
        navigate(`/claims/${result.id}`);
        return result;
      }
      setRecentlySaved({ confNumber: result.confNumber ?? form.confNumber, id: result.id });
      setForm({
        ...EMPTY_FORM,
        refNumber: form.refNumber,
        date: form.date,
      });
      return result;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save claim.");
      return null;
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit("triage");
  };

  const ready = form.confNumber.trim().length > 0;
  const saving = createClaim.isPending;

  return (
    <div className="space-y-4 max-w-7xl" data-testid="page-claim-new">
      <PageHeader
        title="New claim"
        sub="Manual entry · use when an import missed something"
        accent="blue"
      />

      <div
        className="rounded-md border px-4 py-3 flex items-start gap-3"
        style={{
          background: TONE_STYLE.blue.bg,
          borderColor: TONE_STYLE.blue.border,
          color: TONE_STYLE.blue.fg,
        }}
        data-testid="banner-import-first"
      >
        <Sparkles className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div className="flex-1 text-sm">
          Most claims should come from the <strong>job-status report import</strong>. Use this form
          only for one-offs the import missed.
        </div>
        <Button
          asChild
          size="sm"
          className="text-white"
          style={{ background: TONE_STYLE.blue.fg }}
          data-testid="button-open-import"
        >
          <Link href="/import">Open Import →</Link>
        </Button>
      </div>

      {recentlySaved && (
        <div
          className="rounded-md border bg-card px-4 py-3 flex items-start gap-3"
          data-testid="banner-recently-saved"
          style={{ borderColor: TONE_STYLE.green.border }}
        >
          <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: TONE_STYLE.green.fg }} />
          <div className="flex-1 text-sm">
            Saved <span className="font-mono font-semibold">{recentlySaved.confNumber}</span>. Reference
            number kept for the next entry.
          </div>
          <Link href={`/claims/${recentlySaved.id}`} className="text-xs font-medium" style={{ color: TONE_STYLE.blue.fg }}>
            Open claim →
          </Link>
        </div>
      )}

      {saveError && (
        <div
          className="rounded-md border px-4 py-3 flex items-start gap-3"
          style={{ background: TONE_STYLE.red.bg, borderColor: TONE_STYLE.red.border, color: TONE_STYLE.red.fg }}
          data-testid="banner-save-error"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-sm">{saveError}</div>
        </div>
      )}

      <form onSubmit={handleFormSubmit} className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8 space-y-4 min-w-0">
          <Section
            title="Claim identifiers"
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="confNumber" className="flex items-center gap-1.5">
                  Confirmation # <span className="text-destructive">*</span>
                  <InfoTooltip content="The unique trip confirmation number from MAS. This is the primary identifier used to look up and dispute the claim on the portal." />
                </Label>
                <Input
                  id="confNumber"
                  className="font-mono"
                  value={form.confNumber}
                  onChange={e => update("confNumber", e.target.value)}
                  required
                  data-testid="input-conf-number"
                />
              </div>
              <div>
                <Label htmlFor="refNumber" className="flex items-center gap-1.5">
                  Reference #
                  <InfoTooltip content="Optional internal reference. The leading digits become the invoice number used to group claims together." />
                </Label>
                <Input
                  id="refNumber"
                  className="font-mono"
                  value={form.refNumber}
                  onChange={e => update("refNumber", e.target.value)}
                  data-testid="input-ref-number"
                />
                {parsedInvoiceNumber && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Parsed invoice #: <span className="font-mono">{parsedInvoiceNumber}</span>
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="date" className="flex items-center gap-1.5">
                  Service date
                  <InfoTooltip content="The date the transportation service was provided. Used to calculate the dispute filing deadline." />
                </Label>
                <Input
                  id="date"
                  type="date"
                  value={form.date}
                  onChange={e => update("date", e.target.value)}
                  data-testid="input-date"
                />
              </div>
              <div>
                <Label htmlFor="payorEmail" className="flex items-center gap-1.5">
                  Payor email
                  <InfoTooltip content="Optional email used when generating dispute emails to send directly to the responsible party." />
                </Label>
                <Input
                  id="payorEmail"
                  type="email"
                  value={form.payorEmail}
                  onChange={e => update("payorEmail", e.target.value)}
                  data-testid="input-payor-email"
                />
              </div>
            </div>
          </Section>

          <Section
            title="Member & vehicle"
            icon={<User className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="clientNumber" className="flex items-center gap-1.5">
                  Member ID
                  <InfoTooltip content="The member/client ID associated with the trip. Helps identify the passenger and cross-reference with scheduling records." />
                </Label>
                <Input
                  id="clientNumber"
                  className="font-mono"
                  value={form.clientNumber}
                  onChange={e => update("clientNumber", e.target.value)}
                  data-testid="input-client-number"
                />
              </div>
              <div>
                <Label htmlFor="carNumber" className="flex items-center gap-1.5">
                  Vehicle / car #
                  <InfoTooltip content="Identifier of the vehicle that performed the trip. Used to pull GPS data and driver records." />
                </Label>
                <Input
                  id="carNumber"
                  className="font-mono"
                  value={form.carNumber}
                  onChange={e => update("carNumber", e.target.value)}
                  data-testid="input-car-number"
                />
              </div>
            </div>
          </Section>

          <Section
            title="Amount & error"
            icon={<DollarSign className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="claimAmount" className="flex items-center gap-1.5">
                  Claim amount
                  <InfoTooltip content="The dollar amount being disputed. Enter the full trip cost that was denied or underpaid." />
                </Label>
                <Input
                  id="claimAmount"
                  className="font-mono"
                  value={form.claimAmount}
                  onChange={e => update("claimAmount", e.target.value)}
                  placeholder="0.00"
                  data-testid="input-claim-amount"
                />
              </div>
            </div>
            <div className="mt-4">
              <Label htmlFor="errorDetails" className="flex items-center gap-1.5">
                Error description
                <InfoTooltip content="Description of the error or reason the claim was denied. Include the denial code, error message, or explanation from the payor." />
              </Label>
              <Textarea
                id="errorDetails"
                value={form.errorDetails}
                onChange={e => update("errorDetails", e.target.value)}
                rows={4}
                placeholder="e.g. Trip mileage mismatch (rate code R-12 expected 14.2 mi, billed 9.8 mi)…"
                data-testid="input-error-details"
              />
            </div>
          </Section>
        </div>

        <aside className="xl:col-span-4 space-y-3 xl:sticky xl:top-4 self-start">
          <ActionsRail
            variant="claim"
            title="Save claim"
            meta={ready ? "ready" : "fill confirmation #"}
          >
            <ActionsRailRecommended
              label="Recommended"
              description="The claim will land on Claims · Needs Review with a classification prompt for the next user."
            >
              <div className="text-sm font-semibold mb-2">Save and route to classification</div>
              <ToneButton
                tone="blue"
                type="submit"
                disabled={!ready || saving}
                testId="button-save-and-triage"
              >
                {saving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                ) : (
                  <><Save className="h-4 w-4" /> Save and classify</>
                )}
              </ToneButton>
            </ActionsRailRecommended>

            <ActionGroup label="Other ways to save">
              <ActionRow
                icon={<Layers className="w-3.5 h-3.5" />}
                label="Save and add another"
                sub="Keeps reference # filled in for batch entry"
                disabled={!ready || saving}
                disabledReason={!ready ? "Fill in the confirmation number first." : undefined}
                onClick={() => submit("add-another")}
                testId="action-save-and-add-another"
              />
              <ActionRow
                icon={<Save className="w-3.5 h-3.5" />}
                label="Save as draft"
                sub="Stays out of the classification queue"
                disabled
                disabledReason="Draft mode is coming soon — for now use Save and classify."
                muted
                testId="action-save-as-draft"
              />
              <ActionRow
                icon={<X className="w-3.5 h-3.5" />}
                label="Cancel"
                sub="Discard and return to the claims list"
                muted
                onClick={() => navigate("/claims")}
                testId="action-cancel"
              />
            </ActionGroup>
          </ActionsRail>

          <Card data-testid="card-helper-add-another">
            <CardContent className="p-3 text-xs text-muted-foreground flex items-start gap-2">
              <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                Adding several claims for the same invoice? Use{" "}
                <strong>Save and add another</strong> — the reference number stays filled in so you
                can rip through them quickly.
              </span>
            </CardContent>
          </Card>

          <Card data-testid="card-linked-group">
            <CardContent className="p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Linking to invoice group
              </div>
              {linkedGroup ? (
                <Link
                  href={`/invoice-groups/${linkedGroup.id}`}
                  className="block hover:bg-muted -mx-1 px-1 py-1 rounded transition-colors"
                  data-testid="link-linked-group"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <Truck className="w-3.5 h-3.5" style={{ color: TONE_STYLE.purple.fg }} />
                    <span className="font-mono font-semibold" style={{ color: TONE_STYLE.purple.fg }}>
                      {linkedGroup.invoiceNumber}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {linkedGroup.rideCount} ride{linkedGroup.rideCount === 1 ? "" : "s"} ·{" "}
                    {formatCurrency(Number(linkedGroup.totalAmount ?? 0))}
                  </div>
                </Link>
              ) : parsedInvoiceNumber ? (
                <div className="text-xs text-muted-foreground">
                  No existing group for invoice{" "}
                  <span className="font-mono">{parsedInvoiceNumber}</span> — a new group will be
                  created on save.
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Type a reference # like <span className="font-mono">42 ALBANY</span> and we'll
                  match it to an existing invoice group.
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </form>
    </div>
  );
}
