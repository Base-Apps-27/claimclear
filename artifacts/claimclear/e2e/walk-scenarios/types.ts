// Shared types for the queue-walk smoke harness.
//
// A `WalkScenario` is a fully self-contained recipe for one Queue
// page walk: the seed group + legs + their decision trees, the
// initial server state, the script the operator runs against the
// `WalkDriver`, and any post-run assertions on the mock state ledger.
//
// The harness wires every `/api/*` request to the in-memory
// `WalkMockState`. No production code knows about this file.

import type { Page } from "@playwright/test";
import type { DecisionTree } from "../../src/components/decision-tree/types";

/** Wire-level invoice phase — mirrors `InvoicePhase` from
 *  `@workspace/vocab` without taking a runtime dep on it. */
export type InvoicePhase =
  | "triage"
  | "ready_to_submit"
  | "submitted"
  | "response_received"
  | "reviewed"
  | "awaiting_reattestation"
  | "closed";

/** Operator-facing UI stage as exposed by `data-hero` on the inline
 *  workspace. Higher-level than `InvoicePhase` — these are the stages
 *  the operator actually walks through ("generate the preview",
 *  "review the draft", …). */
export type WalkStage =
  | "classify"
  | "sop"
  | "resolved"
  | "generate"
  | "review"
  | "ready"
  | "submitted"
  | "empty";

/** SOP terminal outcome stamped on a leg by `/sop-advance`. The mock
 *  picks one based on the answer label (see `mock-builder.ts`). */
export type SopOutcome =
  | "portal_dispute"
  | "dispute"
  | "non_issue"
  | "cannot_dispute"
  | "hold";

/** Per-leg seed for a scenario. The decision tree is shown to the
 *  operator in the SopAdvancePlayer; option labels are used by the
 *  mock to decide what `sopOutcome` to stamp (see `OUTCOME_BY_ANSWER`
 *  in `mock-builder.ts`). */
export interface WalkLegSeed {
  id: number;
  confNumber: string;
  errorTypeId: string;
  errorTypeName: string;
  tree: DecisionTree;
}

/** Per-test mock state. The harness mutates this in place from inside
 *  every route handler so cause-and-effect across requests is local
 *  and inspectable. `callOrder` is the ordering ledger tests assert on. */
export interface WalkMockState {
  groupId: number;
  invoiceNumber: string;
  phase: InvoicePhase;
  understandingReadbackAt: string | null;
  previewGeneratedAt: string | null;
  draftReviewedAt: string | null;
  holdReason: string | null;
  groupHoldPlacedAt: string | null;
  /** Closure outcome stamped by PATCH /api/invoice-groups/:id/outcome.
   *  `null` until the operator runs the structured closure intake. */
  outcome: string | null;
  closureReason: string | null;
  closureCategory: string | null;
  closureNarrative: string | null;
  /** Last body posted to the closure endpoint, for assertions. */
  lastClosureBody: unknown;
  /** Per-leg state keyed by leg id. */
  legs: Map<number, MockLegState>;
  /** Append-only call ledger: one label per commit-affecting POST/DELETE. */
  callOrder: string[];
  /** Body of the last create-portal-submission POST, for assertions. */
  portalSubmissionBody: unknown;
  /** When set, the stamp-preview-generated route returns this status
   *  with an error body instead of advancing the group. Used by
   *  failure-path scenarios (e.g. preview generation fails). */
  failPreviewWith: number | null;
  /** Stash of leg-by-error-type so the SOP player resolves trees. */
  errorTypeIndex: Map<string, { id: string; name: string; tree: DecisionTree }>;
  /** Optional payor-email bounce state. When set, the group detail
   *  surfaces a bounce-warning banner and the submit CTA is gated.
   *  Pinned by scenario-24. The bounce-detection mechanism itself
   *  lives on the API server and is out of scope for the harness. */
  payorEmailBounceState: {
    kind: "hard_bounced";
    email: string;
    reason: string;
    bouncedAt: string;
  } | null;
  /** Shared presence ledger keyed by `${resourceType}:${resourceId}`,
   *  inner map keyed by lowercased userEmail. Heartbeat upserts an
   *  entry; leave deletes it; the GET handler returns the entries
   *  excluding the requester (matches `/api/presence` server contract).
   *  See scenario-13 for the cross-context concurrency check. */
  presence: Map<string, Map<string, PresenceLedgerEntry>>;
  /** When set, the next portal-submission POST is rejected with this
   *  HTTP status (and a JSON error body) instead of flipping the
   *  group to `submitted`. Cleared automatically after one failure so
   *  scenarios can stage "fail then retry succeeds" sequences by
   *  setting it again before each attempt. Used by Smoke #18 to pin
   *  the submit-fails error UI without touching production code. */
  submitFailWith: number | null;
  /** Operator-edited dispute write-up (Review phase). Persisted by
   *  POST /api/invoice-groups/:id/draft. `null` until the operator
   *  saves the first edit; the gauntlet falls back to the AI baseline
   *  fields below for initial render. */
  draftSubject: string | null;
  draftDescriptionHtml: string | null;
  /** AI baseline fields shown in the textarea before any edit. */
  aiBaselineSubject: string | null;
  aiBaselineDescriptionHtml: string | null;
}

