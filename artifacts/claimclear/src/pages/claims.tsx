import { useState } from "react";
import { useListClaims, useListErrorTypes, useBulkAssignErrorType, getListClaimsQueryKey } from "@workspace/api-client-react";
import type { ClaimResponse, ErrorTypeResponse } from "@workspace/api-client-react";
import { useClaimsListEvents } from "@/hooks/use-claim-events";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { Link } from "wouter";
import { Search, Filter, Tag, X, Loader2, CheckCircle2 } from "lucide-react";

export default function ClaimsList() {
  useClaimsListEvents();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkErrorTypeId, setBulkErrorTypeId] = useState("");
  const [bulkAssignSuccess, setBulkAssignSuccess] = useState("");

  const { data, isLoading } = useListClaims({
    search: search || undefined,
    limit: 50,
  }, {
    query: {
      queryKey: getListClaimsQueryKey({ search: search || undefined, limit: 50 })
    }
  });

  const { data: errorTypesData } = useListErrorTypes();
  const bulkAssign = useBulkAssignErrorType();

  const errorTypes: ErrorTypeResponse[] = errorTypesData ?? [];
  const claims: ClaimResponse[] = data?.claims ?? [];

  const allSelected = claims.length > 0 && claims.every((c) => selectedIds.has(c.id));
  const someSelected = selectedIds.size > 0;

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(claims.map((c) => c.id)));
    }
  };

  const handleToggle = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBulkAssign = async () => {
    if (!bulkErrorTypeId || selectedIds.size === 0) return;

    const et = errorTypes.find((t) => String(t.id) === bulkErrorTypeId);
    if (!et) return;

    try {
      const res = await bulkAssign.mutateAsync({
        data: {
          claimIds: Array.from(selectedIds),
          errorTypeId: Number(bulkErrorTypeId),
        }
      });
      setBulkAssignSuccess(`Updated ${res.updated} claim${res.updated !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setShowBulkAssign(false);
      setBulkErrorTypeId("");
      queryClient.invalidateQueries({ queryKey: getListClaimsQueryKey() });
      setTimeout(() => setBulkAssignSuccess(""), 3000);
    } catch {
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">All Claims</h1>
          <p className="text-muted-foreground mt-1">Search and filter through the entire claims database.</p>
        </div>
        <Button asChild>
          <Link href="/claims/new">Create Claim</Link>
        </Button>
      </div>

      {bulkAssignSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-800">{bulkAssignSuccess}</span>
        </div>
      )}

      {someSelected && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{selectedIds.size} claim{selectedIds.size !== 1 ? "s" : ""} selected</span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                <X className="h-3 w-3 mr-1" /> Clear
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {showBulkAssign ? (
                <>
                  <Select value={bulkErrorTypeId} onValueChange={setBulkErrorTypeId}>
                    <SelectTrigger className="w-[200px] h-8 text-sm">
                      <SelectValue placeholder="Select error type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {errorTypes.map((et) => (
                        <SelectItem key={et.id} value={String(et.id)}>{et.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    onClick={handleBulkAssign}
                    disabled={!bulkErrorTypeId || bulkAssign.isPending}
                  >
                    {bulkAssign.isPending ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Assigning...</>
                    ) : (
                      "Apply"
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setShowBulkAssign(false); setBulkErrorTypeId(""); }}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setShowBulkAssign(true)}>
                  <Tag className="h-3 w-3 mr-1" /> Assign Error Type
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="p-4 border-b flex flex-row items-center justify-between space-y-0">
          <div className="relative w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by Conf #, Client, Error..." 
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Filter className="mr-2 h-4 w-4" /> Filter
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground bg-muted/50 uppercase border-b">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Conf #</th>
                  <th className="px-4 py-3 font-medium">Service Date</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Error Type</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading claims...</td>
                  </tr>
                ) : claims.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No claims found.</td>
                  </tr>
                ) : (
                  claims.map((claim) => (
                    <tr key={claim.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${selectedIds.has(claim.id) ? "bg-primary/5" : ""}`}>
                      <td className="px-4 py-3">
                        <Checkbox
                          checked={selectedIds.has(claim.id)}
                          onCheckedChange={() => handleToggle(claim.id)}
                          aria-label={`Select claim ${claim.confNumber}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-primary">
                        <Link href={`/claims/${claim.id}`}>{claim.confNumber}</Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(claim.date)}</td>
                      <td className="px-4 py-3">{claim.clientNumber || '-'}</td>
                      <td className="px-4 py-3 max-w-[200px] truncate" title={claim.errorTypeName || ''}>
                        {claim.errorTypeName || 'Unknown'}
                      </td>
                      <td className="px-4 py-3 font-medium">{formatCurrency(claim.claimAmount)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={claim.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/claims/${claim.id}`}>View</Link>
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
