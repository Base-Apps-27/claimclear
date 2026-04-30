import { z } from "zod";
import { CLOSURE_REASONS, CLOSURE_ACCOUNTABILITY_TAGS, type ClosureReason } from "@workspace/db";

const trimmed = (s: unknown) => (typeof s === "string" ? s.trim() : s);

const personRefSchema = z.object({
  name: z.preprocess(trimmed, z.string().min(1, "name is required")),
  id: z.preprocess(trimmed, z.string().optional().nullable()).optional(),
});

export const closureAccountabilityTagSchema = z.enum(CLOSURE_ACCOUNTABILITY_TAGS);

const isoDateLike = z.union([z.string().min(1), z.date()]).optional().nullable();

export const createClosureRequestSchema = z.object({
  outcome: z.enum(["Withdrawn", "Non-Issue"]),
  closureReason: z.enum(CLOSURE_REASONS),
  closureCategory: z.string().trim().min(1).optional().nullable(),
  closureCategoryOther: z.string().trim().optional().nullable(),
  closureRootCause: z.string().trim().optional().nullable(),
  closureRootCauseOther: z.string().trim().optional().nullable(),
  closureNarrative: z.string().optional().nullable(),
  closureAccountabilityTags: z.array(closureAccountabilityTagSchema).optional().nullable(),
  closureAccountabilityOther: z.string().trim().optional().nullable(),
  closureDrivers: z.array(personRefSchema).optional().nullable(),
  closureDispatchers: z.array(personRefSchema).optional().nullable(),
  closureCommunicatedTo: z.string().trim().optional().nullable(),
  closureAddressedAt: isoDateLike,
  closureAddressedBy: z.string().trim().optional().nullable(),
  closureAddressedByEmail: z.string().trim().optional().nullable(),
  closureReviewNotes: z.string().optional().nullable(),
  approvedAmount: z.union([z.string(), z.number()]).optional().nullable(),
  invoiceNumbers: z.string().optional().nullable(),
}).superRefine((val, ctx) => {
  const reason = val.closureReason as ClosureReason;
  if (val.outcome === "Non-Issue" && reason !== "non_issue") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Non-Issue outcome requires closureReason "non_issue".`, path: ["closureReason"] });
  }
  if (val.outcome === "Withdrawn" && !["not_contestable", "accepted_loss"].includes(reason)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Withdrawn outcome requires closureReason "not_contestable" or "accepted_loss".`, path: ["closureReason"] });
  }

  const requiresDetails = reason === "not_contestable" || reason === "non_issue";
  if (!requiresDetails) {
    return;
  }

  if (!val.closureCategory || val.closureCategory.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "closureCategory is required for this closure reason.", path: ["closureCategory"] });
  } else if (val.closureCategory === "other" && !val.closureCategoryOther?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "closureCategoryOther is required when closureCategory is 'other'.", path: ["closureCategoryOther"] });
  }

  if (!val.closureRootCause || val.closureRootCause.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "closureRootCause is required for this closure reason.", path: ["closureRootCause"] });
  } else if (val.closureRootCause === "other" && !val.closureRootCauseOther?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "closureRootCauseOther is required when closureRootCause is 'other'.", path: ["closureRootCauseOther"] });
  }

  const narrative = (val.closureNarrative ?? "").trim();
  if (narrative.length < 80) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "closureNarrative must be at least 80 characters.", path: ["closureNarrative"] });
  }

  const tags = val.closureAccountabilityTags ?? [];
  if (tags.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "At least one closureAccountabilityTags entry is required.", path: ["closureAccountabilityTags"] });
  }
  if (tags.includes("other") && !val.closureAccountabilityOther?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "closureAccountabilityOther is required when 'other' is selected.", path: ["closureAccountabilityOther"] });
  }
  if (tags.includes("driver")) {
    const drivers = val.closureDrivers ?? [];
    const valid = drivers.filter((d) => d?.name && d.name.trim().length > 0);
    if (valid.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "closureDrivers requires at least one entry with a name when 'driver' is selected.", path: ["closureDrivers"] });
    }
  }
  if (tags.includes("dispatcher")) {
    const dispatchers = val.closureDispatchers ?? [];
    const valid = dispatchers.filter((d) => d?.name && d.name.trim().length > 0);
    if (valid.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "closureDispatchers requires at least one entry with a name when 'dispatcher' is selected.", path: ["closureDispatchers"] });
    }
  }
});

export type CreateClosureRequest = z.infer<typeof createClosureRequestSchema>;

/**
 * Every request-body key that, if present, indicates the caller is
 * supplying structured closure detail. Routes use this list to decide
 * whether to invoke parseClosurePayload — so adding a field to the
 * canonical request schema only requires updating this list once.
 */
export const CLOSURE_DETAIL_FIELDS = [
  "closureCategory",
  "closureCategoryOther",
  "closureRootCause",
  "closureRootCauseOther",
  "closureNarrative",
  "closureAccountabilityTags",
  "closureAccountabilityOther",
  "closureDrivers",
  "closureDispatchers",
  "closureCommunicatedTo",
  "closureAddressedAt",
  "closureAddressedBy",
  "closureAddressedByEmail",
  "closureReviewNotes",
] as const;

