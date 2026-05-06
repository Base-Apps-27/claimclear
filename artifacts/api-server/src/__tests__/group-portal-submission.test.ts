import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  runBatchWorker,
  __setChromiumForTests,
  legsFromPortalSubmissionRows,
  assembleGroupSubmission,
  EmptyGroupError,
  MissingDescriptionError,
  MissingConfNumberError,
  InvoiceNumberMismatchError,
  AttachmentDriftError,
  type GroupPortalSubmission,
  type PortalSubmission,
} from "../bot/batch-worker";

/**
 * Offline contract test for Task #484: a single runBatchWorker call accepts a
 * GroupPortalSubmission with N legs, opens exactly one Playwright session,
 * and returns one perLeg entry per input leg in input order.
 *
 * The test never touches a real browser — it swaps the chromium impl via
 * __setChromiumForTests with a fake page that satisfies the selectors the
 * worker probes. We assert:
 *   1. chromium.launch is called exactly once per worker invocation
 *      (no per-leg sessions),
 *   2. perLeg has the same legIds in the same order as sub.legs,
 *   3. ticketId is parsed off the fake confirmation page.
 */

type FakeFn = (...args: any[]) => any;

function makeFakePage() {
  // Minimal selector→element map. Anything the worker queries that isn't
  // here returns null, which the worker treats as "field not present" and
  // logs a warning — it does NOT throw, except for the two selectors below
  // (#new_helpdesk_ticket and the submit button) which must resolve.
  const selectorTruthy = new Set<string>([
    "#new_helpdesk_ticket",
    'button.new-ticket-submit-button[type="submit"]',
  ]);

  const fakeElement = {
    fill: async () => {},
    click: async () => {},
    isVisible: async () => true,
    setInputFiles: async () => {},
    evaluate: async () => {},
    textContent: async () => "",
  };

  const page = {
    $: async (sel: string) => (selectorTruthy.has(sel) ? fakeElement : null),
    $$eval: async () => [],
    evaluate: async (_fn: FakeFn) => ({ childCount: 1, fileNames: [], filesListCount: 0 }),
    waitForTimeout: async () => {},
    waitForSelector: async () => {},
    waitForLoadState: async () => {},
    fill: async () => {},
    click: async () => {},
    screenshot: async () => {},
    close: async () => {},
    url: () => "https://portal.example.com/support/tickets/12345",
    textContent: async () => "Your ticket #12345 has been created.",
    goto: async () => {},
  };

  return page;
}

function makeFakeChromium(launchCalls: { count: number }) {
  return {
    launch: async () => {
      launchCalls.count += 1;
      const page = makeFakePage();
      const context = {
        newPage: async () => page,
        storageState: async () => {},
      };
      return {
        newContext: async () => context,
        close: async () => {},
      };
    },
  } as any;
}

function makeLeg(overrides: Partial<GroupPortalSubmission["legs"][number]> = {}): GroupPortalSubmission["legs"][number] {
  return {
    id: 1,
    confNumber: "CONF-001",
    serviceDate: "2025-01-15",
    refNumber: "REF-001",
    carNumber: "CAR-001",
    claimAmount: "10.00",
    errorTypeName: "GPS Deviation",
    errorDetails: "GPS off route",
    issueType: "Other Issue or Question",
    gpsBreadcrumbsAvailable: "Yes",
    ...overrides,
  };
}

function makeGroup(legCount: number): GroupPortalSubmission {
  const legs = Array.from({ length: legCount }, (_, i) =>
    makeLeg({ id: 100 + i, confNumber: `CONF-${100 + i}`, refNumber: `REF-${100 + i}` }),
  );
  return {
    groupId: 9001,
    invoiceNumber: "INV-9001",
    clientNumber: "CLIENT-X",
    requesterEmail: "ops@example.com",
    transportationProviderName: "Acme Transit",
    phoneNumber: "555-1212",
    subject: "Multi-leg invoice dispute",
    descriptionHtml: "<p>Pre-built description</p>",
    disputeReason: "Multiple legs misrouted",
    evidenceNotes: "See attached",
    attachmentUrls: [],
    legs,
  };
}

test("runBatchWorker: 3-leg group opens one session and returns one perLeg entry per leg in order", async () => {
  const launchCalls = { count: 0 };
  __setChromiumForTests(makeFakeChromium(launchCalls));
  try {
    const sub = makeGroup(3);
    const result = await runBatchWorker(sub, false);

    assert.equal(launchCalls.count, 1, "exactly one Playwright session per group call");
    assert.equal(result.ticketId, "12345", "parses ticket id from confirmation text");
    assert.ok(result.perLeg, "perLeg present");
    assert.equal(result.perLeg.length, 3, "one perLeg entry per input leg");
    assert.deepEqual(
      result.perLeg.map((p) => p.legId),
      [100, 101, 102],
      "perLeg preserves input leg order",
    );
    assert.ok(
      result.perLeg.every((p) => p.ticked === true),
      "all legs ticked successfully on the happy path",
    );
  } finally {
    __setChromiumForTests(null);
  }
});

