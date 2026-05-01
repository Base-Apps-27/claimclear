import React, { useState, useMemo } from "react";
import { 
  Filter, 
  Search, 
  Check, 
  CalendarIcon, 
  DollarSign, 
  Clock, 
  AlertCircle,
  FileCheck,
  Activity,
  X
} from "lucide-react";
import { STATUSES, OUTCOMES, ERROR_TYPES, DEADLINES, SAMPLE_ROWS } from "./_shared/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type FilterCategory = "status" | "outcome" | "errorType" | "serviceDate" | "createdDate" | "amount" | "deadline";

interface FilterState {
  status: string[];
  outcome: string[];
  errorType: string[];
  deadline: string[];
  serviceDate: { start?: string; end?: string; preset?: string };
  createdDate: { start?: string; end?: string; preset?: string };
  amount: { min?: string; max?: string };
}

const CATEGORIES: { id: FilterCategory; label: string; icon: React.ElementType }[] = [
  { id: "status", label: "Status", icon: Activity },
  { id: "outcome", label: "Outcome", icon: FileCheck },
  { id: "errorType", label: "Error Type", icon: AlertCircle },
  { id: "deadline", label: "Filing Deadline", icon: Clock },
  { id: "serviceDate", label: "Service Date", icon: CalendarIcon },
  { id: "createdDate", label: "Created Date", icon: CalendarIcon },
  { id: "amount", label: "Amount", icon: DollarSign },
];

