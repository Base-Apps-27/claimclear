// Render coverage for the sibling-detection prompt.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SiblingDuplicatePrompt,
  SiblingDuplicatePromptView,
} from "./sibling-prompt";

void React;

function render(node: React.ReactElement): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  );
}

test("SiblingDuplicatePrompt renders the prompt with the primary conf number + CTA", () => {
  const html = render(
    <SiblingDuplicatePrompt
      legId={4321}
      invoiceGroupId={10}
      primaryClaimId={1234}
      primaryConfNumber="CLM-1234"
      primaryErrorTypeName="Eligibility lapse"
    />,
  );
  assert.match(html, /data-testid="sop-sibling-prompt"/);
  assert.match(html, /data-testid="sop-sibling-prompt-btn"/);
  assert.match(html, /Looks like a sibling duplicate/);
  assert.match(html, /CLM-1234/);
  // Error-type name surfaces in parens when supplied.
  assert.match(html, /\(Eligibility lapse\)/);
  // The CTA carries the conf number so the operator knows what they're
  // about to mark this leg against.
  assert.match(html, /Mark as sibling duplicate of CLM-1234/);
});

test("SiblingDuplicatePrompt: optional errorTypeName omitted gracefully", () => {
  const html = render(
    <SiblingDuplicatePrompt
      legId={4321}
      invoiceGroupId={null}
      primaryClaimId={1234}
      primaryConfNumber="CLM-1234"
      primaryErrorTypeName={null}
    />,
  );
  assert.match(html, /CLM-1234/);
  assert.equal(html.includes("()"), false);
  assert.equal(html.includes("(null)"), false);
});

test("SiblingDuplicatePrompt: amber styling so it reads as a 'heads up' not an error", () => {
  const html = render(
    <SiblingDuplicatePrompt
      legId={1}
      primaryClaimId={2}
      primaryConfNumber="CLM-2"
    />,
  );
  assert.match(html, /bg-amber-50/);
  assert.match(html, /border-amber-200/);
  assert.equal(html.includes("destructive"), false);
});

function cardOpenTag(html: string): string {
  const m = html.match(/<div[^>]*data-testid="sop-sibling-prompt"[^>]*>/);
  if (!m) throw new Error("sop-sibling-prompt card open tag not found");
  return m[0];
}

test("SiblingDuplicatePromptView: idle — card is interactive (Guard #10 baseline)", () => {
  const html = renderToStaticMarkup(
    <SiblingDuplicatePromptView
      isPending={false}
      onClick={() => {}}
      primaryConfNumber="CLM-9"
    />,
  );
  const card = cardOpenTag(html);
  assert.match(card, /data-pending="false"/);
  assert.match(card, /aria-busy="false"/);
  assert.equal(/\bpointer-events-none\b/.test(card), false);
  assert.equal(/\bopacity-60\b/.test(card), false);
  const idleBtn = html.match(/<button[^>]*sop-sibling-prompt-btn[^>]*>/);
  assert.ok(idleBtn, "expected the CTA button to be rendered");
  assert.equal(/\sdisabled(=|\s|>)/.test(idleBtn![0]), false);
});

test("SiblingDuplicatePromptView: pending — entire card is disabled (Guard #10)", () => {
  const html = renderToStaticMarkup(
    <SiblingDuplicatePromptView
      isPending={true}
      onClick={() => {}}
      primaryConfNumber="CLM-9"
    />,
  );
  // Whole-surface lock: the Card itself carries the busy/disabled signals
  // so the entire prompt (not just the CTA) becomes non-interactive.
  const card = cardOpenTag(html);
  assert.match(card, /data-pending="true"/);
  assert.match(card, /aria-busy="true"/);
  assert.match(card, /\bpointer-events-none\b/);
  assert.match(card, /\bopacity-60\b/);
  const pendingBtn = html.match(/<button[^>]*sop-sibling-prompt-btn[^>]*>/);
  assert.ok(pendingBtn, "expected the CTA button to be rendered");
  assert.match(pendingBtn![0], /\sdisabled(=|\s|>)/);
  assert.match(html, /animate-spin/);
});

test("SiblingDuplicatePromptView: click handler is wired to the CTA", () => {
  let clicks = 0;
  const rendered = SiblingDuplicatePromptView({
    isPending: false,
    onClick: () => {
      clicks += 1;
    },
    primaryConfNumber: "CLM-9",
  }) as React.ReactElement;

  function findOnClick(node: unknown): (() => void) | null {
    if (!node || typeof node !== "object") return null;
    const el = node as { props?: Record<string, unknown> };
    const props = el.props ?? {};
    if (
      props["data-testid"] === "sop-sibling-prompt-btn" &&
      typeof props.onClick === "function"
    ) {
      return props.onClick as () => void;
    }
    const children = props.children;
    if (Array.isArray(children)) {
      for (const c of children) {
        const f = findOnClick(c);
        if (f) return f;
      }
    } else if (children) {
      return findOnClick(children);
    }
    return null;
  }

  const handler = findOnClick(rendered);
  assert.ok(handler, "CTA onClick handler must be wired through to the Button");
  handler!();
  handler!();
  assert.equal(clicks, 2);
});
