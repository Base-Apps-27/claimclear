#!/usr/bin/env node
// Saturday Load-Test Deep Mining — one-shot analyzer.
//
// Reads raw/*.json (dumped from the production read-replica), produces:
//   events.jsonl                   — unified event log
//   operators/<email>.jsonl        — per-operator event log
//   groups/<id>.jsonl              — per-group event log
//   sessions.csv                   — sessions per operator (15-min gap)
//   page_dwell.csv                 — dwell time per page per operator
//   page_transitions.csv           — Markov page transitions
//   page_sequences_n{2,3,4}.csv    — top N-step page sequences
//   action_transitions.csv         — Markov action transitions
//   action_sequences_n{2,3,4}.csv  — top N-step action sequences
//   timegaps.csv                   — gap distributions w/ p25/p50/p75/p90/p99
//   sop_node_heatmap.csv           — per-node SOP metrics + trouble score
//   terminal_funnel.csv            — error_type -> terminal outcome funnel
//   loops.csv                      — duplicate-node-answer + multi-restart legs
//   friction.csv                   — long dwell w/o mutation, back-navs, abandoned
//   regenerated_drafts.csv         — groups whose AI draft was regenerated
//
// The script is deterministic and re-runnable; bumping the SESSION_GAP_MIN
// constant only at the top reshuffles sessions.csv without touching anything
// else.

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(ROOT, 'raw');
const OUT = ROOT;
const SESSION_GAP_MIN = 15;
const SESSION_GAP_MS = SESSION_GAP_MIN * 60_000;
const TZ_LABEL = 'EDT (UTC-4) — Saturday May 9, 2026 local';
const WIN_START = '2026-05-09T04:00:00Z';
const WIN_END   = '2026-05-10T04:00:00Z';

const read = (n) => JSON.parse(fs.readFileSync(path.join(RAW, n), 'utf8'));
const audit = read('audit_logs.json');
const states = read('state_events.json');
const presence = read('presence_logs.json');
const verdicts = read('claim_verdict.json');
const subs = read('portal_submissions.json');
const bots = read('bot_activity_log.json');
const claims = read('claims_touched.json');
const groups = read('groups_touched.json');
const errorTypes = read('error_types.json');

const claimsById = new Map(claims.map(c => [c.id, c]));
const groupsById = new Map(groups.map(g => [g.id, g]));

// ─── 1. Unified event timeline ───────────────────────────────────────────────
const events = [];
const norm = (s) => (s ? s.toLowerCase() : null);

for (const a of audit) {
  events.push({
    ts: a.timestamp,
    operator: norm(a.user_email),
    record_type: a.invoice_group_id ? 'group' : (a.claim_id ? 'claim' : 'system'),
    record_id: a.invoice_group_id ?? a.claim_id ?? null,
    action: a.action,
    source: 'audit',
    payload: { details: a.details, metadata: a.metadata, claim_id: a.claim_id, group_id: a.invoice_group_id },
  });
}
for (const s of states) {
  events.push({
    ts: s.created_at,
    operator: norm(s.actor_user_id),
    record_type: s.invoice_group_id ? 'group' : (s.claim_id ? 'claim' : 'system'),
    record_id: s.invoice_group_id ?? s.claim_id ?? null,
    action: `state:${s.event_key}`,
    source: 'state_event',
    payload: { metadata: s.metadata, duration_ms: s.duration_ms, claim_id: s.claim_id, group_id: s.invoice_group_id },
  });
}
for (const p of presence) {
  events.push({
    ts: p.last_heartbeat,
    operator: norm(p.user_email),
    record_type: p.resource_type === 'invoice_group' ? 'group' : 'claim',
    record_id: p.resource_id,
    action: 'presence_heartbeat',
    source: 'presence',
    payload: { resource_type: p.resource_type, resource_id: p.resource_id },
  });
}
for (const v of verdicts) {
  events.push({
    ts: v.created_at,
    operator: norm(v.created_by),
    record_type: 'claim',
    record_id: v.claim_id,
    action: `verdict:${v.source}:${v.outcome}`,
    source: 'claim_verdict',
    payload: { confidence: v.confidence, inspection_time_ms: v.inspection_time_ms },
  });
}
for (const sb of subs) {
  events.push({
    ts: sb.created_at,
    operator: norm(sb.requester_email),
    record_type: 'group',
    record_id: sb.invoice_group_id,
    action: `submission_created:${sb.status}`,
    source: 'portal_submission',
    payload: { id: sb.id, status: sb.status, attempts: sb.attempts },
  });
  if (sb.submitted_at) {
    events.push({
      ts: sb.submitted_at,
      operator: norm(sb.claimed_by_user_name) || norm(sb.requester_email),
      record_type: 'group',
      record_id: sb.invoice_group_id,
      action: `submission_submitted`,
      source: 'portal_submission',
      payload: { id: sb.id },
    });
  }
}
for (const b of bots) {
  events.push({
    ts: b.created_at,
    operator: null,
    record_type: 'submission',
    record_id: b.submission_id,
    action: `bot:${b.action}:${b.success ? 'ok' : 'fail'}`,
    source: 'bot_activity',
    payload: { message: b.message },
  });
}
// claims.sop_answers is a state column, not an event log, so it has no
// per-answer timestamp. The chronology of SOP answers is *already* captured
// by audit_logs (`leg_sop_advanced` / `leg_sop_rewound` rows carry
// metadata.nodeId + metadata.answer), which is what every SOP analysis in
// this script consumes. We emit a single end-of-window snapshot per touched
// claim so per-claim event logs include the final sop_answers blob without
// inventing fake timestamps.
for (const c of claims) {
  if (!c.sop_answers || (Array.isArray(c.sop_answers) && c.sop_answers.length === 0)) continue;
  events.push({
    ts: c.updated_at || c.ready_at || c.created_at,
    operator: null,
    record_type: 'claim',
    record_id: c.id,
    action: 'claim_sop_state_snapshot',
    source: 'claim_state',
    payload: {
      sop_node_id: c.sop_node_id,
      sop_outcome: c.sop_outcome,
      sop_answers: c.sop_answers,
      error_type_id: c.error_type_id,
      error_type_name: c.error_type_name,
      disposition: c.disposition,
    },
  });
}

