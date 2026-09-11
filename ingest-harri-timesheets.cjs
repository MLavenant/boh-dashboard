/**
 * Ingest Harri "Timesheet Report - Detailed" CSV → Toast-shaped labor-{venue}.json
 * by ISO week. Used for AVA CG + Claudie (Harri time clock).
 *
 * Usage:
 *   node ingest-harri-timesheets.cjs <csv...> [--weeks 2026-W35,2026-W36]
 *   node ingest-harri-timesheets.cjs "C:\Users\...\Timesheet....csv"
 *
 * Output: data/{week}/labor-{venue}.json  (same schema as fetch-labor-week.cjs)
 * Overwrites Toast labor for that venue/week when Harri is the source of truth.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.BOH_ROOT || __dirname;

const BRAND_TO_VENUE = {
  'AVA Coconut Grove': 'ava_coconut_grove',
  'AVA COCONUT GROVE': 'ava_coconut_grove',
  AVA: 'ava_coconut_grove',
  CLAUDIE: 'claudie',
  Claudie: 'claudie',
};

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const hdr = [...lines[0].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = [...lines[i].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (!cols.length) continue;
    const o = {};
    hdr.forEach((h, j) => { o[h] = cols[j] != null ? cols[j] : ''; });
    rows.push(o);
  }
  return rows;
}

function isoWeekLabel(dateStr) {
  // dateStr = YYYY-MM-DD
  const dt = new Date(dateStr + 'T12:00:00Z');
  if (isNaN(dt)) return null;
  const t = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function dayName(dateStr) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date(dateStr + 'T12:00:00').getDay()
  ];
}

function parseHours(row) {
  const total = parseFloat(String(row['Total Hours'] || '').trim());
  if (Number.isFinite(total) && total > 0) return total;
  const reg = parseFloat(String(row['Regular Hours'] || '').trim()) || 0;
  const ot = parseFloat(String(row.Overtime || '').trim()) || 0;
  const dbl = parseFloat(String(row['Double Overtime'] || '').trim()) || 0;
  return reg + ot + dbl;
}

function combineDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = String(dateStr).slice(0, 10);
  const t = String(timeStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !t) return null;
  // Harri times are local restaurant time; store as local wall-clock ISO-like string
  return `${d}T${t.length === 8 ? t : t + ':00'}`;
}

function payrollNameFromDisplay(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const parts = s.split(/\s+/);
  if (parts.length === 1) return s;
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(' ');
  return `${last}, ${first}`;
}

function rowToEntry(row) {
  const brand = String(row['Brand Name'] || '').trim();
  const venue = BRAND_TO_VENUE[brand] || BRAND_TO_VENUE[brand.toUpperCase()];
  if (!venue) return null;

  const dateRaw = String(row.Date || '').trim();
  const date = dateRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const hours = parseHours(row);
  if (!(hours >= 0.25)) return null;
  if (!String(row['Actual Clock In'] || '').trim()) return null;

  // Skip explicit missed / zeroed approvals when no clock
  const status = String(row['Timecard Status'] || '');
  if (/missed shift/i.test(status) && hours < 0.25) return null;

  const name = String(row.Name || '').trim();
  const jobName = String(row['Position Name'] || '').trim();
  const inDate = combineDateTime(date, row['Actual Clock In']);
  let outDate = combineDateTime(date, row['Actual Clock Out']);
  // Overnight: clock out earlier than clock in → next calendar day
  if (inDate && outDate && outDate <= inDate) {
    const next = new Date(date + 'T12:00:00');
    next.setDate(next.getDate() + 1);
    const nd = next.toISOString().slice(0, 10);
    outDate = combineDateTime(nd, row['Actual Clock Out']);
  }

  const weekLabel = isoWeekLabel(date);
  if (!weekLabel) return null;

  return {
    venue,
    weekLabel,
    entry: {
      date,
      day: String(row['Day Name'] || dayName(date)),
      businessDate: date.replace(/-/g, ''),
      employeeGuid: row.payroll_id ? `harri:${row.payroll_id}` : null,
      employeeName: name,
      payrollName: payrollNameFromDisplay(name),
      jobGuid: null,
      jobName,
      inDate,
      outDate,
      hours: +hours.toFixed(3),
      source: 'harri',
    },
  };
}

function main() {
  const args = process.argv.slice(2).filter(Boolean);
  if (!args.length) {
    console.error('Usage: node ingest-harri-timesheets.cjs <csv...> [--weeks W35,W36 or 2026-W35,...]');
    process.exit(1);
  }

  let weekFilter = null;
  const csvPaths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--weeks') {
      const raw = args[++i] || '';
      weekFilter = new Set(
        raw.split(',').map((s) => {
          s = s.trim();
          if (/^\d{4}-W\d{2}$/.test(s)) return s;
          if (/^W?\d{1,2}$/i.test(s)) {
            const n = s.replace(/^W/i, '');
            return `${new Date().getFullYear()}-W${String(n).padStart(2, '0')}`;
          }
          return s;
        })
      );
      continue;
    }
    csvPaths.push(args[i]);
  }

  /** week -> venue -> entries[] */
  const bucket = new Map();
  let skipped = 0;
  let kept = 0;

  for (const csvPath of csvPaths) {
    const p = path.isAbsolute(csvPath) ? csvPath : path.join(ROOT, csvPath);
    if (!fs.existsSync(p)) {
      console.error('Missing CSV:', p);
      process.exit(1);
    }
    const rows = parseCsv(p);
    console.log(`Read ${path.basename(p)}: ${rows.length} rows`);
    for (const row of rows) {
      const mapped = rowToEntry(row);
      if (!mapped) { skipped++; continue; }
      if (weekFilter && !weekFilter.has(mapped.weekLabel)) continue;
      const key = `${mapped.weekLabel}||${mapped.venue}`;
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key).push(mapped.entry);
      kept++;
    }
  }

  const summary = {};
  for (const [key, entries] of [...bucket.entries()].sort()) {
    const [weekLabel, venue] = key.split('||');
    entries.sort((a, b) => (a.date + a.employeeName).localeCompare(b.date + b.employeeName));
    const outDir = path.join(ROOT, 'data', weekLabel);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `labor-${venue}.json`);
    const payload = {
      venue,
      weekLabel,
      fetchedAt: new Date().toISOString(),
      source: 'harri',
      venueGuid: null,
      entryCount: entries.length,
      entries,
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    if (!summary[weekLabel]) summary[weekLabel] = {};
    summary[weekLabel][venue] = entries.length;
    console.log(`Wrote ${outPath} (${entries.length} entries)`);
  }

  console.log('\nSummary:', JSON.stringify(summary, null, 2));
  console.log(`Kept ${kept} clocked shifts (skipped ${skipped} empty/missed/unknown)`);
}

main();
