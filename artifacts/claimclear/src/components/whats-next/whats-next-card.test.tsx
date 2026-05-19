// Task #769 — UI + derivation coverage for the WhatsNextCard's
// early-Reply behaviour.
//
// The card's row-visibility is now driven by `deriveWhatsNextSurface`
// (a pure helper in `whats-next-derivation.ts`) so the component and
// these tests share one source of truth. We exercise three behaviours
// the task spec calls out:
//
//   (a) Reply option visible + clickable when `hasOperatorReply` is
//       true and no verdicts exist.
//   (b) Reply option visible but disabled (with the tooltip) when no
//       operator reply exists and no verdicts exist.
//   (c) Re-attest / Close-out still hidden until all legs have a
//       verdict (the verdict gate on those two paths is preserved).
//
// Render assertions use `renderToStaticMarkup` against the exported
// `ReplyOptionRow` — the same harness pattern the rest of the page's
// tests use, no jsdom dependency.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ReplyOptionRow } from "./reply-option-row";
import {
  deriveVerdictMix,
  deriveWhatsNextSurface,
} from "@/lib/whats-next-derivation";
import type {
  ClaimResponse,
  ClaimVerdictResponse,
  InvoiceGroupResponse,
} from "@workspace/api-client-react";

void React;

// ── Fixtures ───────────────────────────────────────────────────────

function leg(opts: {
  id: number;
  verdict?: { outcome: string; source: string } | null;
}): ClaimResponse {
  const r: Partial<ClaimResponse> = {
    id: opts.id,
    confNumber: `C${opts.id}`,
    status: "Awaiting" as ClaimResponse["status"],
    outcome: "" as ClaimResponse["outcome"],
    includedInDispute: true,
    sopOutcome: "portal_dispute" as ClaimResponse["sopOutcome"],
    duplicateOfClaimId: null,
    latestVerdict: opts.verdict
      ? ({
          id: 1,
          claimId: opts.id,
          source: opts.verdict.source,
          outcome: opts.verdict.outcome,
          createdAt: new Date().toISOString(),
        } as ClaimVerdictResponse)
      : null,
    latestDraft: null,
  };
  return r as ClaimResponse;
}

function group(overrides: Partial<InvoiceGroupResponse> = {}): InvoiceGroupResponse {
  return {
    id: 1,
    invoiceNumber: "INV-1",
    awaitingPayorAgainAt: null,
    ...overrides,
  } as InvoiceGroupResponse;
}

// ── (c) Verdict gate is preserved for Re-attest and Close-out ──────

test("deriveWhatsNextSurface: Re-attest stays hidden until every leg has a verdict (mixed-partial)", () => {
  const derivation = deriveVerdictMix([
    leg({ id: 1, verdict: { outcome: "Approved", source: "operator_confirmed" } }),
    leg({ id: 2 }), // pending
  ]);
  const s = deriveWhatsNextSurface(derivation, group());
  // showReattest is the *eligibility* flag — the card guards rendering
  // on `decisionReady && showReattest`. With a pending leg in the mix,
  // `decisionReady` must be false, so the Re-attest row never renders.
  assert.equal(derivation.allLegsHaveVerdict, false);
  assert.equal(s.decisionReady, false);
});

test("deriveWhatsNextSurface: Close-out stays hidden until every leg has a verdict", () => {
  const derivation = deriveVerdictMix([
    leg({ id: 1, verdict: { outcome: "Denied", source: "operator_confirmed" } }),
    leg({ id: 2 }), // pending
  ]);
  const s = deriveWhatsNextSurface(derivation, group());
  assert.equal(s.showCloseOut, false, "mixed partial coverage isn't all_denied");
  assert.equal(s.decisionReady, false);
});

test("deriveWhatsNextSurface: Re-attest renders once every leg is approved", () => {
  const derivation = deriveVerdictMix([
    leg({ id: 1, verdict: { outcome: "Approved", source: "operator_confirmed" } }),
    leg({ id: 2, verdict: { outcome: "Approved", source: "operator_confirmed" } }),
  ]);
  const s = deriveWhatsNextSurface(derivation, group());
  assert.equal(s.showReattest, true);
  assert.equal(s.decisionReady, true);
});