events.sort((a,b) => a.ts.localeCompare(b.ts));
fs.writeFileSync(path.join(OUT, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n'));

// Per-operator + per-group splits.
fs.mkdirSync(path.join(OUT, 'operators'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'groups'), { recursive: true });
const byOp = new Map();
const byGroup = new Map();
for (const e of events) {
  if (e.operator) {
    if (!byOp.has(e.operator)) byOp.set(e.operator, []);
    byOp.get(e.operator).push(e);
  }
  if (e.record_type === 'group' && e.record_id) {
    const k = String(e.record_id);
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(e);
  }
  // Also attribute leg events to their parent group for the per-group log.
  if (e.record_type === 'claim' && e.record_id) {
    const c = claimsById.get(e.record_id);
    if (c?.invoice_group_id) {
      const k = String(c.invoice_group_id);
      if (!byGroup.has(k)) byGroup.set(k, []);
      byGroup.get(k).push({ ...e, _via_claim: e.record_id });
    }
  }
}
for (const [op, arr] of byOp) {
  const safe = op.replace(/[^a-z0-9._-]/gi, '_');
  fs.writeFileSync(path.join(OUT, 'operators', `${safe}.jsonl`), arr.map(e => JSON.stringify(e)).join('\n'));
}
for (const [gid, arr] of byGroup) {
  fs.writeFileSync(path.join(OUT, 'groups', `${gid}.jsonl`), arr.map(e => JSON.stringify(e)).join('\n'));
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const csvEscape = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
};
const writeCsv = (name, header, rows) => {
  const lines = [header.join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  fs.writeFileSync(path.join(OUT, name), lines.join('\n'));
};
const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[i];
};
const stats = (vals) => {
  const s = vals.slice().sort((a,b)=>a-b);
  return {
    n: s.length,
    p25: quantile(s, 0.25),
    p50: quantile(s, 0.50),
    p75: quantile(s, 0.75),
    p90: quantile(s, 0.90),
    p99: quantile(s, 0.99),
    mean: s.length ? Math.round(s.reduce((a,b)=>a+b,0) / s.length) : null,
  };
};
const fmtMs = (ms) => ms == null ? '' : ms;

// ─── 2. Sessions per operator ────────────────────────────────────────────────
const sessionRows = [];
let sessionId = 0;
for (const [op, arr] of byOp) {
  const sorted = arr.slice().sort((a,b)=>a.ts.localeCompare(b.ts));
  let cur = null;
  for (const e of sorted) {
    const t = Date.parse(e.ts);
    if (!cur || t - cur.lastT > SESSION_GAP_MS) {
      if (cur) sessionRows.push(cur);
      sessionId++;
      cur = { sid: sessionId, operator: op, start: e.ts, end: e.ts, count: 1, firstT: t, lastT: t };
    } else {
      cur.end = e.ts;
      cur.count++;
      cur.lastT = t;
    }
  }
  if (cur) sessionRows.push(cur);
}
writeCsv('sessions.csv',
  ['session_id','operator','start_ts','end_ts','duration_ms','event_count'],
  sessionRows.map(s => [s.sid, s.operator, s.start, s.end, s.lastT - s.firstT, s.count]),
);

// ─── 3. Page dwell (presence heartbeats per resource per operator) ───────────
const pageDwell = []; // {operator, resource, dwell_ms, start, end}
for (const [op, arr] of byOp) {
  const heartbeats = arr.filter(e => e.action === 'presence_heartbeat')
    .sort((a,b)=>a.ts.localeCompare(b.ts));
  for (let i = 0; i < heartbeats.length - 1; i++) {
    const a = heartbeats[i], b = heartbeats[i+1];
    const dt = Date.parse(b.ts) - Date.parse(a.ts);
    if (dt > 0 && dt < 30 * 60_000) { // cap a single dwell at 30 min (heartbeat cadence)
      const resA = `${a.payload.resource_type}/${a.payload.resource_id}`;
      pageDwell.push({ operator: op, resource: resA, dwell_ms: dt, start: a.ts, end: b.ts });
    }
  }
}
writeCsv('page_dwell.csv',
  ['operator','resource','dwell_ms','start_ts','end_ts'],
  pageDwell.map(p => [p.operator, p.resource, p.dwell_ms, p.start, p.end]),
);

// ─── 4. Page-flow Markov + sequences ─────────────────────────────────────────
const pageTransitions = new Map();
const pageRevisits = new Map(); // operator -> {resource -> visit count}
const sequencesByN = { 2: new Map(), 3: new Map(), 4: new Map() };
for (const [op, arr] of byOp) {
  const heartbeats = arr.filter(e => e.action === 'presence_heartbeat')
    .sort((a,b)=>a.ts.localeCompare(b.ts));
  const visits = [];
  for (const h of heartbeats) {
    const k = `${h.payload.resource_type}/${h.payload.resource_id}`;
    if (!visits.length || visits[visits.length-1].k !== k) visits.push({ k, ts: h.ts });
  }
  if (!pageRevisits.has(op)) pageRevisits.set(op, new Map());
  const rv = pageRevisits.get(op);
  for (const v of visits) rv.set(v.k, (rv.get(v.k) ?? 0) + 1);
  for (let i = 0; i < visits.length - 1; i++) {
    const k = `${visits[i].k}\t${visits[i+1].k}`;
    pageTransitions.set(k, (pageTransitions.get(k) ?? 0) + 1);
  }
  for (const N of [2,3,4]) {
    for (let i = 0; i + N - 1 < visits.length; i++) {
      const seq = visits.slice(i, i+N).map(v => v.k).join(' → ');
      sequencesByN[N].set(seq, (sequencesByN[N].get(seq) ?? 0) + 1);
    }
  }
}

writeCsv('page_transitions.csv',
  ['from_resource','to_resource','count'],
  [...pageTransitions.entries()]
    .sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => { const [from,to] = k.split('\t'); return [from, to, v]; }),
);
for (const N of [2,3,4]) {
  writeCsv(`page_sequences_n${N}.csv`,
    ['sequence','count'],
    [...sequencesByN[N].entries()].sort((a,b)=>b[1]-a[1]).slice(0, 200).map(([k,v]) => [k, v]),
  );
}

// Page revisit counts (most-revisited resources).
const revisitRows = [];
for (const [op, m] of pageRevisits) {
  for (const [k, n] of m) if (n >= 2) revisitRows.push([op, k, n]);
}
revisitRows.sort((a,b)=>b[2]-a[2]);
writeCsv('page_revisits.csv', ['operator','resource','visit_count'], revisitRows);

// Per-page median dwell.
const dwellByPage = new Map();
for (const p of pageDwell) {
  if (!dwellByPage.has(p.resource)) dwellByPage.set(p.resource, []);
  dwellByPage.get(p.resource).push(p.dwell_ms);
}
const dwellPageRows = [...dwellByPage.entries()].map(([res, arr]) => {
  const s = stats(arr);
  return [res, s.n, s.p50, s.p75, s.p90];
}).sort((a,b)=>b[1]-a[1]);
writeCsv('page_dwell_by_page.csv',
  ['resource','samples','p50_ms','p75_ms','p90_ms'], dwellPageRows);

// ─── 5. Action-flow Markov + sequences ───────────────────────────────────────
// Mutation actions only (filter out presence/state-mirrors of audit rows).
const isMutation = (a) => {
  if (a.source === 'audit') return true;
  if (a.source === 'claim_verdict') return true;
  if (a.source === 'portal_submission') return true;
  return false;
};
const actionTransitions = new Map();
const actionSeqByN = { 2: new Map(), 3: new Map(), 4: new Map() };
const precedingByAction = new Map();   // action -> {prev: count}
const followingByAction = new Map();   // action -> {next: count}
for (const [op, arr] of byOp) {
  const muts = arr.filter(isMutation).sort((a,b)=>a.ts.localeCompare(b.ts));
  for (let i = 0; i < muts.length - 1; i++) {
    const from = muts[i].action;
    const to = muts[i+1].action;
    const k = `${from}\t${to}`;
    actionTransitions.set(k, (actionTransitions.get(k) ?? 0) + 1);
    if (!precedingByAction.has(to)) precedingByAction.set(to, new Map());
    if (!followingByAction.has(from)) followingByAction.set(from, new Map());
    precedingByAction.get(to).set(from, (precedingByAction.get(to).get(from) ?? 0) + 1);
    followingByAction.get(from).set(to, (followingByAction.get(from).get(to) ?? 0) + 1);
  }
  for (const N of [2,3,4]) {
    for (let i = 0; i + N - 1 < muts.length; i++) {
      const seq = muts.slice(i, i+N).map(m => m.action).join(' → ');
      actionSeqByN[N].set(seq, (actionSeqByN[N].get(seq) ?? 0) + 1);
    }
  }
}
writeCsv('action_transitions.csv',
  ['from_action','to_action','count'],
  [...actionTransitions.entries()].sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => { const [from,to] = k.split('\t'); return [from, to, v]; }),
);
for (const N of [2,3,4]) {
  writeCsv(`action_sequences_n${N}.csv`,
    ['sequence','count'],
    [...actionSeqByN[N].entries()].sort((a,b)=>b[1]-a[1]).slice(0, 200).map(([k,v]) => [k, v]),
  );
}
const precFollRows = [];
for (const [act, prevM] of precedingByAction) {
  const top = [...prevM.entries()].sort((a,b)=>b[1]-a[1])[0];
  precFollRows.push([act, 'preceding', top?.[0] ?? '', top?.[1] ?? 0]);
}
for (const [act, nextM] of followingByAction) {
  const top = [...nextM.entries()].sort((a,b)=>b[1]-a[1])[0];
  precFollRows.push([act, 'following', top?.[0] ?? '', top?.[1] ?? 0]);
}
writeCsv('action_neighbors.csv', ['action','direction','top_neighbor','count'], precFollRows);

