import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, X, Check, Filter, ListFilter, AlertCircle, Calendar, DollarSign, Clock } from "lucide-react";
import { STATUSES, OUTCOMES, ERROR_TYPES, DEADLINES, SAMPLE_ROWS } from "./_shared/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

type FilterType = "status" | "outcome" | "errorType" | "amount" | "date" | "deadline";

interface FilterChip {
  id: string;
  type: FilterType;
  label: string;
  value: any;
}

export function CommandPalette() {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [activeFilters, setActiveFilters] = useState<FilterChip[]>([
    { id: "status-needs-review", type: "status", label: "Status: Needs Review", value: "Needs Review" },
    { id: "error-gps", type: "errorType", label: "Error: GPS Deviation Status", value: "3" },
    { id: "amount-gt-50", type: "amount", label: "Amount: > $50", value: ">50" },
  ]);

  // Handle click outside to close
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  const removeFilter = (id: string) => {
    setActiveFilters((prev) => prev.filter((f) => f.id !== id));
  };

  const addFilter = (chip: FilterChip) => {
    // Avoid exact duplicates
    if (!activeFilters.find((f) => f.id === chip.id)) {
      setActiveFilters((prev) => [...prev, chip]);
    }
    setInputValue("");
    inputRef.current?.focus();
  };

  const searchLower = inputValue.toLowerCase();

  const matchingStatuses = STATUSES.filter(s => s.toLowerCase().includes(searchLower));
  const matchingOutcomes = OUTCOMES.filter(o => o.toLowerCase().includes(searchLower));
  const matchingErrors = ERROR_TYPES.filter(e => e.name.toLowerCase().includes(searchLower));
  const matchingDeadlines = DEADLINES.filter(d => d.label.toLowerCase().includes(searchLower) || d.value.toLowerCase().includes(searchLower));

  // Heuristics for special types
  const isAmountMatch = searchLower.includes("$") || searchLower.includes(">") || searchLower.includes("<") || /^\d/.test(searchLower);
  const amountSuggestion = isAmountMatch && searchLower.length > 0 ? searchLower : null;

  const isDateMatch = searchLower.includes("mar") || searchLower.includes("apr") || searchLower.includes("/");
  const dateSuggestion = isDateMatch && searchLower.length > 2 ? searchLower : null;

  return (
    <div className="min-h-[900px] bg-background p-4 font-sans text-foreground flex flex-col gap-6">
      
      {/* Header Strip */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">All Claims</h1>
          <div className="text-sm text-muted-foreground font-medium bg-muted px-2.5 py-0.5 rounded-full">
            2,137 matching
          </div>
        </div>

        {/* Applied Chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground mr-1 flex items-center gap-1.5">
              <ListFilter className="w-4 h-4" /> Filtering by:
            </span>
            {activeFilters.map((f) => (
              <Badge key={f.id} variant="secondary" className="flex items-center gap-1 pl-2 pr-1 py-1 text-sm bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800">
                {f.label}
                <div 
                  className="ml-1 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-0.5 cursor-pointer"
                  onClick={() => removeFilter(f.id)}
                >
                  <X className="w-3 h-3" />
                </div>
              </Badge>
            ))}
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground ml-auto" onClick={() => setActiveFilters([])}>
              Clear all
            </Button>
          </div>
        )}

        {/* Command Palette Input Container */}
        <div className="relative max-w-2xl w-full z-50" ref={containerRef}>
          <div className={`flex items-center border rounded-md bg-card shadow-sm transition-all ${isOpen ? 'ring-2 ring-primary/20 border-primary' : 'hover:border-primary/50'}`}>
            <Search className="ml-3 w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              className="flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground w-full"
              placeholder="Filter claims... (try: needs review, GPS, > $50, today)"
            />
            {inputValue && (
              <Button variant="ghost" size="icon" className="w-8 h-8 mr-1 text-muted-foreground" onClick={() => { setInputValue(""); inputRef.current?.focus(); }}>
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Palette Dropdown */}
          {isOpen && (
            <div className="absolute top-full left-0 w-full mt-2 bg-popover border shadow-lg rounded-md overflow-hidden flex flex-col max-h-[400px]">
              <Command className="w-full h-full border-none" shouldFilter={false}>
                <CommandList className="max-h-[400px] p-1">
                  {!inputValue && activeFilters.length === 0 && (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      Type to filter by status, outcome, error type, amount, or date.
                    </div>
                  )}

                  {inputValue && 
                    matchingStatuses.length === 0 && 
                    matchingOutcomes.length === 0 && 
                    matchingErrors.length === 0 && 
                    matchingDeadlines.length === 0 && 
                    !amountSuggestion && 
                    !dateSuggestion && (
                    <CommandEmpty className="py-6 text-center text-sm text-muted-foreground">
                      No matching filters found.
                    </CommandEmpty>
                  )}

                  {matchingStatuses.length > 0 && (
                    <CommandGroup heading="Status">
                      {matchingStatuses.map((s) => (
                        <CommandItem 
                          key={s} 
                          value={`status-${s}`}
                          onSelect={() => addFilter({ id: `status-${s}`, type: "status", label: `Status: ${s}`, value: s })}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                          {s}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {matchingErrors.length > 0 && (
                    <CommandGroup heading="Error Type">
                      {matchingErrors.map((e) => (
                        <CommandItem 
                          key={e.id} 
                          value={`error-${e.id}`}
                          onSelect={() => addFilter({ id: `error-${e.id}`, type: "errorType", label: `Error: ${e.name}`, value: e.id })}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <AlertCircle className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className={e.italic ? "italic" : ""}>{e.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {matchingOutcomes.length > 0 && (
                    <CommandGroup heading="Outcome">
                      {matchingOutcomes.map((o) => (
                        <CommandItem 
                          key={o} 
                          value={`outcome-${o}`}
                          onSelect={() => addFilter({ id: `outcome-${o}`, type: "outcome", label: `Outcome: ${o}`, value: o })}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5 text-muted-foreground" />
                          {o}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {matchingDeadlines.length > 0 && (
                    <CommandGroup heading="Filing Deadline">
                      {matchingDeadlines.map((d) => (
                        <CommandItem 
                          key={d.value} 
                          value={`deadline-${d.value}`}
                          onSelect={() => addFilter({ id: `deadline-${d.value}`, type: "deadline", label: `Deadline: ${d.label}`, value: d.value })}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          {d.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {amountSuggestion && (
                    <CommandGroup heading="Amount">
                      <CommandItem 
                        value={`amount-custom`}
                        onSelect={() => addFilter({ id: `amount-${amountSuggestion}`, type: "amount", label: `Amount: ${amountSuggestion}`, value: amountSuggestion })}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                        Amount matching "{amountSuggestion}"
                      </CommandItem>
                    </CommandGroup>
                  )}

                  {dateSuggestion && (
                    <CommandGroup heading="Date">
                      <CommandItem 
                        value={`date-custom`}
                        onSelect={() => addFilter({ id: `date-${dateSuggestion}`, type: "date", label: `Date: ${dateSuggestion}`, value: dateSuggestion })}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                        Date matching "{dateSuggestion}"
                      </CommandItem>
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </div>
          )}
        </div>
      </div>

      {/* Dimmed Table Preview */}
      <div className={`mt-4 rounded-md border bg-card overflow-hidden transition-opacity duration-300 ${isOpen ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-4 py-3 font-medium text-muted-foreground">Conf #</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Service Date</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Client</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Error Type</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Amount</th>
                <th className="px-4 py-3 font-medium text-muted-foreground">Deadline</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SAMPLE_ROWS.map((row, i) => (
                <tr key={i} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs">{row.conf}</td>
                  <td className="px-4 py-3">{row.serviceDate}</td>
                  <td className="px-4 py-3">{row.client}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="font-normal">{row.status}</Badge>
                  </td>
                  <td className="px-4 py-3 max-w-[200px] truncate" title={row.errorType}>
                    {row.errorType}
                  </td>
                  <td className="px-4 py-3">{row.amount}</td>
                  <td className="px-4 py-3">
                    {row.deadline === "today" && <Badge variant="destructive" className="text-[10px]">Today</Badge>}
                    {row.deadline === "soon" && <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-100 border-transparent text-[10px]">Soon</Badge>}
                    {row.deadline === "ok" && <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
