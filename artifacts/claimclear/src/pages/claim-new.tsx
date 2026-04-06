import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateClaim, getListClaimsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { InfoTooltip } from "@/components/info-tooltip";

export default function ClaimNew() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const createClaim = useCreateClaim();

  const [form, setForm] = useState({
    confNumber: "",
    date: "",
    refNumber: "",
    clientNumber: "",
    carNumber: "",
    errorDetails: "",
    claimAmount: "",
    payorEmail: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.confNumber.trim()) return;

    const result = await createClaim.mutateAsync({ data: form });
    queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
    navigate(`/claims/${result.id}`);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">New Claim</h2>
        <p className="text-muted-foreground">Create a new claim manually</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="confNumber" className="flex items-center gap-1.5">
                  Confirmation Number *
                  <InfoTooltip content="The unique trip confirmation number from MAS. This is the primary identifier used to look up and dispute the claim on the portal." />
                </Label>
                <Input id="confNumber" value={form.confNumber} onChange={e => setForm({ ...form, confNumber: e.target.value })} required />
              </div>
              <div>
                <Label htmlFor="date" className="flex items-center gap-1.5">
                  Service Date
                  <InfoTooltip content="The date the transportation service was provided. This is used to calculate the dispute filing deadline (typically 30-60 days from service)." />
                </Label>
                <Input id="date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="refNumber" className="flex items-center gap-1.5">
                  Reference Number
                  <InfoTooltip content="An optional internal reference number for tracking purposes. Some organizations use this to link claims to their billing system." />
                </Label>
                <Input id="refNumber" value={form.refNumber} onChange={e => setForm({ ...form, refNumber: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="clientNumber" className="flex items-center gap-1.5">
                  Client Number
                  <InfoTooltip content="The member/client ID number associated with the trip. Helps identify the passenger and cross-reference with scheduling records." />
                </Label>
                <Input id="clientNumber" value={form.clientNumber} onChange={e => setForm({ ...form, clientNumber: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="carNumber" className="flex items-center gap-1.5">
                  Car Number
                  <InfoTooltip content="The vehicle number or identifier assigned to the car that performed the trip. Used to pull GPS data and driver records." />
                </Label>
                <Input id="carNumber" value={form.carNumber} onChange={e => setForm({ ...form, carNumber: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="claimAmount" className="flex items-center gap-1.5">
                  Claim Amount
                  <InfoTooltip content="The dollar amount being disputed. Enter the full trip cost that was denied or underpaid. Format: numbers only, e.g., 125.50" />
                </Label>
                <Input id="claimAmount" value={form.claimAmount} onChange={e => setForm({ ...form, claimAmount: e.target.value })} placeholder="0.00" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="payorEmail" className="flex items-center gap-1.5">
                  Payor Email
                  <InfoTooltip content="The email address of the payor or insurance contact. Used when generating dispute emails to send directly to the responsible party." />
                </Label>
                <Input id="payorEmail" type="email" value={form.payorEmail} onChange={e => setForm({ ...form, payorEmail: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label htmlFor="errorDetails" className="flex items-center gap-1.5">
                  Error Details
                  <InfoTooltip content="Description of the error or reason the claim was denied. Include the denial code, error message, or explanation from the payor. This helps classify the claim and determine the dispute strategy." />
                </Label>
                <Textarea id="errorDetails" value={form.errorDetails} onChange={e => setForm({ ...form, errorDetails: e.target.value })} rows={3} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => navigate("/claims")}>Cancel</Button>
              <Button type="submit" disabled={createClaim.isPending}>Create Claim</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