export interface PresenceLedgerEntry {
  userEmail: string;
  userName: string | null;
  lastHeartbeat: string;
}

export interface MockLegState {
  id: number;
  confNumber: string;
  errorTypeId: string;
  errorTypeName: string;
  sopNodeId: string | null;
  sopOutcome: SopOutcome | null;
  sopAnswers: Array<{ nodeId: string; answer: string; ts: string }>;
  includedInDispute: boolean;
  dropReason: "non_issue" | "cannot_dispute" | null;
  duplicateOfClaimId: number | null;
  holdReason: string | null;
  holdPendingFrom: string | null;
}

/** Lightweight shape passed to a scenario's `run` callback. The
 *  scenario doesn't import the driver class directly so adding new
 *  verbs only requires extending this interface + the implementation. */
export interface WalkDriverApi {
  page: Page;
  state: WalkMockState;

  /** Navigate to `/queue?group={GROUP_ID}` and wait for the inline
   *  workspace to mount. */
  openClaim: () => Promise<void>;

  /** Click the leg tab and wait for it to become active. */
  selectLeg: (legId: number) => Promise<void>;

  /** Click the "Start walk" CTA on the SOP hero. Idempotent — no-op
   *  if the player is already mounted. */
  startWalk: () => Promise<void>;

  /** End-to-end "this leg is viable" walk: select the leg, start
   *  the walk if needed, click the option labeled "Viable" (or the
   *  override), and wait for the include terminal to render. */
  markLegViable: (legId: number, optionLabel?: string) => Promise<void>;

  /** End-to-end "this leg is a non-issue" walk: select the leg,
   *  start the walk if needed, click the option labeled "Non-issue"
   *  (or the override), and wait for the closed terminal to render. */
  markLegNonIssue: (legId: number, optionLabel?: string) => Promise<void>;

  /** Open the per-leg hold dialog, pick a reason, submit. */
  placeLegHold: (legId: number, opts?: { reason?: string; note?: string }) => Promise<void>;

  /** Click the per-leg "Release leg hold" button. */
  releaseLegHold: (legId: number) => Promise<void>;

  /** Click the GeneratePreviewHero CTA. */
  generatePreview: () => Promise<void>;

  /** Click the ReviewHero "Mark reviewed" CTA. */
  markReviewed: () => Promise<void>;

  /** Click the pinned-footer Submit CTA. */
  submit: () => Promise<void>;

  /** POST `/api/invoice-groups/:id/reattest/queue` to park survivors
   *  on the Attestation Queue. The Queue page workspace has no UI
   *  affordance for this — the operator triggers it from the invoice
   *  detail page's `InvoiceGroupActionSlot` — so the harness fires
   *  the request directly to keep the scenario self-contained while
   *  still proving the route ledger and the resulting macroPhase. */
  queueReattest: () => Promise<void>;

  /** Assert the inline-workspace's `data-phase` attribute matches.
   *  Wire-level — for ordering against backend lifecycle states. */
  expectPhase: (phase: InvoicePhase) => Promise<void>;

  /** Assert the inline-workspace is on a given operator-facing stage
   *  (the `data-hero` attribute). Higher-level than `expectPhase` —
   *  e.g. `expectStage('review')` reads as "we're on the review-the-
   *  draft hero" without the test having to know the wire phase. */
  expectStage: (stage: WalkStage) => Promise<void>;
}

/** A single scenario manifest. */
export interface WalkScenario {
  /** Stable name used as the Playwright test title. */
  name: string;
  /** Human-readable summary printed in the test header. */
  description: string;
  /** Initial server state factory. The harness runs this once per
   *  test to get a fresh `WalkMockState` so scenarios can share
   *  helpers without leaking state between runs. */
  seed: () => WalkMockState;
  /** Per-test scripted run, invoked with a `WalkDriverApi`. Required
   *  for single-context scenarios; ignored when `concurrent` is set. */
  run?: (driver: WalkDriverApi) => Promise<void>;
  /** Optional post-run assertions on the mock-state ledger. Use this
   *  for ordering / call-count invariants the UI alone cannot prove. */
  assert?: (state: WalkMockState) => void;
  /** Optional declarative call-ordering expectation. Each entry must
   *  appear in `state.callOrder`, and entries must appear in the
   *  given order (other unrelated calls between them are fine). The
   *  runner asserts this automatically before invoking `assert`. */
  expectedCallOrder?: string[];
  /** When set, the runner spins up a second Playwright `BrowserContext`
   *  with a distinct user identity and invokes `runConcurrent` with
   *  both drivers wired against the same shared `WalkMockState`.
   *  Pins the two-users-on-one-claim presence flow (Scenario #13). */
  concurrent?: ConcurrentScenarioOptions;
  /** Required when `concurrent` is set. Receives both drivers wired
   *  to the same shared mock state. */
  runConcurrent?: (
    a: WalkDriverApi,
    b: WalkDriverApi,
  ) => Promise<void>;
}

export interface ConcurrentScenarioOptions {
  /** Identity used for the first browser context. Defaults to the
   *  built-in OPERATOR_USER. */
  userA?: HarnessUser;
  /** Identity used for the second browser context. Defaults to a
   *  built-in `operator-two@example.test` second operator. */
  userB?: HarnessUser;
}

export interface HarnessUser {
  id: string;
  email: string;
  displayName: string;
}