// ─── 6. Time-gap distributions ───────────────────────────────────────────────
const gaps = {
  sop_to_sop_within_walk: [],   // by operator+claim, consecutive sop_advanced/rewound rows
  leg_finish_to_next_start: [], // per operator, between leg sop_terminal and next leg first sop_advanced
  preview_to_queue: [],         // per group, group_preview_generated → portal_submission_create
  landing_to_first_mutation: [],// per operator+resource, presence first → first audit on that resource
  inter_session: [],            // per operator, session.end → next session.start
};

// 6a. Within-walk SOP gaps.
const sopByOpClaim = new Map();
for (const e of audit) {
  if (e.action === 'leg_sop_advanced' || e.action === 'leg_sop_rewound') {
    const k = `${norm(e.user_email)}|${e.claim_id}`;
    if (!sopByOpClaim.has(k)) sopByOpClaim.set(k, []);
    sopByOpClaim.get(k).push(e.timestamp);
  }
}
for (const arr of sopByOpClaim.values()) {
  arr.sort();
  for (let i = 1; i < arr.length; i++) {
    const dt = Date.parse(arr[i]) - Date.parse(arr[i-1]);
    if (dt >= 0 && dt < 60 * 60_000) gaps.sop_to_sop_within_walk.push(dt);
  }
}

