import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Search, FolderOpen, Files, FileMinus, Send, Loader2 } from "lucide-react";
import {
  useGlobalSearch,
  getGlobalSearchQueryKey,
} from "@workspace/api-client-react";
import type {
  GlobalSearchInvoiceGroup,
  GlobalSearchClaim,
  GlobalSearchWithdrawal,
  GlobalSearchPortalSubmission,
} from "@workspace/api-client-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { RefNumber } from "@/components/ref-number";
import { formatCurrency } from "@/lib/format";

// Debounce keystrokes so we don't fire a query for every letter — 200ms feels
// instant but lets the user finish typing a confirmation number before we
// hit the server.
function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function fmtAmount(s: string | null | undefined): string | null {
  if (s == null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return formatCurrency(n);
}

function shortContext(parts: Array<string | null | undefined>): string {
  return parts.filter(p => p != null && String(p).length > 0).join(" · ");
}

export function HeaderSearch() {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query.trim(), 200);

  // Keyboard shortcuts: ⌘K (or Ctrl+K) anywhere; "/" only when not typing in
  // another input. Both open the overlay if it isn't already open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmdK = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      const slash = e.key === "/" && !isTypingTarget(e.target);
      if (cmdK || slash) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset query when the overlay closes so reopening starts clean.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const enabled = open && debouncedQuery.length > 0;
  const params = { q: debouncedQuery };
  const { data, isFetching } = useGlobalSearch(params, {
    query: {
      queryKey: getGlobalSearchQueryKey(params),
      enabled,
      staleTime: 30_000,
    },
  });

  const totals = useMemo(() => {
    const d = data;
    if (!d) return 0;
    return (
      d.invoiceGroups.length +
      d.claims.length +
      d.withdrawals.length +
      d.portalSubmissions.length
    );
  }, [data]);

  const goto = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  const renderGroupItem = (g: GlobalSearchInvoiceGroup) => (
    <CommandItem
      key={`g-${g.id}`}
      value={`group-${g.id}-${g.invoiceNumber ?? ""}-${g.clientNumber ?? ""}`}
      onSelect={() => goto(`/invoice-groups/${g.id}`)}
      data-testid={`header-search-result-group-${g.id}`}
    >
      <FolderOpen className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-col min-w-0">
        <span className="truncate font-medium inline-flex items-center gap-1">
          {g.invoiceNumber ? (
            <RefNumber value={g.invoiceNumber} variant="inline" />
          ) : (
            <span>Group #{g.id}</span>
          )}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {shortContext([
            g.clientNumber ? `Client ${g.clientNumber}` : null,
            g.errorTypeName,
            g.status,
            fmtAmount(g.totalAmount),
          ])}
        </span>
      </div>
    </CommandItem>
  );

  const renderClaimItem = (c: GlobalSearchClaim) => (
    <CommandItem
      key={`c-${c.id}`}
      value={`claim-${c.id}-${c.confNumber ?? ""}-${c.clientNumber ?? ""}`}
      onSelect={() => goto(`/claims/${c.id}`)}
      data-testid={`header-search-result-claim-${c.id}`}
    >
      <Files className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-col min-w-0">
        <span className="truncate font-medium">
          {c.confNumber ?? `Claim #${c.id}`}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {shortContext([
            c.clientNumber ? `Client ${c.clientNumber}` : null,
            c.errorTypeName,
            c.status,
            fmtAmount(c.claimAmount),
          ])}
        </span>
      </div>
    </CommandItem>
  );

  const renderWithdrawalItem = (w: GlobalSearchWithdrawal) => {
    const href = w.kind === "claim" ? `/claims/${w.id}` : `/invoice-groups/${w.id}`;
    return (
      <CommandItem
        key={`w-${w.kind}-${w.id}`}
        value={`withdrawal-${w.kind}-${w.id}-${w.identifier}`}
        onSelect={() => goto(href)}
        data-testid={`header-search-result-withdrawal-${w.kind}-${w.id}`}
      >
        <FileMinus className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col min-w-0">
          <span className="truncate font-medium">{w.identifier}</span>
          <span className="truncate text-xs text-muted-foreground">
            {shortContext([
              w.kind === "claim" ? "Claim" : "Group",
              w.clientNumber ? `Client ${w.clientNumber}` : null,
              w.closureReason,
              fmtAmount(w.amount),
            ])}
          </span>
        </div>
      </CommandItem>
    );
  };

  const renderPortalItem = (p: GlobalSearchPortalSubmission) => (
    <CommandItem
      key={`p-${p.id}`}
      value={`portal-${p.id}-${p.invoiceNumber ?? ""}-${p.confNumber ?? ""}`}
      // Portal submissions don't have a dedicated detail page — the
      // group's detail page is the closest surface that shows the
      // submission row + its activity, so we land there.
      onSelect={() => goto(`/invoice-groups/${p.invoiceGroupId}`)}
      data-testid={`header-search-result-portal-${p.id}`}
    >
      <Send className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-col min-w-0">
        <span className="truncate font-medium">
          {p.invoiceNumber ?? p.confNumber ?? `Submission #${p.id}`}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {shortContext([
            p.clientNumber ? `Client ${p.clientNumber}` : null,
            p.errorTypeName,
            p.status,
            p.portalTicketId ? `Ticket ${p.portalTicketId}` : null,
          ])}
        </span>
      </div>
    </CommandItem>
  );

  const showEmpty = enabled && !isFetching && totals === 0 && data?.query === debouncedQuery;
  const showHint = !debouncedQuery;

  return (
    <>
      {/* Wide-screen trigger: full input-styled button. Clicking opens the
          overlay rather than focusing inline so we get the same command-palette
          UX everywhere. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 h-9 w-72 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:bg-accent transition-colors"
        data-testid="header-search-trigger"
        aria-label="Open global search"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left truncate">
          Search invoices, claims, submissions…
        </span>
        <kbd className="pointer-events-none hidden lg:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {/* Narrow-screen trigger: icon-only button that opens the same overlay. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={() => setOpen(true)}
        data-testid="header-search-trigger-mobile"
        aria-label="Open global search"
      >
        <Search className="h-4 w-4" />
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search invoice #, conf #, client #…"
          value={query}
          onValueChange={setQuery}
          data-testid="header-search-input"
        />
        <CommandList>
          {showHint && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              Start typing an invoice #, confirmation #, client #, or error keyword.
            </div>
          )}
          {enabled && isFetching && totals === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching…
            </div>
          )}
          {showEmpty && (
            <CommandEmpty>
              No matches for <span className="font-medium">"{debouncedQuery}"</span>.
            </CommandEmpty>
          )}
          {data && totals > 0 && (
            <>
              {data.invoiceGroups.length > 0 && (
                <CommandGroup heading="Invoice groups">
                  {data.invoiceGroups.map(renderGroupItem)}
                </CommandGroup>
              )}
              {data.claims.length > 0 && (
                <CommandGroup heading="Claims">
                  {data.claims.map(renderClaimItem)}
                </CommandGroup>
              )}
              {data.withdrawals.length > 0 && (
                <CommandGroup heading="Withdrawals">
                  {data.withdrawals.map(renderWithdrawalItem)}
                </CommandGroup>
              )}
              {data.portalSubmissions.length > 0 && (
                <CommandGroup heading="Portal submissions">
                  {data.portalSubmissions.map(renderPortalItem)}
                </CommandGroup>
              )}
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
