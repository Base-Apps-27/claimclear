import { CheckCircle2, CircleDashed, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Stage = {
  key: string;
  label: string;
  desc?: string;
  done?: number;
  total?: number;
};

export type StageStepperProps = {
  stages: Stage[];
  currentKey: string;
  variant?: "claim" | "group";
  className?: string;
};

const VARIANT_STYLES = {
  claim: {
    activeBg: "bg-blue-50 dark:bg-blue-950/30",
    activeFg: "text-blue-700 dark:text-blue-300",
    border: "border-border",
  },
  group: {
    activeBg: "bg-purple-50 dark:bg-purple-950/30",
    activeFg: "text-purple-700 dark:text-purple-300",
    border: "border-purple-200 dark:border-purple-900",
  },
} as const;

export function StageStepper({ stages, currentKey, variant = "claim", className }: StageStepperProps) {
  const activeIdx = Math.max(0, stages.findIndex((s) => s.key === currentKey));
  const styles = VARIANT_STYLES[variant];

  return (
    <div
      className={cn(
        "rounded-md border bg-card overflow-hidden",
        variant === "group" ? "border-purple-200 dark:border-purple-900" : "border-border",
        className,
      )}
      data-testid="stage-stepper"
    >
      <div className="flex">
        {stages.map((s, i) => {
          const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
          return (
            <div
              key={s.key}
              data-testid={`stage-${s.key}`}
              data-state={state}
              className={cn(
                "flex-1 px-3 py-2.5 flex items-center gap-2.5 relative min-w-0",
                state === "active" && cn(styles.activeBg, styles.activeFg),
                state === "done" && "bg-card text-foreground",
                state === "todo" && "bg-muted text-muted-foreground",
                i < stages.length - 1 && "border-r border-border",
              )}
            >
              {state === "done" ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-green-600" />
              ) : state === "active" ? (
                <CircleDashed className="w-4 h-4 flex-shrink-0" />
              ) : (
                <div className="w-4 h-4 rounded-full border border-border flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide opacity-65 flex items-center gap-1.5">
                  <span>Step {i + 1}</span>
                  {variant === "group" && typeof s.done === "number" && typeof s.total === "number" && (
                    <span className="font-mono font-semibold opacity-85">
                      {s.done}/{s.total}
                    </span>
                  )}
                </div>
                <div className="text-xs font-semibold truncate">{s.label}</div>
                {s.desc && state === "active" && (
                  <div className="text-[10px] truncate opacity-80">{s.desc}</div>
                )}
              </div>
              {i < stages.length - 1 && (
                <ChevronRight className="w-3 h-3 absolute -right-1.5 top-1/2 -translate-y-1/2 z-10 text-muted-foreground bg-background" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