// 6b. Leg-finish to next-leg-start (per operator).
for (const [op, arr] of byOp) {
  const muts = arr.filter(e => e.source === 'audit' &&
    (e.action === 'leg_sop_advanced' || e.action === 'leg_sop_rewound'))
    .sort((a,b)=>a.ts.localeCompare(b.ts));
  for (let i = 1; i < muts.length; i++) {
    const prev = muts[i-1], next = muts[i];
    if (prev.payload.metadata?.isTerminal && prev.payload.claim_id !== next.payload.claim_id) {
      const dt = Date.parse(next.ts) - Date.parse(prev.ts);
      if (dt >= 0 && dt < 30 * 60_000) gaps.leg_finish_to_next_start.push(dt);
    }
  }
}

// 6c. Preview → queue, per group.
for (const g of groups) {
  if (!g.preview_generated_at) continue;
  const subsForGroup = subs.filter(s => s.invoice_group_id === g.id)
    .filter(s => Date.parse(s.created_at) >= Date.parse(g.preview_generated_at));
  if (!subsForGroup.length) continue;
  const earliest = subsForGroup.map(s => Date.parse(s.created_at)).sort((a,b)=>a-b)[0];
  const dt = earliest - Date.parse(g.preview_generated_at);
  if (dt >= 0 && dt < 6 * 60 * 60_000) gaps.preview_to_queue.push(dt);
}

// 6d. Landing on a record → first mutation on it (per operator+resource).
for (const [op, arr] of byOp) {
  const byRes = new Map();
  for (const e of arr) {
    const k = e.record_type === 'claim'
      ? `claim/${e.record_id}` : (e.record_type === 'group' ? `invoice_group/${e.record_id}` : null);
    if (!k) continue;
    if (!byRes.has(k)) byRes.set(k, []);
    byRes.get(k).push(e);
  }
  for (const list of byRes.values()) {
    list.sort((a,b)=>a.ts.localeCompare(b.ts));
    const firstHb = list.find(e => e.action === 'presence_heartbeat');
    const firstMut = list.find(e => isMutation(e));
    if (firstHb && firstMut && Date.parse(firstMut.ts) > Date.parse(firstHb.ts)) {
      const dt = Date.parse(firstMut.ts) - Date.parse(firstHb.ts);
      if (dt < 30 * 60_000) gaps.landing_to_first_mutation.push(dt);
    }
  }
}

