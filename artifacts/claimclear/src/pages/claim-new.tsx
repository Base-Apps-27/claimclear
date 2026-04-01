import { useState } from "react";
import { useLocation } from "wouter";
import { useCreateClaim, getListClaimsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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
                <Label htmlFor="confNumber">Confirmation Number *</Label>
                <Input id="confNumber" value={form.confNumber} onChange={e => setForm({ ...form, confNumber: e.target.value })} required />
              </div>
              <div>
                <Label htmlFor="date">Service Date</Label>
                <Input id="date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="refNumber">Reference Number</Label>
                <Input id="refNumber" value={form.refNumber} onChange={e => setForm({ ...form, refNumber: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="clientNumber">Client Number</Label>
                <Input id="clientNumber" value={form.clientNumber} onChange={e => setForm({ ...form, clientNumber: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="carNumber">Car Number</Label>
                <Input id="carNumber" value={form.carNumber} onChange={e => setForm({ ...form, carNumber: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="claimAmount">Claim Amount</Label>
                <Input id="claimAmount" value={form.claimAmount} onChange={e => setForm({ ...form, claimAmount: e.target.value })} placeholder="0.00" />
              </div>
              <div className="col-span-2">
                <Label htmlFor="payorEmail">Payor Email</Label>
                <Input id="payorEmail" type="email" value={form.payorEmail} onChange={e => setForm({ ...form, payorEmail: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label htmlFor="errorDetails">Error Details</Label>
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
