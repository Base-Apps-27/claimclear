import React, { useState } from "react";
import { Search, Plus, X, ChevronDown, Check, CalendarIcon, XCircle, MoreHorizontal } from "lucide-react";

import {
  STATUSES,
  OUTCOMES,
  ERROR_TYPES,
  DEADLINES,
  SAMPLE_ROWS,
} from "./_shared/data";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

type FilterType = "status" | "outcome" | "errorType" | "deadline" | "serviceDate" | "createdDate" | "amount";

interface FilterInstance {
  id: string;
  type: FilterType;
  values: string[];
  range?: { min?: string; max?: string };
}

const FILTER_CONFIG: Record<FilterType, { label: string; options?: { label: string; value: string }[] }> = {
  status: { label: "Status", options: STATUSES.map(s => ({ label: s, value: s })) },
  outcome: { label: "Outcome", options: OUTCOMES.map(s => ({ label: s, value: s })) },
  errorType: { label: "Error Type", options: ERROR_TYPES.map(e => ({ label: e.name, value: e.id })) },
  deadline: { label: "Deadline", options: DEADLINES.map(d => ({ label: d.label, value: d.value })) },
  serviceDate: { label: "Service Date" },
  createdDate: { label: "Created Date" },
  amount: { label: "Amount" },
};

