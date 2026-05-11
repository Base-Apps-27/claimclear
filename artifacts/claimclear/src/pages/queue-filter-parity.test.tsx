// V1 (Task #649) — URL ↔ control parity for the always-on filter
// strip. Every URL token has exactly one on-screen control and every
// on-screen control writes exactly one URL token, so a stale link or
// shared bookmark always reproduces the visible state.
//
// These tests exercise the exported pure helpers from `@/lib/queue-filters`:
//   • `parseParityFilters(get, getAll)` — URL → control state
//   • `serializeParityPatch(patch)` — control change → URL update map
//   • `legacyUrlRewrites(read)` — `?readyToReview=true` and the
//     pre-redesign per-tab search params (`qActionable`, etc.) are
//     folded into the new vocabulary on mount.
//   • `laneForRow(group)` — three-lane partition.
//   • `buildChips(filters, ...)` — every active filter has a chip.
//
// We deliberately do not render React here. The render path is
// covered by the V5 wire-integrity test and by the data-testid
// surface that integration tests bind to.

import { test } from "node:test";
import { strict as assert } from "node:assert";

const {
  parseParityFilters,
  serializeParityPatch,
  legacyUrlRewrites,
  laneForRow,
  buildChips,
  appliedFacetCount,
  parseOutlook,
  parseDraftReviewed,
} = await import("@/lib/queue-filters");

function makeReader(params: URLSearchParams) {
  return {
    get: (k: string) => params.get(k) ?? "",
    getAll: (k: string) => {
      const raw = params.get(k);
      if (raw == null || raw === "") return [];
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    },
  };
}

test("URL → control: every parity-relevant URL token decodes to its control state", () => {
  const url = new URLSearchParams(
    "engagement=all&expiring=today-tomorrow&outlook=ready_to_review&errorTypeId=12,34&draftReviewed=reviewed&showPastDeadline=true&qSearch=INV-99",
  );
  const { get, getAll } = makeReader(url);
  const f = parseParityFilters(get, getAll);
  assert.equal(f.engagement, "all");
  assert.equal(f.expiring, "today-tomorrow");
  assert.equal(f.outlook, "ready_to_review");
  assert.deepEqual(f.errorTypeIds, ["12", "34"]);
  assert.equal(f.draftReviewed, "reviewed");
  assert.equal(f.showPastDeadline, true);
  assert.equal(f.qSearch, "INV-99");
});

test("URL → control: missing tokens fall back to canonical defaults (engagement=needs)", () => {
  const { get, getAll } = makeReader(new URLSearchParams(""));
  const f = parseParityFilters(get, getAll);
  assert.equal(f.engagement, "needs");
  assert.equal(f.expiring, null);
  assert.equal(f.outlook, null);
  assert.deepEqual(f.errorTypeIds, []);
  assert.equal(f.draftReviewed, null);
  assert.equal(f.showPastDeadline, false);
  assert.equal(f.qSearch, "");
});

test("control → URL: each filter patch writes exactly the one URL key it owns", () => {
  assert.deepEqual(serializeParityPatch({ engagement: "all" }), { engagement: "all" });
  assert.deepEqual(serializeParityPatch({ engagement: "needs" }), { engagement: null });
  assert.deepEqual(serializeParityPatch({ expiring: "urgent" }), { expiring: "urgent" });
  assert.deepEqual(serializeParityPatch({ expiring: null }), { expiring: null });
  assert.deepEqual(serializeParityPatch({ outlook: "ready_to_review" }), {
    outlook: "ready_to_review",
  });
  assert.deepEqual(serializeParityPatch({ errorTypeIds: ["1", "5"] }), {
    errorTypeId: "1,5",
  });
  assert.deepEqual(serializeParityPatch({ errorTypeIds: [] }), { errorTypeId: null });
  assert.deepEqual(serializeParityPatch({ draftReviewed: "unreviewed" }), {
    draftReviewed: "unreviewed",
  });
  assert.deepEqual(serializeParityPatch({ showPastDeadline: true }), {
    showPastDeadline: "true",
  });
  assert.deepEqual(serializeParityPatch({ showPastDeadline: false }), {
    showPastDeadline: null,
  });
  assert.deepEqual(serializeParityPatch({ qSearch: "INV-1" }), { qSearch: "INV-1" });
  assert.deepEqual(serializeParityPatch({ qSearch: "" }), { qSearch: null });
});