export function FacetedRail() {
  const [open, setOpen] = useState(true);
  const [activeCategory, setActiveCategory] = useState<FilterCategory>("status");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Initial realistic state
  const [filters, setFilters] = useState<FilterState>({
    status: ["Needs Review", "Needs Evidence"],
    outcome: [],
    errorType: ["2"], // GPS Pickup Too Far
    deadline: [],
    serviceDate: {},
    createdDate: {},
    amount: { min: "50", max: "" }
  });

  const getAppliedCount = (categoryId?: FilterCategory) => {
    if (categoryId) {
      const val = filters[categoryId];
      if (Array.isArray(val)) return val.length;
      if (typeof val === "object" && val !== null) {
        return Object.values(val).filter(v => v !== "" && v !== undefined).length;
      }
      return 0;
    }
    
    // Total count
    return Object.values(filters).reduce((acc, val) => {
      if (Array.isArray(val)) return acc + val.length;
      if (typeof val === "object" && val !== null) {
        return acc + Object.values(val).filter(v => v !== "" && v !== undefined).length > 0 ? 1 : 0;
      }
      return acc;
    }, 0);
  };

  const handleToggleArray = (category: keyof FilterState, value: string) => {
    setFilters(prev => {
      const arr = prev[category] as string[];
      if (arr.includes(value)) {
        return { ...prev, [category]: arr.filter(v => v !== value) };
      }
      return { ...prev, [category]: [...arr, value] };
    });
  };

  const renderOptions = () => {
    switch (activeCategory) {
      case "status":
      case "outcome": {
        const options = activeCategory === "status" ? STATUSES : OUTCOMES;
        const filteredOptions = options.filter(o => o.toLowerCase().includes(searchQuery.toLowerCase()));
        
        return (
          <div className="flex flex-col h-full">
            <div className="p-3 border-b sticky top-0 bg-popover z-10 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder={`Filter ${activeCategory === "status" ? "statuses" : "outcomes"}...`}
                  className="pl-9 h-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-3">
                {filteredOptions.map((opt) => (
                  <div key={opt} className="flex items-center space-x-3">
                    <Checkbox 
                      id={`opt-${opt}`} 
                      checked={(filters[activeCategory] as string[]).includes(opt)}
                      onCheckedChange={() => handleToggleArray(activeCategory, opt)}
                    />
                    <Label htmlFor={`opt-${opt}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer">
                      {opt}
                    </Label>
                  </div>
                ))}
                {filteredOptions.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-4">No results found.</div>
                )}
              </div>
            </ScrollArea>
          </div>
        );
      }
      case "errorType": {
        const filteredOptions = ERROR_TYPES.filter(o => o.name.toLowerCase().includes(searchQuery.toLowerCase()));
        
        // Sort selected first
        const selected = filteredOptions.filter(o => filters.errorType.includes(o.id));
        const unselected = filteredOptions.filter(o => !filters.errorType.includes(o.id));
        const sortedOptions = [...selected, ...unselected];

        return (
          <div className="flex flex-col h-full">
            <div className="p-3 border-b sticky top-0 bg-popover z-10 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Filter error types..."
                  className="pl-9 h-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-3">
                {sortedOptions.map((opt) => (
                  <div key={opt.id} className="flex items-center space-x-3">
                    <Checkbox 
                      id={`err-${opt.id}`} 
                      checked={filters.errorType.includes(opt.id)}
                      onCheckedChange={() => handleToggleArray("errorType", opt.id)}
                    />
                    <Label 
                      htmlFor={`err-${opt.id}`} 
                      className={cn(
                        "text-sm font-medium leading-none cursor-pointer",
                        opt.italic && "italic text-muted-foreground"
                      )}
                    >
                      {opt.name}
                    </Label>
                  </div>
                ))}
                {sortedOptions.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-4">No results found.</div>
                )}
              </div>
            </ScrollArea>
          </div>
        );
      }
      case "deadline": {
        return (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b shrink-0">
              <h4 className="text-sm font-medium">Select filing deadline</h4>
            </div>
            <div className="p-3 space-y-3">
              {DEADLINES.map((opt) => (
                <div key={opt.value} className="flex items-center space-x-3">
                  <Checkbox 
                    id={`dl-${opt.value}`} 
                    checked={filters.deadline.includes(opt.value)}
                    onCheckedChange={() => handleToggleArray("deadline", opt.value)}
                  />
                  <Label htmlFor={`dl-${opt.value}`} className="text-sm font-medium cursor-pointer">
                    {opt.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        );
      }
      case "serviceDate":
      case "createdDate": {
        const dateType = activeCategory;
        const currentDates = filters[dateType];
        
        return (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b shrink-0">
              <h4 className="text-sm font-medium">Custom range</h4>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Start date</Label>
                  <Input 
                    type="date" 
                    value={currentDates.start || ""}
                    onChange={(e) => setFilters(p => ({ ...p, [dateType]: { ...p[dateType], start: e.target.value } }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">End date</Label>
                  <Input 
                    type="date" 
                    value={currentDates.end || ""}
                    onChange={(e) => setFilters(p => ({ ...p, [dateType]: { ...p[dateType], end: e.target.value } }))}
                  />
                </div>
              </div>
              
              <div className="pt-4 border-t space-y-2">
                <Label className="text-xs text-muted-foreground">Quick presets</Label>
                <div className="flex flex-wrap gap-2">
                  {["Last 7 days", "Last 30 days", "This month", "Last month"].map(preset => (
                    <Badge 
                      key={preset} 
                      variant={currentDates.preset === preset ? "default" : "outline"}
                      className="cursor-pointer font-normal rounded-sm"
                      onClick={() => setFilters(p => ({ ...p, [dateType]: { preset, start: "", end: "" } }))}
                    >
                      {preset}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      }
      case "amount": {
        return (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b shrink-0">
              <h4 className="text-sm font-medium">Amount range</h4>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Min ($)</Label>
                  <Input 
                    type="number" 
                    placeholder="0.00"
                    value={filters.amount.min || ""}
                    onChange={(e) => setFilters(p => ({ ...p, amount: { ...p.amount, min: e.target.value } }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Max ($)</Label>
                  <Input 
                    type="number" 
                    placeholder="No limit"
                    value={filters.amount.max || ""}
                    onChange={(e) => setFilters(p => ({ ...p, amount: { ...p.amount, max: e.target.value } }))}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  const totalApplied = getAppliedCount();

  const clearAll = () => {
    setFilters({
      status: [],
      outcome: [],
      errorType: [],
      deadline: [],
      serviceDate: {},
      createdDate: {},
      amount: {}
    });
  };

  return (
    <div className="min-h-[900px] bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6 relative">
        
        {/* Header Strip */}
        <div className="flex items-center justify-between bg-card border rounded-lg p-3 shadow-sm relative z-20">
          <div className="flex items-center gap-4">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search claims..." className="pl-9 h-9 bg-muted/50 border-transparent focus-visible:bg-transparent focus-visible:border-input" />
            </div>
            <span className="text-sm text-muted-foreground font-medium">2,137 matching</span>
          </div>

          <div className="flex items-center gap-2">
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className={cn("h-9 gap-2", totalApplied > 0 && "border-primary/30 bg-primary/5")}
                >
                  <Filter className="h-4 w-4" />
                  Filter
                  {totalApplied > 0 && (
                    <Badge variant="secondary" className="ml-1 px-1.5 py-0 min-w-5 h-5 rounded-full flex items-center justify-center bg-primary/20 text-primary hover:bg-primary/20 font-semibold border-0">
                      {totalApplied}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[640px] p-0 shadow-lg" align="end" sideOffset={8}>
                <div className="flex h-[420px] overflow-hidden">
                  
                  {/* Left Pane - Categories Rail */}
                  <div className="w-[180px] bg-muted/30 border-r flex flex-col">
                    <div className="p-3 border-b">
                      <h3 className="text-sm font-semibold">Filters</h3>
                    </div>
                    <ScrollArea className="flex-1">
                      <div className="p-2 space-y-1">
                        {CATEGORIES.map(category => {
                          const count = getAppliedCount(category.id);
                          const isActive = activeCategory === category.id;
                          const Icon = category.icon;
                          
                          return (
                            <button
                              key={category.id}
                              onClick={() => {
                                setActiveCategory(category.id);
                                setSearchQuery(""); // Reset search when switching categories
                              }}
                              className={cn(
                                "w-full flex items-center justify-between px-2.5 py-2 text-sm rounded-md transition-colors text-left",
                                isActive ? "bg-background shadow-sm border font-medium text-foreground" : "text-muted-foreground hover:bg-muted/80 hover:text-foreground border border-transparent"
                              )}
                            >
                              <div className="flex items-center gap-2.5">
                                <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground/70")} />
                                <span>{category.label}</span>
                              </div>
                              {count > 0 && (
                                <span className={cn(
                                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                                  isActive ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
                                )}>
                                  {count}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Right Pane - Options */}
                  <div className="flex-1 bg-background flex flex-col">
                    {renderOptions()}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-3 border-t bg-muted/10">
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={clearAll}>
                    Clear all
                  </Button>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground mr-2">{totalApplied} applied</span>
                    <Button size="sm" onClick={() => setOpen(false)}>Done</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Dimming overlay when popover is open */}
        {open && (
          <div className="absolute inset-0 z-10 bg-background/40 backdrop-blur-[1px] pointer-events-none rounded-lg -m-4 p-4" />
        )}

        {/* Table Content */}
        <div className={cn("bg-card border rounded-lg overflow-hidden transition-opacity duration-300", open ? "opacity-40" : "opacity-100")}>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Claim ID</th>
                <th className="px-4 py-3 text-left font-medium">Service Date</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Error Type</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 text-left font-medium">Deadline</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SAMPLE_ROWS.slice(0, 10).map((row, i) => (
                <tr key={i} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{row.conf}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.serviceDate}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="font-normal bg-background">
                      {row.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate" title={row.errorType}>
                    {row.errorType}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{row.amount}</td>
                  <td className="px-4 py-3">
                    {row.deadline === "today" ? (
                      <span className="inline-flex items-center gap-1.5 text-destructive font-medium text-xs">
                        <span className="size-1.5 rounded-full bg-destructive" />
                        Today
                      </span>
                    ) : row.deadline === "soon" ? (
                      <span className="inline-flex items-center gap-1.5 text-amber-600 font-medium text-xs">
                        <span className="size-1.5 rounded-full bg-amber-500" />
                        Soon
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground font-medium text-xs">
                        <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                        OK
                      </span>
                    )}
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
