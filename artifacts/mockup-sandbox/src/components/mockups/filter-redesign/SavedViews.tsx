import React, { useState } from "react";
import { Search, Filter, ChevronDown, ChevronUp, X, Check } from "lucide-react";
import { STATUSES, OUTCOMES, ERROR_TYPES, DEADLINES, SAMPLE_ROWS } from "./_shared/data";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const VIEWS = [
  { id: "v1", name: "My queue today", desc: "Status: Needs Review · Deadline: Today" },
  { id: "v2", name: "Filed this week", desc: "Created: Past 7 days" },
  { id: "v3", name: "Awaiting carrier response", desc: "Status: Awaiting Response" },
  { id: "v4", name: "GPS issues — investigating", desc: "Error Type: GPS Deviation, GPS Pickup..." },
  { id: "v5", name: "Unassigned error type", desc: "Error Type: Unassigned" },
];

export function SavedViews() {
  const [open, setOpen] = useState(true);
  const [activeView, setActiveView] = useState("v1");

  // Filters state
  const [statuses, setStatuses] = useState<Set<string>>(new Set(["Needs Review"]));
  const [outcomes, setOutcomes] = useState<Set<string>>(new Set());
  const [errorTypes, setErrorTypes] = useState<Set<string>>(new Set());
  const [deadline, setDeadline] = useState("today");
  
  // Accordion state
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["status"]));

  const toggleSection = (id: string) => {
    const next = new Set(expandedSections);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedSections(next);
  };

  const applyView = (id: string) => {
    setActiveView(id);
    if (id === "v1") {
      setStatuses(new Set(["Needs Review"]));
      setDeadline("today");
      setErrorTypes(new Set());
      setOutcomes(new Set());
    } else {
      setStatuses(new Set());
      setDeadline("all");
      setErrorTypes(new Set());
      setOutcomes(new Set());
    }
  };

  return (
    <div className="min-h-[900px] bg-background p-4 flex flex-col font-sans">
      {/* Header Strip */}
      <div className="flex items-center justify-between border-b pb-4 mb-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search claims..." className="w-[300px] pl-8" />
          </div>
          <span className="text-sm text-muted-foreground">2,137 matching</span>
        </div>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("gap-2", (statuses.size > 0 || errorTypes.size > 0 || outcomes.size > 0 || deadline !== 'all') && "border-primary bg-primary/5")}>
              <Filter className="h-4 w-4" />
              Filter
              {(statuses.size > 0 || errorTypes.size > 0) && (
                <Badge variant="secondary" className="ml-1 rounded-sm px-1.5 py-0.5 text-[10px] leading-none">
                  {statuses.size + errorTypes.size + outcomes.size + (deadline !== 'all' ? 1 : 0)}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[480px] p-0" align="end" sideOffset={8}>
            {/* Views Section */}
            <div className="p-4 bg-muted/30">
              <h3 className="text-sm font-semibold mb-3">Saved Views</h3>
              <div className="flex flex-wrap gap-2">
                {VIEWS.map((v) => (
                  <Button
                    key={v.id}
                    variant={activeView === v.id ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs rounded-full"
                    onClick={() => applyView(v.id)}
                  >
                    {v.name}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" className="h-7 text-xs rounded-full border border-dashed border-border text-muted-foreground">
                  + Save current as view
                </Button>
              </div>
              {activeView && (
                <div className="mt-3 text-xs text-muted-foreground flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-primary" />
                  {VIEWS.find(v => v.id === activeView)?.desc}
                </div>
              )}
            </div>

            <Separator />

            {/* Refine Section */}
            <ScrollArea className="h-[400px]">
              <div className="p-2">
                <div className="px-2 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Refine</div>
                
                {/* Status Accordion */}
                <Collapsible open={expandedSections.has("status")} onOpenChange={() => toggleSection("status")}>
                  <CollapsibleTrigger className="flex w-full items-center justify-between p-2 hover:bg-muted/50 rounded-md transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Status</span>
                      {statuses.size > 0 && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{statuses.size}</Badge>
                          <span className="text-xs text-muted-foreground hidden sm:inline-block">
                            {Array.from(statuses)[0]} {statuses.size > 1 && `+${statuses.size - 1} more`}
                          </span>
                        </div>
                      )}
                    </div>
                    {expandedSections.has("status") ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-2 pb-3 pt-1">
                    <div className="mb-2">
                      <Input placeholder="Filter statuses..." className="h-7 text-xs" />
                    </div>
                    <div className="space-y-2 max-h-[160px] overflow-y-auto pr-2">
                      {STATUSES.map(s => (
                        <label key={s} className="flex items-center gap-2 text-sm cursor-pointer group">
                          <Checkbox 
                            checked={statuses.has(s)} 
                            onCheckedChange={(c) => {
                              const next = new Set(statuses);
                              if (c) next.add(s); else next.delete(s);
                              setStatuses(next);
                            }} 
                          />
                          <span className="group-hover:text-foreground/80">{s}</span>
                        </label>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Separator className="my-1" />

                {/* Error Type Accordion */}
                <Collapsible open={expandedSections.has("errorType")} onOpenChange={() => toggleSection("errorType")}>
                  <CollapsibleTrigger className="flex w-full items-center justify-between p-2 hover:bg-muted/50 rounded-md transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Error Type</span>
                      {errorTypes.size > 0 && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{errorTypes.size}</Badge>
                          <span className="text-xs text-muted-foreground hidden sm:inline-block">
                            {Array.from(errorTypes)[0]} {errorTypes.size > 1 && `+${errorTypes.size - 1} more`}
                          </span>
                        </div>
                      )}
                    </div>
                    {expandedSections.has("errorType") ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-2 pb-3 pt-1">
                    <div className="mb-2">
                      <Input placeholder="Filter error types..." className="h-7 text-xs" />
                    </div>
                    <div className="space-y-2 max-h-[160px] overflow-y-auto pr-2">
                      {ERROR_TYPES.map(e => (
                        <label key={e.id} className="flex items-start gap-2 text-sm cursor-pointer group">
                          <Checkbox 
                            className="mt-0.5"
                            checked={errorTypes.has(e.name)} 
                            onCheckedChange={(c) => {
                              const next = new Set(errorTypes);
                              if (c) next.add(e.name); else next.delete(e.name);
                              setErrorTypes(next);
                            }} 
                          />
                          <span className={cn("leading-tight group-hover:text-foreground/80", e.italic && "italic text-muted-foreground")}>{e.name}</span>
                        </label>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
                
                <Separator className="my-1" />

                {/* Deadline Accordion */}
                <Collapsible open={expandedSections.has("deadline")} onOpenChange={() => toggleSection("deadline")}>
                  <CollapsibleTrigger className="flex w-full items-center justify-between p-2 hover:bg-muted/50 rounded-md transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Filing Deadline</span>
                      {deadline !== "all" && (
                        <span className="text-xs text-muted-foreground">
                          {DEADLINES.find(d => d.value === deadline)?.label}
                        </span>
                      )}
                    </div>
                    {expandedSections.has("deadline") ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-2 pb-3 pt-1">
                    <div className="space-y-2">
                      {DEADLINES.map(d => (
                        <label key={d.value} className="flex items-center gap-2 text-sm cursor-pointer group">
                          <input 
                            type="radio" 
                            name="deadline"
                            className="accent-primary"
                            checked={deadline === d.value}
                            onChange={() => setDeadline(d.value)}
                          />
                          <span className="group-hover:text-foreground/80">{d.label}</span>
                        </label>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </ScrollArea>

            <Separator />
            <div className="p-3 flex items-center justify-between bg-muted/10">
              <Button variant="ghost" size="sm" className="text-muted-foreground h-8" onClick={() => {
                setStatuses(new Set());
                setErrorTypes(new Set());
                setOutcomes(new Set());
                setDeadline("all");
                setActiveView("");
              }}>
                Clear all
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8">Save as view...</Button>
                <Button size="sm" className="h-8" onClick={() => setOpen(false)}>Done</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Dimmed Table Context */}
      <div className={cn("flex-1 overflow-auto transition-opacity", open ? "opacity-30 pointer-events-none" : "opacity-100")}>
        <div className="rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="p-3 font-medium text-muted-foreground">Conf #</th>
                <th className="p-3 font-medium text-muted-foreground">Service Date</th>
                <th className="p-3 font-medium text-muted-foreground">Status</th>
                <th className="p-3 font-medium text-muted-foreground">Error Type</th>
                <th className="p-3 font-medium text-muted-foreground text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE_ROWS.slice(0, 10).map((row, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3 font-mono text-xs">{row.conf}</td>
                  <td className="p-3">{row.serviceDate}</td>
                  <td className="p-3">
                    <Badge variant={row.status === "Needs Review" ? "default" : "outline"} className="font-normal text-[11px] h-5 px-2">
                      {row.status}
                    </Badge>
                  </td>
                  <td className="p-3 max-w-[200px] truncate">{row.errorType}</td>
                  <td className="p-3 text-right">{row.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