// 6e. Inter-session gaps.
const opsSessions = new Map();
for (const s of sessionRows) {
  if (!opsSessions.has(s.operator)) opsSessions.set(s.operator, []);
  opsSessions.get(s.operator).push(s);
}
for (const arr of opsSessions.values()) {
  arr.sort((a,b)=>a.firstT - b.firstT);
  for (let i = 1; i < arr.length; i++) {
    const dt = arr[i].firstT - arr[i-1].lastT;
    if (dt > 0) gaps.inter_session.push(dt);
  }
}

const gapRows = Object.entries(gaps).map(([k, vals]) => {
  const s = stats(vals);
  return [k, s.n, fmtMs(s.p25), fmtMs(s.p50), fmtMs(s.p75), fmtMs(s.p90), fmtMs(s.p99), fmtMs(s.mean)];
});
writeCsv('timegaps.csv', ['gap_kind','samples','p25_ms','p50_ms','p75_ms','p90_ms','p99_ms','mean_ms'], gapRows);

// Log-spaced histogram bins per gap-kind (1s, 3s, 10s, 30s, 1m, 3m, 10m, 30m,
// 1h, 3h, 12h+).
const HIST_BINS_MS = [1_000, 3_000, 10_000, 30_000, 60_000, 180_000, 600_000,
  1_800_000, 3_600_000, 10_800_000, 43_200_000];
const HIST_LABELS = ['<1s','1-3s','3-10s','10-30s','30s-1m','1-3m','3-10m',
  '10-30m','30m-1h','1-3h','3-12h','12h+'];
const histRows = [];
for (const [kind, vals] of Object.entries(gaps)) {
  const counts = Array(HIST_LABELS.length).fill(0);
  for (const v of vals) {
    let i = HIST_BINS_MS.findIndex(b => v < b);
    if (i === -1) i = HIST_LABELS.length - 1;
    counts[i]++;
  }
  HIST_LABELS.forEach((label, i) => histRows.push([kind, label, counts[i]]));
}
writeCsv('timegaps_histogram.csv', ['gap_kind','bucket','count'], histRows);

// ─── 7. SOP node heatmap ─────────────────────────────────────────────────────
const nodeStats = new Map();
const nodeText = new Map();   // nodeId -> question text
for (const et of errorTypes) {
  const tree = et.decision_tree;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.id) nodeText.set(node.id, node.question || node.label || node.text || node.title || '');
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(tree);
}
function bumpNode(nodeId, key, n=1) {
  if (!nodeId) return;
  if (!nodeStats.has(nodeId)) nodeStats.set(nodeId, { visited:0, answered:0, back_stepped_past:0, restarted_past:0, reclassified_after:0, dwell:[] });
  nodeStats.get(nodeId)[key] += n;
}
const claimSopHistory = new Map(); // claim -> ordered sop_advance events
for (const e of audit) {
  if (e.action === 'leg_sop_advanced') {
    bumpNode(e.metadata?.nodeId, 'visited');
    bumpNode(e.metadata?.nodeId, 'answered');
    if (!claimSopHistory.has(e.claim_id)) claimSopHistory.set(e.claim_id, []);
    claimSopHistory.get(e.claim_id).push(e);
  }
  if (e.action === 'leg_sop_rewound') {
    bumpNode(e.metadata?.nodeId, 'back_stepped_past');
    bumpNode(e.metadata?.toNodeId, 'restarted_past');
  }
  if (e.action === 'leg_reclassified' || e.action === 'leg_classified') {
    // Mark every node previously answered for this claim as "reclassified_after".
    const hist = claimSopHistory.get(e.claim_id) || [];
    const seen = new Set();
    for (const h of hist) {
      const nid = h.metadata?.nodeId;
      if (nid && !seen.has(nid)) { seen.add(nid); bumpNode(nid, 'reclassified_after'); }
    }
  }
}
// Dwell on a node = time between this SOP answer and the next SOP event for
// the same (operator, claim). Built from audit directly so we can pair the
// answered nodeId with the next-step timestamp.
const auditByOpClaim = new Map();
for (const e of audit) {
  if (e.claim_id && (e.action === 'leg_sop_advanced' || e.action === 'leg_sop_rewound')) {
    const k = `${norm(e.user_email)}|${e.claim_id}`;
    if (!auditByOpClaim.has(k)) auditByOpClaim.set(k, []);
    auditByOpClaim.get(k).push(e);
  }
}
for (const arr of auditByOpClaim.values()) {
  arr.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
  for (let i = 0; i < arr.length - 1; i++) {
    const dt = Date.parse(arr[i+1].timestamp) - Date.parse(arr[i].timestamp);
    if (dt > 0 && dt < 10 * 60_000) {
      const nid = arr[i].metadata?.nodeId;
      if (nid) nodeStats.get(nid)?.dwell.push(dt);
    }
  }
}
const nodeRows = [...nodeStats.entries()].map(([nid, s]) => {
  const dwell = stats(s.dwell);
  const trouble = s.back_stepped_past * 2 + s.restarted_past * 3 + s.reclassified_after * 4;
  return [nid, (nodeText.get(nid) || '').slice(0, 200), s.visited, s.answered, s.back_stepped_past, s.restarted_past, s.reclassified_after, dwell.p50 ?? '', dwell.n, trouble];
}).sort((a,b)=>b[9]-a[9]);
writeCsv('sop_node_heatmap.csv',
  ['node_id','question','visited','answered','back_stepped_past','restarted_past','reclassified_after','median_dwell_ms','dwell_samples','trouble_score'],
  nodeRows);

