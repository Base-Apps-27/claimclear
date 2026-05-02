// Component tests for <ServiceDateCell /> (Task #353). The cell
// replaces the bare em-dash that used to render in the Service Date
// column whenever `service_date` was null. We assert the contract a
// downstream surface depends on:
//
//   - has_date          → renders the formatted date, no link
//   - no_claims         → "No claims attached"     · href="/import"
//   - no_dated_claims   → "No dated claims"        · href group detail
//   - parse_failed      → "Couldn't read claim dates" · href group detail
//   - all_dated_legs_excluded → "All dated legs excluded" · href group detail
//   - unknown reason w/ date    → falls back to has_date render
//   - unknown reason w/o date   → falls back to no_dated_claims label
//
// Render strategy follows `duplicate-terminal.test.tsx`:
// `renderToStaticMarkup` from react-dom/server inside `node:test` —
// no jsdom, no DOM globals required. The wouter <Link> hop is
// stubbed because Link reads from a router context we don't mount.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

void React;

import { ServiceDateCell } from "./service-date-cell";

// Wouter's <Link> requires a router context. The bundled
// `memoryLocation` hook calls `useSyncExternalStore` without a
// `getServerSnapshot`, which throws under `renderToStaticMarkup`. A
// static no-op hook returning a constant location is enough to let
// `<Link href=...>` render its `<a>` so we can assert the contract.
const staticLocationHook = (): [string, (to: string) => void] => ["/", () => {}];

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    React.createElement(Router, { hook: staticLocationHook, children: node }),
  );
}

test("ServiceDateCell renders the formatted date when reason=has_date", () => {
  const html = render(
    React.createElement(ServiceDateCell, {
      groupId: 42,
      earliestDate: "2026-04-15",
      reason: "has_date",
    }),
  );
  // Spans, not anchors — no link when we have a real date.
  assert.match(html, /data-reason="has_date"/);
  assert.match(html, /data-testid="service-date-cell-42"/);
  assert.ok(!/<a[^>]+data-testid="service-date-cell-42"/.test(html), "has_date should not render an anchor");
  // formatDate output ("Apr 15, 2026" via toLocaleDateString) — assert
  // the year is present so we don't tightly couple to locale spacing.
  assert.match(html, /2026/);
});

test("ServiceDateCell renders 'No claims attached' linking to /import for no_claims", () => {
  const html = render(
    React.createElement(ServiceDateCell, {
      groupId: 7,
      earliestDate: null,
      reason: "no_claims",
    }),
  );
  assert.match(html, /data-reason="no_claims"/);
  assert.match(html, /href="\/import"/);
  assert.match(html, /No claims attached/);
});

test("ServiceDateCell renders 'No dated claims' linking to the group for no_dated_claims", () => {
  const html = render(
    React.createElement(ServiceDateCell, {
      groupId: 13,
      earliestDate: null,
      reason: "no_dated_claims",
    }),
  );
  assert.match(html, /data-reason="no_dated_claims"/);
  assert.match(html, /href="\/invoice-groups\/13"/);
  assert.match(html, /No dated claims/);
});

test("ServiceDateCell renders 'Couldn&#x27;t read claim dates' for parse_failed", () => {
  const html = render(
    React.createElement(ServiceDateCell, {
      groupId: 21,
      earliestDate: null,
      reason: "parse_failed",
    }),
  );
  assert.match(html, /data-reason="parse_failed"/);
  assert.match(html, /href="\/invoice-groups\/21"/);
  // Apostrophe is HTML-encoded by react-dom/server.
  assert.match(html, /Couldn&#x27;t read claim dates/);
});

test("ServiceDateCell renders 'All dated legs excluded' linking to the group for all_dated_legs_excluded", () => {
  const html = render(
    React.createElement(ServiceDateCell, {
      groupId: 88,
      earliestDate: null,
      reason: "all_dated_legs_excluded",
    }),
  );
  assert.match(html, /data-reason="all_dated_legs_excluded"/);
  assert.match(html, /href="\/invoice-groups\/88"/);
  assert.match(html, /All dated legs excluded/);
});

test("ServiceDateCell falls back to has_date when reason is missing but a date is present", () => {
  const html = render(
    React.createElement(ServiceDateCell, {
      groupId: 5,
      earliestDate: "2026-01-02",
      reason: null,
    }),
  );
  assert.match(html, /data-reason="has_date"/);
  assert.match(html, /2026/);
});

test("ServiceDateCell falls back to no_dated_claims when both reason and date are missing", () => {
  const html = render(
    React.createElement(ServiceDateCell, {
      groupId: 5,
      earliestDate: null,
      reason: undefined,
    }),
  );
  assert.match(html, /data-reason="no_dated_claims"/);
  assert.match(html, /No dated claims/);
});

test("ServiceDateCell exposes its testIdPrefix for e2e selectors", () => {
  const html = render(
    React.createElement(ServiceDateCell, {
      groupId: 99,
      earliestDate: null,
      reason: "no_claims",
      testIdPrefix: "hero-row-service-date",
    }),
  );
  assert.match(html, /data-testid="hero-row-service-date-99"/);
});