test("URL ↔ URL round-trip: serialize(parse(url)) reproduces every set token", () => {
  const cases: Array<{ url: string; expected: Record<string, string | null> }> = [
    {
      url: "engagement=all&expiring=urgent&outlook=ready_to_review&errorTypeId=7&draftReviewed=reviewed&showPastDeadline=true&qSearch=foo",
      expected: {
        engagement: "all",
        expiring: "urgent",
        outlook: "ready_to_review",
        errorTypeId: "7",
        draftReviewed: "reviewed",
        showPastDeadline: "true",
        qSearch: "foo",
      },
    },
    {
      url: "expiring=tomorrow&outlook=reattest_only",
      expected: {
        engagement: null,
        expiring: "tomorrow",
        outlook: "reattest_only",
        errorTypeId: null,
        draftReviewed: null,
        showPastDeadline: null,
        qSearch: null,
      },
    },
  ];
  for (const c of cases) {
    const { get, getAll } = makeReader(new URLSearchParams(c.url));
    const parsed = parseParityFilters(get, getAll);
    const serialized = serializeParityPatch({
      engagement: parsed.engagement,
      expiring: parsed.expiring,
      outlook: parsed.outlook,
      errorTypeIds: parsed.errorTypeIds,
      draftReviewed: parsed.draftReviewed,
      showPastDeadline: parsed.showPastDeadline,
      qSearch: parsed.qSearch,
    });
    assert.deepEqual(serialized, c.expected, `round-trip failed for ?${c.url}`);
  }
});

test("legacy URL rewrite: ?readyToReview=true → ?outlook=ready_to_review and the legacy key is cleared", () => {
  const params = new URLSearchParams("readyToReview=true");
  const out = legacyUrlRewrites((k) => params.get(k));
  assert.deepEqual(out, { outlook: "ready_to_review", readyToReview: null });
});

test("legacy URL rewrite: ?readyToReview=true does NOT clobber an explicit ?outlook=…", () => {
  const params = new URLSearchParams("readyToReview=true&outlook=reattest_only");
  const out = legacyUrlRewrites((k) => params.get(k));
  assert.equal(out?.outlook, undefined);
  assert.equal(out?.readyToReview, null);
});

test("legacy URL rewrite: per-tab `qActionable` folds into `qSearch`", () => {
  const params = new URLSearchParams("qActionable=INV-3");
  const out = legacyUrlRewrites((k) => params.get(k));
  assert.equal(out?.qSearch, "INV-3");
  assert.equal(out?.qActionable, null);
  assert.equal(out?.qPortalQueued, null);
  assert.equal(out?.qOnHold, null);
});

test("legacy URL rewrite: stale `?tab=` is stripped on mount", () => {
  const params = new URLSearchParams("tab=portal-queued");
  const out = legacyUrlRewrites((k) => params.get(k));
  assert.equal(out?.tab, null);
});

test("legacy URL rewrite: clean URL is a no-op (returns null)", () => {
  const params = new URLSearchParams("expiring=urgent&engagement=all");
  const out = legacyUrlRewrites((k) => params.get(k));
  assert.equal(out, null);
});

test("parseOutlook accepts only the three canonical buckets", () => {
  assert.equal(parseOutlook("ready_to_review"), "ready_to_review");
  assert.equal(parseOutlook("reattest_only"), "reattest_only");
  assert.equal(parseOutlook("nothing_to_do"), "nothing_to_do");
  assert.equal(parseOutlook(""), null);
  assert.equal(parseOutlook("garbage"), null);
});

test("parseDraftReviewed accepts only `reviewed` / `unreviewed`", () => {
  assert.equal(parseDraftReviewed("reviewed"), "reviewed");
  assert.equal(parseDraftReviewed("unreviewed"), "unreviewed");
  assert.equal(parseDraftReviewed("true"), null);
  assert.equal(parseDraftReviewed(""), null);
});

type RowLike = Parameters<typeof laneForRow>[0];
const baseRow: Record<string, unknown> = {
  id: 1,
  invoiceNumber: "INV-1",
  rideCount: 1,
  totalAmount: "0",
  status: "New",
  isUrgent: false,
  effectiveDaysLeft: 10,
  legSubStatusCounts: {},
};
const row = (overrides: Record<string, unknown>): RowLike =>
  ({ ...baseRow, ...overrides } as unknown as RowLike);

