import { useState } from "react";
import { useListClaims, getListClaimsQueryKey } from "@workspace/api-client-react";
import { useClaimsListEvents } from "@/hooks/use-claim-events";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { Link } from "wouter";
import { Search, Filter, ArrowUpDown } from "lucide-react";

export default function ClaimsList() {
  useClaimsListEvents();
  const [search, setSearch] = useState("");
  
  const { data, isLoading } = useListClaims({
    search: search || undefined,
    limit: 50,
  }, {
    query: {
      queryKey: getListClaimsQueryKey({ search: search || undefined, limit: 50 })
    }
  });

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
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading claims...</td>
                  </tr>
                ) : data?.claims.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No claims found.</td>
                  </tr>
                ) : (
                  data?.claims.map(claim => (
                    <tr key={claim.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
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
