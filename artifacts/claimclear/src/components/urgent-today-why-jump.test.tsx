// Task #410 — UI coverage for the "File-today activity" Sheet panel
// (`UrgentTodayActivityPanel`). The panel is mounted from two heroes —
// the Queue urgency hero and the Dashboard "File today" hero — and the
// *currently-urgent* rows must behave differently in each:
//
//   • Queue (host passes `onSelectUrgentGroup`): clicking a row is an
//     in-page jump that calls the host callback (which writes
//     `?group=<id>` and scrolls the inline workspace into view) and
//     dismisses the Sheet via the parent-supplied `onClose`. It MUST
//     NOT render an `<a href="/invoice-groups/<id>">` that would leave
//     the Queue.
//   • Dashboard (no `onSelectUrgentGroup`, no inline workspace):
//     clicking a row navigates to `/queue?group=<id>` (preselects the
//     group on the Queue) AND fires `onClose` so the panel doesn't
//     linger after navigation. It MUST NOT point at the standalone
//     invoice-group detail page.
//   • The cleared-today section is unchanged in either mount: each
//     cleared row is still an `<a href="/invoice-groups/<id>">` link
//     to the detail page, and clicking it does NOT fire onClose
//     (cleared rows still leave the page like before).
//
// We render `UrgentTodayActivityPanel` standalone (without the
// surrounding `<Sheet>`) — Task #410's refactor decoupled the panel
// from Radix's Dialog context by hoisting the open state into the
// `UrgentTodayWhyLine` and threading a plain `onClose` callback
// down. That makes the panel renderable in jsdom without paying for
// Radix's portal/focus-scope/dismissable-layer effects.

import "./decision-tree/terminals/_setup-jsdom.ts";

// Wouter's `useBrowserLocation` reads the bare `location` global directly
// (not `window.location`), so we mirror jsdom's window.location onto
// globalThis. Same trick for `history` so navigation calls don't crash.
{
  const w = (globalThis as { window?: Window }).window!;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    get: () => w.location,
  });
  Object.defineProperty(globalThis, "history", {
    configurable: true,
    get: () => w.history,
  });
  Object.defineProperty(globalThis, "addEventListener", {
    configurable: true,
    writable: true,
    value: w.addEventListener.bind(w),
  });
  Object.defineProperty(globalThis, "removeEventListener", {
    configurable: true,
    writable: true,
    value: w.removeEventListener.bind(w),
  });
}

// ---------------------------------------------------------------------------
// fetch stub — return a canned UrgentTodayTransitions payload so the
// `useGetDashboardUrgentTodayTransitions` query resolves immediately.
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
}
const fetchCalls: FetchCall[] = [];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const URGENT_PAYLOAD = {
  today: "2026-05-04",
  urgentCount: 2,
  totalActionable: 5,
  maxUrgentToday: 3,
  wasUrgentToday: true,
  currentlyUrgent: [
    { id: 101, invoiceNumber: "INV-101", status: "Action Required" },
    { id: 202, invoiceNumber: "INV-202", status: "Portal Queued" },
  ],
  clearedToday: [
    {
      id: 9001,
      invoiceGroupId: 303,
      invoiceNumber: "INV-303",
      clientNumber: "C-77",
      fromStatus: "Action Required",
      toStatus: "Submitted",
      timestampET: "10:14",
      source: "manual",
      actor: "avery",
      reason: null,
    },
  ],
  clearedSummary: { total: 1, actors: ["avery"] },
  snapshots: [],
};

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string;
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else if (typeof (input as { url?: string }).url === "string") {
      url = (input as { url: string }).url;
    } else {
      url = String(input);
    }
    const method = init?.method ?? "GET";
    fetchCalls.push({ url, method });
    if (url.includes("/api/dashboard/urgent-today/transitions")) {
      return jsonResponse(200, URGENT_PAYLOAD);
    }
    return jsonResponse(404, { error: `unstubbed ${method} ${url}` });
  },
});

// ---------------------------------------------------------------------------
// Imports — must come AFTER the jsdom + fetch setup above.
// ---------------------------------------------------------------------------

import * as React from "react";
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  type RenderResult,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UrgentTodayActivityPanelBody } from "./urgent-today-why";

void React;

interface MountOpts {
  onSelectUrgentGroup?: (id: number) => void;
  onClose?: () => void;
}

function mountPanel(opts: MountOpts = {}): RenderResult {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <UrgentTodayActivityPanelBody
        onSelectUrgentGroup={opts.onSelectUrgentGroup}
        onClose={opts.onClose}
      />
    </QueryClientProvider>,
  );
}

async function waitForRow(testid: string): Promise<HTMLElement> {
  await waitFor(() => {
    assert.ok(screen.queryByTestId(testid), `row ${testid} should mount once data resolves`);
  });
  return screen.getByTestId(testid);
}

/* ------------------------------------------------------------------ */
/* (a) Queue mount: row is a button that selects in-page + closes.    */
/* ------------------------------------------------------------------ */

