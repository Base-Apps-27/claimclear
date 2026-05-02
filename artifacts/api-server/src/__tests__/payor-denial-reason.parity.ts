// Compile-time parity guard for the payor-denial-reason vocabulary
// (Task #321).
//
// Single source of truth: `PAYOR_DENIAL_REASON_CODES` in
// `@workspace/payor-denial-reasons` (which derives the
// `PayorDenialReasonCode` union from that const-array literal).
//
// The OpenAPI spec (`lib/api-spec/openapi.yaml`) declares the SAME
// vocabulary as the `PayorDenialReasonCode` enum, and orval emits a
// TypeScript mirror at
// `lib/api-zod/src/generated/types/payorDenialReasonCode.ts`, re-exported
// from `@workspace/api-zod` as both a value (`PayorDenialReasonCode`,
// the orval-generated `as const` object) and a type
// (`PayorDenialReasonCodeType`).
//
// This file imports BOTH the source union and the generated mirror, then
// uses TypeScript's structural typing to assert the two unions are
// EXACTLY equal — same members, no extras, no omissions, in either
// direction. If anyone edits one source without updating the other, this
// file STOPS COMPILING (the line marked "ASSERTION" below errors with
// "Type 'true' is not assignable to type 'false'") and the broken mirror
// surfaces at `tsc -b` time, not just when tests happen to run.
//
// Filename is `.ts` (not `.test.ts`) on purpose: `node --test` won't
// execute it (no test() calls anyway), but it IS included in the
// api-server tsconfig's `src/**` glob, so `pnpm tsc -b` (and any IDE
// that runs the project references) will check it.
//
// We additionally pin the runtime values of the orval-generated `const`
// object to the source array via `satisfies`. The compile-time `Equal`
// check covers type drift; the `satisfies` block here covers the rare
// case where orval's value-level mirror disagrees with its own type
// (e.g. an upstream codegen bug that emits a key without the matching
// value). Both must hold.

import {
  PAYOR_DENIAL_REASON_CODES,
  type PayorDenialReasonCode as SourceCode,
} from "@workspace/payor-denial-reasons";
import {
  PayorDenialReasonCode as GeneratedConst,
  type PayorDenialReasonCodeType as GeneratedCode,
} from "@workspace/api-zod";

// `Equal<A, B>` is the standard "type-level equality" trick: it returns
// `true` only when A and B are mutually assignable in BOTH directions
// (so it catches "GeneratedCode has an extra member" AND "SourceCode has
// an extra member" — a one-way `extends` check would miss one of those).
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

// ---- ASSERTION (compile-time) -------------------------------------------
// If this line ever errors with "Type 'true' is not assignable to type
// 'false'", the OpenAPI enum and the source union have drifted. Either
// add the missing member to `PAYOR_DENIAL_REASON_CODES` in
// `lib/payor-denial-reasons/src/index.ts` OR update the
// `PayorDenialReasonCode` enum in `lib/api-spec/openapi.yaml` and
// re-run `pnpm --filter @workspace/api-spec codegen`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _payorDenialReasonCodeUnionsAreEqual: Equal<SourceCode, GeneratedCode> = true;

// ---- value-level pin (also compile-time, via `satisfies`) ---------------
// Walk the source array and prove every entry is a value the generated
// `const PayorDenialReasonCode = { ... } as const` object also exposes
// (and vice versa via the union check above). This catches the case
// where the orval-emitted const object's *values* disagree with its own
// emitted *type* — a separate failure mode the `Equal<>` line cannot see.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _payorDenialReasonCodeRuntimeValuesPinned = PAYOR_DENIAL_REASON_CODES.map(
  (code) => code,
) satisfies ReadonlyArray<(typeof GeneratedConst)[keyof typeof GeneratedConst]>;
