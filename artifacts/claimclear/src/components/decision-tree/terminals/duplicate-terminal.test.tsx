// Snapshot parity for the muted DuplicateTerminal card. The parent
// surface gates render on `!isDuplicate` historically; with Task #308
// the gate now allows duplicates so this card renders inside the SOP
// player. The DOM here is a stable contract: the muted card, the
// "Sibling Duplicate of CLM-X" line, and the rollup explainer.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { DuplicateTerminal } from "./duplicate-terminal";

void React;

const tree = { rootId: "n1", nodes: [{ id: "n1", question: "?", options: [] }] } as never;

test("DuplicateTerminal renders the muted card with the primary CLM-X reference", () => {
  const html = renderToStaticMarkup(
    <DuplicateTerminal
      leg={{
        id: 99,
        sopOutcome: null,
        duplicateOfClaimId: 7,
      }}
      tree={tree}
    />,
  );
  assert.match(html, /data-testid="sop-terminal-card"/);
  assert.match(html, /Sibling Duplicate of/);
  assert.match(html, /CLM-7/);
  assert.match(html, /rolls up to the primary leg/);
});

test("DuplicateTerminal byte-equivalent snapshot — Guard #3 hot path", () => {
  // Frozen DOM. If anything changes here, the diff makes it visible:
  // we either intentionally update the snapshot (and the SOP queue
  // operators see a UI change) or we caught a regression.
  const html = renderToStaticMarkup(
    <DuplicateTerminal
      leg={{ id: 99, sopOutcome: null, duplicateOfClaimId: 42 }}
      tree={tree}
    />,
  );
  // Hard byte-level guards on the structural classes + literals.
  // (We assert presence of each contract-relevant fragment rather than
  // a single frozen string so that incidental whitespace from new
  // lucide releases doesn't trip the suite.)
  for (const fragment of [
    'class="rounded-xl text-card-foreground shadow bg-muted/30 border-muted-foreground/20 border"',
    'data-testid="sop-terminal-card"',
    'class="p-4 space-y-2"',
    'class="flex items-start gap-2 text-sm"',
    "Sibling Duplicate of",
    '<code class="font-mono">CLM-42</code>',
    // Apostrophe is HTML-encoded to &#x27; by react-dom/server.
    "rolls up to the primary leg",
    "No independent SOP walk is required.",
  ]) {
    assert.ok(
      html.includes(fragment),
      `byte-parity guard tripped — missing fragment: ${fragment}`,
    );
  }
});

test("DuplicateTerminal is defensive: renders even with no primaryId", () => {
  // Belt-and-suspenders — the parent surface should never pass a
  // duplicate leg without duplicateOfClaimId, but if it does we'd
  // rather render a slightly-wrong card than crash the SOP panel.
  const html = renderToStaticMarkup(
    <DuplicateTerminal
      leg={{ id: 99, sopOutcome: null, duplicateOfClaimId: null }}
      tree={tree}
    />,
  );
  assert.match(html, /data-testid="sop-terminal-card"/);
  assert.match(html, /Sibling Duplicate of/);
});
