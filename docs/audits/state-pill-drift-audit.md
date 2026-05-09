# State-pill drift audit — Task #554

Generated 2026-05-09T01:38:15Z by:

```
pnpm --filter @workspace/scripts run check:vocab-drift
rg -n "<Badge\b" artifacts/claimclear/src artifacts/api-server/src --no-heading
rg -n "<TonePill\b" artifacts/claimclear/src artifacts/api-server/src --no-heading
rg -n "<StateBadge\b" artifacts/claimclear/src artifacts/api-server/src --no-heading
```

## 1. `check:vocab-drift` — forbidden-literal + forbidden-badge-state-expression scan

```

> @workspace/scripts@0.0.0 check:vocab-drift /home/runner/workspace/scripts
> tsx ./src/check-vocab-drift.ts

Vocabulary drift check passed.
```

Scanner contract (`scripts/src/check-vocab-drift.ts`):

1. **Forbidden literals** (`FORBIDDEN_LITERALS` in `@workspace/vocab`): 
   bare display strings like `"Excluded"`, `"Dropped"`, `"Non-Issue"`.
2. **Forbidden `<Badge>` state expressions** (`FORBIDDEN_BADGE_STATE_EXPRS`): 
   any `<Badge>` (or non-`<StateBadge>` JSX text node) rendering one of 
   `{group.status}`, `{group.outcome}`, `{group.phase}`, `{claim.status}`, 
   `{claim.outcome}`, `{leg.subStatus}`, `{verdict.outcome}`, 
   `{submission.status}`, etc. — any operator-facing chip showing those 
   six domains must route through `<StateBadge>`.

Per-line opt-out: `// vocab-allow-next-line` on the line above.

## 2. Remaining `<Badge>` usages (claimclear) after migration

Reviewer guidance: any `<Badge>` rendering a six-domain state value must 
be migrated. The scanner now enforces this; everything below was reviewed 
and is decorative (counts, sandbox markers, error-type chips, retry counters).