function FilterChip({
  filter,
  onUpdate,
  onRemove,
  defaultOpen = false,
}: {
  filter: FilterInstance;
  onUpdate: (updates: Partial<FilterInstance>) => void;
  onRemove: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const config = FILTER_CONFIG[filter.type];

  // Helper to render the display value
  const renderValue = () => {
    if (filter.type === "amount") {
      if (filter.range?.min && filter.range?.max) return `$${filter.range.min} - $${filter.range.max}`;
      if (filter.range?.min) return `> $${filter.range.min}`;
      if (filter.range?.max) return `< $${filter.range.max}`;
      return "Any";
    }
    if (filter.type === "serviceDate" || filter.type === "createdDate") {
      if (filter.range?.min && filter.range?.max) return `${filter.range.min} - ${filter.range.max}`;
      if (filter.range?.min) return `After ${filter.range.min}`;
      if (filter.range?.max) return `Before ${filter.range.max}`;
      return "Any";
    }
    
    if (!filter.values.length) return "Any";
    
    if (filter.values.length === 1) {
      const opt = config.options?.find(o => o.value === filter.values[0]);
      return opt?.label || filter.values[0];
    }
    
    return `${filter.values.length} selected`;
  };

  return (
    <div className="flex items-center rounded-md border border-border bg-background shadow-xs text-sm overflow-hidden h-7">
      <div className="px-2 py-1 text-muted-foreground bg-muted/50 border-r border-border font-medium flex items-center h-full">
        {config.label}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="px-2 py-1 hover:bg-muted/50 flex-1 flex items-center justify-between min-w-[60px] text-left h-full focus:outline-none focus:ring-1 focus:ring-ring">
            <span className="truncate max-w-[150px] font-medium">{renderValue()}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[240px] p-0" align="start">
          {config.options ? (
            <Command>
              {(config.options.length > 6) && <CommandInput placeholder={`Search ${config.label.toLowerCase()}...`} />}
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup>
                  {config.options.map((option) => {
                    const isSelected = filter.values.includes(option.value);
                    return (
                      <CommandItem
                        key={option.value}
                        onSelect={() => {
                          const newValues = isSelected
                            ? filter.values.filter(v => v !== option.value)
                            : [...filter.values, option.value];
                          onUpdate({ values: newValues });
                        }}
                      >
                        <div className={cn(
                          "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                          isSelected ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                        )}>
                          <Check className={cn("h-4 w-4")} />
                        </div>
                        <span>{option.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          ) : filter.type === "amount" ? (
            <div className="p-4 grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">Amount Range</h4>
                <p className="text-sm text-muted-foreground">Filter by claim amount.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="min">Min</Label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-2.5 text-muted-foreground text-sm">$</span>
                    <Input
                      id="min"
                      className="pl-6 h-8"
                      value={filter.range?.min || ""}
                      onChange={(e) => onUpdate({ range: { ...filter.range, min: e.target.value } })}
                    />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="max">Max</Label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-2.5 text-muted-foreground text-sm">$</span>
                    <Input
                      id="max"
                      className="pl-6 h-8"
                      value={filter.range?.max || ""}
                      onChange={(e) => onUpdate({ range: { ...filter.range, max: e.target.value } })}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium leading-none">Date Range</h4>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label>Start</Label>
                  <Input
                    type="date"
                    className="h-8"
                    value={filter.range?.min || ""}
                    onChange={(e) => onUpdate({ range: { ...filter.range, min: e.target.value } })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>End</Label>
                  <Input
                    type="date"
                    className="h-8"
                    value={filter.range?.max || ""}
                    onChange={(e) => onUpdate({ range: { ...filter.range, max: e.target.value } })}
                  />
                </div>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <button
        onClick={onRemove}
        className="px-2 py-1 hover:bg-muted text-muted-foreground hover:text-foreground h-full flex items-center focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}


export function InlineTokens() {
  const [activeFilters, setActiveFilters] = useState<FilterInstance[]>([
    { id: "1", type: "status", values: ["Needs Review", "Needs Evidence"] },
    { id: "2", type: "amount", values: [], range: { min: "50", max: "200" } },
  ]);

  const [addOpen, setAddOpen] = useState(false);

  const addFilter = (type: FilterType) => {
    const newFilter: FilterInstance = { id: Math.random().toString(36).substring(7), type, values: [] };
    setActiveFilters([...activeFilters, newFilter]);
    setAddOpen(false);
  };

  const updateFilter = (id: string, updates: Partial<FilterInstance>) => {
    setActiveFilters(activeFilters.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const removeFilter = (id: string) => {
    setActiveFilters(activeFilters.filter(f => f.id !== id));
  };

  const clearAll = () => setActiveFilters([]);

  const getStatusBadgeVariant = (status: string) => {
    if (["Needs Review", "Needs Evidence"].includes(status)) return "destructive";
    if (["Awaiting Response", "On Hold"].includes(status)) return "secondary";
    if (["Resolved", "Denied"].includes(status)) return "outline";
    return "default";
  };

  const getDeadlineBadgeColor = (deadline: string) => {
    if (deadline === "today") return "text-destructive bg-destructive/10 border-destructive/20";
    if (deadline === "soon") return "text-amber-600 bg-amber-50 border-amber-200";
    return "text-muted-foreground bg-muted border-border";
  };

  return (
    <div className="min-h-[900px] bg-background p-4 flex flex-col gap-4 font-sans text-foreground">
      {/* Header Area */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold tracking-tight">All Claims</h1>
            <Badge variant="secondary" className="font-normal font-mono text-xs">2,137 matching</Badge>
          </div>
          <div className="flex items-center gap-2">
             <Button variant="outline" size="sm" className="h-8">
               <MoreHorizontal className="h-4 w-4 mr-2" />
               Actions
             </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex items-center gap-2 bg-muted/30 p-1.5 rounded-lg border border-border/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search claims..." 
              className="pl-8 h-8 w-[200px] bg-background shadow-none border-border"
            />
          </div>

          <div className="w-px h-5 bg-border mx-1" />

          <div className="flex items-center gap-2 flex-1 overflow-x-auto no-scrollbar pb-0.5">
            {activeFilters.map((filter, i) => (
              <FilterChip
                key={filter.id}
                filter={filter}
                onUpdate={(updates) => updateFilter(filter.id, updates)}
                onRemove={() => removeFilter(filter.id)}
                defaultOpen={filter.values.length === 0 && !filter.range && i === activeFilters.length - 1} // Open new ones automatically
              />
            ))}

            <Popover open={addOpen} onOpenChange={setAddOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-foreground border border-dashed border-border/60 hover:border-border">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add filter
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Filter by..." />
                  <CommandList>
                    <CommandEmpty>No dimension found.</CommandEmpty>
                    <CommandGroup>
                      {Object.entries(FILTER_CONFIG).map(([type, config]) => (
                        <CommandItem
                          key={type}
                          onSelect={() => addFilter(type as FilterType)}
                        >
                          {config.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {activeFilters.length > 0 && (
            <>
              <div className="w-px h-5 bg-border mx-1" />
              <Button variant="ghost" size="sm" className="h-7 text-muted-foreground px-2" onClick={clearAll}>
                Clear
              </Button>
              <Button variant="secondary" size="sm" className="h-7">
                Save view
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Dimmed Table Content */}
      <div className="border rounded-md opacity-60 pointer-events-none select-none transition-opacity duration-500">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"><Checkbox disabled /></TableHead>
              <TableHead>Conf #</TableHead>
              <TableHead>Service Date</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Error Type</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Deadline</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SAMPLE_ROWS.slice(0, 10).map((row, i) => (
              <TableRow key={i}>
                <TableCell><Checkbox disabled /></TableCell>
                <TableCell className="font-mono text-xs">{row.conf}</TableCell>
                <TableCell className="text-muted-foreground">{row.serviceDate}</TableCell>
                <TableCell className="font-medium">{row.client}</TableCell>
                <TableCell>
                  <Badge variant={getStatusBadgeVariant(row.status) as any} className="font-medium">
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[200px] truncate" title={row.errorType}>
                  {row.errorType}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">{row.amount}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn("font-medium capitalize", getDeadlineBadgeColor(row.deadline))}>
                    {row.deadline}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

    </div>
  );
}