export interface NormalizedClosure {
  outcome: "Withdrawn" | "Non-Issue";
  closureReason: ClosureReason;
  closureCategory: string | null;
  closureCategoryOther: string | null;
  closureRootCause: string | null;
  closureRootCauseOther: string | null;
  closureNarrative: string | null;
  closureAccountabilityTags: string[] | null;
  closureAccountabilityOther: string | null;
  closureDrivers: Array<{ name: string; id?: string | null }> | null;
  closureDispatchers: Array<{ name: string; id?: string | null }> | null;
  closureCommunicatedTo: string | null;
  closureAddressedAt: Date | null;
  closureAddressedBy: string | null;
  closureAddressedByEmail: string | null;
  closureReviewNotes: string | null;
  approvedAmount: string | null | undefined;
  invoiceNumbers: string | null | undefined;
}

function nullIfEmpty(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function toDateOrNull(v: string | Date | null | undefined): Date | null {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const t = v.trim();
  if (t.length === 0) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Validates a raw request body and returns a normalized payload ready for
 * persistence. Throws ClosureValidationError on validation failure with a
 * formatted message and field path.
 */
export function parseClosurePayload(raw: unknown): NormalizedClosure {
  const parsed = createClosureRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first.path.join(".");
    throw new ClosureValidationError(`${path ? `${path}: ` : ""}${first.message}`, parsed.error.issues);
  }
  const v = parsed.data;
  const tags = v.closureAccountabilityTags ?? null;
  const driversRaw = v.closureDrivers ?? null;
  const dispatchersRaw = v.closureDispatchers ?? null;
  const drivers = driversRaw
    ? driversRaw
        .filter((d) => d?.name && d.name.trim().length > 0)
        .map((d) => ({ name: d.name.trim(), id: d.id ? d.id.trim() : null }))
    : null;
  const dispatchers = dispatchersRaw
    ? dispatchersRaw
        .filter((d) => d?.name && d.name.trim().length > 0)
        .map((d) => ({ name: d.name.trim(), id: d.id ? d.id.trim() : null }))
    : null;
  return {
    outcome: v.outcome,
    closureReason: v.closureReason as ClosureReason,
    closureCategory: nullIfEmpty(v.closureCategory),
    closureCategoryOther: nullIfEmpty(v.closureCategoryOther),
    closureRootCause: nullIfEmpty(v.closureRootCause),
    closureRootCauseOther: nullIfEmpty(v.closureRootCauseOther),
    closureNarrative: v.closureNarrative ? v.closureNarrative.trim() : null,
    closureAccountabilityTags: tags && tags.length > 0 ? [...tags] : null,
    closureAccountabilityOther: nullIfEmpty(v.closureAccountabilityOther),
    closureDrivers: drivers && drivers.length > 0 ? drivers : null,
    closureDispatchers: dispatchers && dispatchers.length > 0 ? dispatchers : null,
    closureCommunicatedTo: nullIfEmpty(v.closureCommunicatedTo),
    closureAddressedAt: toDateOrNull(v.closureAddressedAt as string | Date | null | undefined),
    closureAddressedBy: nullIfEmpty(v.closureAddressedBy),
    closureAddressedByEmail: nullIfEmpty(v.closureAddressedByEmail),
    closureReviewNotes: v.closureReviewNotes ? v.closureReviewNotes.trim() : null,
    approvedAmount: v.approvedAmount === undefined || v.approvedAmount === null
      ? null
      : typeof v.approvedAmount === "number"
        ? String(v.approvedAmount)
        : v.approvedAmount,
    invoiceNumbers: v.invoiceNumbers ?? null,
  };
}

export class ClosureValidationError extends Error {
  issues: z.ZodIssue[];
  constructor(message: string, issues: z.ZodIssue[]) {
    super(message);
    this.name = "ClosureValidationError";
    this.issues = issues;
  }
}

/**
 * The verbatim CreateClosureRequest payload, surfaced under the audit
 * log's `metadata.closure` key. Field names match the request payload one
 * for one (camelCase, `closure*` prefix preserved) so downstream
 * consumers — activity feed, Withdrawals Review page, exports — can
 * render the closure without re-querying the row or remapping field
 * names.
 */
export function closureAuditPayload(c: NormalizedClosure) {
  return {
    outcome: c.outcome,
    closureReason: c.closureReason,
    closureCategory: c.closureCategory,
    closureCategoryOther: c.closureCategoryOther,
    closureRootCause: c.closureRootCause,
    closureRootCauseOther: c.closureRootCauseOther,
    closureNarrative: c.closureNarrative,
    closureAccountabilityTags: c.closureAccountabilityTags,
    closureAccountabilityOther: c.closureAccountabilityOther,
    closureDrivers: c.closureDrivers,
    closureDispatchers: c.closureDispatchers,
    closureCommunicatedTo: c.closureCommunicatedTo,
    closureAddressedAt: c.closureAddressedAt ? c.closureAddressedAt.toISOString() : null,
    closureAddressedBy: c.closureAddressedBy,
    closureAddressedByEmail: c.closureAddressedByEmail,
    closureReviewNotes: c.closureReviewNotes,
    approvedAmount: c.approvedAmount ?? null,
    invoiceNumbers: c.invoiceNumbers ?? null,
  };
}