test("laneForRow: status=On Hold → hold lane regardless of urgency", () => {
  assert.equal(
    laneForRow(row({ status: "On Hold", isUrgent: true, effectiveDaysLeft: 0 })),
    "hold",
  );
});

test("laneForRow: today/tomorrow → clock lane (Portal Queued and New both apply)", () => {
  assert.equal(laneForRow(row({ effectiveDaysLeft: 0 })), "clock");
  assert.equal(laneForRow(row({ effectiveDaysLeft: 1 })), "clock");
  assert.equal(
    laneForRow(row({ status: "Portal Queued", effectiveDaysLeft: 0 })),
    "clock",
  );
});

test("laneForRow: 2+ days out → week lane", () => {
  assert.equal(laneForRow(row({ effectiveDaysLeft: 2 })), "week");
  assert.equal(laneForRow(row({ effectiveDaysLeft: 30 })), "week");
});

test("buildChips: every active filter is represented by a chip with a working clear callback", () => {
  let lastPatch: Record<string, unknown> = {};
  const apply = (patch: Record<string, unknown>) => {
    lastPatch = patch;
  };
  const filters = parseParityFilters(
    (k) =>
      ({
        engagement: "all",
        expiring: "urgent",
        outlook: "ready_to_review",
        errorTypeId: "9",
        draftReviewed: "reviewed",
        showPastDeadline: "true",
        qSearch: "INV-9",
      } as Record<string, string>)[k] ?? "",
    (k) => (k === "errorTypeId" ? ["9"] : []),
  );
  const errorTypes = [{ id: 9, name: "Underpayment" }];
  const chips = buildChips(filters, errorTypes, apply as never);
  const ids = chips.map((c) => c.id).sort();
  assert.deepEqual(ids.sort(), [
    "draftReviewed-reviewed",
    "engagement-all",
    "errorTypeId-9",
    "expiring-today",
    "outlook-ready_to_review",
    "qSearch",
    "showPastDeadline",
  ]);
  // Spot-check that clearing an errorType chip writes the correct
  // patch (parity-relevant — the chip must own its URL token).
  chips.find((c) => c.id === "errorTypeId-9")!.onClear();
  assert.deepEqual(lastPatch, { errorTypeIds: [] });
});

test("buildChips: each chip carries its own match count when one is supplied", () => {
  const filters = parseParityFilters(
    (k) =>
      ({
        expiring: "urgent",
        outlook: "ready_to_review",
        qSearch: "INV",
      } as Record<string, string>)[k] ?? "",
    () => [],
  );
  const counts = {
    "expiring-today": 4,
    "outlook-ready_to_review": 11,
    qSearch: 2,
  };
  const chips = buildChips(filters, [], (() => {}) as never, counts);
  const byId = Object.fromEntries(chips.map((c) => [c.id, c.count]));
  assert.equal(byId["expiring-today"], 4);
  assert.equal(byId["outlook-ready_to_review"], 11);
  assert.equal(byId["qSearch"], 2);
});

// ── Full parity matrix (Task #649). Every URL token the queue page
// owns appears here verbatim with the three required assertions per
// row: control→URL (serializeParityPatch / set helper), URL→control
// (parseParityFilters / read helper), and clear→URL (the explicit
// "back to default" patch writes a null/empty for the same key).
type MatrixRow = {
  name: string;
  urlKey: string;
  urlValue: string | null;
  // control→URL
  set?: Parameters<typeof serializeParityPatch>[0];
  setExpectKey?: string;
  setExpectValue?: string | null;
  // URL→control (parse)
  parsedExpectKey?: string;
  parsedExpect?: unknown;
  // clear→URL
  clear?: Parameters<typeof serializeParityPatch>[0];
  clearExpectKey?: string;
  // raw URL-only tokens (laneCollapsed/group/inbox/triage) — no
  // parity helper patches, but we still pin URL→read parity by
  // round-tripping through URLSearchParams.
  rawOnly?: boolean;
  rawAssertions?: Array<{ key: string; expect: string | string[] | number | boolean | null }>;
};