// ─── 8. Terminal funnel (error_type → terminal outcome) ──────────────────────
// Per leg, find the last sop_outcome from the last terminal sop_advance row.
const terminalsByClaim = new Map();
for (const e of audit) {
  if (e.action === 'leg_sop_advanced' && e.metadata?.isTerminal) {
    terminalsByClaim.set(e.claim_id, e.metadata?.sopOutcome || 'unknown');
  }
}
const funnel = new Map();
for (const c of claims) {
  const term = terminalsByClaim.get(c.id) || c.sop_outcome || (c.disposition?.startsWith('disposed_') ? c.disposition : null);
  const et = c.error_type_name || '(unclassified)';
  const k = `${et}\t${term ?? '(none)'}`;
  funnel.set(k, (funnel.get(k) ?? 0) + 1);
}
{
  const totalLegs = [...funnel.values()].reduce((a, b) => a + b, 0);
  const etTotals = new Map();
  for (const [k, v] of funnel.entries()) {
    const [et] = k.split('\t');
    etTotals.set(et, (etTotals.get(et) ?? 0) + v);
  }
  writeCsv('terminal_funnel.csv',
    ['error_type','terminal_outcome','leg_count','pct_of_all_legs','pct_within_error_type'],
    [...funnel.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v]) => {
      const [et,t] = k.split('\t');
      const etDenom = etTotals.get(et) || 0;
      return [et, t, v,
        totalLegs ? ((v/totalLegs)*100).toFixed(2) : '0.00',
        etDenom ? ((v/etDenom)*100).toFixed(2) : '0.00'];
    }));
}

// Per-operator terminal funnel (surfaces operator-specific patterns).
const funnelByOp = new Map();
for (const e of audit) {
  if (e.action === 'leg_sop_advanced' && e.metadata?.isTerminal) {
    const op = norm(e.user_email);
    const t = e.metadata?.sopOutcome || 'unknown';
    const k = `${op}\t${t}`;
    funnelByOp.set(k, (funnelByOp.get(k) ?? 0) + 1);
  }
}
{
  const opTotals = new Map();
  for (const [k, v] of funnelByOp.entries()) {
    const [op] = k.split('\t');
    opTotals.set(op, (opTotals.get(op) ?? 0) + v);
  }
  writeCsv('terminal_funnel_by_operator.csv',
    ['operator', 'terminal_outcome', 'count', 'pct_of_operator_terminals'],
    [...funnelByOp.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const [op, t] = k.split('\t');
      const denom = opTotals.get(op) || 0;
      return [op, t, v, denom ? ((v / denom) * 100).toFixed(2) : '0.00'];
    }));
}

// Combined operator x error-type x terminal matrix.
const funnelMatrix = new Map();
for (const e of audit) {
  if (e.action === 'leg_sop_advanced' && e.metadata?.isTerminal) {
    const op = norm(e.user_email);
    const t = e.metadata?.sopOutcome || 'unknown';
    const claim = claimsById.get(e.claim_id);
    const et = claim?.error_type_name || '(unclassified)';
    const k = `${op}\t${et}\t${t}`;
    funnelMatrix.set(k, (funnelMatrix.get(k) ?? 0) + 1);
  }
}
writeCsv('terminal_funnel_matrix.csv',
  ['operator','error_type','terminal_outcome','count'],
  [...funnelMatrix.entries()].sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => { const [op,et,t] = k.split('\t'); return [op, et, t, v]; }));

// Per-action mutation counts across the whole window.
const actionCounts = new Map();
for (const e of audit) actionCounts.set(e.action, (actionCounts.get(e.action) ?? 0) + 1);
writeCsv('mutation_counts_by_action.csv',
  ['action','count'],
  [...actionCounts.entries()].sort((a,b)=>b[1]-a[1]));

