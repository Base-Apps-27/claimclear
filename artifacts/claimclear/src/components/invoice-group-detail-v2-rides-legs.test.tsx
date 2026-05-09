// Task #521 — regression for the invoice-group detail "Rides & legs"
// table row rendering "Non-issue" for every dropped leg. The row must
// use the reason-aware label helper so a `cannot_dispute` leg reads
// "Non-contestable" and a `non_issue` leg reads "Non-issue", matching
// the leg detail page and the Queue walkthrough.
//
// We assert two things:
//   1. The reason-aware helper produces the right labels for the
//      reproduction shape from the task (group `1858595410` with one
//      `non_issue` leg and one `cannot_dispute` leg). A small render
//      harness mirrors what the row does today (deriveLegSubStatus →
//      legSubStatusDisplayLabel(sub, leg)) so the labels show up in the
//      rendered HTML, not two "Non-issue" pills.
//   2. The actual `invoice-group-detail-v2.tsx` row call site uses
//      `legSubStatusDisplayLabel(sub, r)` instead of the bare
//      `legSubStatusLabel(sub)`. Reading the source string keeps this
//      test honest: a refactor that swaps the helper back will break
//      this assertion even if the harness above keeps passing.

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  deriveLegSubStatus,
  type LegForSubStatus,
} from "@workspace/leg-state";
import { legSubStatusDisplayLabel } from "@workspace/vocab";

void React;

interface MiniLeg extends LegForSubStatus {
  id: number;
}

function RidesLegsRows({ legs }: { legs: MiniLeg[] }) {
  return (
    <div>
      {legs.map((r) => {
        const sub = deriveLegSubStatus(r);
        return (
          <div key={r.id} data-testid={`legs-queue-row-${r.id}`}>
            <span data-testid={`legs-queue-pill-${r.id}`}>
              {legSubStatusDisplayLabel(sub, r)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

test("Rides & legs row renders Non-contestable for cannot_dispute and Non-issue for non_issue", () => {
  // Reproduction case from the task: group 1858595410, legs 14932069
  // (non_issue) and 14932070 (cannot_dispute). The row must produce
  // one of each label, not two "Non-issue".
  const legs: MiniLeg[] = [
    {
      id: 14932069,
      sopOutcome: "non_issue",
      includedInDispute: true,
      errorTypeId: "ET-1",
      disposition: "disposed_nonissue",
    } as unknown as MiniLeg,
    {
      id: 14932070,
      sopOutcome: "cannot_dispute",
      includedInDispute: true,
      errorTypeId: "ET-1",
      disposition: "disposed_withdraw",
    } as unknown as MiniLeg,
  ];

  const html = renderToStaticMarkup(<RidesLegsRows legs={legs} />);
  assert.match(html, /data-testid="legs-queue-pill-14932069"[^>]*>Non-issue</);
  assert.match(
    html,
    /data-testid="legs-queue-pill-14932070"[^>]*>Non-contestable</,
  );
  assert.equal(
    (html.match(/Non-issue/g) ?? []).length,
    1,
    "must not render 'Non-issue' for both legs",
  );
});

test("invoice-group-detail-v2 rides & legs row passes the leg row to StateBadge", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(
    join(here, "invoice-group-detail-v2.tsx"),
    "utf8",
  );
  // Task #554 — the row pill now goes through `<StateBadge
  // variant="subStatus" value={sub} leg={r} />`. StateBadge calls
  // `legSubStatusDisplayLabel(value, leg)` internally when `leg` is
  // provided, so the reason-aware label contract from #521 still
  // holds, just one indirection up.
  assert.match(
    src,
    /<StateBadge[^>]*variant="subStatus"[^>]*\bleg=\{r\}/,
    "rides & legs row must pass `leg={r}` to StateBadge — see Tasks #521, #554",
  );
});