test("runBatchWorker: single-leg group still works (back-compat with current per-leg producers)", async () => {
  const launchCalls = { count: 0 };
  __setChromiumForTests(makeFakeChromium(launchCalls));
  try {
    const sub = makeGroup(1);
    const result = await runBatchWorker(sub, false);
    assert.equal(launchCalls.count, 1);
    assert.equal(result.perLeg.length, 1);
    assert.equal(result.perLeg[0].legId, 100);
    assert.equal(result.perLeg[0].ticked, true);
  } finally {
    __setChromiumForTests(null);
  }
});

test("runBatchWorker: rejects an empty-leg group up front (no browser launch)", async () => {
  const launchCalls = { count: 0 };
  __setChromiumForTests(makeFakeChromium(launchCalls));
  try {
    const sub = makeGroup(0);
    await assert.rejects(
      () => runBatchWorker(sub, false),
      /no legs/i,
      "empty group is a programming error and surfaces immediately",
    );
    assert.equal(launchCalls.count, 0, "no Playwright session opened for empty group");
  } finally {
    __setChromiumForTests(null);
  }
});

test("legsFromPortalSubmissionRows: groups per-leg rows by invoiceGroupId, preserving leg order", () => {
  // Two rows sharing invoiceGroupId 500 should collapse into one
  // GroupPortalSubmission with two legs in input order; a third row with a
  // different group becomes its own group.
  const baseRow = {
    clientNumber: "CLIENT-X",
    subject: "Multi-leg dispute",
    requesterEmail: "ops@example.com",
    transportationProviderName: "Acme Transit",
    phoneNumber: "555-0000",
    invoiceNumber: "INV-500",
    descriptionHtml: "<p>desc</p>",
    disputeReason: "reason",
    evidenceNotes: "notes",
    attachmentUrls: [],
  };
  const groups = legsFromPortalSubmissionRows([
    {
      ...baseRow,
      id: 11,
      invoiceGroupId: 500,
      confNumber: "A",
      serviceDate: "2025-01-01",
      refNumber: "R-A",
      carNumber: "C-A",
      claimAmount: "1.00",
      errorTypeName: "ET-A",
      errorDetails: "details A",
      issueType: "Other Issue or Question",
      gpsBreadcrumbsAvailable: "Yes",
    },
    {
      ...baseRow,
      id: 22,
      invoiceGroupId: 500,
      confNumber: "B",
      serviceDate: "2025-01-02",
      refNumber: "R-B",
      carNumber: "C-B",
      claimAmount: "2.00",
      errorTypeName: "ET-B",
      errorDetails: "details B",
      issueType: "GPS Control Deviation",
      gpsBreadcrumbsAvailable: "No",
    },
    {
      ...baseRow,
      id: 33,
      invoiceGroupId: 600,
      invoiceNumber: "INV-600",
      confNumber: "C",
      serviceDate: "2025-01-03",
      refNumber: "R-C",
      carNumber: "C-C",
      claimAmount: "3.00",
      errorTypeName: "ET-C",
      errorDetails: "details C",
      issueType: "Other Issue or Question",
      gpsBreadcrumbsAvailable: "Unknown",
    },
  ]);
  assert.equal(groups.length, 2, "two distinct invoice groups");
  const group500 = groups.find((g) => g.groupId === 500);
  const group600 = groups.find((g) => g.groupId === 600);
  assert.ok(group500 && group600);
  assert.deepEqual(
    group500.legs.map((l) => l.id),
    [11, 22],
    "legs preserved in input order within a group",
  );
  assert.equal(group500.legs[1].issueType, "GPS Control Deviation");
  assert.equal(group600.legs.length, 1);
  assert.equal(group600.invoiceNumber, "INV-600");
});

// ---------------------------------------------------------------------------
// assembleGroupSubmission: producer-side strict adapter that fails LOUDLY
// when the per-leg rows it gets handed don't form a coherent invoice group.
// These tests pin down each named error so future producer changes (Task
// #485 onward) can't silently revert the safety guarantees.
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<PortalSubmission> = {}): PortalSubmission {
  return {
    id: 1,
    confNumber: "CONF-001",
    serviceDate: "2025-01-15",
    refNumber: "REF-001",
    clientNumber: "CLIENT-X",
    carNumber: "CAR-001",
    claimAmount: "10.00",
    errorTypeName: "GPS Deviation",
    errorDetails: "GPS off route",
    issueType: "Other Issue or Question",
    subject: "Multi-leg dispute",
    requesterEmail: "ops@example.com",
    transportationProviderName: "Acme Transit",
    phoneNumber: "555-1212",
    invoiceNumber: "INV-9001",
    gpsBreadcrumbsAvailable: "Yes",
    descriptionHtml: "<p>Real description present</p>",
    disputeReason: "Reason text",
    evidenceNotes: "Evidence text",
    attachmentUrls: ["/objects/a.pdf"],
    invoiceGroupId: 9001,
    ...overrides,
  };
}