// Redacted operator labels (operator_1..N) for any chart that may be shared
// outside the immediate internal team. Stable mapping keyed on alphabetical
// operator email so re-runs are deterministic.
const opRedaction = new Map();
{
  // Named operators first (operator_1..N alphabetically), then anything else
  // that ever appeared in the unified event stream — including state-only
  // accounts like accounting@agapeny.com or the Apple-relay test login —
  // mapped to operator_unknown_<n> so no raw email leaks into a "redacted"
  // file.
  const named = [...new Set(audit.map(e => norm(e.user_email)).filter(Boolean))].sort();
  named.forEach((op, i) => opRedaction.set(op, `operator_${i + 1}`));
  const others = [...new Set([...byOp.keys()].filter(op => !opRedaction.has(op)))].sort();
  others.forEach((op, i) => opRedaction.set(op, `operator_unknown_${i + 1}`));
}
const redact = (op) => {
  if (!op) return '(unknown)';
  return opRedaction.get(op) || `operator_unknown_${[...opRedaction.values()].length + 1}`;
};
writeCsv('redacted_operator_map.csv', ['operator_email','redacted_label'],
  [...opRedaction.entries()].map(([e, l]) => [e, l]));
writeCsv('redacted_terminal_funnel_by_operator.csv',
  ['operator','terminal_outcome','count'],
  [...funnelByOp.entries()].sort((a,b)=>b[1]-a[1])
    .map(([k,v]) => { const [op,t] = k.split('\t'); return [redact(op), t, v]; }));
writeCsv('redacted_sessions.csv',
  ['session_id','operator','start_ts','end_ts','duration_ms','event_count'],
  sessionRows.map(s => [s.sid, redact(s.operator), s.start, s.end, s.lastT - s.firstT, s.count]));

// ─── 9. Loops / repetitions ──────────────────────────────────────────────────
// 9a. Same node answered more than once for a single (operator, claim) walk.
const dupNodeRows = [];
for (const [k, arr] of auditByOpClaim) {
  const counts = new Map();
  for (const e of arr) if (e.action === 'leg_sop_advanced') {
    const nid = e.metadata?.nodeId;
    if (nid) counts.set(nid, (counts.get(nid) ?? 0) + 1);
  }
  for (const [nid, n] of counts) if (n > 1) {
    const [op, cid] = k.split('|');
    dupNodeRows.push([op, cid, nid, (nodeText.get(nid) || '').slice(0,120), n]);
  }
}
dupNodeRows.sort((a,b)=>b[4]-a[4]);
writeCsv('loops_duplicate_node_answers.csv',
  ['operator','claim_id','node_id','question','answer_count'], dupNodeRows);

// 9b. Multi-restart legs: claim with >1 leg_sop_rewound or leg_reclassified events.
const restartCounts = new Map();
for (const e of audit) {
  if (e.action === 'leg_sop_rewound' || e.action === 'leg_reclassified') {
    if (!restartCounts.has(e.claim_id)) restartCounts.set(e.claim_id, 0);
    restartCounts.set(e.claim_id, restartCounts.get(e.claim_id) + 1);
  }
}
const multiRestartRows = [...restartCounts.entries()].filter(([,n]) => n >= 2)
  .sort((a,b)=>b[1]-a[1]).map(([cid, n]) => [cid, n]);
writeCsv('loops_multi_restart_legs.csv', ['claim_id','restart_count'], multiRestartRows);

// 9c. Regenerated drafts (preview generated more than once for the same group).
const regenCounts = new Map();
for (const e of audit) {
  if (e.action === 'group_preview_generated') {
    regenCounts.set(e.invoice_group_id, (regenCounts.get(e.invoice_group_id) ?? 0) + 1);
  }
}
const regenRows = [...regenCounts.entries()].filter(([,n])=>n>1).sort((a,b)=>b[1]-a[1])
  .map(([gid, n]) => [gid, n]);
writeCsv('regenerated_drafts.csv', ['invoice_group_id','preview_count'], regenRows);

// ─── 10. Friction signals ────────────────────────────────────────────────────
// 10a. Long dwell on a page that did not result in any mutation.
const longNoMut = [];
for (const [op, arr] of byOp) {
  const sorted = arr.slice().sort((a,b)=>a.ts.localeCompare(b.ts));
  // Slice into per-resource visits using consecutive heartbeats; if there's
  // any mutation on the same record_type/record_id within the visit, skip.
  let cur = null;
  for (const e of sorted) {
    if (e.action === 'presence_heartbeat') {
      const k = `${e.payload.resource_type}/${e.payload.resource_id}`;
      if (!cur || cur.k !== k) {
        if (cur && (cur.lastT - cur.firstT) > 2 * 60_000 && !cur.hadMut) {
          longNoMut.push([op, cur.k, cur.lastT - cur.firstT, new Date(cur.firstT).toISOString()]);
        }
        cur = { k, firstT: Date.parse(e.ts), lastT: Date.parse(e.ts), hadMut: false };
      } else {
        cur.lastT = Date.parse(e.ts);
      }
    } else if (cur && isMutation(e)) {
      const recK = e.record_type === 'claim' ? `claim/${e.record_id}`
        : (e.record_type === 'group' ? `invoice_group/${e.record_id}` : null);
      if (recK === cur.k) cur.hadMut = true;
    }
  }
  if (cur && (cur.lastT - cur.firstT) > 2 * 60_000 && !cur.hadMut) {
    longNoMut.push([op, cur.k, cur.lastT - cur.firstT, new Date(cur.firstT).toISOString()]);
  }
}
longNoMut.sort((a,b)=>b[2]-a[2]);
writeCsv('friction_long_dwell_no_mutation.csv',
  ['operator','resource','dwell_ms','start_ts'], longNoMut.slice(0, 200));