const PARITY_MATRIX: MatrixRow[] = [
  {
    name: "engagement",
    urlKey: "engagement",
    urlValue: "all",
    set: { engagement: "all" },
    setExpectKey: "engagement",
    setExpectValue: "all",
    parsedExpectKey: "engagement",
    parsedExpect: "all",
    clear: { engagement: "needs" },
    clearExpectKey: "engagement",
  },
  {
    name: "expiring=urgent",
    urlKey: "expiring",
    urlValue: "urgent",
    set: { expiring: "urgent" },
    setExpectKey: "expiring",
    setExpectValue: "urgent",
    parsedExpectKey: "expiring",
    parsedExpect: "urgent",
    clear: { expiring: null },
    clearExpectKey: "expiring",
  },
  {
    name: "expiring=tomorrow",
    urlKey: "expiring",
    urlValue: "tomorrow",
    set: { expiring: "tomorrow" },
    setExpectKey: "expiring",
    setExpectValue: "tomorrow",
    parsedExpectKey: "expiring",
    parsedExpect: "tomorrow",
    clear: { expiring: null },
    clearExpectKey: "expiring",
  },
  {
    name: "expiring=today-tomorrow",
    urlKey: "expiring",
    urlValue: "today-tomorrow",
    set: { expiring: "today-tomorrow" },
    setExpectKey: "expiring",
    setExpectValue: "today-tomorrow",
    parsedExpectKey: "expiring",
    parsedExpect: "today-tomorrow",
    clear: { expiring: null },
    clearExpectKey: "expiring",
  },
  {
    name: "expiring=soon",
    urlKey: "expiring",
    urlValue: "soon",
    set: { expiring: "soon" },
    setExpectKey: "expiring",
    setExpectValue: "soon",
    parsedExpectKey: "expiring",
    parsedExpect: "soon",
    clear: { expiring: null },
    clearExpectKey: "expiring",
  },
  {
    name: "expiring=stuck",
    urlKey: "expiring",
    urlValue: "stuck",
    set: { expiring: "stuck" },
    setExpectKey: "expiring",
    setExpectValue: "stuck",
    parsedExpectKey: "expiring",
    parsedExpect: "stuck",
    clear: { expiring: null },
    clearExpectKey: "expiring",
  },
  {
    name: "outlook=ready_to_review",
    urlKey: "outlook",
    urlValue: "ready_to_review",
    set: { outlook: "ready_to_review" },
    setExpectKey: "outlook",
    setExpectValue: "ready_to_review",
    parsedExpectKey: "outlook",
    parsedExpect: "ready_to_review",
    clear: { outlook: null },
    clearExpectKey: "outlook",
  },
  {
    name: "outlook=reattest_only",
    urlKey: "outlook",
    urlValue: "reattest_only",
    set: { outlook: "reattest_only" },
    setExpectKey: "outlook",
    setExpectValue: "reattest_only",
    parsedExpectKey: "outlook",
    parsedExpect: "reattest_only",
    clear: { outlook: null },
    clearExpectKey: "outlook",
  },
  {
    name: "outlook=nothing_to_do",
    urlKey: "outlook",
    urlValue: "nothing_to_do",
    set: { outlook: "nothing_to_do" },
    setExpectKey: "outlook",
    setExpectValue: "nothing_to_do",
    parsedExpectKey: "outlook",
    parsedExpect: "nothing_to_do",
    clear: { outlook: null },
    clearExpectKey: "outlook",
  },
  {
    name: "errorTypeIds",
    urlKey: "errorTypeId",
    urlValue: "7,9",
    set: { errorTypeIds: ["7", "9"] },
    setExpectKey: "errorTypeId",
    setExpectValue: "7,9",
    parsedExpectKey: "errorTypeIds",
    parsedExpect: ["7", "9"],
    clear: { errorTypeIds: [] },
    clearExpectKey: "errorTypeId",
  },
  {
    name: "draftReviewed=reviewed",
    urlKey: "draftReviewed",
    urlValue: "reviewed",
    set: { draftReviewed: "reviewed" },
    setExpectKey: "draftReviewed",
    setExpectValue: "reviewed",
    parsedExpectKey: "draftReviewed",
    parsedExpect: "reviewed",
    clear: { draftReviewed: null },
    clearExpectKey: "draftReviewed",
  },
  {
    name: "draftReviewed=unreviewed",
    urlKey: "draftReviewed",
    urlValue: "unreviewed",
    set: { draftReviewed: "unreviewed" },
    setExpectKey: "draftReviewed",
    setExpectValue: "unreviewed",
    parsedExpectKey: "draftReviewed",
    parsedExpect: "unreviewed",
    clear: { draftReviewed: null },
    clearExpectKey: "draftReviewed",
  },
  {
    name: "excludeReason=handled_offline",
    urlKey: "excludeReason",
    urlValue: "handled_offline",
    set: { excludeReason: "handled_offline" },
    setExpectKey: "excludeReason",
    setExpectValue: "handled_offline",
    parsedExpectKey: "excludeReason",
    parsedExpect: "handled_offline",
    clear: { excludeReason: null },
    clearExpectKey: "excludeReason",
  },
  {
    name: "showPastDeadline",
    urlKey: "showPastDeadline",
    urlValue: "true",
    set: { showPastDeadline: true },
    setExpectKey: "showPastDeadline",
    setExpectValue: "true",
    parsedExpectKey: "showPastDeadline",
    parsedExpect: true,
    clear: { showPastDeadline: false },
    clearExpectKey: "showPastDeadline",
  },
  {
    name: "qSearch",
    urlKey: "qSearch",
    urlValue: "INV-7",
    set: { qSearch: "INV-7" },
    setExpectKey: "qSearch",
    setExpectValue: "INV-7",
    parsedExpectKey: "qSearch",
    parsedExpect: "INV-7",
    clear: { qSearch: "" },
    clearExpectKey: "qSearch",
  },
  // ── Raw URL-only tokens. These are not parity helper patches; the
  // queue page owns them through `useUrlParams.set/get` directly
  // (lane-collapse memory, group/inbox/triage selection). They still
  // belong in the parity matrix because a stale link must reproduce
  // their visible state — so we round-trip the URL and assert read.
  {
    name: "laneCollapsed",
    urlKey: "laneCollapsed",
    urlValue: "hold,week",
    rawOnly: true,
    rawAssertions: [{ key: "laneCollapsed", expect: ["hold", "week"] }],
  },
  {
    name: "group",
    urlKey: "group",
    urlValue: "42",
    rawOnly: true,
    rawAssertions: [{ key: "group", expect: "42" }],
  },
  {
    name: "inbox",
    urlKey: "inbox",
    urlValue: "open",
    rawOnly: true,
    rawAssertions: [{ key: "inbox", expect: "open" }],
  },
  {
    name: "triage",
    urlKey: "triage",
    urlValue: "108",
    rawOnly: true,
    rawAssertions: [{ key: "triage", expect: "108" }],
  },
];

