import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { StatusPillForRow, StatusPillForStatus } from "./status-pill";
import { TONE_STYLE } from "./tone";
import { TooltipProvider } from "@/components/ui/tooltip";

// Some statuses (e.g. "Denied", "On Hold", "Processed") have a glossary
// description, so the pill wraps itself in a Radix Tooltip. Radix needs
// a Provider in scope even for static SSR render, so the helper below
// supplies one.
function render(node: ReactElement) {
  return renderToStaticMarkup(<TooltipProvider>{node}</TooltipProvider>);
}

// Wave C T006-B. `StatusPillForRow` derives tone from the canonical
// `disposition` column while keeping the user-facing label keyed to
// `status` (the glossary in @workspace/vocab is status-keyed). These
// tests pin the precedence and the legacy entrypoint behavior so the
// migration of further row-context callers stays safe.

function bgFor(tone: keyof typeof TONE_STYLE) {
  return TONE_STYLE[tone].bg;
}

test("StatusPillForRow — tone follows disposition, label follows status", () => {
  // status alone would map to red (Denied); disposition wins green.
  const html = render(
    <StatusPillForRow row={{ disposition: "verdict_approved", status: "Denied" }} />,
  );
  assert.ok(
    html.includes(bgFor("green")),
    `expected green background; got: ${html}`,
  );
  // Label is the human form of the status string ("Denied"), not the disposition.
  assert.ok(html.includes("Denied"), `expected status label in markup; got: ${html}`);
});

test("StatusPillForRow — `unclassified` disposition falls through to status ladder", () => {
  // Same fallback rule as deriveLegSubStatus: writers that haven't
  // synced disposition yet still render a sensible tone via status.
  const html = render(
    <StatusPillForRow row={{ disposition: "unclassified", status: "Denied" }} />,
  );
  assert.ok(
    html.includes(bgFor("red")),
    `expected red fallback background; got: ${html}`,
  );
});

test("StatusPillForRow — missing disposition falls through to status ladder", () => {
  const html = render(<StatusPillForRow row={{ status: "On Hold" }} />);
  assert.ok(
    html.includes(bgFor("amber")),
    `expected amber background; got: ${html}`,
  );
});

test("StatusPillForStatus — legacy entrypoint still keyed off status", () => {
  // Status-only callsites (URL filter pills, group rows w/o disposition,
  // tab labels) keep using this entrypoint and stay correct by definition.
  const html = render(<StatusPillForStatus status="Processed" />);
  assert.ok(
    html.includes(bgFor("purple")),
    `expected purple background for Processed; got: ${html}`,
  );
});