test("assembleGroupSubmission: happy path returns a coherent group", () => {
  const group = assembleGroupSubmission([
    makeRow({ id: 1, confNumber: "A" }),
    makeRow({ id: 2, confNumber: "B" }),
  ]);
  assert.equal(group.groupId, 9001);
  assert.equal(group.invoiceNumber, "INV-9001");
  assert.equal(group.legs.length, 2);
  assert.deepEqual(group.legs.map((l) => l.id), [1, 2]);
});

test("assembleGroupSubmission: empty rows throws EmptyGroupError", () => {
  assert.throws(() => assembleGroupSubmission([]), EmptyGroupError);
});

test("assembleGroupSubmission: empty descriptionHtml throws MissingDescriptionError", () => {
  assert.throws(
    () => assembleGroupSubmission([makeRow({ descriptionHtml: "   " })]),
    MissingDescriptionError,
  );
});

test("assembleGroupSubmission: empty confNumber on any leg throws MissingConfNumberError", () => {
  try {
    assembleGroupSubmission([
      makeRow({ id: 1, confNumber: "A" }),
      makeRow({ id: 2, confNumber: "" }),
    ]);
    assert.fail("expected MissingConfNumberError");
  } catch (err) {
    assert.ok(err instanceof MissingConfNumberError);
    assert.equal((err as MissingConfNumberError).legId, 2);
  }
});

test("assembleGroupSubmission: divergent invoiceNumber across legs throws InvoiceNumberMismatchError", () => {
  try {
    assembleGroupSubmission([
      makeRow({ id: 1, invoiceNumber: "INV-9001" }),
      makeRow({ id: 2, invoiceNumber: "INV-WRONG" }),
    ]);
    assert.fail("expected InvoiceNumberMismatchError");
  } catch (err) {
    assert.ok(err instanceof InvoiceNumberMismatchError);
    assert.equal((err as InvoiceNumberMismatchError).legId, 2);
    assert.equal((err as InvoiceNumberMismatchError).expected, "INV-9001");
    assert.equal((err as InvoiceNumberMismatchError).seen, "INV-WRONG");
  }
});

test("assembleGroupSubmission: divergent attachmentUrls across legs throws AttachmentDriftError", () => {
  try {
    assembleGroupSubmission([
      makeRow({ id: 1, attachmentUrls: ["/objects/a.pdf", "/objects/b.pdf"] }),
      makeRow({ id: 2, attachmentUrls: ["/objects/a.pdf"] }),
    ]);
    assert.fail("expected AttachmentDriftError");
  } catch (err) {
    assert.ok(err instanceof AttachmentDriftError);
    assert.equal((err as AttachmentDriftError).legId, 2);
    assert.equal((err as AttachmentDriftError).headCount, 2);
    assert.equal((err as AttachmentDriftError).legCount, 1);
  }
});

test("assembleGroupSubmission: attachment list order does not matter (sorted comparison)", () => {
  // Drift check is set-equality, not list-equality — same urls in a
  // different order is the same set of evidence and must not throw.
  const group = assembleGroupSubmission([
    makeRow({ id: 1, attachmentUrls: ["/objects/a.pdf", "/objects/b.pdf"] }),
    makeRow({ id: 2, attachmentUrls: ["/objects/b.pdf", "/objects/a.pdf"] }),
  ]);
  assert.equal(group.legs.length, 2);
});

test("assembleGroupSubmission: rows from different invoiceGroupIds throws (programmer error)", () => {
  assert.throws(
    () =>
      assembleGroupSubmission([
        makeRow({ id: 1, invoiceGroupId: 9001 }),
        makeRow({ id: 2, invoiceGroupId: 9002 }),
      ]),
    /invoiceGroupId/,
  );
});

test("runBatchWorker: empty group throws the named EmptyGroupError (not a generic Error)", async () => {
  const launchCalls = { count: 0 };
  __setChromiumForTests(makeFakeChromium(launchCalls));
  try {
    await assert.rejects(() => runBatchWorker(makeGroup(0), false), EmptyGroupError);
    assert.equal(launchCalls.count, 0);
  } finally {
    __setChromiumForTests(null);
  }
});
