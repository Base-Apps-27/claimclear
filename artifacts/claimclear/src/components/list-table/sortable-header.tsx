import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SortableHeaderProps {
  label: React.ReactNode;
  sortKey: string;
  currentSort: string;
  currentDir: "asc" | "desc" | "";
  onSort: (key: string, dir: "asc" | "desc" | "") => void;
  className?: string;
}

export function SortableHeader({ label, sortKey, currentSort, currentDir, onSort, className }: SortableHeaderProps) {
  const isActive = currentSort === sortKey;

  const handleClick = () => {
    if (!isActive) {
      onSort(sortKey, "asc");
    } else if (currentDir === "asc") {
      onSort(sortKey, "desc");
    } else {
      onSort("", "");
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex items-center gap-1 group select-none cursor-pointer hover:text-foreground transition-colors w-full text-left",
        isActive ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {label}
      <span className={cn("flex-shrink-0 transition-opacity", isActive ? "opacity-100" : "opacity-0 group-hover:opacity-40")}>
        {isActive && currentDir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : isActive && currentDir === "desc" ? (
          <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3" />
        )}
      </span>
    </button>
  );
}
