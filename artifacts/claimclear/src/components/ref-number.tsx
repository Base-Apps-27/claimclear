import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RefNumberProps {
  value: string | null | undefined;
  className?: string;
}

export function RefNumber({ value, className = "" }: RefNumberProps) {
  const [copied, setCopied] = useState(false);

  if (!value) return <span className={className}>-</span>;

  const parts = value.trim().split(/\s+/);
  const invoiceNumber = parts[0];
  const rest = parts.slice(1).join(" ");

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(invoiceNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="font-mono font-bold text-[#1B2A4A] dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800">
        {invoiceNumber}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0"
        onClick={handleCopy}
        title="Copy invoice number"
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-600" />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" />
        )}
      </Button>
      {rest && <span className="font-mono text-muted-foreground">{rest}</span>}
    </span>
  );
}