// 10b. Back-navigations — page-visit sequence that revisits the prior URL.
const backNavRows = [];
for (const [op, arr] of byOp) {
  const heartbeats = arr.filter(e => e.action === 'presence_heartbeat')
    .sort((a,b)=>a.ts.localeCompare(b.ts));
  const visits = [];
  for (const h of heartbeats) {
    const k = `${h.payload.resource_type}/${h.payload.resource_id}`;
    if (!visits.length || visits[visits.length-1] !== k) visits.push(k);
  }
  let count = 0;
  for (let i = 2; i < visits.length; i++) {
    if (visits[i] === visits[i-2]) count++;
  }
  if (count > 0) backNavRows.push([op, count]);
}
backNavRows.sort((a,b)=>b[1]-a[1]);
writeCsv('friction_back_navigations.csv', ['operator','back_nav_count'], backNavRows);

// 10c. Abandoned legs — operator on a leg, jumped to a different leg without advancing the SOP.
const abandonedRows = [];
for (const [op, arr] of byOp) {
  const sorted = arr.slice().sort((a,b)=>a.ts.localeCompare(b.ts));
  let curLeg = null;
  let advancedOnCur = false;
  for (const e of sorted) {
    if (e.action === 'presence_heartbeat' && e.payload.resource_type === 'claim') {
      const cid = e.payload.resource_id;
      if (curLeg && curLeg !== cid) {
        if (!advancedOnCur) abandonedRows.push([op, curLeg, e.ts]);
        curLeg = cid;
        advancedOnCur = false;
      } else if (!curLeg) {
        curLeg = cid;
      }
    } else if (e.action === 'leg_sop_advanced' && e.payload.claim_id === curLeg) {
      advancedOnCur = true;
    }
  }
}
writeCsv('friction_abandoned_legs.csv', ['operator','claim_id','jumped_at_ts'], abandonedRows);

// 10d. HoldExit attempts — leg_sop_hold_cleared / leg_hold_cleared / hold-related actions.
const holdRows = [];
for (const e of audit) {
  if (/hold/i.test(e.action)) holdRows.push([e.timestamp, norm(e.user_email), e.action, e.claim_id, e.invoice_group_id, e.details?.slice(0,120) ?? '']);
}
writeCsv('friction_hold_events.csv',
  ['ts','operator','action','claim_id','invoice_group_id','details'], holdRows);

// ─── 11. Top-line scope summary ──────────────────────────────────────────────
const operators = new Set();
for (const e of audit) if (e.user_email) operators.add(norm(e.user_email));
const summary = {
  window_utc: { start: WIN_START, end: WIN_END },
  window_label: TZ_LABEL,
  session_gap_minutes: SESSION_GAP_MIN,
  excluded_accounts: ['system@claimclear','system@claimclear-heal','system','z7ytv7jcb4@privaterelay.appleid.com','(NULL user_email — system writes)'],
  operators: [...operators].sort(),
  counts: {
    operators: operators.size,
    invoice_groups_touched: groups.length,
    claims_touched: claims.length,
    audit_events: audit.length,
    state_events: states.length,
    presence_heartbeats: presence.length,
    portal_submissions_created: subs.length,
    bot_activity_rows: bots.length,
    sop_advance_events: audit.filter(e => e.action === 'leg_sop_advanced').length,
    sop_rewind_events: audit.filter(e => e.action === 'leg_sop_rewound').length,
    sop_terminal_events: audit.filter(e => e.action === 'leg_sop_advanced' && e.metadata?.isTerminal).length,
    leg_reclassified: audit.filter(e => e.action === 'leg_reclassified').length,
    group_preview_generated: audit.filter(e => e.action === 'group_preview_generated').length,
    group_draft_edited: audit.filter(e => e.action === 'group_draft_edited').length,
    group_draft_reviewed: audit.filter(e => e.action === 'group_draft_reviewed').length,
    portal_draft_created: audit.filter(e => e.action === 'portal_draft_created').length,
    portal_submission_cancelled: audit.filter(e => e.action === 'portal_submission_cancelled').length,
    response_acknowledged: audit.filter(e => e.action === 'response_acknowledged').length,
    sessions: sessionRows.length,
  },
};
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));

console.log('done.');
console.log(JSON.stringify(summary.counts, null, 2));
