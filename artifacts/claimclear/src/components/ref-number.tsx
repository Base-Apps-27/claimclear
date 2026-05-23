import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClipboardCopy } from "@/hooks/use-clipboard-copy";

interface CopyButtonProps {
  value: string | null | undefined;
  className?: string;
}

/**
 * Standalone copy-icon button that puts `value` on the clipboard
 * (with any leading `#` defensively stripped) and flashes a Check
 * icon for ~1s via the shared `useClipboardCopy` hook (Task #494 —
 * standardizes the chirp across every copy-icon site). Exported
 * separately so adoption sites that already render the invoice text
 * inside a `<Link>` (where nesting an additional interactive Button
 * would be invalid HTML) can drop the copy affordance next to the
 * link instead of inside it.
 *
 * Click handler stops propagation + prevents default so the button
 * can sit inside row-level click targets without triggering them.
 */
export function CopyButton({ value, className = "" }: CopyButtonProps) {
  const { copied, copy } = useClipboardCopy();
  if (!value) return null;
  const payload = String(value).trim().split(/\s+/)[0].replace(/^#+/, "");
  if (!payload) return null;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await copy(payload);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-5 w-5 shrink-0 ${className}`}
      onClick={handleCopy}
      title="Copy invoice number"
      data-testid={`copy-invoice-${payload}`}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-600" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </Button>
  );
}

interface CopyConfirmationButtonProps {
  value: string | null | undefined;
  className?: string;
}

/**
 * Sibling of {@link CopyButton} specialised for MAS portal confirmation
 * numbers (Task #844). Same chirp + clipboard plumbing via
 * `useClipboardCopy`, but the title and testid are semantically
 * "confirmation" so screen-reader users and the test suite can
 * distinguish copy-conf buttons from copy-invoice buttons sitting on
 * the same row.
 *
 * Renders nothing when there's no confirmation number to copy.
 */
export function CopyConfirmationButton({
  value,
  className = "",
}: CopyConfirmationButtonProps) {
  const { copied, copy } = useClipboardCopy();
  if (!value) return null;
  const payload = String(value).trim().split(/\s+/)[0].replace(/^#+/, "");
  if (!payload) return null;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await copy(payload);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keep Enter / Space from bubbling to row-level handlers that
    // would otherwise re-fire the row click on the same key event.
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-5 w-5 shrink-0 ${className}`}
      onClick={handleCopy}
      onKeyDown={onKeyDown}
      title="Copy confirmation number"
      aria-label="Copy confirmation number"
      data-testid={`copy-conf-${payload}`}
    >
      {copied ? (
        <Check className="h-3 w-3 text-green-600" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground" />
      )}
    </Button>
  );
}

interface RefNumberProps {
  value: string | null | undefined;
  className?: string;
  variant?: "chip" | "inline";
  /**
   * Selects which copy affordance to render alongside the number.
   * "invoice" (default) uses {@link CopyButton}; "confirmation" uses
   * {@link CopyConfirmationButton} so sites that pass a portal
   * confirmation number get the right tooltip/testid (Task #844).
   */
  kind?: "invoice" | "confirmation";
  "data-testid"?: string;
}

export function RefNumber({
  value,
  className = "",
  variant = "chip",
  kind = "invoice",
  "data-testid": dataTestId,
}: RefNumberProps) {
  if (!value) return <span className={className}>-</span>;

  const parts = String(value).trim().split(/\s+/);
  const rawFirst = parts[0];
  // Defensively strip a leading `#` so what's displayed (and what
  // CopyButton puts on the clipboard) is the bare identifier. Sites
  // that want a `#` visible render it as a sibling outside the
  // component.
  const invoiceNumber = rawFirst.replace(/^#+/, "");
  const rest = parts.slice(1).join(" ");

  const Copier =
    kind === "confirmation" ? CopyConfirmationButton : CopyButton;

  if (variant === "inline") {
    return (
      <span
        className={`inline-flex items-center gap-1 ${className}`}
        data-testid={dataTestId}
      >
        <span className="font-mono">{invoiceNumber}</span>
        <Copier value={invoiceNumber} />
        {rest && <span className="font-mono text-muted-foreground">{rest}</span>}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      data-testid={dataTestId}
    >
      <span className="font-mono font-bold text-[#1B2A4A] dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800">
        {invoiceNumber}
      </span>
      <Copier value={invoiceNumber} />
      {rest && <span className="font-mono text-muted-foreground">{rest}</span>}
    </span>
  );
}
