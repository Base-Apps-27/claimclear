import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  useAdminListAuditLogs,
  getAdminExportAuditLogsCsvUrl,
  type AdminAuditLogItem,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ACTION_CATEGORY_LABELS, type ActionCategory } from "@/lib/audit-action-meta";
import { formatDateTime } from "@/lib/format";
import { ArrowLeft, Download } from "lucide-react";

const PAGE_SIZE = 50;

const CATEGORY_OPTIONS: ("all" | ActionCategory)[] = [
  "all",
  "status",
  "edit",
  "evidence",
  "workflow",
  "hold",
  "draft",
  "communication",
  "other",
];

function useQueryParam(name: string): string {
  const [location] = useLocation();
  return useMemo(() => {
    const idx = location.indexOf("?");
    if (idx === -1) return "";
    const sp = new URLSearchParams(location.slice(idx + 1));
    return sp.get(name) || "";
  }, [location, name]);
}

export default function AdminUserActivity() {
  const { user } = useAuth();
  const initialEmail = useQueryParam("email");
  const [userEmail, setUserEmail] = useState(initialEmail);
  const [category, setCategory] = useState<"all" | ActionCategory>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  if (user?.role !== "admin") {
    return (
      <Card>
        <CardHeader><CardTitle>Admin only</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">You need admin access to view this page.</p>
        </CardContent>
      </Card>
    );
  }

  const params = useMemo(() => {
    const p: Record<string, string | number> = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
    if (userEmail.trim()) p.userEmail = userEmail.trim();
    if (category !== "all") p.category = category;
    if (from) p.from = new Date(from).toISOString();
    if (to) p.to = new Date(to).toISOString();
    return p;
  }, [userEmail, category, from, to, page]);

  const { data, isLoading, isFetching } = useAdminListAuditLogs(params);

  const items: AdminAuditLogItem[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const showingFrom = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, total);

  const exportUrl = useMemo(() => {
    const exportParams: Record<string, string> = {};
    if (userEmail.trim()) exportParams.userEmail = userEmail.trim();
    if (category !== "all") exportParams.category = category;
    if (from) exportParams.from = new Date(from).toISOString();
    if (to) exportParams.to = new Date(to).toISOString();
    return getAdminExportAuditLogsCsvUrl(exportParams);
  }, [userEmail, category, from, to]);

  function resetPage() {
    setPage(0);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/settings">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Back to settings
          </Button>
        </Link>
      </div>

      <div>
        <h2 className="text-2xl font-bold tracking-tight">User Activity</h2>
        <p className="text-muted-foreground">Audit log feed scoped to a single user, with CSV export.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="user-email">User email</Label>
              <Input
                id="user-email"
                placeholder="user@example.com"
                value={userEmail}
                onChange={(e) => { setUserEmail(e.target.value); resetPage(); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select value={category} onValueChange={(v) => { setCategory(v as "all" | ActionCategory); resetPage(); }}>
                <SelectTrigger id="category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{ACTION_CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); resetPage(); }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" type="date" value={to} onChange={(e) => { setTo(e.target.value); resetPage(); }} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a href={exportUrl}>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
            </a>
            {(userEmail || category !== "all" || from || to) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setUserEmail(""); setCategory("all"); setFrom(""); setTo(""); resetPage(); }}
              >
                Clear filters
              </Button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {isFetching ? "Loading…" : total > 0 ? `Showing ${showingFrom}–${showingTo} of ${total}` : "No matching activity"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">When</TableHead>
                <TableHead className="w-[200px]">User</TableHead>
                <TableHead className="w-[200px]">Action</TableHead>
                <TableHead className="w-[120px]">Category</TableHead>
                <TableHead className="w-[180px]">Target</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>
              )}
              {!isLoading && items.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No activity matches your filters.</TableCell></TableRow>
              )}
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="text-xs whitespace-nowrap">{formatDateTime(item.timestamp)}</TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium truncate">{item.userName || "—"}</div>
                    <div className="text-muted-foreground truncate">{item.userEmail || ""}</div>
                  </TableCell>
                  <TableCell className="text-sm">{item.actionLabel}</TableCell>
                  <TableCell><Badge variant="secondary">{ACTION_CATEGORY_LABELS[item.category as ActionCategory] || item.category}</Badge></TableCell>
                  <TableCell className="text-xs">
                    {item.invoiceGroupId != null ? (
                      <Link href={`/invoice-groups/${item.invoiceGroupId}`} className="text-blue-600 hover:underline">
                        Invoice {item.invoiceGroupNumber || `#${item.invoiceGroupId}`}
                      </Link>
                    ) : item.claimId != null ? (
                      <Link href={`/claims/${item.claimId}`} className="text-blue-600 hover:underline">
                        {item.claimConfNumber || `Claim #${item.claimId}`}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{item.details}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" disabled={page === 0 || isFetching} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          Previous
        </Button>
        <span className="text-xs text-muted-foreground">Page {page + 1}{total > 0 ? ` of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}` : ""}</span>
        <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total || isFetching} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
