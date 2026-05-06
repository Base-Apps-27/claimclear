import { useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import {
  useCreateInvoiceGroup,
  useListInvoiceGroups,
  getListInvoiceGroupsQueryKey,
  getListClaimsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { InfoTooltip } from "@/components/info-tooltip";
import { RefNumber } from "@/components/ref-number";
import {
  PageHeader, Section, TONE_STYLE, ToneButton,
} from "@/components/cohesion";
import {
  ActionsRail, ActionsRailRecommended, ActionGroup, ActionRow,
} from "@/components/actions-rail";
import {
  Save, X, Plus, Trash2, FileText, User, DollarSign, Sparkles,
  Truck, AlertCircle, Loader2, Info,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";

type LegForm = {
  confNumber: string;
  date: string;
  refNumber: string;
  clientNumber: string;
  carNumber: string;
  errorDetails: string;
  claimAmount: string;
};

const EMPTY_LEG: LegForm = {
  confNumber: "",
  date: "",
  refNumber: "",
  clientNumber: "",
  carNumber: "",
  errorDetails: "",
  claimAmount: "",
};

type InvoiceForm = {
  invoiceNumber: string;
  payorEmail: string;
  clientNumber: string;
};

const EMPTY_INVOICE: InvoiceForm = {
  invoiceNumber: "",
  payorEmail: "",
  clientNumber: "",
};

type Conflict = {
  existingGroupId: number;
  invoiceNumber: string;
  rideCount: number;
  totalAmount: string | null;
  status: string;
};

export default function InvoiceNew() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const createInvoice = useCreateInvoiceGroup();

  const [invoice, setInvoice] = useState<InvoiceForm>(EMPTY_INVOICE);
  const [legs, setLegs] = useState<LegForm[]>([{ ...EMPTY_LEG }]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const trimmedInvoice = invoice.invoiceNumber.trim();

  // Live lookup so we can warn the operator before they submit if an
  // invoice with this number already exists. Uses the same list endpoint
  // the legacy claim-new page already used.
  const lookupParams = { search: trimmedInvoice || undefined, limit: 5, includeExpired: true };
  const { data: groupLookup } = useListInvoiceGroups(
    lookupParams,
    { query: { enabled: trimmedInvoice.length > 0, queryKey: getListInvoiceGroupsQueryKey(lookupParams) } },
  );
  const linkedGroup = useMemo(() => {
    if (!trimmedInvoice || !groupLookup?.groups) return null;
    return groupLookup.groups.find(g => g.invoiceNumber === trimmedInvoice) ?? null;
  }, [trimmedInvoice, groupLookup]);

  const updateInvoice = <K extends keyof InvoiceForm>(key: K, value: InvoiceForm[K]) =>
    setInvoice(prev => ({ ...prev, [key]: value }));

  const updateLeg = (idx: number, key: keyof LegForm, value: string) =>
    setLegs(prev => prev.map((l, i) => (i === idx ? { ...l, [key]: value } : l)));

  const addLeg = () => setLegs(prev => [...prev, { ...EMPTY_LEG }]);
  const removeLeg = (idx: number) =>
    setLegs(prev => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  const totalAmount = useMemo(
    () => legs.reduce((s, l) => s + (parseFloat(l.claimAmount) || 0), 0),
    [legs],
  );

  const ready =
    trimmedInvoice.length > 0 && legs.every(l => l.confNumber.trim().length > 0);
  const saving = createInvoice.isPending;

  const buildBody = (attachToExistingId: number | null) => ({
    invoiceNumber: trimmedInvoice,
    clientNumber: invoice.clientNumber.trim() || null,
    payorEmail: invoice.payorEmail.trim() || null,
    legs: legs.map(l => ({
      confNumber: l.confNumber.trim(),
      date: l.date || null,
      refNumber: l.refNumber.trim() || null,
      clientNumber: l.clientNumber.trim() || null,
      carNumber: l.carNumber.trim() || null,
      errorDetails: l.errorDetails.trim() || null,
      claimAmount: l.claimAmount.trim() || null,
    })),
    attachToExistingId,
  });

  const submit = async (attachToExistingId: number | null = null) => {
    setSaveError(null);
    try {
      const result = await createInvoice.mutateAsync({ data: buildBody(attachToExistingId) });
      // Refresh both list caches so new rows appear on subsequent
      // navigation. The detail page lands fresh.
      queryClient.invalidateQueries({ queryKey: getListInvoiceGroupsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
      // Land on the detail page with `?from=manual` so it can render a
      // "you just created this — start here" banner pointing at triage.
      navigate(`/invoice-groups/${result.group.id}?from=manual`);
    } catch (err) {
      // Orval throws an error whose `.response` carries the body for non-2xx;
      // we narrow on shape so a 409 surfaces as the conflict prompt and any
      // other failure becomes an inline banner.
      const e = err as { status?: number; response?: { data?: { error?: string; existingGroup?: Conflict & { id?: number } } } };
      const status = e.status ?? 0;
      const data = e.response?.data;
      if (status === 409 && data?.existingGroup) {
        setConflict({
          existingGroupId: data.existingGroup.id ?? (data.existingGroup as { existingGroupId?: number }).existingGroupId ?? 0,
          invoiceNumber: data.existingGroup.invoiceNumber,
          rideCount: data.existingGroup.rideCount,
          totalAmount: data.existingGroup.totalAmount ?? null,
          status: data.existingGroup.status,
        });
        return;
      }
      setSaveError(data?.error ?? (err instanceof Error ? err.message : "Failed to save invoice."));
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(null);
  };

  return (
    <div className="space-y-4 max-w-7xl" data-testid="page-invoice-new">
      <PageHeader
        title="New invoice"
        sub="Manual entry · creates the invoice group and one or more legs in one shot"
        accent="purple"
      />

      <div
        className="rounded-md border px-4 py-3 flex items-start gap-3"
        style={{
          background: TONE_STYLE.purple.bg,
          borderColor: TONE_STYLE.purple.border,
          color: TONE_STYLE.purple.fg,
        }}
        data-testid="banner-import-first"
      >
        <Sparkles className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div className="flex-1 text-sm">
          Most invoices come from the <strong>job-status report import</strong>. Use this form for
          one-offs the import missed — you can save and start triaging right away.
        </div>
        <Button
          asChild
          size="sm"
          className="text-white"
          style={{ background: TONE_STYLE.purple.fg }}
          data-testid="button-open-import"
        >
          <Link href="/import">Open Import →</Link>
        </Button>
      </div>

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
            title="Invoice"
            icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="invoiceNumber" className="flex items-center gap-1.5">
                  Invoice # <span className="text-destructive">*</span>
                  <InfoTooltip content="The invoice number this dispute belongs to. Each invoice is unique — if one already exists, you'll be asked whether to attach to it." />
                </Label>
                <Input
                  id="invoiceNumber"
                  className="font-mono"
                  value={invoice.invoiceNumber}
                  onChange={e => updateInvoice("invoiceNumber", e.target.value)}
                  required
                  data-testid="input-invoice-number"
                />
              </div>
              <div>
                <Label htmlFor="payorEmail" className="flex items-center gap-1.5">
                  Payor email
                  <InfoTooltip content="Optional email used when the dispute is sent directly to the payor instead of through the portal." />
                </Label>
                <Input
                  id="payorEmail"
                  type="email"
                  value={invoice.payorEmail}
                  onChange={e => updateInvoice("payorEmail", e.target.value)}
                  data-testid="input-payor-email"
                />
              </div>
              <div>
                <Label htmlFor="clientNumber" className="flex items-center gap-1.5">
                  Group member ID
                  <InfoTooltip content="Optional. If left blank we'll inherit the member ID from the first leg that has one." />
                </Label>
                <Input
                  id="clientNumber"
                  className="font-mono"
                  value={invoice.clientNumber}
                  onChange={e => updateInvoice("clientNumber", e.target.value)}
                  data-testid="input-group-client-number"
                />
              </div>
            </div>
          </Section>

          <Section
            title={`Legs (${legs.length})`}
            icon={<Truck className="h-4 w-4 text-muted-foreground" />}
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addLeg}
                data-testid="button-add-leg"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add leg
              </Button>
            }
          >
            <div className="space-y-4">
              {legs.map((leg, idx) => (
                <div
                  key={idx}
                  className="rounded-md border bg-card/50 p-3 space-y-3"
                  data-testid={`leg-card-${idx}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Leg {idx + 1}
                    </div>
                    {legs.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeLeg(idx)}
                        data-testid={`button-remove-leg-${idx}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={`conf-${idx}`} className="flex items-center gap-1.5 text-xs">
                        Confirmation # <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id={`conf-${idx}`}
                        className="font-mono h-9"
                        value={leg.confNumber}
                        onChange={e => updateLeg(idx, "confNumber", e.target.value)}
                        required
                        data-testid={`input-leg-conf-${idx}`}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`date-${idx}`} className="text-xs">Service date</Label>
                      <Input
                        id={`date-${idx}`}
                        type="date"
                        className="h-9"
                        value={leg.date}
                        onChange={e => updateLeg(idx, "date", e.target.value)}
                        data-testid={`input-leg-date-${idx}`}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`ref-${idx}`} className="text-xs">Reference #</Label>
                      <Input
                        id={`ref-${idx}`}
                        className="font-mono h-9"
                        value={leg.refNumber}
                        onChange={e => updateLeg(idx, "refNumber", e.target.value)}
                        data-testid={`input-leg-ref-${idx}`}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`amt-${idx}`} className="text-xs">Claim amount</Label>
                      <Input
                        id={`amt-${idx}`}
                        className="font-mono h-9"
                        placeholder="0.00"
                        value={leg.claimAmount}
                        onChange={e => updateLeg(idx, "claimAmount", e.target.value)}
                        data-testid={`input-leg-amount-${idx}`}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`client-${idx}`} className="text-xs">Member ID</Label>
                      <Input
                        id={`client-${idx}`}
                        className="font-mono h-9"
                        value={leg.clientNumber}
                        onChange={e => updateLeg(idx, "clientNumber", e.target.value)}
                        data-testid={`input-leg-client-${idx}`}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`car-${idx}`} className="text-xs">Vehicle / car #</Label>
                      <Input
                        id={`car-${idx}`}
                        className="font-mono h-9"
                        value={leg.carNumber}
                        onChange={e => updateLeg(idx, "carNumber", e.target.value)}
                        data-testid={`input-leg-car-${idx}`}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor={`err-${idx}`} className="text-xs">Error description</Label>
                    <Textarea
                      id={`err-${idx}`}
                      rows={2}
                      value={leg.errorDetails}
                      onChange={e => updateLeg(idx, "errorDetails", e.target.value)}
                      placeholder="e.g. Trip mileage mismatch (rate code R-12 expected 14.2 mi, billed 9.8 mi)…"
                      data-testid={`input-leg-error-${idx}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        <aside className="xl:col-span-4 space-y-3 xl:sticky xl:top-4 self-start">
          <ActionsRail
            variant="claim"
            title="Save invoice"
            meta={ready ? "ready" : "fill invoice # and a leg"}
          >
            <ActionsRailRecommended
              label="Recommended"
              description="Lands on the invoice detail page so you can triage, walk the SOP, and queue the dispute right away."
            >
              <div className="text-sm font-semibold mb-2">Save and start processing</div>
              <ToneButton
                tone="purple"
                type="submit"
                disabled={!ready || saving}
                testId="button-save-and-process"
              >
                {saving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                ) : (
                  <><Save className="h-4 w-4" /> Save and start</>
                )}
              </ToneButton>
            </ActionsRailRecommended>

            <ActionGroup label="Other ways to save">
              <ActionRow
                icon={<X className="w-3.5 h-3.5" />}
                label="Cancel"
                sub="Discard and return to invoice groups"
                muted
                onClick={() => navigate("/invoice-groups")}
                testId="action-cancel"
              />
            </ActionGroup>
          </ActionsRail>

          <Card data-testid="card-summary">
            <CardContent className="p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Summary
              </div>
              <div className="text-sm flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5" /> Legs
                </span>
                <span className="font-semibold">{legs.length}</span>
              </div>
              <div className="text-sm flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5" /> Total
                </span>
                <span className="font-mono font-semibold">{formatCurrency(totalAmount)}</span>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-linked-group">
            <CardContent className="p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
                Invoice number lookup
              </div>
              {linkedGroup ? (
                <div className="text-xs space-y-1.5" data-testid="linked-group-warning">
                  <div className="flex items-center gap-1.5 text-amber-700">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="font-medium">Invoice already exists</span>
                  </div>
                  <Link
                    href={`/invoice-groups/${linkedGroup.id}`}
                    className="block hover:bg-muted -mx-1 px-1 py-1 rounded transition-colors"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <Truck className="w-3.5 h-3.5" style={{ color: TONE_STYLE.purple.fg }} />
                      <span className="font-mono font-semibold" style={{ color: TONE_STYLE.purple.fg }}>
                        <RefNumber value={linkedGroup.invoiceNumber} variant="inline" />
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {linkedGroup.rideCount} ride{linkedGroup.rideCount === 1 ? "" : "s"} ·{" "}
                      {formatCurrency(Number(linkedGroup.totalAmount ?? 0))}
                    </div>
                  </Link>
                  <p className="text-muted-foreground">
                    Saving will offer to attach the new legs to this invoice.
                  </p>
                </div>
              ) : trimmedInvoice ? (
                <div className="text-xs text-muted-foreground">
                  No existing invoice for{" "}
                  <span className="font-mono">{trimmedInvoice}</span> — a new one will be created on save.
                </div>
              ) : (
                <div className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>Type the invoice number and we'll check whether one already exists.</span>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </form>

      <Dialog open={!!conflict} onOpenChange={open => { if (!open) setConflict(null); }}>
        <DialogContent data-testid="dialog-invoice-conflict">
          <DialogHeader>
            <DialogTitle>Invoice already exists</DialogTitle>
            <DialogDescription>
              {conflict && (
                <>
                  Invoice <span className="font-mono font-semibold">{conflict.invoiceNumber}</span>{" "}
                  already exists with {conflict.rideCount} leg{conflict.rideCount === 1 ? "" : "s"}
                  {conflict.totalAmount ? ` totalling ${formatCurrency(Number(conflict.totalAmount))}` : ""}.
                  Do you want to attach the {legs.length} new leg{legs.length === 1 ? "" : "s"} to it,
                  or cancel and edit the invoice number?
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!conflict) return;
                navigate(`/invoice-groups/${conflict.existingGroupId}`);
              }}
              data-testid="button-conflict-open-existing"
            >
              Open existing
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConflict(null)}
              data-testid="button-conflict-cancel"
            >
              Edit invoice number
            </Button>
            <Button
              onClick={() => {
                if (!conflict) return;
                const id = conflict.existingGroupId;
                setConflict(null);
                submit(id);
              }}
              data-testid="button-conflict-attach"
              style={{ background: TONE_STYLE.purple.fg, color: "white" }}
            >
              Attach legs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