test("Queue mount: clicking a currently-urgent row calls onSelectUrgentGroup, closes the Sheet, and does NOT render a link to /invoice-groups/<id>", async (t) => {
  fetchCalls.length = 0;
  const selected: number[] = [];
  const closes: number[] = [];

  t.after(() => {
    cleanup();
    fetchCalls.length = 0;
  });

  mountPanel({
    onSelectUrgentGroup: id => selected.push(id),
    onClose: () => closes.push(1),
  });

  const row = await waitForRow("urgent-today-current-101");

  // Shape: in Queue mode the row is a <button>, not an <a> pointing at
  // the standalone detail page. This is the central guard — the row
  // must NOT silently revert to /invoice-groups/<id> and yank the
  // operator off the Queue.
  assert.equal(
    row.tagName,
    "BUTTON",
    "Queue-mode currently-urgent row should render as a <button>, not a Link",
  );
  assert.equal(
    row.getAttribute("href"),
    null,
    "Queue-mode row must not have an href — it's an in-page action",
  );

  // Click it. Both effects must land: the host's selectWorkflow
  // callback fires with the row's id, AND the panel asks its parent to
  // close the Sheet.
  fireEvent.click(row);

  assert.deepEqual(
    selected,
    [101],
    "onSelectUrgentGroup must be called exactly once with the clicked group's id",
  );
  assert.equal(
    closes.length,
    1,
    "onClose must fire exactly once so the parent dismisses the Sheet after the in-page jump",
  );
});

/* ------------------------------------------------------------------ */
/* (b) Dashboard mount: row is a Link → /queue?group=<id>.            */
/* ------------------------------------------------------------------ */

test("Dashboard mount (no onSelectUrgentGroup): currently-urgent row navigates to /queue?group=<id>, NOT to /invoice-groups/<id>", async (t) => {
  fetchCalls.length = 0;
  const closes: number[] = [];

  t.after(() => {
    cleanup();
    fetchCalls.length = 0;
  });

  mountPanel({ onClose: () => closes.push(1) });

  const row = await waitForRow("urgent-today-current-202");

  // Shape: Dashboard mode keeps a wouter Link, but pointed at the
  // Queue with the group preselected via the existing `?group=<id>`
  // param the Queue's `selectWorkflow` already understands.
  assert.equal(
    row.tagName,
    "A",
    "Dashboard-mode currently-urgent row should render as an anchor (wouter Link)",
  );
  assert.equal(
    row.getAttribute("href"),
    "/queue?group=202",
    "Dashboard-mode row must point at /queue?group=<id> so the operator lands on the Queue with the group preselected",
  );
  assert.notEqual(
    row.getAttribute("href"),
    "/invoice-groups/202",
    "Dashboard-mode row must NOT point at the standalone detail page",
  );

  // Clicking the link should also fire onClose so the panel doesn't
  // linger after the operator has been routed away.
  fireEvent.click(row);
  assert.equal(
    closes.length,
    1,
    "onClose must fire exactly once when the Dashboard-mode link is clicked",
  );
});

/* ------------------------------------------------------------------ */
/* (c) Cleared-today rows are unchanged in BOTH mounts.               */
/* ------------------------------------------------------------------ */

test("Cleared-today rows still link to /invoice-groups/<id> in BOTH Queue and Dashboard mounts (Task #410 only changes the currently-urgent rows)", async (t) => {
  fetchCalls.length = 0;
  t.after(() => {
    cleanup();
    fetchCalls.length = 0;
  });

  // Queue mount.
  const queueCloses: number[] = [];
  const { unmount } = mountPanel({
    onSelectUrgentGroup: () => {},
    onClose: () => queueCloses.push(1),
  });
  const clearedQueue = await waitForRow("urgent-today-cleared-9001");
  assert.equal(clearedQueue.tagName, "A", "cleared row in Queue mount must remain a Link");
  assert.equal(
    clearedQueue.getAttribute("href"),
    "/invoice-groups/303",
    "cleared row in Queue mount must keep linking to the standalone detail page",
  );
  fireEvent.click(clearedQueue);
  assert.equal(
    queueCloses.length,
    0,
    "cleared rows must NOT trigger onClose — Task #410 only rewires currently-urgent rows",
  );
  unmount();

  // Dashboard mount.
  const dashCloses: number[] = [];
  mountPanel({ onClose: () => dashCloses.push(1) });
  const clearedDash = await waitForRow("urgent-today-cleared-9001");
  assert.equal(clearedDash.tagName, "A", "cleared row in Dashboard mount must remain a Link");
  assert.equal(
    clearedDash.getAttribute("href"),
    "/invoice-groups/303",
    "cleared row in Dashboard mount must keep linking to the standalone detail page",
  );
  fireEvent.click(clearedDash);
  assert.equal(
    dashCloses.length,
    0,
    "cleared rows must NOT trigger onClose in Dashboard mount either",
  );
});
