# State pill inventory (Task #554)

This audit enumerates every component that renders an operator-facing
state pill in `artifacts/claimclear/src` and classifies each by the
six-domain vocabulary (`@workspace/vocab`).

The migration target is a single `<StateBadge variant=… value=… />`
component sourced from the glossary; the parallel renderers
(`status-badge.tsx` and `cohesion/status-pill.tsx`) are deleted as
part of this task.

## Domain key

| Variant     | Domain                                       | Example values                           |
| ----------- | -------------------------------------------- | ---------------------------------------- |
| `phase`     | `invoice_phase` — outer-tier lifecycle       | `triage`, `submitted`, `closed`          |
| `status`    | `claim_status` — workflow status (cache)     | `New`, `Awaiting Response`, `Resolved`   |
| `subStatus` | `leg_sub_status` — inner-tier per-leg state  | `investigating`, `ready`, `dropped`      |
| `verdict`   | `verdict_outcome` — per-leg payor verdict    | `Approved`, `Denied`, `Partial`          |
| `outcome`   | `outcome` — terminal disposition             | `Approved`, `Non-Issue`, `Withdrawn`     |
| `stage`     | `submission_stage` — portal submission stage | `queued`, `submitted`, `failed`          |

## Inventory (operator-facing surfaces)

### Renderers collapsed by this task

| File | Line(s) | Old call | Domain |
| ---- | ------- | -------- | ------ |
| `components/status-badge.tsx` | 53 | `StatusBadge` (deleted) | status / outcome |
| `components/cohesion/status-pill.tsx` | 89, 105 | `StatusPillForStatus`, `StatusPillForRow` (deleted) | status |
| `components/leg-sub-status-pill.tsx` | 82 | `LegSubStatusPill` (now thin facade over `<StateBadge variant="subStatus">`) | subStatus |

### Consumer call sites migrated to `<StateBadge>`

| File | Line | Old call | New variant |
| ---- | ---- | -------- | ----------- |
| `pages/queue.tsx` | 1396 | `<StatusBadge status={group.status} />` | `status` |
| `pages/responses-awaiting-review.tsx` | 730 | `<StatusBadge status={group.status} />` | `status` |
| `pages/claims.tsx` | 811 | `<StatusPillForRow row={claim} />` | `status` (row-aware tone) |
| `pages/invoice-groups.tsx` | 929 | `<LegSubStatusPill subStatus={s} />` | `subStatus` |
| `pages/invoice-groups.tsx` | 958 | `<StatusPillForStatus status={group.status} />` | `status` |
| `components/invoice-group-legs-list.tsx` | 68 | `<LegSubStatusPill leg={r} />` | `subStatus` |
| `components/invoice-group-detail-v2.tsx` | 779 | `<StatusPill tone=… >{group.status}</StatusPill>` | `status` |
| `components/invoice-group-detail-v2.tsx` | 1141 | `<StatusPill tone=… >{legSubStatusDisplayLabel(sub, r)}</StatusPill>` | `subStatus` |
| `components/invoice-group-detail-v2.tsx` | 1267 | `<StatusPill tone=… >{group.outcome}</StatusPill>` | `outcome` |
| `components/claim-detail-v2.tsx` | 868 | `<StatusPill tone={subStatusTone}>…</StatusPill>` | `subStatus` |
| `components/claim-detail-v2.tsx` | 1752 | `<StatusPill tone=… >{parentGroup.status}</StatusPill>` | `status` |
| `components/claim-detail-v2.tsx` | 1790 | `<StatusPill tone=… >{verdict.outcome}</StatusPill>` | `verdict` |
| `components/leg-conclusion-row.tsx` | 332 | `<LegSubStatusPill leg={claim} />` | `subStatus` |

### Decorative tone pills (NOT state — kept as `<TonePill>`)

These render arbitrary content with a tone but are not bound to any of
the six state domains. They migrate from `StatusPill` (cohesion) to a
new presentational primitive `TonePill` so the deletion of the parallel
renderer doesn't strand legitimate decorative use.

| File | Line | Content | Why not state |
| ---- | ---- | ------- | ------------- |
| `pages/attestation-queue.tsx` | 46, 53 | "N open", "N completed" | counters, not state |
| `pages/import.tsx` | 1240 | row classification chip | import preview, not workflow state |
| `components/attestation/group-review-pane.tsx` | 132 | EOM marker | period label |
| `components/attestation/per-leg-row.tsx` | 104, 109 | "Already attested" / "Cancel required" | per-leg attestation flag, not the leg's sub-status |
| `components/attestation/queue-workspace.tsx` | 181 | tab counter chip | counter |
| `components/attestation/completed-workspace.tsx` | 199 | "DONE" stamp | terminal stamp, not a vocab value |
| `components/attestation/completed-detail-pane.tsx` | 85, 198 | per-section badges | counters |
| `components/claim-detail-v2.tsx` | 1806, 1834, 1840 | "No verdict yet" / "MAS completed" / "Cancel required" | empty/MAS-action prompts, not a vocab value |

## Drift guardrail

`pnpm --filter @workspace/scripts run check:vocab-drift` already scans
`artifacts/{claimclear,api-server}/src/**/*.tsx` for the four
forbidden literals (`"Excluded"`, `"Dropped"`, `"Non-Issue"`,
`"Non Issue"`) and the post-merge script now runs it on every merge
(see `scripts/post-merge.sh`).

The renderer-collapse keeps the surface area for future drift small:
adding a new state pill anywhere in the operator-facing artifacts
means using `<StateBadge>`, which routes through `@workspace/vocab` for
its label, tooltip, and tone family.
