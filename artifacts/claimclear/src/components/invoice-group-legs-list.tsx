import { Link } from "wouter";
import type { ClaimResponse } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { LegSubStatusPill } from "@/components/leg-sub-status-pill";

// Disputed-legs table extracted from invoice-group-detail-v2 so the queue
// inline workspace can render the same row schema. Pure presentation:
// callers pass the disputed legs (already filtered) and the excluded
// count separately so they keep the leg-filter logic in one place.
interface Props {
  rides: ClaimResponse[];
  excludedCount: number;
}

export function InvoiceGroupLegsList({ rides, excludedCount }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Legs queue</CardTitle>
        <CardDescription>
          Disputed legs only{excludedCount > 0 ? ` · ${excludedCount} excluded leg${excludedCount === 1 ? "" : "s"} hidden` : ""}.
          Resolve every leg before generating the submission preview.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rides.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No legs included in the dispute for this group.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 pr-2">Leg</th>
                  <th className="text-left py-2 pr-2">Service date</th>
                  <th className="text-left py-2 pr-2">Amount</th>
                  <th className="text-left py-2 pr-2">Sub-status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rides.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0" data-testid={`legs-queue-row-${r.id}`}>
                    <td className="py-2 pr-2 font-medium">
                      #{r.id} · {r.confNumber || "—"}
                    </td>
                    <td className="py-2 pr-2 text-muted-foreground">
                      {r.date ? formatDate(r.date) : "—"}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">
                      {formatCurrency(r.claimAmount ?? "0")}
                    </td>
                    <td className="py-2 pr-2">
                      <LegSubStatusPill leg={r} />
                    </td>
                    <td className="py-2 text-right">
                      <Link href={`/claims/${r.id}`}>
                        <Button size="sm" variant="ghost" className="h-7" data-testid={`legs-queue-open-${r.id}`}>
                          Open <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