```
artifacts/claimclear/src/pages/portal-submissions.tsx:684:          {sharedBatch.succeeded > 0 && <Badge className="bg-green-100 text-green-700 border-0">{sharedBatch.succeeded} ok</Badge>}
artifacts/claimclear/src/pages/portal-submissions.tsx:685:          {sharedBatch.failed > 0 && <Badge variant="destructive">{sharedBatch.failed} failed</Badge>}
artifacts/claimclear/src/pages/portal-submissions.tsx:1010:            <Badge variant="outline" className="text-[10px] h-4 px-1 font-normal flex-shrink-0" data-testid={`row-leg-count-${sub.id}`}>
artifacts/claimclear/src/pages/portal-submissions.tsx:1027:            <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5">
artifacts/claimclear/src/pages/portal-submissions.tsx:1034:            <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5 text-amber-700 border-amber-400">
artifacts/claimclear/src/pages/portal-submissions.tsx:1047:              <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5 w-[88px] justify-center bg-green-50 text-green-700 border-green-300 flex-shrink-0" data-testid={`row-email-sent-${sub.id}`}>
artifacts/claimclear/src/pages/portal-submissions.tsx:1053:              <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5 font-mono bg-green-50 text-green-700 border-green-300">
artifacts/claimclear/src/pages/portal-submissions.tsx:1061:            <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5 bg-red-50 text-red-700 border-red-300 max-w-[200px]">
artifacts/claimclear/src/pages/portal-submissions.tsx:1088:            <Badge variant="outline" className="cursor-help text-[10px] h-5 px-1.5 bg-purple-50 text-purple-700 border-purple-300">
artifacts/claimclear/src/pages/portal-submissions.tsx:1209:                <Badge variant="outline" className={`${style.badgeClass} text-[10px] flex-shrink-0`} data-testid={`run-status-${run.batchId}`}>
artifacts/claimclear/src/pages/settings.tsx:249:                    <Badge variant={user.role === "admin" ? "default" : "secondary"} className="cursor-help">{user.role}</Badge>
artifacts/claimclear/src/pages/settings.tsx:268:                <Badge variant="destructive" className="ml-2">{pendingUsers.length} pending</Badge>
artifacts/claimclear/src/pages/settings.tsx:359:                            <Badge variant={u.role === "admin" ? "default" : "outline"} className="cursor-help">{u.role}</Badge>
artifacts/claimclear/src/pages/queue.tsx:632:        <Badge variant="secondary" data-testid={testid ? `${testid}-total` : undefined}>
artifacts/claimclear/src/pages/queue.tsx:637:        <Badge
artifacts/claimclear/src/pages/queue.tsx:651:        <Badge
artifacts/claimclear/src/pages/queue.tsx:666:        <Badge
artifacts/claimclear/src/pages/queue.tsx:680:        <Badge
artifacts/claimclear/src/pages/queue.tsx:1881:                <Badge variant="secondary" data-testid="badge-classification-count">
artifacts/claimclear/src/pages/queue.tsx:1912:              <Badge variant="outline" className="text-[10px]">All caught up</Badge>
artifacts/claimclear/src/pages/queue.tsx:2027:              <Badge
artifacts/claimclear/src/pages/queue.tsx:2035:              <Badge variant="secondary" className="text-[10px]">
artifacts/claimclear/src/pages/queue.tsx:2040:              <Badge variant="outline" className="text-[10px] text-muted-foreground">
artifacts/claimclear/src/pages/error-types.tsx:513:                    {et.category && <Badge variant="outline" className="mt-1">{et.category}</Badge>}
artifacts/claimclear/src/pages/error-types.tsx:529:                    <Badge variant="secondary" className="text-green-700"><TreeDeciduous className="h-3 w-3 mr-1" />Workflow Tree</Badge>
artifacts/claimclear/src/pages/error-types.tsx:531:                    <Badge variant="destructive" className="text-xs"><AlertTriangle className="h-3 w-3 mr-1" />No Workflow</Badge>
artifacts/claimclear/src/pages/error-types.tsx:534:                    <Badge variant="secondary" className="text-purple-700"><Mail className="h-3 w-3 mr-1" />Direct Email</Badge>
artifacts/claimclear/src/pages/error-types.tsx:536:                    <Badge variant="secondary" className="text-blue-700"><MapPin className="h-3 w-3 mr-1" />GPS Control Deviation</Badge>
artifacts/claimclear/src/pages/error-types.tsx:539:                    <Badge variant="secondary"><FileText className="h-3 w-3 mr-1" />Custom Dispute Instructions</Badge>
artifacts/claimclear/src/pages/error-types.tsx:541:                    <Badge variant="outline" className="text-muted-foreground"><FileText className="h-3 w-3 mr-1" />Using Default Instructions</Badge>
artifacts/claimclear/src/pages/error-types.tsx:682:                        <Badge variant="outline" className="text-[10px] px-1 py-0">default</Badge>
artifacts/claimclear/src/pages/error-types.tsx:760:                    <Badge variant="secondary" className="text-xs">Custom Override</Badge>
artifacts/claimclear/src/pages/responses-awaiting-review.tsx:364:            <Badge variant="secondary" data-testid="page-count-badge">
artifacts/claimclear/src/pages/responses-awaiting-review.tsx:1497:                <Badge variant="secondary" className="text-[10px]">
artifacts/claimclear/src/pages/admin-user-activity.tsx:217:                  <TableCell><Badge variant="secondary">{ACTION_CATEGORY_LABELS[item.category as ActionCategory] || item.category}</Badge></TableCell>
artifacts/claimclear/src/pages/invoice-groups.tsx:920:                                  <Badge variant="secondary" className="text-xs">{group.rideCount} ride{group.rideCount !== 1 ? "s" : ""}</Badge>
artifacts/claimclear/src/pages/import.tsx:1038:          <Badge variant="outline" className="text-xs">
artifacts/claimclear/src/pages/import.tsx:1054:                  <Badge variant={s.used ? "default" : "outline"} className={`text-[10px] ${s.used ? "" : "opacity-60"}`}>
artifacts/claimclear/src/pages/system-health.tsx:35:      return <Badge className="bg-green-600 text-white">{status}</Badge>;
artifacts/claimclear/src/pages/system-health.tsx:37:      return <Badge className="bg-blue-500 text-white">{status}</Badge>;
artifacts/claimclear/src/pages/system-health.tsx:39:      return <Badge className="bg-amber-500 text-white">{status}</Badge>;
artifacts/claimclear/src/pages/system-health.tsx:42:      return <Badge className="bg-rose-600 text-white">{status}</Badge>;
artifacts/claimclear/src/pages/system-health.tsx:44:      return <Badge variant="secondary">{status}</Badge>;
artifacts/claimclear/src/pages/system-health.tsx:287:                  <Badge className="bg-amber-500 text-white">
artifacts/claimclear/src/pages/system-health.tsx:312:                              <Badge variant="secondary">{r.roleVariant}</Badge>
artifacts/claimclear/src/pages/system-health.tsx:319:                              <Badge className="bg-green-600 text-white">sent</Badge>
artifacts/claimclear/src/pages/system-health.tsx:321:                              <Badge className="bg-rose-600 text-white">failed</Badge>
artifacts/claimclear/src/pages/system-health.tsx:420:                      <Badge className="bg-blue-500 text-white">Running</Badge>
artifacts/claimclear/src/pages/system-health.tsx:422:                      <Badge className="bg-rose-600 text-white">Last run failed</Badge>
artifacts/claimclear/src/pages/system-health.tsx:424:                      <Badge className="bg-green-600 text-white">Idle</Badge>
artifacts/claimclear/src/pages/withdrawals.tsx:597:                            <Badge
artifacts/claimclear/src/pages/withdrawals.tsx:628:                              <Badge className="bg-green-100 text-green-800 border border-green-300 text-[10px] uppercase font-bold">
artifacts/claimclear/src/components/portal-submission-drawer.tsx:299:              <Badge className="bg-blue-600 text-white border-0 text-[10px] tracking-wider px-1.5 py-0.5 gap-1 flex-shrink-0">
artifacts/claimclear/src/components/inline-group-workspace-v3.tsx:931:        <Badge variant="outline" className="text-[10px] font-normal ml-1">
artifacts/claimclear/src/components/inline-group-workspace-v3.tsx:2388:            <Badge variant="secondary" className="text-[10px]">
artifacts/claimclear/src/components/inline-group-workspace-v3.tsx:2649:          <Badge variant="secondary" className="text-[10px]">
artifacts/claimclear/src/components/inline-group-workspace-v3-extras.tsx:1072:          <Badge variant="outline" className="text-[10px] font-normal">
artifacts/claimclear/src/components/inline-group-workspace-v3-extras.tsx:1076:          <Badge variant="outline" className="text-[10px] font-normal italic">
artifacts/claimclear/src/components/inline-group-workspace-v3-extras.tsx:1092:        <Badge
artifacts/claimclear/src/components/response-actions-card.tsx:77:          <Badge
artifacts/claimclear/src/components/leg-conclusion-row.tsx:334:                <Badge variant="outline" className="text-[10px]">
artifacts/claimclear/src/components/per-leg-verdict-picker.tsx:196:            <Badge variant="outline" className="text-[10px]">
artifacts/claimclear/src/components/per-leg-verdict-picker.tsx:333:            <Badge variant="secondary" className="text-[10px]">
artifacts/claimclear/src/components/invoice-group-submission-gauntlet.tsx:336:              <Badge variant="outline" className="text-[10px] font-normal">Optional</Badge>
artifacts/claimclear/src/components/invoice-group-submission-gauntlet.tsx:344:                <Badge variant="secondary" className="text-[10px]">
artifacts/claimclear/src/components/invoice-group-submission-gauntlet.tsx:495:                    <Badge variant="secondary" className="text-[10px]">
artifacts/claimclear/src/components/attestation/per-leg-row.tsx:99:        <Badge variant="outline" className="text-[10px] uppercase tracking-wide font-bold">
artifacts/claimclear/src/components/withdrawal-review-drawer.tsx:114:              <Badge
artifacts/claimclear/src/components/withdrawal-review-drawer.tsx:124:                <Badge className="bg-green-100 text-green-800 border border-green-300 text-[10px] uppercase tracking-wide font-bold">
artifacts/claimclear/src/components/withdrawal-review-drawer.tsx:192:                  <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
artifacts/claimclear/src/components/attestation/group-review-pane.tsx:123:                <Badge
artifacts/claimclear/src/components/attestation/group-review-pane.tsx:278:                      <Badge
artifacts/claimclear/src/components/mas-action-checklist.tsx:224:              <Badge variant="secondary" className="text-[10px]">
artifacts/claimclear/src/components/attestation/queue-row.tsx:70:          <Badge
artifacts/claimclear/src/components/list-table/faceted-filter/facet-date-range.tsx:56:                  <Badge
artifacts/claimclear/src/components/attestation/queue-sidebar.tsx:34:        <Badge
artifacts/claimclear/src/components/prompt-context-badge.tsx:40:          <Badge
artifacts/claimclear/src/components/decision-tree/sop-advance-player.tsx:1540:        {req.required && <Badge variant="secondary" className="text-[9px] h-4">Required</Badge>}
artifacts/claimclear/src/components/decision-tree/sop-advance-player.tsx:1683:            <Badge variant="secondary" className="h-4 px-1 text-[10px] font-medium">
artifacts/claimclear/src/components/decision-tree/sop-advance-player.tsx:1751:              <Badge
artifacts/claimclear/src/components/decision-tree/sop-advance-player.tsx:1841:              <Badge
artifacts/claimclear/src/components/decision-tree/sop-advance-player.tsx:1885:                      <Badge
artifacts/claimclear/src/components/decision-tree/sop-advance-player.tsx:1893:                    <Badge
artifacts/claimclear/src/components/activity-feed.tsx:236:                            <Badge
artifacts/claimclear/src/components/activity-feed.tsx:276:                                  <Badge
artifacts/claimclear/src/components/queue-needs-review-panel.tsx:452:            <Badge
artifacts/claimclear/src/components/communication/group-communication-thread.tsx:162:            <Badge variant="secondary" className="text-xs">
artifacts/claimclear/src/components/communication/group-communication-thread.tsx:166:              <Badge
artifacts/claimclear/src/components/communication/group-communication-thread.tsx:244:        <Badge
artifacts/claimclear/src/components/communication/group-communication-thread.tsx:345:            <Badge className="text-[10px] bg-blue-100 text-blue-800 border-blue-300">
artifacts/claimclear/src/components/decision-tree/editor.tsx:283:          <Badge variant="outline" className="gap-1 text-xs"><GitBranch className="h-3 w-3" />{stats.nodes} nodes</Badge>
artifacts/claimclear/src/components/decision-tree/editor.tsx:284:          <Badge variant="outline" className="gap-1 text-xs"><ArrowRight className="h-3 w-3" />{stats.paths} paths</Badge>
artifacts/claimclear/src/components/decision-tree/editor.tsx:285:          <Badge variant="outline" className="gap-1 text-xs"><Layers className="h-3 w-3" />{stats.depth} levels</Badge>
artifacts/claimclear/src/components/decision-tree/editor.tsx:373:                <Badge variant="outline" className="shrink-0 text-[10px]">
artifacts/claimclear/src/components/decision-tree/editor.tsx:556:              <Badge variant="outline" className="bg-white text-slate-500 font-medium font-mono text-[10px] tracking-wider uppercase">
artifacts/claimclear/src/components/decision-tree/editor.tsx:592:                    <Badge variant="secondary" className="bg-slate-100 text-slate-600 font-normal text-[10px] cursor-help">
artifacts/claimclear/src/components/decision-tree/editor.tsx:597:                    <Badge variant="secondary" className="bg-violet-50 text-violet-700 border-violet-200 font-normal text-[10px]">
artifacts/claimclear/src/components/decision-tree/editor.tsx:602:                    <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-indigo-200 font-normal text-[10px]">
artifacts/claimclear/src/components/mas-reattest-history.tsx:86:            <Badge variant="outline" className="text-[10px] border-emerald-300 bg-white/60 text-emerald-800">
artifacts/claimclear/src/components/mas-reattest-history.tsx:119:          <Badge variant="outline" className="text-[10px] border-amber-300 bg-white/60 text-amber-800">
artifacts/claimclear/src/components/mas-reattest-history.tsx:153:            <Badge variant="outline" className="text-[10px] border-emerald-300 bg-white/60 text-emerald-800">
artifacts/claimclear/src/components/mas-reattest-history.tsx:186:          <Badge variant="outline" className="text-[10px] border-amber-300 bg-white/60 text-amber-800">
artifacts/claimclear/src/components/decision-tree/player.tsx:349:          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Test Mode</Badge>
artifacts/claimclear/src/components/decision-tree/player.tsx:473:        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">Test Mode - no changes will be saved</Badge>
artifacts/claimclear/src/components/decision-tree/player.tsx:584:                      {req.required && <Badge variant="secondary" className="text-[9px] h-4">Required</Badge>}
artifacts/claimclear/src/components/decision-tree/player.tsx:836:          <Badge variant="outline" className="text-[10px] truncate max-w-[40%]">{step.answer}</Badge>
artifacts/claimclear/src/components/conversations-card.tsx:127:          <Badge variant="secondary">{totalMessages}</Badge>
artifacts/claimclear/src/components/conversations-card.tsx:341:                    <Badge variant="outline" className={`text-xs cursor-help ${meta.className}`}>
artifacts/claimclear/src/components/conversations-card.tsx:572:    <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 cursor-pointer">
artifacts/claimclear/src/components/conversations-card.tsx:673:            <Badge variant="outline" className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
artifacts/claimclear/src/components/conversations-card.tsx:678:            <Badge variant="secondary" className="text-[10px] bg-yellow-100 text-yellow-800">
artifacts/claimclear/src/components/conversations-card.tsx:762:              <Badge variant="outline" className={`text-[10px] capitalize ${confColors[conf] || ""}`}>
artifacts/claimclear/src/components/decision-tree/plain-text-editor.tsx:476:            <Badge variant="outline" className="gap-1 text-xs">
artifacts/claimclear/src/components/decision-tree/plain-text-editor.tsx:481:              <Badge variant="secondary" className="gap-1 text-xs bg-amber-50 text-amber-800 border-amber-200">
artifacts/claimclear/src/components/decision-tree/plain-text-editor.tsx:487:              <Badge variant="secondary" className="gap-1 text-xs bg-violet-50 text-violet-800 border-violet-200">
artifacts/claimclear/src/components/decision-tree/plain-text-editor.tsx:574:                <Badge variant="outline" className="font-mono text-[10px] tracking-wider text-slate-500">
artifacts/claimclear/src/components/decision-tree/plain-text-editor.tsx:636:          <Badge variant="outline" className="text-[10px] py-0 h-4 bg-amber-50 text-amber-800 border-amber-200">
artifacts/claimclear/src/components/decision-tree/plain-text-editor.tsx:641:          <Badge variant="outline" className="text-[10px] py-0 h-4 text-slate-500">
artifacts/claimclear/src/components/decision-tree/plain-text-editor.tsx:660:                  <Badge
```