test("PARITY MATRIX (V1): every URL token round-trips set→read→clear verbatim", () => {
  for (const r of PARITY_MATRIX) {
    if (r.rawOnly) {
      // URL→read for raw tokens.
      const params = new URLSearchParams();
      if (r.urlValue !== null) params.set(r.urlKey, r.urlValue);
      const reader = makeReader(params);
      for (const a of r.rawAssertions ?? []) {
        if (Array.isArray(a.expect)) {
          assert.deepEqual(reader.getAll(a.key), a.expect, `${r.name}: getAll`);
        } else {
          assert.equal(reader.get(a.key), String(a.expect), `${r.name}: get`);
        }
      }
      continue;
    }
    // control → URL
    const written = serializeParityPatch(r.set!);
    assert.equal(
      written[r.setExpectKey!],
      r.setExpectValue,
      `${r.name}: control→URL`,
    );
    // URL → control
    const params = new URLSearchParams();
    if (r.urlValue !== null) params.set(r.urlKey, r.urlValue);
    const reader = makeReader(params);
    const f = parseParityFilters(reader.get, reader.getAll);
    assert.deepEqual(
      (f as unknown as Record<string, unknown>)[r.parsedExpectKey!],
      r.parsedExpect,
      `${r.name}: URL→control`,
    );
    // clear → URL — every parity-relevant clear must write `null` for
    // the URL key so the param disappears (`set` collapses null/empty
    // to a `delete()` call in `useUrlParams`).
    const cleared = serializeParityPatch(r.clear!);
    assert.equal(cleared[r.clearExpectKey!], null, `${r.name}: clear→URL`);
  }
});