test("deriveWhatsNextSurface: Close-out renders once every leg is denied", () => {
  const derivation = deriveVerdictMix([
    leg({ id: 1, verdict: { outcome: "Denied", source: "operator_confirmed" } }),
    leg({ id: 2, verdict: { outcome: "Denied", source: "operator_confirmed" } }),
  ]);
  const s = deriveWhatsNextSurface(derivation, group());
  assert.equal(s.showCloseOut, true);
  assert.equal(s.decisionReady, true);
});

// ── (a)/(b) Reply option decouples from the verdict gate ───────────

test("deriveWhatsNextSurface: Reply row is available with zero verdicts (early-Reply state)", () => {
  const derivation = deriveVerdictMix([leg({ id: 1 }), leg({ id: 2 })]);
  const s = deriveWhatsNextSurface(derivation, group());
  // Decoupled — `showReply` does NOT require allLegsHaveVerdict.
  assert.equal(derivation.mix, "no_verdicts_yet");
  assert.equal(s.showReply, true);
  // …but the card header still reads calm — early-Reply doesn't wake
  // the card up.
  assert.equal(s.decisionReady, false);
  assert.equal(s.showReattest, false);
  assert.equal(s.showCloseOut, false);
});

test("deriveWhatsNextSurface: Reply row hides once the group is already awaiting-payor-again", () => {
  const derivation = deriveVerdictMix([leg({ id: 1 })]);
  const s = deriveWhatsNextSurface(
    derivation,
    group({ awaitingPayorAgainAt: "2026-05-19T10:00:00Z" }),
  );
  assert.equal(s.showReply, false);
  assert.equal(s.decisionReady, false);
});

// ── ReplyOptionRow render contract ─────────────────────────────────

function renderReply(hasOperatorReply: boolean, disabled = false): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ReplyOptionRow
        hasOperatorReply={hasOperatorReply}
        onClick={() => {}}
        disabled={disabled}
      />
    </TooltipProvider>,
  );
}

test("(a) ReplyOptionRow: clickable when the operator has sent a reply", () => {
  const html = renderReply(true);
  const m = html.match(/<button[^>]*data-testid="button-awaiting-payor-again"[^>]*>/);
  assert.ok(m, "Reply button should render");
  // Strip the className value before checking — Tailwind's `disabled:`
  // variants would otherwise match.
  const stripped = m![0].replace(/class="[^"]*"/, "");
  assert.ok(
    !/\sdisabled(=|\s|>)/.test(stripped),
    `Reply button should be enabled, got: ${m![0]}`,
  );
  // The enabled-state description copy is rendered.
  assert.match(html, /Drop this off the queue until the payor replies again/);
});

test("(b) ReplyOptionRow: disabled with tooltip when no operator reply has been sent", () => {
  const html = renderReply(false);
  const m = html.match(/<button[^>]*data-testid="button-awaiting-payor-again"[^>]*>/);
  assert.ok(m, "Reply button should still render (visible-but-disabled)");
  assert.ok(
    /\sdisabled(=|\s|>)/.test(m![0]),
    `Reply button should carry the disabled attribute, got: ${m![0]}`,
  );
  // The disabled-state description doubles as the in-row hint.
  assert.match(html, /Send a reply on the email thread above to unlock this/);
});

test("(b) ReplyOptionRow source pins the tooltip explainer copy for the disabled state", async () => {
  // Radix portals TooltipContent so the body string isn't in the SSR
  // output — pin the copy at the source so a regression here is still
  // caught. Mirrors the pattern used by responses-awaiting-review-header.test.tsx
  // for its info-tooltip body.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = await fs.readFile(
    path.join(here, "reply-option-row.tsx"),
    "utf8",
  );
  // The disabled wrapper must render a Tooltip with the explicit
  // unlock-instructions copy.
  assert.match(src, /<Tooltip>/);
  assert.match(src, /<TooltipTrigger asChild>/);
  assert.match(
    src,
    /Send a reply to the payor in the email thread above first/,
  );
  assert.match(src, /this unlocks once your reply has been sent\./);
});

test("(b) ReplyOptionRow: respects the caller's `disabled` prop (e.g. mutation pending)", () => {
  const html = renderReply(true, true);
  const m = html.match(/<button[^>]*data-testid="button-awaiting-payor-again"[^>]*>/);
  assert.ok(m);
  assert.ok(
    /\sdisabled(=|\s|>)/.test(m![0]),
    "Reply button should be disabled when the caller passes disabled=true",
  );
});
