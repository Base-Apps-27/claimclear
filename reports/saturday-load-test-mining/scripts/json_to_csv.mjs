#!/usr/bin/env node
// Convert each raw/*.json (array of row objects) to raw/*.csv with a stable
// column order (union of keys, sorted) so the dumps are usable from any
// CSV-aware tool without going through Node. Re-runnable.

import fs from 'fs';
import path from 'path';

const RAW = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'raw');
const csvEscape = (v) => {
  if (v === null || v === undefined) return '';
  const s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
};

for (const fn of fs.readdirSync(RAW).filter(f => f.endsWith('.json'))) {
  const rows = JSON.parse(fs.readFileSync(path.join(RAW, fn), 'utf8'));
  if (!Array.isArray(rows) || rows.length === 0) continue;
  const cols = [...rows.reduce((s, r) => {
    Object.keys(r ?? {}).forEach(k => s.add(k));
    return s;
  }, new Set())];
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => csvEscape(r?.[c])).join(','));
  const out = path.join(RAW, fn.replace(/\.json$/, '.csv'));
  fs.writeFileSync(out, lines.join('\n'));
  console.log(out, rows.length, 'rows');
}