## 3. Remaining `<Badge>` usages (api-server)

```
(no matches — api-server has no JSX surfaces)
```

## 4. `<StateBadge>` callsite census (canonical state pills)

```
artifacts/claimclear/src/components/invoice-group-detail-v2.tsx:739:                  <StateBadge variant="status" value={group.status} justTransitioned={justShipped} />
artifacts/claimclear/src/components/invoice-group-detail-v2.tsx:1101:                        <StateBadge variant="subStatus" value={sub} leg={r} />
artifacts/claimclear/src/components/invoice-group-detail-v2.tsx:1227:                          <StateBadge
artifacts/claimclear/src/components/portal-submission-drawer.tsx:306:                <StateBadge variant="stage" value={submission.status} />
artifacts/claimclear/src/pages/portal-submissions.tsx:898:        <StateBadge variant="stage" value={status} />
artifacts/claimclear/src/pages/portal-submissions.tsx:1017:      <StateBadge
artifacts/claimclear/src/pages/queue.tsx:1396:            <StateBadge variant="status" value={group.status} />
artifacts/claimclear/src/pages/queue.tsx:2025:            <StateBadge variant="status" value={group.status} className="text-[10px]" />
artifacts/claimclear/src/pages/responses-awaiting-review.tsx:730:          <StateBadge variant="status" value={group.status} />
artifacts/claimclear/src/components/state-legend.tsx:14:// row in the popover renders a real `<StateBadge>` so the legend stays
artifacts/claimclear/src/components/state-legend.tsx:99:                  <StateBadge
artifacts/claimclear/src/pages/invoice-groups.tsx:959:                              <td className={`px-4 ${tdPy}`}><StateBadge variant="status" value={group.status} /></td>
artifacts/claimclear/src/components/leg-sub-status-pill.tsx:8:// Thin facade over `<StateBadge variant="subStatus" …>`. Kept so the
artifacts/claimclear/src/components/leg-sub-status-pill.tsx:29:    <StateBadge
artifacts/claimclear/src/pages/claims.tsx:812:                              <td className={`px-4 ${tdPy}`}><StateBadge variant="status" value={claim.status} row={claim} /></td>
artifacts/claimclear/src/components/invoice-group-detail-v2-rides-legs.test.tsx:96:  // Task #554 — the row pill now goes through `<StateBadge
artifacts/claimclear/src/components/invoice-group-detail-v2-rides-legs.test.tsx:103:    /<StateBadge[^>]*variant="subStatus"[^>]*\bleg=\{r\}/,
artifacts/claimclear/src/components/claim-detail-v2.tsx:836:                  <StateBadge
artifacts/claimclear/src/components/claim-detail-v2.tsx:1724:                    value={<StateBadge variant="status" value={parentGroup.status} />}
artifacts/claimclear/src/components/claim-detail-v2.tsx:1762:                    <StateBadge variant="verdict" value={verdict.outcome} />
artifacts/claimclear/src/components/attestation/completed-detail-pane.tsx:192:          <StateBadge
artifacts/claimclear/src/components/cohesion/tone-pill.tsx:5:// `Tone` background — used by the unified `<StateBadge>` (which adds
artifacts/claimclear/src/components/cohesion/tone-pill.tsx:14:// last two into `<StateBadge variant="status" …>` and deletes the
```

## 5. `<TonePill>` callsite census (decorative chips, intentionally NOT state)

```
artifacts/claimclear/src/components/state-badge.tsx:277:        <TonePill
artifacts/claimclear/src/pages/import.tsx:1240:                  <TonePill tone={conf.tone}>{conf.label}</TonePill>
artifacts/claimclear/src/pages/attestation-queue.tsx:46:            <TonePill
artifacts/claimclear/src/pages/attestation-queue.tsx:53:            <TonePill
artifacts/claimclear/src/components/claim-detail-v2.tsx:1776:                    <TonePill tone="muted">No verdict yet</TonePill>
artifacts/claimclear/src/components/claim-detail-v2.tsx:1804:                      <TonePill tone="green">MAS completed</TonePill>
artifacts/claimclear/src/components/claim-detail-v2.tsx:1810:                    <TonePill tone="amber">Cancel required</TonePill>
artifacts/claimclear/src/components/attestation/completed-detail-pane.tsx:85:                <TonePill
artifacts/claimclear/src/components/attestation/completed-detail-pane.tsx:197:          <TonePill
artifacts/claimclear/src/components/attestation/queue-workspace.tsx:181:                      <TonePill tone={tone} className="text-[10px] uppercase tracking-wide font-bold">
artifacts/claimclear/src/components/attestation/per-leg-row.tsx:104:            <TonePill tone="green" className="text-[10px]">
artifacts/claimclear/src/components/attestation/per-leg-row.tsx:109:          <TonePill
artifacts/claimclear/src/components/attestation/group-review-pane.tsx:132:                    <TonePill tone="purple" className="text-[10px] font-mono">
artifacts/claimclear/src/components/attestation/completed-workspace.tsx:199:                  <TonePill tone="green" className="text-[10px] uppercase tracking-wide font-bold">
```

## Triage (post-migration)

Audit on 2026-05-09:

- Every six-domain state pill in claimclear renders through `<StateBadge>`.
- Portal-submission `status` (which IS the `stage` domain) was migrated to `<StateBadge variant="stage">` in `pages/portal-submissions.tsx` (3 callsites) and `components/portal-submission-drawer.tsx`.
- The classification-inbox row in `pages/queue.tsx` was migrated to `<StateBadge variant="status">`.
- The "Already closed — outcome …" inline text in `invoice-group-detail-v2.tsx` was rewritten to render `outcomeLabel(group.outcome)` from the glossary instead of the raw enum value.
- Remaining `<Badge>` instances in claimclear are decorative: leg counts, error-type chips, sandbox markers, retry counters, system-health hardware status, sibling-duplicate markers. None render one of the six state domains.
- api-server has no JSX surfaces — N/A.
