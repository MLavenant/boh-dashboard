'use strict';
const fs = require('fs');
const path = require('path');

// ── Load rolling.json to get available weeks ──────────────────────────────────
let rollingWeeks = [];
try {
  const rolling = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'rolling.json'), 'utf8'));
  rollingWeeks = (rolling.weeks || []).map((w, i) => {
    // weekLabel is like "2026-W27" → show as "W27"
    const isoMatch = w.weekLabel && w.weekLabel.match(/W(\d+)$/);
    const shortLabel = isoMatch ? 'W' + isoMatch[1] : ('Week ' + (i + 1));
    return { label: shortLabel, key: w.weekLabel };
  });
} catch(e) {
  // fallback
}
if (!rollingWeeks.length) rollingWeeks = [{ label: 'W27', key: '2026-W27' }];

const DIR = __dirname;

// ── Load all data files (nested by venue → weekKey) ──────────────────────────
// Map from build venue key → process-venue-data.cjs slug
const VENUE_SLUG_MAP = {
  claudie:  'claudie',
  casaneos: 'casa_neos',
  ava_cg:   'ava_coconut_grove',
  ava_wp:   'ava_winter_park',
  mila:     'mila',
};

const TARGETS = JSON.parse(fs.readFileSync(path.join(DIR, 'station-targets.json'), 'utf8'));

// Item-level targets from Excel ref files
let ITEM_TARGETS = {};
try {
  ITEM_TARGETS = JSON.parse(fs.readFileSync(path.join(DIR, 'item-targets.json'), 'utf8'));
} catch(e) { /* file not found, skip */ }

function applyTargets(venueKey, data) {
  const venueTargets = TARGETS[venueKey] || {};
  (data.stations || []).forEach(s => {
    if (venueTargets[s.station]) s.exp_sec = venueTargets[s.station];
  });
  return data;
}

// Build nested ALL_DATA: { venueKey: { weekKey: data, ... }, ... }
const VENUES = {};
for (const [venueKey, slug] of Object.entries(VENUE_SLUG_MAP)) {
  VENUES[venueKey] = {};
  for (const w of rollingWeeks) {
    const weekFile = path.join(DIR, `${slug}-data-${w.key}.json`);
    if (fs.existsSync(weekFile)) {
      VENUES[venueKey][w.key] = applyTargets(venueKey, JSON.parse(fs.readFileSync(weekFile, 'utf8')));
    }
  }
  // fallback: load the plain data file as 'latest' if no week files found
  if (Object.keys(VENUES[venueKey]).length === 0) {
    const fallbackFiles = [
      path.join(DIR, `${slug}-data.json`),
      path.join(DIR, `${venueKey}-data.json`),
      path.join(DIR, 'dashboard-data.json'),
    ];
    for (const fb of fallbackFiles) {
      if (fs.existsSync(fb)) {
        const data = applyTargets(venueKey, JSON.parse(fs.readFileSync(fb, 'utf8')));
        VENUES[venueKey]['latest'] = data;
        if (rollingWeeks.length > 0) VENUES[venueKey][rollingWeeks[rollingWeeks.length - 1].key] = data;
        break;
      }
    }
  }
}

const VENUE_LABELS = {
  claudie:  'Claudie',
  casaneos: 'Casa Neos',
  ava_cg:   'AVA Coconut Grove',
  ava_wp:   'AVA Winter Park',
  mila:     'MILA',
};

// ── Read template ────────────────────────────────────────────────────────────
const template = fs.readFileSync(path.join(DIR, 'dashboard-claudie.html'), 'utf8');

// ── Split at <script> ─────────────────────────────────────────────────────────
const scriptTagIdx = template.indexOf('\n<script>');
const htmlPart = template.slice(0, scriptTagIdx);

// ── Modify HTML header to add venue pills + week selector ────────────────────
let html = htmlPart
  .replace('<title>Claudie · BOH Dashboard</title>', '<title>BOH Dashboard</title>')
  .replace(
    '<header>\n  <h1>Claudie · BOH Dashboard</h1>\n  <span class="badge">Week of Jun 29 – Jul 5, 2026 · Updated Jul 6, 2026</span>\n</header>',
    `<header>
  <h1 id="dashTitle">BOH Dashboard</h1>
  <span class="badge" id="dashBadge">${rollingWeeks[rollingWeeks.length-1].label}</span>
</header>
<div id="venuePills" style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px"></div>
<div id="weekSelector" style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:13px;color:#9aa0aa">
  <span style="color:#9aa0aa">Week:</span>
  <button id="weekPrev" onclick="changeWeek(-1)" style="background:#1e2533;border:1px solid #2d3448;color:#9aa0aa;border-radius:6px;padding:4px 10px;cursor:pointer;font-family:inherit;font-size:13px">&#8249;</button>
  <select id="weekDropdown" onchange="selectWeek(this.value)" style="background:#1e2533;border:1px solid #2d3448;color:#e8eaed;border-radius:6px;padding:4px 10px;cursor:pointer;font-family:inherit;font-size:13px">
    ${rollingWeeks.map((w,i) => `<option value="${i}"${i===rollingWeeks.length-1?' selected':''}>${w.label}</option>`).join('')}
  </select>
  <button id="weekNext" onclick="changeWeek(1)" style="background:#1e2533;border:1px solid #2d3448;color:#9aa0aa;border-radius:6px;padding:4px 10px;cursor:pointer;font-family:inherit;font-size:13px">&#8250;</button>
</div>`
  );

// Add Station KPI bar before station pills
html = html.replace(
  '<div class="section-title">Station Selector</div>\n<div class="station-pills" id="stationPills"></div>',
  `<div id="stationKpiBar" style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px">
  <div class="card" style="margin:0;text-align:center">
    <div style="font-size:11px;color:#9aa0aa;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">Overall Avg Fulfillment</div>
    <div id="skpiAvg" style="font-size:2.5rem;font-weight:700;line-height:1.1">—</div>
    <div style="font-size:11px;color:#9aa0aa;margin-top:2px">all food stations combined</div>
  </div>
  <div class="card" style="margin:0;text-align:center">
    <div style="font-size:11px;color:#9aa0aa;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">Stations Over Target</div>
    <div id="skpiOver" style="font-size:2.5rem;font-weight:700;line-height:1.1">—</div>
    <div style="font-size:11px;color:#9aa0aa;margin-top:2px" id="skpiOverLabel">stations over target</div>
  </div>
  <div class="card" style="margin:0;text-align:center">
    <div style="font-size:11px;color:#9aa0aa;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">Worst Station This Week</div>
    <div id="skpiWorst" style="font-size:1.4rem;font-weight:700;line-height:1.2">—</div>
    <div style="font-size:11px;color:#9aa0aa;margin-top:2px" id="skpiWorstSub"></div>
  </div>
</div>
<div class="section-title">Station Selector</div>
<div class="station-pills" id="stationPills"></div>`
);

// Add Assignment + Group tabs to nav
html = html.replace(
  '<button class="tab-btn" onclick="switchTab(\'menu\',this)">Menu Items</button>\n</nav>',
  '<button class="tab-btn" onclick="switchTab(\'menu\',this)">Menu Items</button>\n  <button class="tab-btn" onclick="switchTab(\'assignment\',this)">📋 Assignment</button>\n  <button class="tab-btn" onclick="switchTab(\'group\',this)">🏢 Group</button>\n</nav>'
);

// Add Visual 4 (WoW) + Station Breaking Lines before Visual 5 (3D)
html = html.replace(
  '</div>\n\n<!-- Visual 5: 3D -->',
  `</div>

<!-- Station Breaking Lines -->
<div class="card">
  <h2>Station Fulfillment vs Load — Where Stations Break</h2>
  <p class="note">Each line = one food station. X-axis = estimated concurrent ticket load (derived from hourly data). Y-axis = avg fulfillment time (min). Red dashed = 15 min threshold. Click legend to isolate a station.</p>
  <p id="stationBreakingSubtitle" style="font-size:12px;color:#9aa0aa;margin:-4px 0 8px">▼ = first moment station breaks 15 min threshold</p>
  <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
    <button id="sbToggleAll" onclick="sbToggleAllLines()" style="padding:4px 12px;background:#1e2533;border:1px solid #2d3448;color:#9aa0aa;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit">Toggle All</button>
    <span style="color:#9aa0aa;font-size:12px;line-height:28px">Click legend labels to isolate stations</span>
  </div>
  <canvas id="cStationBreaking" style="max-height:420px"></canvas>
  <p id="stationBreakingNote" style="font-size:12px;color:#9aa0aa;margin:8px 0 0"></p>
</div>

<!-- Visual 4: Station WoW -->
<div class="card">
  <h2>Visual 4 — Station Fulfillment — Week over Week</h2>
  <p class="note">Avg fulfillment time per food station. Gold = current week. Reference line at 15 min target. Sorted worst → best.</p>
  <p id="wowSubtitle" style="font-size:12px;color:#9aa0aa;margin:0 0 8px"></p>
  <canvas id="cStationWoW" style="max-height:480px"></canvas>
  <div><span class="trend-badge" id="wowTrendBadge">📊 Week-over-week trend: available from Week 2</span></div>
</div>

<!-- Visual 5: 3D -->`
);

// Add bubble chart canvas to menu tab + station column in header
html = html.replace(
  '<div class="section-title">Menu Item Performance</div>\n<div class="card">',
  `<div class="section-title">Menu Item Performance</div>
<div id="menuWorstOffenders" style="display:none;background:#2d1212;border:1px solid #7f1d1d;border-radius:10px;padding:14px 18px;margin-bottom:14px"></div>
<div class="card" id="menuBubbleCard" style="margin-bottom:12px">
  <h2>Volume × Fulfillment Time</h2>
  <p class="note">Bubble size = order count. Color: green ≤10 min, yellow 10–15 min, red &gt;15 min. Hover for details.</p>
  <canvas id="cMenuBubble" style="max-height:340px"></canvas>
</div>
<div class="card">`
);

// Update menu table headers
html = html.replace(
  '<th style="width:180px">vs 15 min threshold</th>',
  '<th style="width:180px">vs Target</th>'
);
html = html.replace(
  '<th style="width:70px">Status</th>',
  '<th style="width:70px">Target</th>\n        <th style="width:70px">Status</th>\n        <th style="width:80px">Trend</th>\n        <th style="width:80px">Station</th>'
);

// Add Assignment + Group sections before footer
html = html.replace(
  '<footer>',
  `<!-- ========== TAB 5: ASSIGNMENT ========== -->
<section id="tab-assignment" class="tab-section">
<div class="section-title">Item–Station Assignment</div>
<div class="card">
  <h2>Menu Item → Station Mapping</h2>
  <p class="note">All food items assigned to their canonical kitchen station. Target = station fulfillment target. Avg Actual = current week avg from Toast. Searchable and sorted by station.</p>
  <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
    <input id="assignSearch" type="text" placeholder="Search items…" oninput="applyAssignFilter()" style="padding:6px 12px;background:#1e2533;border:1px solid #2d3448;color:#e8eaed;border-radius:8px;font-size:13px;font-family:inherit;width:220px;outline:none">
    <span id="assignCount" style="font-size:12px;color:#9aa0aa"></span>
  </div>
  <div style="overflow-x:auto">
    <table id="assignTable" style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#1e2533;text-align:left">
          <th style="padding:8px 10px;color:#9aa0aa;font-weight:600;white-space:nowrap">Station</th>
          <th style="padding:8px 10px;color:#9aa0aa;font-weight:600">Menu Item</th>
          <th style="padding:8px 10px;color:#9aa0aa;font-weight:600;text-align:right;white-space:nowrap">Target</th>
          <th style="padding:8px 10px;color:#9aa0aa;font-weight:600;text-align:right;white-space:nowrap">Avg Actual</th>
          <th style="padding:8px 10px;color:#9aa0aa;font-weight:600;text-align:right;white-space:nowrap">Count</th>
          <th style="padding:8px 10px;color:#9aa0aa;font-weight:600;text-align:center;white-space:nowrap">Status</th>
        </tr>
      </thead>
      <tbody id="assignBody"></tbody>
    </table>
  </div>
</div>
</section>

<!-- ========== TAB 4: GROUP ========== -->
<section id="tab-group" class="tab-section">
<div class="section-title" id="groupTitle">RDG Group — ${rollingWeeks[rollingWeeks.length-1].label} Performance</div>
<div class="row three" id="groupCards" style="margin-bottom:18px"></div>
<div class="card">
  <h2>Venue Comparison — Avg Fulfillment Time</h2>
  <p class="note">Horizontal bars per venue. Reference line at 15 min target. Color: green ≤10 min, yellow 10–15 min, red &gt;15 min.</p>
  <canvas id="cGroupBar" style="max-height:280px"></canvas>
</div>
<div class="coming-note" id="groupWowNote">📅 Week-over-week comparison: available from Week 2 (Jul 14)</div>
</section>

<footer>`
);

// Inject IDs into the top KPI row elements
html = html
  .replace('<div class="kpi"><div class="v">22,927</div><div class="l">Food tickets (week)</div></div>',
           '<div class="kpi"><div class="v" id="kFoodTickets">22,927</div><div class="l">Food tickets (week)</div></div>')
  .replace('<div class="kpi alert"><div class="v">57</div><div class="l">Peak concurrent tickets</div></div>',
           '<div class="kpi alert"><div class="v" id="kPeakConc">57</div><div class="l">Peak concurrent tickets</div></div>')
  .replace('<div class="kpi alert"><div class="v">26</div><div class="l">Breaking point (tickets)</div></div>',
           '<div class="kpi alert"><div class="v" id="kBP1">26</div><div class="l">Breaking point (tickets)</div></div>')
  .replace('<div class="kpi alert"><div class="v">141</div><div class="l">Breaking point (guests)</div></div>',
           '<div class="kpi alert"><div class="v" id="kBP2">141</div><div class="l">Breaking point (guests)</div></div>')
  .replace('<div class="kpi"><div class="v">39.4</div><div class="l">Peak avg conc. (Sat 20–21)</div></div>',
           '<div class="kpi"><div class="v" id="kPeakAvg">39.4</div><div class="l" id="kPeakAvgLabel">Peak avg conc.</div></div>')
  .replace('<div class="kpi"><div class="v">15 min</div><div class="l">Fulfillment target</div></div>',
           '<div class="kpi"><div class="v" id="kThreshold">15 min</div><div class="l">Fulfillment target</div></div>');

// Add page summary paragraph after KPI row
html = html.replace(
  '</div>\n\n<!-- Visual 1 -->',
  '</div>\n<p id="pageSummary" style="color:#9aa0aa;font-size:13px;margin:12px 0 0;line-height:1.6;max-width:780px"></p>\n\n<!-- Visual 1 -->'
);

// Add venue pill styles + new UI styles
html = html.replace('</style>', `
/* Venue pills */
.venue-pill{padding:5px 14px;border:1px solid #2d3448;background:#1e2533;color:#9aa0aa;border-radius:20px;cursor:pointer;font-size:13px;font-family:inherit;transition:all .15s}
.venue-pill:hover{border-color:#d9a441;color:#e8eaed}
.venue-pill.active{background:#262a33;color:#e8eaed;border-color:#d9a441;font-weight:600}
/* Wider station pills with two-line display */
.station-pill{padding:6px 14px!important;min-width:140px;text-align:left;line-height:1.3}
.station-pill .sp-name{font-size:13px;display:block;font-weight:600}
.station-pill .sp-stats{font-size:11px;color:#9aa0aa;display:block;margin-top:1px}
.station-pill.active .sp-stats{color:#c9d1db}
@media(max-width:820px){#stationKpiBar{grid-template-columns:1fr!important}}
/* Sparkline */
.sparkline-svg{display:inline-block;vertical-align:middle;margin-left:4px}
/* Worst cell pulse */
@keyframes peakPulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,0.6)}70%{box-shadow:0 0 0 4px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
.peak-cell{animation:peakPulse 1.5s infinite;outline:2px solid #ef4444!important}
/* Group scorecard */
.group-card{background:#181b22;border:1px solid #262a33;border-radius:12px;padding:16px}
.group-card .venue-name{font-size:15px;font-weight:700;color:#e8eaed;margin-bottom:8px}
.group-card .big-num{font-size:28px;font-weight:700}
.group-card .sub{color:#9aa0aa;font-size:11px;margin-top:1px}
.group-card .row4{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
.group-card .mini-kpi{background:#13161c;border-radius:8px;padding:8px 10px;text-align:center}
.group-card .mini-kpi .v{font-size:16px;font-weight:700}
.group-card .mini-kpi .l{color:#9aa0aa;font-size:10px;margin-top:1px}
</style>`);

// ── Build ALL_DATA JS string ──────────────────────────────────────────────────
const allDataJS = `const ALL_DATA = ${JSON.stringify(VENUES, null, 0)};
const ITEM_TARGETS_DATA = ${JSON.stringify(ITEM_TARGETS, null, 0)};`;

// ── Generate the new <script> block ──────────────────────────────────────────
const newScript = `
<script>
// ============================================================
// MULTI-VENUE DATA
// ============================================================
${allDataJS}

const WEEKS = ${JSON.stringify(rollingWeeks)};
let currentWeekIdx = WEEKS.length - 1;
let currentVenue = 'claudie';
function getD() {
  const weekKey = WEEKS[currentWeekIdx]?.key;
  return ALL_DATA[currentVenue]?.[weekKey] || ALL_DATA[currentVenue]?.['latest'] || {};
}

// ============================================================
// FOOD STATION FILTER
// ============================================================
const FOOD_EXCL_PATTERNS = ['bar','champagne','wine','btg','pos','barista','somm','water','service','beach','btl inside','btl outside'];
function isFoodStation(name) {
  const n = name.toLowerCase();
  return !FOOD_EXCL_PATTERNS.some(p => n.includes(p));
}

// ============================================================
// UTILS
// ============================================================
function getThreshold() { return 15; }
const THRESHOLD = 15;
const gc = '#262a33';

const HM_HRS = ["11-12","12-13","13-14","14-15","15-16","16-17","17-18","18-19","19-20","20-21","21-22","22-23","23-24","0-1"];
const HM_DAYS_FULL = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const HM_DAYS_SHORT = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function fmtSec(s) {
  if (s == null || s === 0) return '—';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}
function fmtMin(s) {
  if (s == null) return '—';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m + ' min ' + (sec > 0 ? sec + ' sec' : '');
}
function lerpColor(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  const hex = s => parseInt(s.replace('#',''), 16);
  const ha=hex(a), hb=hex(b);
  const r1=(ha>>16)&255,g1=(ha>>8)&255,b1=ha&255;
  const r2=(hb>>16)&255,g2=(hb>>8)&255,b2=hb&255;
  const r=Math.round(r1+(r2-r1)*t),g=Math.round(g1+(g2-g1)*t),bl=Math.round(b1+(b2-b1)*t);
  return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+bl.toString(16).padStart(2,'0');
}
function textFor(bg) {
  if (bg === '#1a1d24') return '#3a3d44';
  const h = parseInt(bg.replace('#',''), 16);
  const r=(h>>16)&255,g=(h>>8)&255,b=h&255;
  return (r*299+g*587+b*114)/1000 > 100 ? '#111' : '#eee';
}
function fulColor(min) {
  if (min == null) return '#1a1d24';
  if (min <= 10) return lerpColor('#1a3a1a','#22c55e', min/10);
  if (min <= 15) return lerpColor('#22c55e','#f59e0b', (min-10)/5);
  if (min <= 20) return lerpColor('#f59e0b','#ef4444', (min-15)/5);
  return '#ef4444';
}
function guestColor(g) {
  if (g == null || g === 0) return '#1a1d24';
  return lerpColor('#b3d9f7','#1565c0', Math.min(1, g/180));
}
function hmColor(sec, target) {
  if (sec == null || sec === 0) return '#1a1d24';
  const ref = target || 600;
  const ratio = sec / ref;
  if (ratio <= 1.0) return lerpColor('#133d22','#22c55e', ratio);
  if (ratio <= 1.15) return lerpColor('#22c55e','#f59e0b', (ratio-1)/0.15);
  if (ratio <= 1.30) return lerpColor('#f59e0b','#ef4444', (ratio-1.15)/0.15);
  return '#ef4444';
}
function perfColorHex(avg_sec, exp_sec) {
  if (!exp_sec) return '#9aa0aa';
  const r = avg_sec / exp_sec;
  if (r <= 1.0) return '#22c55e';
  if (r <= 1.15) return '#f59e0b';
  return '#ef4444';
}
function avgFulColorByMin(min) {
  if (min <= 10) return '#22c55e';
  if (min <= 15) return '#f59e0b';
  return '#ef4444';
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(name, btn) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'overview' && window._threeRenderer) {
    const host = document.getElementById('kitchen');
    const W = host.clientWidth || 900;
    window._threeRenderer.setSize(W, 500);
    window._threeCamera.aspect = W / 500;
    window._threeCamera.updateProjectionMatrix();
  }
}

// ============================================================
// HEATMAP TOGGLE
// ============================================================
function showHM(which, btn) {
  document.querySelectorAll('.hm-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('hmFul').style.display = which === 'ful' ? '' : 'none';
  document.getElementById('hmGuests').style.display = which === 'guests' ? '' : 'none';
}

// ============================================================
// Chart.js DEFAULTS
// ============================================================
Chart.defaults.color = '#9aa0aa';
Chart.defaults.borderColor = gc;
Chart.defaults.font.family = 'inherit';

// ============================================================
// BREAKING POINT (re-derived at render time, min 5 occurrences)
// ============================================================
function computeBreakingPoint() {
  const curve = getD().curve || [];
  let bpEntry = null;
  for (let i = 0; i < curve.length; i++) {
    if (i < 10) continue;
    const d = curve[i];
    if (d.occ < 5) continue;
    if (d.occ >= 3 && d.ful >= getThreshold()) { bpEntry = d; break; }
  }
  if (!bpEntry) return { tickets: null, guests: null };
  return { tickets: bpEntry.conc, guests: Math.round(bpEntry.guests) };
}

// ============================================================
// VISUAL 1: Kitchen Pressure Curve
// ============================================================
function renderPressure() {
  const CURVE = getD().curve;
  if (!CURVE || !CURVE.length) { const ex = Chart.getChart('cPressure'); if (ex) ex.destroy(); return; }
  const BP = computeBreakingPoint().tickets;
  const labels = CURVE.map(d => d.conc);
  const bpPlugin = {
    id:'bpZone',
    beforeDraw(chart) {
      const {ctx, chartArea:a, scales} = chart;
      if (!a || !scales.x || !scales.y1) return;
      ctx.save();
      // Always draw threshold line regardless of breaking point
      const thr = getThreshold();
      const yThr = scales.y1.getPixelForValue(thr);
      if (yThr >= a.top && yThr <= a.bottom) {
        ctx.strokeStyle='#e2706a';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);
        ctx.beginPath();ctx.moveTo(a.left,yThr);ctx.lineTo(a.right,yThr);ctx.stroke();
        ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='11px sans-serif';
        ctx.textAlign='left';ctx.fillText(thr+' min target',a.left+4,yThr-4);
      }
      // Draw breaking point zone if it exists
      const bpIdx = labels.indexOf(BP);
      if (bpIdx >= 0) {
        const xBp = scales.x.getPixelForValue(bpIdx);
        ctx.fillStyle='rgba(226,112,106,0.07)';
        ctx.fillRect(xBp,a.top,a.right-xBp,a.height);
        ctx.strokeStyle='#e2706a';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);
        ctx.beginPath();ctx.moveTo(xBp,a.top);ctx.lineTo(xBp,a.bottom);ctx.stroke();
        ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='bold 11px sans-serif';
        ctx.textAlign='center';ctx.fillText('⚡ BP:'+BP,xBp,a.top+14);
      }
      ctx.restore();
    }
  };
  const existing = Chart.getChart('cPressure');
  if (existing) existing.destroy();
  new Chart(document.getElementById('cPressure'),{
    data:{labels,datasets:[
      {type:'bar',label:'Occurrences',data:CURVE.map(d=>d.occ),backgroundColor:labels.map(l=>BP!=null&&l>=BP?'rgba(226,112,106,0.7)':'rgba(74,159,255,0.55)'),borderColor:labels.map(l=>BP!=null&&l>=BP?'#e2706a':'#4a9eff'),borderWidth:1,yAxisID:'y',order:2,borderRadius:2},
      {type:'line',label:'Avg fulfillment (min)',data:CURVE.map(d=>d.ful),borderColor:'#d9a441',backgroundColor:'rgba(217,164,65,0.0)',tension:0.3,pointRadius:2,pointHoverRadius:5,borderWidth:2.5,yAxisID:'y1',order:1},
      {type:'line',label:'P75 fulfillment (min)',data:CURVE.map(d=>d.p75),borderColor:'#e2706a',borderWidth:1.5,borderDash:[4,3],pointRadius:0,tension:0.3,yAxisID:'y1',order:1}
    ]},
    options:{interaction:{mode:'index',intersect:false},scales:{x:{title:{display:true,text:'Concurrent tickets open'},grid:{color:gc}},y:{position:'left',title:{display:true,text:'Occurrences'},grid:{color:gc},min:0},y1:{position:'right',title:{display:true,text:'Fulfillment time (min)'},grid:{display:false},min:0,suggestedMax:24}},plugins:{legend:{position:'top',labels:{boxWidth:12}}}},
    plugins:[bpPlugin]
  });
  const annEl = document.getElementById('bpAnnotation');
  if (annEl) {
    if (BP != null) {
      annEl.innerHTML = '⚡ Breaking point at <strong>'+BP+' concurrent tickets</strong> — avg fulfillment jumps to '+(CURVE.find(d=>d.conc===BP)||{ful:'?'}).ful+' min.';
    } else {
      annEl.innerHTML = 'No breaking point detected — avg fulfillment stays below threshold across all observed load levels.';
    }
  }
  const bp1 = document.getElementById('kpiBP1');
  const bp2 = document.getElementById('kpiBP2');
  const bpObj = computeBreakingPoint();
  if (bp1) bp1.textContent = bpObj.tickets ?? '—';
  if (bp2) bp2.textContent = bpObj.guests ?? '—';
  const bpNote = document.getElementById('bpMethodNote');
  if (bpNote) bpNote.textContent = 'BP detected via P75 fulfillment';
}

// ============================================================
// VISUAL 2: Breaking Point
// ============================================================
function renderBreaking() {
  const CURVE = getD().curve;
  if (!CURVE || !CURVE.length) { const ex = Chart.getChart('cBreaking'); if (ex) ex.destroy(); return; }
  const { tickets: bpTickets, guests: bpGuests } = computeBreakingPoint();
  const labels = CURVE.map(d => d.conc);
  const refLines={id:'refLines',afterDraw(chart){
    const {ctx,chartArea:a,scales}=chart;if(!a)return;
    const bpIdx=labels.indexOf(bpTickets);
    if(bpIdx>=0){const xBp=scales.x.getPixelForValue(bpIdx);ctx.save();ctx.strokeStyle='#e2706a';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(xBp,a.top);ctx.lineTo(xBp,a.bottom);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='11px sans-serif';ctx.fillText('BP: '+bpTickets,xBp+4,a.top+14);ctx.restore();}
    const yThr=scales.y.getPixelForValue(getThreshold());if(yThr>=a.top&&yThr<=a.bottom){ctx.save();ctx.strokeStyle='#e2706a';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(a.left,yThr);ctx.lineTo(a.right,yThr);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='11px sans-serif';ctx.fillText(getThreshold()+' min',a.left+4,yThr-4);ctx.restore();}
    const yGBp=scales.y1.getPixelForValue(bpGuests);if(yGBp>=a.top&&yGBp<=a.bottom){ctx.save();ctx.strokeStyle='#5aa9e6';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(a.left,yGBp);ctx.lineTo(a.right,yGBp);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#5aa9e6';ctx.font='11px sans-serif';ctx.textAlign='right';ctx.fillText('BP: '+bpGuests+' guests',a.right-4,yGBp-4);ctx.restore();}
  }};
  const existing = Chart.getChart('cBreaking');
  if (existing) existing.destroy();
  new Chart(document.getElementById('cBreaking'),{
    data:{labels,datasets:[
      {type:'line',label:'Avg fulfillment (min)',data:CURVE.map(d=>d.ful),borderColor:'#d9a441',backgroundColor:'rgba(217,164,65,0.12)',fill:true,tension:0.3,pointRadius:0,yAxisID:'y',order:1},
      {type:'line',label:'Avg guests seated',data:CURVE.map(d=>d.guests),borderColor:'#5aa9e6',backgroundColor:'rgba(90,169,230,0.08)',fill:true,tension:0.3,pointRadius:0,yAxisID:'y1',order:2}
    ]},
    options:{interaction:{mode:'index',intersect:false},scales:{x:{title:{display:true,text:'Concurrent tickets open'},grid:{color:gc}},y:{position:'left',title:{display:true,text:'Avg fulfillment (min)'},grid:{color:gc},suggestedMax:22},y1:{position:'right',title:{display:true,text:'Avg guests seated'},grid:{display:false},suggestedMax:200}},plugins:{legend:{position:'top',labels:{boxWidth:12}}}},
    plugins:[refLines]
  });
}

// ============================================================
// VISUAL 3: Load vs Performance
// ============================================================
function renderLoadPerf() {
  const TBK = getD().tbk;
  const thrLine={id:'thr',afterDraw(chart){const{ctx,chartArea:a,scales}=chart;if(!a||!scales.y)return;const thr=getThreshold();const yy=scales.y.getPixelForValue(thr);if(yy<a.top||yy>a.bottom)return;ctx.save();ctx.strokeStyle='#e2706a';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(a.left,yy);ctx.lineTo(a.right,yy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='11px sans-serif';ctx.fillText(thr+' min target',a.left+6,yy-4);ctx.restore();}};
  const existing = Chart.getChart('cLoadPerf');
  if (existing) existing.destroy();
  new Chart(document.getElementById('cLoadPerf'),{type:'bar',data:{labels:TBK.map(b=>b.bucket),datasets:[{label:'Avg fulfillment (min)',data:TBK.map(b=>b.ful),backgroundColor:TBK.map(b=>b.ful>THRESHOLD?'#8a3f1a':'#d9a441'),borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{x:{title:{display:true,text:'Concurrent tickets open (bucket)'},grid:{display:false}},y:{title:{display:true,text:'Avg fulfillment (min)'},grid:{color:gc},suggestedMax:22}}},plugins:[thrLine]});
}

// ============================================================
// VISUAL 4: 3D Station View
// ============================================================
function render3D() {
  const STATIONS = getD().stations.filter(s => !/cold[\s_-]?expo|^pass$/i.test(s.station));
  const host = document.getElementById('kitchen');
  if (!window.THREE) {
    host.innerHTML='<div style="padding:40px;color:#9aa0aa;text-align:center">Three.js failed to load.<br><small>CDN: cdnjs.cloudflare.com</small></div>';
    return;
  }
  if (window._threeRenderer) {
    window._threeRenderer.dispose();
    window._threeRenderer = null;
  }
  host.innerHTML = '';

  // ── Claudie floor plan (physical positions) ──────────────────────────────
  const FLOOR_PLANS = {
    claudie: [
      { match: /garde.manger|^gm$|^gm\b/i,  x:  7,  z: -7,  w: 3.5, d: 2   },
      { match: /fry/i,                       x:  7,  z: -4.5,w: 3.5, d: 2   },
      { match: /saut/i,                      x:  7,  z: -2,  w: 3.5, d: 2   },
      { match: /fish(?!.*market)|fish.market/i, x: 4, z: 1,  w: 3,   d: 2.5 },
      { match: /crudo/i,                     x:  7.5,z: 1,   w: 3,   d: 2.5 },
      { match: /pastry/i,                    x:  7,  z: 5,   w: 3.5, d: 2   },
      { match: /meat/i,                      x:  3,  z: 7.5, w: 5,   d: 2   },
      { match: /hot.expo/i,                  x: -2,  z: -3,  w: 2,   d: 3   },
      { match: /pizza|oven/i,                x: -1,  z: -8,  w: 3,   d: 2   },
    ]
  };

  const useFloorPlan = currentVenue === 'claudie';

  function perfBoxColor(s) {
    if (!s.exp_sec) return 0x6b7280;
    const r = s.avg_sec / s.exp_sec;
    if (r <= 1.0) return 0x2e8b57;
    if (r <= 1.15) return 0xc99a2e;
    return 0xc0392b;
  }
  function perfLightColor(s) {
    if (!s.exp_sec) return 0x4488cc;
    const r = s.avg_sec / s.exp_sec;
    if (r <= 1.0) return 0x00ff88;
    if (r <= 1.15) return 0xff9900;
    return 0xff3300;
  }
  function tSprite(t, sub, color, big) {
    const c = document.createElement('canvas'); c.width = 320; c.height = sub ? 100 : 48;
    const g = c.getContext('2d');
    g.font = 'bold ' + (big ? 26 : 20) + 'px sans-serif'; g.fillStyle = color || '#fff'; g.textAlign = 'center';
    g.fillText(t, 160, sub ? 34 : 32);
    if (sub) { g.font = '22px sans-serif'; g.fillStyle = '#ffd479'; g.fillText(sub, 160, 70); }
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  }

  let W = host.clientWidth || 900, H = 500;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0e13);
  scene.fog = new THREE.Fog(0x0c0e13, 20, 45);
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1); renderer.setSize(W, H);
  host.appendChild(renderer.domElement);
  window._threeRenderer = renderer; window._threeCamera = camera;

  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const dl = new THREE.DirectionalLight(0xffffff, 0.5); dl.position.set(6, 14, 8); scene.add(dl);

  const kitchen = new THREE.Group(); scene.add(kitchen);

  const FW = useFloorPlan ? 28 : 22;
  const FD = useFloorPlan ? 26 : 22;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(FW, 0.2, FD), new THREE.MeshLambertMaterial({ color: 0x161a21 }));
  floor.position.y = -0.1; kitchen.add(floor);
  const grid = new THREE.GridHelper(Math.max(FW, FD), 20, 0x2a2f3a, 0x1e222a); grid.position.y = 0.02; kitchen.add(grid);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x222831 });
  function wall(w, d, x, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), wallMat); m.position.set(x, 0.8, z); kitchen.add(m); }
  wall(FW, 0.25, 0, -FD / 2); wall(FW, 0.25, 0, FD / 2); wall(0.25, FD, -FW / 2, 0); wall(0.25, FD, FW / 2, 0);

  // PASS strip for Claudie
  if (useFloorPlan) {
    const passMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4a });
    const passWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.5, FD), passMat);
    passWall.position.set(-10.5, 1.25, 0); kitchen.add(passWall);
    const passSp = tSprite('PASS', null, '#6b7280', false);
    passSp.scale.set(2.2, 0.55, 1); passSp.position.set(-10.5, 2.8, 0); kitchen.add(passSp);
  }

  const withTargets = STATIONS.filter(s => s.exp_sec > 0);
  const overTarget = withTargets.filter(s => s.avg_sec > s.exp_sec).length;
  document.getElementById('kTotal').textContent = overTarget + '/' + withTargets.length + ' over target';

  const boxes = [];
  const stationLights = [];
  let gi = 0;

  STATIONS.forEach(s => {
    let x, z, bw = 2.0, bd = 2.0;

    if (useFloorPlan) {
      const fp = FLOOR_PLANS.claudie;
      const entry = fp.find(e => e.match.test(s.station));
      if (entry) { x = entry.x; z = entry.z; bw = entry.w * 0.9; bd = entry.d * 0.9; }
      else { const col = gi % 3, row = Math.floor(gi / 3); x = -8 + col * 2.5; z = 8 + row * 2.5; gi++; }
    } else {
      // Auto-grid layout for non-Claudie venues
      const cols = Math.ceil(Math.sqrt(STATIONS.length));
      const rows = Math.ceil(STATIONS.length / cols);
      const spacingX = (FW - 4) / Math.max(1, cols - 1 + 1);
      const spacingZ = (FD - 4) / Math.max(1, rows - 1 + 1);
      const col = gi % cols, row = Math.floor(gi / cols);
      x = -FW / 2 + 2 + col * spacingX;
      z = -FD / 2 + 2 + row * spacingZ;
      bw = Math.min(2.0, spacingX * 0.75);
      bd = Math.min(2.0, spacingZ * 0.75);
      gi++;
    }

    const mins = s.avg_sec ? s.avg_sec / 60 : 0;
    const boxColor = perfBoxColor(s);
    const boxH = Math.max(0.5, Math.min(2.5, mins / 6));

    // Simple colored box
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(bw, boxH, bd),
      new THREE.MeshLambertMaterial({ color: boxColor })
    );
    box.position.set(x, boxH / 2, z);
    box.userData = s;
    kitchen.add(box);
    boxes.push(box);

    // Edge outline
    const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(bw, boxH, bd));
    const edgesMesh = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }));
    edgesMesh.position.set(x, boxH / 2, z);
    kitchen.add(edgesMesh);

    // Performance point light above station
    const glow = new THREE.PointLight(perfLightColor(s), 1.4, 6);
    glow.position.set(x, boxH + 1.2, z);
    kitchen.add(glow);
    stationLights.push({ light: glow, baseIntensity: 1.4, station: s });

    // Text label (station name + avg time)
    const shortName = s.station.replace('Garde Manger', 'Garde M.').replace('Cold Expo', 'PASS').replace('Hot Expo', 'HOT EXP');
    const label = tSprite(shortName, (mins ? mins.toFixed(1) : '–') + ' min', '#fff', true);
    label.scale.set(Math.max(2.4, bw * 0.95), 0.88, 1);
    label.position.set(x, boxH + 1.6, z);
    kitchen.add(label);
  });

  const rotYInit = useFloorPlan ? 0.3 : 0.7;
  const distInit = useFloorPlan ? 32 : 28;
  let rotY = rotYInit, rotX = 0.65, dist = distInit;
  function place() { camera.position.set(dist * Math.sin(rotY) * Math.cos(rotX), dist * Math.sin(rotX), dist * Math.cos(rotY) * Math.cos(rotX)); camera.lookAt(0, 0.6, 0); }
  place();
  let drag = false, px = 0, py = 0, moved = 0, spin = true;
  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', e => { drag = true; moved = 0; px = e.clientX; py = e.clientY; spin = false; host.style.cursor = 'grabbing'; });
  window.addEventListener('pointerup', e => { if (drag && moved < 6) pick(e); drag = false; host.style.cursor = 'grab'; });
  window.addEventListener('pointermove', e => {
    if (!drag) {
      const r = dom.getBoundingClientRect();
      const hm2 = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const hray = new THREE.Raycaster(); hray.setFromCamera(hm2, camera);
      const hits = hray.intersectObjects(boxes, false);
      stationLights.forEach(sl => { sl.light.intensity = sl.baseIntensity; });
      if (hits.length) { const sl = stationLights.find(sl => sl.station === hits[0].object.userData); if (sl) sl.light.intensity = 2.2; }
      return;
    }
    const dx = e.clientX - px, dy = e.clientY - py;
    moved += Math.abs(dx) + Math.abs(dy);
    rotY -= dx * 0.008;
    rotX = Math.max(0.2, Math.min(1.45, rotX + dy * 0.006));
    px = e.clientX; py = e.clientY; place();
  });
  dom.addEventListener('wheel', e => { e.preventDefault(); dist = Math.max(9, Math.min(46, dist + (e.deltaY > 0 ? 1.4 : -1.4))); place(); }, { passive: false });

  const ray = new THREE.Raycaster(), m2 = new THREE.Vector2();
  let zoomTimer = null;
  function pick(e) {
    const r = dom.getBoundingClientRect();
    m2.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    m2.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(m2, camera);
    const hit = ray.intersectObjects(boxes, false);
    if (hit.length) {
      selectStation3D(hit[0].object.userData);
      const sd = dist, td = Math.max(9, dist - 6);
      let zt = 0;
      if (zoomTimer) clearInterval(zoomTimer);
      zoomTimer = setInterval(() => {
        zt += 0.04;
        if (zt >= 1) { dist = td; clearInterval(zoomTimer); setTimeout(() => { let zt2 = 0; const t2 = setInterval(() => { zt2 += 0.04; dist = td + (sd - td) * zt2; place(); if (zt2 >= 1) { dist = sd; clearInterval(t2); } }, 16); }, 1500); }
        else { dist = sd + (td - sd) * zt; }
        place();
      }, 16);
    }
  }
  function selectStation3D(s) {
    const ratio = s.exp_sec > 0 ? (s.avg_sec / s.exp_sec * 100).toFixed(1) + '%' : 'no target';
    let sc = '#74d39a', st = 'On target';
    if (!s.exp_sec) { sc = '#9aa0aa'; st = 'No target'; }
    else if (s.avg_sec / s.exp_sec > 1.15) { sc = '#e2706a'; st = 'Over target'; }
    else if (s.avg_sec > s.exp_sec) { sc = '#c99a2e'; st = 'Slightly over'; }
    document.getElementById('kDetail').innerHTML = '<div style="border-top:1px solid #262a33;padding-top:14px"><h2 style="font-size:15px;margin:0 0 10px">' + s.station + '</h2><div class="kpis" style="margin-bottom:0"><div class="kpi"><div class="v" style="font-size:19px">' + s.count + '</div><div class="l">Tickets</div></div><div class="kpi"><div class="v" style="font-size:19px">' + fmtSec(s.avg_sec) + '</div><div class="l">Avg time</div></div><div class="kpi"><div class="v" style="font-size:19px">' + (s.exp_sec > 0 ? fmtSec(s.exp_sec) : '—') + '</div><div class="l">Target</div></div><div class="kpi"><div class="v" style="font-size:19px;color:' + sc + '">' + ratio + '</div><div class="l">' + st + '</div></div></div></div>';
  }

  if (window._threeLoopId) cancelAnimationFrame(window._threeLoopId);
  let loopActive = true;
  function loop() {
    if (!loopActive) return;
    window._threeLoopId = requestAnimationFrame(loop);
    if (spin) kitchen.rotation.y += 0.0022;
    renderer.render(scene, camera);
  }
  loop();
  window._threeCleanup = () => { loopActive = false; };
  window.addEventListener('resize', () => { W = host.clientWidth || W; renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix(); });
}

// ============================================================
// VISUAL 5: Day x Hour Heatmaps
// ============================================================
function renderHeatmaps() {
  const HM_FUL = getD().hmFul;
  const HM_GUESTS = getD().hmGuests;

  // Find max cell in fulfillment heatmap for callout
  let hmPeakVal = 0, hmPeakDay = '', hmPeakHr = '';
  let hmGPeakVal = 0;
  HM_HRS.forEach(hr => {
    HM_DAYS_FULL.forEach(day => {
      const v = HM_FUL[day] && HM_FUL[day][hr] != null ? HM_FUL[day][hr] : null;
      if (v != null && v > hmPeakVal) { hmPeakVal = v; hmPeakDay = day; hmPeakHr = hr; }
    });
  });
  if (hmPeakDay && HM_GUESTS[hmPeakDay]) hmGPeakVal = HM_GUESTS[hmPeakDay][hmPeakHr] || 0;
  const hmCalloutEl = document.getElementById('hmFulCallout');
  if (hmCalloutEl && hmPeakDay) {
    hmCalloutEl.style.display = '';
    hmCalloutEl.innerHTML = '🔥 <strong>Peak pressure:</strong> ' + hmPeakDay + ' ' + hmPeakHr + ' — <strong style="color:#ef4444">' + hmPeakVal.toFixed(1) + 'min</strong> avg fulfillment' + (hmGPeakVal ? ' / <strong>' + Math.round(hmGPeakVal) + '</strong> guests' : '');
  }

  function buildHM(tblId, getVal, colorFn, dispFn, tipFn, isFul) {
    const tbl = document.getElementById(tblId);
    // Find max cell for worst-cell highlight (only for fulfillment)
    let maxV = -Infinity, maxDay = '', maxHr = '';
    if (isFul) {
      HM_HRS.forEach(hr => { HM_DAYS_FULL.forEach(day => { const v = getVal(day, hr); if (v != null && v > maxV) { maxV = v; maxDay = day; maxHr = hr; } }); });
    }
    // Row averages (per hour)
    const rowAvg = {};
    HM_HRS.forEach(hr => {
      let sum = 0, cnt = 0;
      HM_DAYS_FULL.forEach(day => { const v = getVal(day, hr); if (v != null) { sum += v; cnt++; } });
      rowAvg[hr] = cnt > 0 ? sum / cnt : null;
    });
    // Col averages (per day)
    const colAvg = {};
    HM_DAYS_FULL.forEach(day => {
      let sum = 0, cnt = 0;
      HM_HRS.forEach(hr => { const v = getVal(day, hr); if (v != null) { sum += v; cnt++; } });
      colAvg[day] = cnt > 0 ? sum / cnt : null;
    });

    let html2 = '<thead><tr><th class="row-head" style="background:#1e2533">Hour</th>';
    HM_DAYS_SHORT.forEach(d => { html2 += '<th style="background:#1e2533;min-width:72px">'+d+'</th>'; });
    html2 += '<th style="background:#1a1d25;min-width:60px;color:#d9a441;font-size:11px">Avg</th>';
    html2 += '</tr></thead><tbody>';
    HM_HRS.forEach(hr => {
      html2 += '<tr><td class="row-head" style="background:#181b22;font-weight:600;color:#9aa0aa">'+hr+'</td>';
      HM_DAYS_FULL.forEach(day => {
        const v = getVal(day, hr);
        const bg = colorFn(v);
        const fg = textFor(bg);
        const isWorst = isFul && day === maxDay && hr === maxHr && v != null;
        const worstStyle = isWorst ? ';outline:2px solid #fff;outline-offset:-2px;position:relative' : '';
        const worstLabel = isWorst ? ' ⭐' : '';
        html2 += '<td title="'+tipFn(day,hr,v)+'" style="background:'+bg+';color:'+fg+';padding:6px 3px'+worstStyle+'">'+dispFn(v)+worstLabel+'</td>';
      });
      // Row summary
      const ra = rowAvg[hr];
      const raBg = colorFn(ra);
      const raFg = textFor(raBg);
      html2 += '<td style="background:' + raBg + ';color:' + raFg + ';padding:6px 3px;font-weight:700;opacity:0.9">' + (ra != null ? dispFn(ra) : '') + '</td>';
      html2 += '</tr>';
    });
    // Column summary row
    html2 += '<tr><td class="row-head" style="background:#1a1d25;color:#d9a441;font-weight:700;font-size:11px">Avg</td>';
    HM_DAYS_FULL.forEach(day => {
      const ca = colAvg[day];
      const caBg = colorFn(ca);
      const caFg = textFor(caBg);
      html2 += '<td style="background:' + caBg + ';color:' + caFg + ';padding:6px 3px;font-weight:700;opacity:0.9">' + (ca != null ? dispFn(ca) : '') + '</td>';
    });
    html2 += '<td style="background:#1a1d25;padding:6px 3px"></td></tr>';
    html2 += '</tbody>';
    tbl.innerHTML = html2;
  }
  buildHM('hmFulTable',
    (day,hr) => HM_FUL[day]&&HM_FUL[day][hr]!=null?HM_FUL[day][hr]:null,
    fulColor,
    v => v!=null?v.toFixed(1):'',
    (day,hr,v) => v!=null?day+' '+hr+': '+v.toFixed(1)+' min':day+' '+hr+': no data',
    true
  );
  buildHM('hmGuestsTable',
    (day,hr) => HM_GUESTS[day]&&HM_GUESTS[day][hr]?HM_GUESTS[day][hr]:null,
    guestColor,
    v => v!=null?v.toFixed(0):'',
    (day,hr,v) => v!=null?day+' '+hr+': '+v.toFixed(0)+' guests':day+' '+hr+': no data',
    false
  );
}

// ============================================================
// VISUAL 6: Station Fulfillment Week-over-Week
// ============================================================
function renderStationWoW() {
  const STATIONS = getD().stations.filter(s => isFoodStation(s.station));
  const numWeeks = WEEKS.length;

  // Sort worst -> best by current week avg_sec desc
  const sorted = [...STATIONS].sort((a,b) => b.avg_sec - a.avg_sec);
  const labels = sorted.map(s => s.station);
  const currentData = sorted.map(s => +(s.avg_sec / 60).toFixed(2));

  const refLine = {
    id: 'refLine15',
    afterDraw(chart) {
      const {ctx, chartArea:a, scales} = chart;
      if (!a || !scales.x) return;
      const x15 = scales.x.getPixelForValue(15);
      if (x15 < a.left || x15 > a.right) return;
      ctx.save();
      ctx.strokeStyle = '#e2706a';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6,4]);
      ctx.beginPath();
      ctx.moveTo(x15, a.top);
      ctx.lineTo(x15, a.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#e2706a';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('15 min', x15, a.top - 4);
      ctx.restore();
    }
  };

  const existing = Chart.getChart('cStationWoW');
  if (existing) existing.destroy();

  const wowBarColors = currentData.map(v => v >= 15 ? '#ef4444' : v >= 12 ? '#f59e0b' : '#22c55e');
  const datasets = [{
    label: WEEKS[currentWeekIdx] ? WEEKS[currentWeekIdx].label : 'Week 1',
    data: currentData,
    backgroundColor: wowBarColors,
    borderColor: wowBarColors.map(c => c),
    borderWidth: 1,
    borderRadius: 4
  }];

  new Chart(document.getElementById('cStationWoW'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: 'y',
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          title: { display: true, text: 'Avg fulfillment time (min)' },
          grid: { color: gc },
          min: 0
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 11 } }
        }
      },
      plugins: {
        legend: { display: numWeeks > 1, position: 'top', labels: { boxWidth: 12 } },
        tooltip: { callbacks: {
          label(ctx) {
            const s = sorted[ctx.dataIndex];
            const lines = [ctx.dataset.label+': '+ctx.parsed.x.toFixed(1)+' min ('+fmtSec(s.avg_sec)+')'];
            if (s.exp_sec) lines.push('Target: '+fmtSec(s.exp_sec));
            return lines;
          }
        }}
      }
    },
    plugins: [refLine]
  });

  const badge = document.getElementById('wowTrendBadge');
  if (badge) {
    badge.textContent = numWeeks > 1
      ? '📊 Week-over-week trend: ' + numWeeks + ' weeks'
      : '📊 Week-over-week trend: available from Week 2';
  }
  const wowSubEl = document.getElementById('wowSubtitle');
  if (wowSubEl) wowSubEl.textContent = 'Sorted by current week — worst stations left. 🔴 >15min  🟡 12–15min  🟢 <12min';
}

// ============================================================
// Station Breaking Lines (Overview)
// ============================================================
let _sbAllVisible = true;
function sbToggleAllLines() {
  const chart = Chart.getChart('cStationBreaking');
  if (!chart) return;
  _sbAllVisible = !_sbAllVisible;
  chart.data.datasets.forEach((ds, i) => {
    chart.getDatasetMeta(i).hidden = !_sbAllVisible;
  });
  chart.update();
}

function renderStationBreaking() {
  const STATIONS = getD().stations.filter(s => isFoodStation(s.station));
  const STATION_DETAILS = getD().stationDetails;
  const CURVE = getD().curve;
  const HM_FUL_DATA = getD().hmFul;

  // Build hour → avg overall fulfillment map (avg across days)
  const hourFulMap = {};
  Object.values(HM_FUL_DATA).forEach(dayData => {
    Object.entries(dayData).forEach(([hr, val]) => {
      if (!hourFulMap[hr]) hourFulMap[hr] = { sum: 0, cnt: 0 };
      hourFulMap[hr].sum += val;
      hourFulMap[hr].cnt += 1;
    });
  });
  const hourAvgFul = {};
  Object.entries(hourFulMap).forEach(([hr, d]) => { hourAvgFul[hr] = d.sum / d.cnt; });

  // Build inverse lookup: given overall avg_ful → approx concurrent
  // For each hour, find curve point closest to hourAvgFul[hr]
  function estConc(avgFulMin) {
    if (!avgFulMin || !CURVE.length) return null;
    let best = CURVE[0], bestDiff = Math.abs(CURVE[0].ful - avgFulMin);
    CURVE.forEach(c => {
      const diff = Math.abs(c.ful - avgFulMin);
      if (diff < bestDiff) { bestDiff = diff; best = c; }
    });
    return best.conc;
  }

  // Palette for stations
  const PALETTE = ['#d9a441','#5aa9e6','#74d39a','#e2706a','#a78bfa','#fb923c','#f472b6','#38bdf8','#a3e635','#fbbf24','#34d399','#f87171'];

  // For each food station, collect (concEstimate, avg_sec/60) pairs per hour
  const datasets = [];
  STATIONS.forEach((stn, idx) => {
    const det = STATION_DETAILS[stn.station];
    if (!det || !det.hourly) return;
    const pairs = [];
    Object.entries(det.hourly).forEach(([hr, hd]) => {
      if (!hd.avg_sec) return;
      const overallFul = hourAvgFul[hr];
      if (overallFul == null) return;
      const conc = estConc(overallFul);
      if (conc == null) return;
      pairs.push({ x: conc, y: +(hd.avg_sec / 60).toFixed(2) });
    });
    if (!pairs.length) return;
    // Sort by concurrent ascending
    pairs.sort((a, b) => a.x - b.x);
    // Simple rolling average (window 3)
    const smoothed = pairs.map((p, i) => {
      const win = pairs.slice(Math.max(0, i - 1), i + 2);
      const avgY = win.reduce((s, w) => s + w.y, 0) / win.length;
      return { x: p.x, y: +avgY.toFixed(2) };
    });
    // Deduplicate by x (avg y for same conc)
    const byConc = {};
    smoothed.forEach(p => {
      if (!byConc[p.x]) byConc[p.x] = { sum: 0, cnt: 0 };
      byConc[p.x].sum += p.y;
      byConc[p.x].cnt += 1;
    });
    const finalPts = Object.entries(byConc)
      .map(([x, d]) => ({ x: +x, y: +(d.sum / d.cnt).toFixed(2) }))
      .sort((a, b) => a.x - b.x);

    // Fix 3: Apply BP rule — skip first 10 data points, require at least 2 consecutive above threshold
    const postSkip = finalPts.slice(10);
    let hasConsecutive = false;
    for (let i = 0; i < postSkip.length - 1; i++) {
      if (postSkip[i].y >= 15 && postSkip[i + 1].y >= 15) { hasConsecutive = true; break; }
    }
    if (!hasConsecutive) return;

    const color = PALETTE[idx % PALETTE.length];
    datasets.push({
      label: stn.station,
      data: finalPts,
      borderColor: color,
      backgroundColor: color + '22',
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      tension: 0.3,
      fill: false
    });
  });

  // Count hidden stations
  const totalStations = getD().stations.filter(s => isFoodStation(s.station)).length;
  const hiddenCount = totalStations - datasets.length;
  const noteEl = document.getElementById('stationBreakingNote');
  if (noteEl) {
    noteEl.textContent = hiddenCount > 0
      ? 'Only stations that break 15 min threshold are shown. ' + hiddenCount + ' other' + (hiddenCount === 1 ? '' : 's') + ' stayed under target.'
      : 'All stations shown — each exceeds the 15 min threshold at some load level.';
  }

  const thrLine = {
    id: 'sbThr15',
    beforeDraw(chart) {
      const { ctx, chartArea: a, scales } = chart;
      if (!a || !scales.y) return;
      const y15 = scales.y.getPixelForValue(15);
      const y20 = scales.y.getPixelForValue(20);
      if (y15 >= a.top && y15 <= a.bottom) {
        // Danger zone band
        ctx.save();
        ctx.fillStyle = 'rgba(192,57,43,0.08)';
        ctx.fillRect(a.left, y20, a.right - a.left, y15 - y20);
        ctx.restore();
      }
    },
    afterDraw(chart) {
      const { ctx, chartArea: a, scales } = chart;
      if (!a || !scales.y) return;
      const y15 = scales.y.getPixelForValue(15);
      if (y15 < a.top || y15 > a.bottom) return;
      ctx.save();
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(a.left, y15); ctx.lineTo(a.right, y15); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#e74c3c';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('15 min threshold', a.left + 6, y15 - 4);
      // BREAKING ZONE label on right side
      const y175 = scales.y.getPixelForValue(17.5);
      ctx.fillStyle = '#e74c3c';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('🔴 BREAKING ZONE', a.right - 4, y175 + 4);
      ctx.restore();
    }
  };

  // Plugin: draw red downward triangle at first point where station crosses 15 min
  const breakingMarkerPlugin = {
    id: 'breakingMarkers',
    afterDatasetsDraw(chart) {
      const { ctx, scales } = chart;
      if (!scales.x || !scales.y) return;
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        const pts = ds.data;
        let crossPt = null;
        for (let i = 0; i < pts.length - 1; i++) {
          if (pts[i].y < 15 && pts[i+1].y >= 15) { crossPt = pts[i+1]; break; }
          if (pts[i].y >= 15 && i === 0) { crossPt = pts[i]; break; }
        }
        if (!crossPt) return;
        const px = scales.x.getPixelForValue(crossPt.x);
        const py = scales.y.getPixelForValue(crossPt.y);
        const s = 8;
        ctx.save();
        ctx.fillStyle = '#ef4444';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py + s);
        ctx.lineTo(px - s, py - s/2);
        ctx.lineTo(px + s, py - s/2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }
  };

  const existing = Chart.getChart('cStationBreaking');
  if (existing) existing.destroy();

  if (!datasets.length) return;

  // Add subtitle element
  const sbSubEl = document.getElementById('stationBreakingSubtitle');
  if (sbSubEl) sbSubEl.textContent = '▼ = first moment station breaks ' + getThreshold() + ' min threshold';

  const chart = new Chart(document.getElementById('cStationBreaking'), {
    type: 'line',
    data: { datasets },
    options: {
      clip: false,
      parsing: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Estimated concurrent tickets open' },
          grid: { color: gc },
          min: 0
        },
        y: {
          title: { display: true, text: 'Avg fulfillment time (min)' },
          grid: { color: gc },
          min: 0,
          max: 20
        }
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { boxWidth: 12, padding: 10 },
          onClick(e, legendItem, legend) {
            const idx = legendItem.datasetIndex;
            const meta = legend.chart.getDatasetMeta(idx);
            meta.hidden = !meta.hidden;
            // Fade others when one is selected
            const anyVisible = legend.chart.data.datasets.some((_, i) => !legend.chart.getDatasetMeta(i).hidden);
            legend.chart.data.datasets.forEach((ds, i) => {
              if (!legend.chart.getDatasetMeta(i).hidden) {
                legend.chart.data.datasets[i].borderColor = ds._origColor || ds.borderColor;
                legend.chart.data.datasets[i].borderWidth = 2;
              }
            });
            legend.chart.update();
          }
        },
        tooltip: {
          callbacks: {
            title(items) { return items[0] ? items[0].dataset.label : ''; },
            label(ctx) {
              return ['Concurrent: ' + ctx.parsed.x, 'Avg time: ' + ctx.parsed.y.toFixed(1) + ' min'];
            }
          }
        }
      }
    },
    plugins: [thrLine, breakingMarkerPlugin]
  });
}

// ============================================================
// TAB 2: Station Selector & Detail
// ============================================================
function renderStations() {
  const STATIONS = getD().stations;
  const STATION_ITEMS = getD().stationItemsArr;
  const STATION_DETAILS = getD().stationDetails;
  const _BEV_KW = [
    'evian','pellegrino','perrier','water','coke','coca','diet',
    'sprite','soda','juice','lemonade','iced tea','ginger ale',
    'beer','kronenbourg','heineken','stella','bud','corona','draft',
    'wine','champagne','prosecco','sancerre','pinot','chardonnay',
    'bordeaux','burgundy','ros\u00e9','rose','chard','chablis','viognier',
    'malbec','cabernet','merlot','syrah','shiraz','riesling','sauvignon',
    'mathiasson','vista',
    'vodka','gin','rum','tequila','whiskey','whisky','bourbon','scotch',
    'mezcal','espadin','conejos','blanco','reposado','anejo',
    'tito','belvedere','hendricks','hendrick','johnnie','johnie','walker',
    'balvenie','macallan','glenlivet','glenfiddich','jameson',
    'beluga','grey goose','ketel','absolut','tanqueray','bombay',
    'bacardi','patron','don julio','casamigos','centinela',
    'martini','negroni','cocktail','spritz','aperol','campari',
    'cognac','armagnac','calvados','brandy','port','sherry','vermouth',
    'espresso','coffee','latte','cappuccino','tea','barista','americano',
    'gl ','benoit','chauveau','et fill',
    'all in savory','all in dessert','all in ',
  ];
  function isBeverageItem(name) {
    const n = (name || '').toLowerCase();
    return _BEV_KW.some(kw => n.includes(kw));
  }

  // ── Sort by ratio descending (food stations worst first) ──
  function stationRatio(s) {
    if (!s.exp_sec || s.exp_sec === 0) return -1; // no target goes last
    return s.avg_sec / s.exp_sec;
  }
  const sortedStations = [...STATIONS].sort((a, b) => {
    const ra = stationRatio(a), rb = stationRatio(b);
    if (ra < 0 && rb < 0) return a.station.localeCompare(b.station);
    if (ra < 0) return 1;
    if (rb < 0) return -1;
    return rb - ra;
  });

  function pillClass(s) {
    if (!s.exp_sec) return '';
    const r = s.avg_sec / s.exp_sec;
    if (r <= 1.0) return 'green';
    if (r <= 1.2) return 'amber';
    return 'red';
  }

  // ── Sparkline SVG (single dot for 1 week, line for 2+) ──
  function makeSparkline(stationName) {
    // For now only 1 week of data
    const numW = WEEKS.length;
    const W = 36, H = 16;
    if (numW <= 1) {
      // Single dot
      return '<svg class="sparkline-svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'
        + '<circle cx="'+(W/2)+'" cy="'+(H/2)+'" r="3" fill="#f59e0b"/>'
        + '</svg>';
    }
    // Multi-week sparkline (placeholder structure for future)
    return '<svg class="sparkline-svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'"></svg>';
  }

  // ── Trend arrow (→ for single week) ──
  function trendArrow(stationName) {
    if (WEEKS.length <= 1) return '<span style="color:#9aa0aa;font-size:11px">→</span>';
    // Future: compute from multiple weeks
    return '<span style="color:#9aa0aa;font-size:11px">→</span>';
  }

  // ── Station KPI bar ──
  const foodStations = sortedStations.filter(s => isFoodStation(s.station));
  const stationsWithTarget = foodStations.filter(s => s.exp_sec > 0);
  const stationsOverTarget = stationsWithTarget.filter(s => s.avg_sec > s.exp_sec);
  // Weighted avg across all food stations
  let totalCount = 0, totalSec = 0;
  foodStations.forEach(s => { totalCount += s.count; totalSec += s.avg_sec * s.count; });
  const overallAvgSec = totalCount > 0 ? totalSec / totalCount : null;
  const overallAvgMin = overallAvgSec ? overallAvgSec / 60 : null;
  const avgColor = overallAvgMin != null ? avgFulColorByMin(overallAvgMin) : '#9aa0aa';
  const skpiAvg = document.getElementById('skpiAvg');
  if (skpiAvg) {
    skpiAvg.textContent = overallAvgMin != null ? overallAvgMin.toFixed(1) + ' min' : '—';
    skpiAvg.style.color = avgColor;
  }
  const skpiOver = document.getElementById('skpiOver');
  const skpiOverLabel = document.getElementById('skpiOverLabel');
  if (skpiOver) {
    skpiOver.textContent = stationsWithTarget.length > 0 ? stationsOverTarget.length + ' / ' + stationsWithTarget.length : '—';
    skpiOver.style.color = stationsOverTarget.length > 0 ? '#ef4444' : '#22c55e';
  }
  if (skpiOverLabel) skpiOverLabel.textContent = 'stations over target';
  // Worst station
  const skpiWorst = document.getElementById('skpiWorst');
  const skpiWorstSub = document.getElementById('skpiWorstSub');
  if (skpiWorst) {
    const worst = [...stationsWithTarget].sort((a, b) => (b.avg_sec / b.exp_sec) - (a.avg_sec / a.exp_sec))[0];
    if (worst) {
      const delta = worst.avg_sec - worst.exp_sec;
      const wColor = worst.avg_sec > worst.exp_sec ? '#ef4444' : '#22c55e';
      skpiWorst.textContent = worst.station;
      skpiWorst.style.color = wColor;
      if (skpiWorstSub) skpiWorstSub.innerHTML = fmtSec(worst.avg_sec) + ' avg · <span style="color:' + wColor + '">' + (delta > 0 ? '+' + fmtSec(delta) + ' over' : fmtSec(-delta) + ' under') + ' target</span>';
    } else {
      skpiWorst.textContent = 'No targets set';
      skpiWorst.style.color = '#9aa0aa';
      if (skpiWorstSub) skpiWorstSub.textContent = '';
    }
  }

  // ── Status badge for station ──
  function stationBadge(s) {
    if (!s.exp_sec) return '<span style="position:absolute;top:4px;right:6px;font-size:10px;background:#374151;color:#d1d5db;padding:2px 6px;border-radius:10px;font-weight:700">⚪ NO TARGET</span>';
    const r = s.avg_sec / s.exp_sec;
    if (r > 1.2) return '<span style="position:absolute;top:4px;right:6px;font-size:10px;background:#7f1d1d;color:#fca5a5;padding:2px 6px;border-radius:10px;font-weight:700">🔴 BREAKING</span>';
    if (r > 1.0) return '<span style="position:absolute;top:4px;right:6px;font-size:10px;background:#78350f;color:#fcd34d;padding:2px 6px;border-radius:10px;font-weight:700">⚠️ WATCH</span>';
    return '<span style="position:absolute;top:4px;right:6px;font-size:10px;background:#14532d;color:#86efac;padding:2px 6px;border-radius:10px;font-weight:700">✅ ON TARGET</span>';
  }

  // ── Load curve sparkline from station hourly data ──
  function loadSparkline(s) {
    const det = STATION_DETAILS[s.station] || {};
    const hourly = det.hourly || {};
    const hrs = Object.keys(hourly).sort();
    if (!hrs.length) return '<svg width="120" height="30" style="display:block;margin:4px 0"><text x="4" y="18" fill="#4b5563" font-size="10">no data</text></svg>';
    const vals = hrs.map(h => hourly[h].avg_sec / 60);
    const minV = Math.min(...vals), maxV = Math.max(...vals, 15);
    const W = 120, H = 30;
    const xs = vals.map((_, i) => Math.round(4 + (i / Math.max(1, vals.length - 1)) * (W - 8)));
    const ys = vals.map(v => Math.round(H - 4 - ((v - minV) / Math.max(0.1, maxV - minV)) * (H - 8)));
    const tgtY = s.exp_sec ? Math.round(H - 4 - ((s.exp_sec/60 - minV) / Math.max(0.1, maxV - minV)) * (H - 8)) : null;
    let path = xs.map((x, i) => (i===0?'M':'L') + x + ',' + ys[i]).join(' ');
    let tgtLine = tgtY != null ? '<line x1="0" y1="' + tgtY + '" x2="' + W + '" y2="' + tgtY + '" stroke="#e2706a" stroke-width="1" stroke-dasharray="3,2"/>' : '';
    const color = s.exp_sec && s.avg_sec > s.exp_sec ? '#ef4444' : '#22c55e';
    return '<svg width="' + W + '" height="' + H + '" style="display:block;margin:4px 0 0">' + tgtLine + '<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="1.5"/></svg>';
  }

  // ── Sort stations: breaking → watch → ok → no target ──
  function stationGroup(s) {
    if (!s.exp_sec) return 3;
    const r = s.avg_sec / s.exp_sec;
    if (r > 1.0) return 0;
    if (r > 0.85) return 1;
    return 2;
  }
  const groupSorted = [...sortedStations].sort((a, b) => stationGroup(a) - stationGroup(b) || (b.avg_sec / (b.exp_sec||1)) - (a.avg_sec / (a.exp_sec||1)));

  // ── Build pill with two-line format ──
  function pillLabel(s) {
    const avgTime = fmtSec(s.avg_sec);
    let vsTarget = '—';
    if (s.exp_sec > 0) {
      const delta = s.avg_sec - s.exp_sec;
      const sign = delta > 0 ? '+' : '-';
      vsTarget = sign + fmtSec(Math.abs(delta));
    }
    return '<div style="position:relative;padding-top:14px">' +
      stationBadge(s) +
      '<span class="sp-name">' + s.station + '</span>' +
      '<span class="sp-stats">' + avgTime + ' · vs tgt: ' + vsTarget + '</span>' +
      loadSparkline(s) +
      '</div>';
  }

  const pillsEl = document.getElementById('stationPills');
  pillsEl.innerHTML = '';
  groupSorted.forEach((s, idx) => {
    const btn = document.createElement('button');
    btn.className = 'station-pill ' + pillClass(s);
    btn.innerHTML = pillLabel(s);
    btn.onclick = () => {
      document.querySelectorAll('.station-pill').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderStationDetail(s);
    };
    if (idx === 0) btn.classList.add('active');
    pillsEl.appendChild(btn);
  });

  function renderStationDetail(s) {
    const det = STATION_DETAILS[s.station] || {};
    const items = (STATION_ITEMS[s.station] || []).filter(it => !isBeverageItem(it.menuItem || it.item || ''));
    const ratio = s.exp_sec > 0 ? s.avg_sec / s.exp_sec : null;
    let statusClass = 'status-red', statusText = 'Over target';
    if (!s.exp_sec) { statusClass=''; statusText='No target'; }
    else if (ratio <= 1.0) { statusClass='status-green'; statusText='On target ✓'; }
    else if (ratio <= 1.15) { statusClass='status-amber'; statusText='Slightly over'; }

    const brkHours = (det.breakingHours || []).filter(r => r.avg_sec > 900);
    const brkText = brkHours.length > 0
      ? brkHours.slice(0,5).map(r=>r.day+' '+r.hr+' ('+fmtSec(r.avg_sec)+')').join(', ')
      : 'None found (≤15 min all periods)';

    const hourly = det.hourly || {};
    const hourlyHours = Object.keys(hourly).sort();
    const target = s.exp_sec || 0;

    // ── Find worst cell in byDayHour ──
    const byDayHour = det.byDayHour || {};
    let worstSec = -1, worstDay = null, worstHr = null;
    Object.entries(byDayHour).forEach(([day, hrs]) => {
      Object.entries(hrs).forEach(([hr, d]) => {
        if (d && d.avg_sec > worstSec) {
          worstSec = d.avg_sec;
          worstDay = day;
          worstHr = hr;
        }
      });
    });

    let hmHtml = '';
    if (hourlyHours.length > 0) {
      hmHtml = '<div style="overflow-x:auto;margin-top:12px"><table style="border-collapse:collapse;font-size:11px;min-width:600px">';
      hmHtml += '<tr><th style="background:#1e2533;padding:4px 6px;text-align:left;color:#9aa0aa;white-space:nowrap">Hour</th>';
      hourlyHours.forEach(hr => {
        hmHtml += '<th style="background:#1e2533;padding:4px 5px;text-align:center;color:#9aa0aa;white-space:nowrap;min-width:52px">'+hr+'</th>';
      });
      hmHtml += '</tr><tr><td style="background:#181b22;padding:4px 6px;color:#9aa0aa;white-space:nowrap">Avg</td>';
      hourlyHours.forEach(hr => {
        const sec = hourly[hr] ? hourly[hr].avg_sec : null;
        const bg = hmColor(sec, target);
        const fg = textFor(bg);
        const expSec = hourly[hr] ? hourly[hr].exp_sec : 0;
        const tip = sec != null ? fmtSec(sec) + (expSec?' · tgt '+fmtSec(expSec):'') : 'no data';
        hmHtml += '<td title="'+tip+'" style="padding:4px 4px;background:'+bg+';color:'+fg+';text-align:center;font-weight:600">'+(sec!=null?fmtSec(sec):'')+'</td>';
      });
      hmHtml += '</tr>';
      ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].forEach(day => {
        if (!byDayHour[day]) return;
        hmHtml += '<tr><td style="background:#13161c;padding:3px 6px 3px 14px;color:#9aa0aa;font-size:10px;white-space:nowrap">'+day.slice(0,3)+'</td>';
        hourlyHours.forEach(hr => {
          const d2 = byDayHour[day][hr];
          const sec = d2 ? d2.avg_sec : null;
          const tgt2 = d2 ? d2.exp_sec : target;
          const bg = hmColor(sec, tgt2||target);
          const fg = textFor(bg);
          const isWorst = (day === worstDay && hr === worstHr && sec > 0);
          const peakLabel = isWorst ? ' ⚠' : '';
          const peakStyle = isWorst ? ' class="peak-cell"' : '';
          hmHtml += '<td'+peakStyle+' style="padding:3px 4px;background:'+bg+';color:'+fg+';text-align:center;font-size:10px">'+(sec&&sec>0?fmtSec(sec)+peakLabel:'')+'</td>';
        });
        hmHtml += '</tr>';
      });
      hmHtml += '</table>';
      if (worstDay) {
        hmHtml += '<div style="font-size:11px;color:#ef4444;margin-top:4px">⚠ Peak: '+worstDay+' '+worstHr+' ('+fmtSec(worstSec)+')</div>';
      }
      hmHtml += '</div>';
    }

    const topItems = items.slice(0, 20);
    let itemsHtml = '';
    if (topItems.length > 0) {
      const maxSec = Math.max(...topItems.map(i=>i.avgFulSec||0), s.exp_sec||0, 900);
      itemsHtml = '<table class="items-table"><thead><tr><th>Menu Item</th><th>Count</th><th>Avg Time</th><th>vs Target</th><th style="min-width:120px">Bar</th></tr></thead><tbody>';
      topItems.forEach(it => {
        const avg = it.avgFulSec || 0;
        const name = it.menuItem || '—';
        const cnt = it.qty || 0;
        const over = avg > (s.exp_sec||900);
        const delta = s.exp_sec ? avg - s.exp_sec : avg - 900;
        const deltaStr = s.exp_sec
          ? (delta>0?'<span style="color:#e2706a">+'+fmtSec(delta)+'</span>':'<span style="color:#74d39a">'+fmtSec(-delta)+' under</span>')
          : '—';
        const pct = Math.min(100, (avg / maxSec) * 100);
        const barColor = over ? '#ef4444' : '#22c55e';
        itemsHtml += '<tr><td>'+(over?'<span style="color:#e2706a">'+name+'</span>':name)+'</td><td style="color:#9aa0aa">'+cnt+'</td><td style="font-weight:600">'+fmtSec(avg)+'</td><td>'+deltaStr+'</td><td><div class="bar-cell"><div class="bar-bg"><div class="bar-fill" style="width:'+pct+'%;background:'+barColor+'"></div></div><span style="font-size:10px;color:#9aa0aa;white-space:nowrap">'+fmtSec(avg)+'</span></div></td></tr>';
      });
      itemsHtml += '</tbody></table>';
      if (items.length > 20) itemsHtml += '<p style="font-size:11px;color:#9aa0aa;margin:6px 0 0">+'+(items.length-20)+' more items</p>';
    } else {
      itemsHtml = '<p style="color:#9aa0aa;font-size:12px">No item-level data available from ticket drop for this station.</p>';
    }

    const statusSpan = statusClass
      ? '<span class="status-badge '+statusClass+'">'+statusText+'</span>'
      : '<span style="color:#9aa0aa;font-size:12px">'+statusText+'</span>';
    const ratioColor = ratio ? (ratio>1.15?'#ef4444':ratio>1?'#f59e0b':'#22c55e') : '#9aa0aa';
    const ratioDisp = ratio ? (ratio*100).toFixed(0)+'%' : '—';
    document.getElementById('stationDetail').innerHTML =
      '<div class="station-header">'+
        '<h2>'+s.station+'</h2>'+statusSpan+
        '<div class="kpis" style="margin:0 0 0 auto;grid-template-columns:repeat(4,auto)">'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px">'+s.count+'</div><div class="l">Tickets</div></div>'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px">'+fmtSec(s.avg_sec)+'</div><div class="l">Avg time</div></div>'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px">'+(s.exp_sec?fmtSec(s.exp_sec):'—')+'</div><div class="l">Target</div></div>'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px;color:'+ratioColor+'">'+ratioDisp+'</div><div class="l">vs Target</div></div>'+
          (s.bp_tickets != null ? '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px;color:#e2706a">'+s.bp_tickets+'</div><div class="l">Station BP</div></div>' : '')+
        '</div>'+
      '</div>'+
      '<div style="margin-bottom:16px">'+
        '<div style="font-size:13px;font-weight:600;color:#d9a441;margin-bottom:4px">⚡ Breaking Point</div>'+
        '<div style="font-size:12px;color:#9aa0aa">'+brkText+'</div>'+
      '</div>'+
      '<div style="font-size:13px;font-weight:600;color:#d9a441;margin-bottom:4px">Hourly Heatmap (Day × Hour)</div>'+
      hmHtml+
      '<div style="font-size:13px;font-weight:600;color:#d9a441;margin:16px 0 4px">Menu Items at this station (from ticket drop)</div>'+
      itemsHtml +
      '<details style="margin-top:16px;cursor:pointer"><summary style="font-size:13px;font-weight:600;color:#d9a441;outline:none">❓ WHY is this station slow? (top 3 items)</summary>' +
      '<div style="margin-top:8px;background:#1a1d25;border-radius:8px;padding:10px;border:1px solid #2d3448">' +
      (items.length > 0 ? '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;color:#9aa0aa;padding:4px 8px">Item</th><th style="text-align:right;color:#9aa0aa;padding:4px 8px">Avg Time</th><th style="text-align:right;color:#9aa0aa;padding:4px 8px">Tickets</th></tr></thead><tbody>' +
        items.slice(0,3).map(it => '<tr><td style="padding:4px 8px;color:#e8eaed">' + (it.menuItem||'—') + '</td><td style="padding:4px 8px;text-align:right;font-weight:600;color:' + ((it.avgFulSec||0) > (s.exp_sec||900) ? '#ef4444' : '#22c55e') + '">' + fmtSec(it.avgFulSec||0) + '</td><td style="padding:4px 8px;text-align:right;color:#9aa0aa">' + (it.qty||0) + '</td></tr>').join('') +
        '</tbody></table>'
      : '<p style="color:#9aa0aa;font-size:12px;margin:0">No item data available.</p>') +
      '</div></details>';
  }

  renderStationDetail(sortedStations[0]);

  // Station bar chart
  const stSorted = [...STATIONS].sort((a,b)=>b.avg_sec-a.avg_sec);
  function barColor(s){
    if(!s.exp_sec)return '#5aa9e6';
    const r=s.avg_sec/s.exp_sec;
    if(r<=1.0)return '#22c55e';
    if(r<=1.15)return '#f59e0b';
    return '#ef4444';
  }
  const thrPlugin={id:'targetLines',afterDatasetsDraw(chart){
    const{ctx,chartArea:a,scales}=chart;if(!a)return;
    stSorted.forEach((s,i)=>{
      if(!s.exp_sec)return;
      const x=scales.x.getPixelForValue(i);
      const y=scales.y.getPixelForValue(s.exp_sec/60);
      const hw=(scales.x.getPixelForValue(1)-scales.x.getPixelForValue(0))*0.3;
      ctx.save();ctx.strokeStyle='#888';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-hw,y);ctx.lineTo(x+hw,y);ctx.stroke();ctx.restore();
    });
  }};
  const existingSt = Chart.getChart('cStations');
  if (existingSt) existingSt.destroy();
  new Chart(document.getElementById('cStations'),{
    type:'bar',
    data:{labels:stSorted.map(s=>s.station),datasets:[{label:'Avg fulfillment (min)',data:stSorted.map(s=>+(s.avg_sec/60).toFixed(2)),backgroundColor:stSorted.map(barColor),borderRadius:4}]},
    options:{interaction:{mode:'index',intersect:false},scales:{x:{grid:{display:false},ticks:{maxRotation:45,minRotation:30}},y:{title:{display:true,text:'Avg fulfillment time (min)'},grid:{color:gc},min:0}},plugins:{legend:{display:false},tooltip:{callbacks:{label(ctx){const s=stSorted[ctx.dataIndex];const lines=['Avg: '+fmtSec(s.avg_sec)+' ('+ctx.parsed.y.toFixed(1)+' min)','Count: '+s.count];if(s.exp_sec){lines.push('Target: '+fmtSec(s.exp_sec));lines.push('Ratio: '+(s.avg_sec/s.exp_sec*100).toFixed(1)+'%');}else lines.push('No target');return lines;}}}}},
    plugins:[thrPlugin]
  });
}

// ============================================================
// TAB 3: Menu Items
// ============================================================
function renderMenuItems() {
  const SUMMARY = getD().summary || [];
  const STATION_ITEMS = getD().stationItemsArr || {};
  const THR_SEC = 900;
  let currentSort = 'time';
  let currentSearch = '';

  // Build item→station map from stationItemsArr
  const itemStationMap = {};
  Object.entries(STATION_ITEMS).forEach(([station, items]) => {
    if (!isFoodStation(station)) return;
    (items || []).forEach(it => {
      if (!itemStationMap[it.menuItem]) itemStationMap[it.menuItem] = station;
    });
  });

  if (!SUMMARY.length) {
    document.getElementById('menuStats').innerHTML = '';
    const bubbleCard = document.getElementById('menuBubbleCard');
    if (bubbleCard) bubbleCard.style.display = 'none';
    document.getElementById('menuBody').innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:40px 20px;color:#9aa0aa;font-size:14px">' +
      'Item fulfillment data not yet configured for this venue.<br>' +
      '<small style="color:#6b7280">Add a custom report ID to <code>CUSTOM_REPORT_IDS</code> in weekly-save.js to enable.</small>' +
      '</td></tr>';
    window.applyMenuFilters = function() {};
    window.setSort = function() {};
    return;
  }

  const bubbleCard = document.getElementById('menuBubbleCard');
  if (bubbleCard) bubbleCard.style.display = '';

  // Build item→exp_sec map from station items (use station's exp_sec as item target proxy)
  const itemExpSecMap = {};
  const STATIONS_DATA = getD().stations;
  Object.entries(STATION_ITEMS).forEach(([station, items]) => {
    if (!isFoodStation(station)) return;
    const stnData = STATIONS_DATA.find(s => s.station === station);
    const stnExpSec = stnData ? stnData.exp_sec : 0;
    (items || []).forEach(it => {
      if (!itemExpSecMap[it.menuItem] && stnExpSec > 0) {
        itemExpSecMap[it.menuItem] = stnExpSec;
      }
    });
  });
  // Also check if SUMMARY items have exp_sec field
  SUMMARY.forEach(d => {
    if (d.exp_sec && d.exp_sec > 0) itemExpSecMap[d.item] = d.exp_sec;
  });

  function getItemTarget(item) {
    return itemExpSecMap[item] || THR_SEC;
  }
  function itemColorByTarget(avg_sec, item) {
    const tgt = getItemTarget(item);
    if (avg_sec <= tgt) return '#22c55e';
    if (avg_sec <= tgt * 1.15) return '#f59e0b';
    return '#ef4444';
  }

  let menuStatusFilter = 'all';
  const overTarget = SUMMARY.filter(d => d.avg_sec > getItemTarget(d.item)).length;
  const over15 = SUMMARY.filter(d=>d.avg_sec>=900).length;
  const b1015 = SUMMARY.filter(d=>d.avg_sec>=600&&d.avg_sec<900).length;
  const under10 = SUMMARY.filter(d=>d.avg_sec<600).length;
  document.getElementById('menuStats').innerHTML =
    '<div class="menu-stat"><div class="v">'+SUMMARY.length+'</div><div class="l">Total items</div></div>'+
    '<div class="menu-stat"><div class="v" style="color:#ef4444">'+overTarget+'</div><div class="l">Over target</div></div>'+
    '<div class="menu-stat"><div class="v" style="color:#f59e0b">'+b1015+'</div><div class="l">10–15 min</div></div>'+
    '<div class="menu-stat"><div class="v" style="color:#22c55e">'+under10+'</div><div class="l">Under 10 min</div></div>';

  // ── Worst Offenders callout ──
  const top5worst = [...SUMMARY].sort((a,b)=>b.avg_sec-a.avg_sec).slice(0,5);
  const worstOffEl = document.getElementById('menuWorstOffenders');
  if (worstOffEl && top5worst.length > 0) {
    worstOffEl.style.display = '';
    worstOffEl.innerHTML = '<div style="font-size:13px;font-weight:700;color:#fca5a5;margin-bottom:8px">🔥 Worst Offenders — Top 5 Slowest Items</div>' +
      top5worst.map((d,i) => '<div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid #2d1f1f' + (i===top5worst.length-1?';border-bottom:none':'') + '"><span style="color:#9aa0aa;font-size:11px;width:16px">' + (i+1) + '</span><span style="flex:1;font-weight:600;color:#e8eaed">' + d.item + '</span><span style="color:#ef4444;font-weight:700">' + (d.avg_sec/60).toFixed(1) + ' min</span><span style="color:#9aa0aa;font-size:11px">' + d.count + ' tickets</span></div>').join('');
  }

  // ── Bubble chart ──
  (function renderBubble() {
    const existing = Chart.getChart('cMenuBubble');
    if (existing) existing.destroy();

    const food = SUMMARY.filter(d => {
      const st = itemStationMap[d.item];
      return !st || isFoodStation(st);
    });

    if (!food.length) return;

    const maxCount = Math.max(...food.map(d=>d.count));
    const MIN_R = 5, MAX_R = 25;

    const datasets = food.map(d => {
      const minAvg = d.avg_sec / 60;
      const r = MIN_R + (d.count / maxCount) * (MAX_R - MIN_R);
      const color = itemColorByTarget(d.avg_sec, d.item);
      return {
        label: d.item,
        data: [{ x: d.count, y: +minAvg.toFixed(2), r }],
        backgroundColor: color + 'bb',
        borderColor: color,
        borderWidth: 1
      };
    });

    const thrLine = {id:'bubbleThr',afterDraw(chart){
      const{ctx,chartArea:a,scales}=chart;if(!a||!scales.y)return;
      const y15=scales.y.getPixelForValue(15);
      if(y15>=a.top&&y15<=a.bottom){
        ctx.save();ctx.strokeStyle='#e2706a';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);
        ctx.beginPath();ctx.moveTo(a.left,y15);ctx.lineTo(a.right,y15);ctx.stroke();
        ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='11px sans-serif';
        ctx.fillText('15 min',a.left+6,y15-4);ctx.restore();
      }
      // Draw badge top-right
      ctx.save();
      ctx.fillStyle='#1f2330';
      const bw=220,bh=20,bx=a.right-bw-4,by=a.top+4;
      ctx.strokeStyle='#2d3448';ctx.lineWidth=1;
      ctx.beginPath();ctx.roundRect(bx,by,bw,bh,4);ctx.fill();ctx.stroke();
      ctx.fillStyle='#8a9ab5';ctx.font='10px sans-serif';ctx.textAlign='left';
      ctx.fillText('3-week trend: available from Week 2 (Jul 14)',bx+6,by+13);
      ctx.restore();
    }};

    const existingMb = Chart.getChart('cMenuBubble');
    if (existingMb) existingMb.destroy();
    new Chart(document.getElementById('cMenuBubble'), {
      type: 'bubble',
      data: { datasets },
      options: {
        scales: {
          x: { title: { display:true, text:'Order count (volume)' }, grid:{color:gc} },
          y: { title: { display:true, text:'Avg fulfillment (min)' }, grid:{color:gc}, min:0 }
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label(ctx) {
              const d = food[ctx.datasetIndex];
              return [d.item, 'Count: '+d.count, 'Avg: '+(d.avg_sec/60).toFixed(1)+' min'];
            }
          }}
        }
      },
      plugins: [thrLine]
    });
  })();

  const searchEl = document.getElementById('menuSearch');
  if (searchEl) { searchEl.value = ''; currentSearch = ''; }

  function sorted(data) {
    const s = [...data];
    if (currentSort === 'time') s.sort((a,b)=>b.avg_sec-a.avg_sec);
    else if (currentSort === 'fast') s.sort((a,b)=>a.avg_sec-b.avg_sec);
    else if (currentSort === 'count') s.sort((a,b)=>b.count-a.count);
    else s.sort((a,b)=>a.item.localeCompare(b.item));
    return s;
  }
  function itemStatusLabel(sec, item) {
    const tgt = getItemTarget(item);
    if (sec > tgt * 1.15) return '<span style="color:#ef4444;font-size:11px">● Over tgt</span>';
    if (sec > tgt) return '<span style="color:#f59e0b;font-size:11px">● Slight over</span>';
    return '<span style="color:#22c55e;font-size:11px">● On target</span>';
  }

  // ── Status filter buttons ──
  const menuFilterBar = document.getElementById('menuStatusFilter');
  if (menuFilterBar) {
    menuFilterBar.innerHTML = ['all','breaking','watch','ok'].map(f =>
      '<button onclick="setMenuFilter(\\'' + f + '\\',this)" style="padding:4px 12px;background:' + (f==='all'?'#2d3448':'#1e2533') + ';border:1px solid #2d3448;color:' + (f==='all'?'#e8eaed':'#9aa0aa') + ';border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;margin-right:4px">' +
        (f==='all'?'All':f==='breaking'?'🔴 Breaking':f==='watch'?'🟡 Watch':'🟢 OK') + '</button>'
    ).join('');
  }

  function renderMenu() {
    let data = SUMMARY;
    if (currentSearch) data = data.filter(d=>d.item.toLowerCase().includes(currentSearch.toLowerCase()));
    if (menuStatusFilter && menuStatusFilter !== 'all') {
      data = data.filter(d => {
        const tgt = getItemTarget(d.item);
        const r = d.avg_sec / tgt;
        if (menuStatusFilter === 'breaking') return r > 1.0;
        if (menuStatusFilter === 'watch') return r > 0.8 && r <= 1.0;
        if (menuStatusFilter === 'ok') return r <= 0.8;
        return true;
      });
    }
    const s = sorted(data);
    document.getElementById('menuBody').innerHTML = s.map((d,i) => {
      const tgt = getItemTarget(d.item);
      const barCol = itemColorByTarget(d.avg_sec, d.item);
      const over = d.avg_sec > tgt;
      const diff = d.avg_sec - tgt;
      const diffStr = diff > 0
        ? '<span class="over">+'+fmtSec(diff)+'</span>'
        : '<span class="ok">'+fmtSec(-diff)+' under</span>';
      // Bar shows ratio of avg vs target (capped at 150%)
      const pct = Math.min(100, (d.avg_sec / (tgt * 1.5)) * 100);
      const tgtPct = Math.min(100, (tgt / (tgt * 1.5)) * 100); // always ~66.7%
      const tgtDisplay = itemExpSecMap[d.item] ? fmtSec(itemExpSecMap[d.item]) : '<span style="color:#6b7280">—</span>';
      const stationName = itemStationMap[d.item] || null;
      const stationDot = stationName
        ? (() => {
            const st = getD().stations.find(s => s.station === stationName);
            const dotColor = st ? perfColorHex(st.avg_sec, st.exp_sec) : '#9aa0aa';
            return '<span title="'+stationName+'" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#9aa0aa"><span style="width:8px;height:8px;border-radius:50%;background:'+dotColor+';display:inline-block"></span>'+stationName+'</span>';
          })()
        : '<span style="color:#6b7280;font-size:11px">—</span>';
      const trendCell = '<span style="color:#6b7280;font-size:11px" title="Available from Week 2 (Jul 14)">—</span>';
      return '<tr>'+
        '<td style="color:#9aa0aa">'+(i+1)+'</td>'+
        '<td style="'+(over?'color:#e2706a;font-weight:600':'')+'">'+d.item+'</td>'+
        '<td style="color:#9aa0aa;text-align:right">'+d.count+'</td>'+
        '<td style="font-weight:700;color:'+barCol+'">'+fmtMin(d.avg_sec)+'</td>'+
        '<td style="min-width:160px"><div style="position:relative;height:10px;background:#1e2533;border-radius:5px;overflow:visible"><div style="position:absolute;left:0;top:0;height:100%;width:'+pct+'%;background:'+barCol+';border-radius:5px"></div><div style="position:absolute;left:'+tgtPct+'%;top:-2px;width:2px;height:14px;background:#e2706a;border-radius:1px" title="Target: '+fmtSec(tgt)+'"></div></div></td>'+
        '<td>'+tgtDisplay+'</td>'+
        '<td>'+itemStatusLabel(d.avg_sec, d.item)+'</td>'+
        '<td>'+trendCell+'</td>'+
        '<td>'+stationDot+'</td>'+
        '</tr>';
    }).join('');
  }

  window.applyMenuFilters = function() {
    currentSearch = document.getElementById('menuSearch').value;
    renderMenu();
  };
  window.setSort = function(s, btn) {
    currentSort = s;
    document.querySelectorAll('.sort-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    renderMenu();
  };
  window.setMenuFilter = function(f, btn) {
    menuStatusFilter = f;
    const bar = document.getElementById('menuStatusFilter');
    if (bar) bar.querySelectorAll('button').forEach(b => {
      b.style.background = '#1e2533'; b.style.color = '#9aa0aa';
    });
    if (btn) { btn.style.background = '#2d3448'; btn.style.color = '#e8eaed'; }
    renderMenu();
  };
  renderMenu();
}

// ============================================================
// TAB 5: Assignment
// ============================================================
function renderAssignment() {
  // Fix 4: Use item-targets.json for targets; show ALL food items from item-fulfillment
  const venueSlugMap = { claudie:'claudie', casaneos:'casa_neos', ava_cg:'ava_cg', ava_wp:'ava_wp', mila:'mila' };
  const venueTargets = ITEM_TARGETS_DATA[venueSlugMap[currentVenue]] || {};
  const RAW_DATA = getD().assignmentData || [];

  // Build merged rows: use assignmentData items as base, override target from venueTargets
  // Also add any items that appear in item-fulfillment summary but not in assignmentData
  const summary = getD().summary || [];
  const assignMap = {};
  RAW_DATA.forEach(r => { assignMap[r.menuItem] = r; });

  // Merge: all items from assignmentData + summary items not already there
  const allItems = new Set([...RAW_DATA.map(r => r.menuItem), ...summary.map(s => s.menuItem || s.item || '')].filter(Boolean));

  const DATA = [...allItems].map(menuItem => {
    const base = assignMap[menuItem] || {};
    const summaryRow = summary.find(s => (s.menuItem || s.item) === menuItem);
    const avgFulSec = base.avgFulSec || (summaryRow ? summaryRow.avg_sec : null);
    const count = base.count || (summaryRow ? summaryRow.count : null);
    const station = base.station || null;
    // Fix 4: use item-targets.json value if available, otherwise use base.targetSec or null
    const targetSec = venueTargets[menuItem] || base.targetSec || null;
    return { menuItem, station, targetSec, avgFulSec, count };
  });

  // Sort: items WITH station first (sorted by station name), then without station
  DATA.sort((a, b) => {
    if (a.station && !b.station) return -1;
    if (!a.station && b.station) return 1;
    if (a.station && b.station) return a.station.localeCompare(b.station) || a.menuItem.localeCompare(b.menuItem);
    return a.menuItem.localeCompare(b.menuItem);
  });

  const searchEl = document.getElementById('assignSearch');
  if (searchEl) { searchEl.value = ''; }

  function getRows() {
    const q = (document.getElementById('assignSearch')?.value || '').toLowerCase();
    return q ? DATA.filter(r => r.menuItem.toLowerCase().includes(q) || (r.station||'').toLowerCase().includes(q)) : DATA;
  }

  function statusBadge(avgFulSec, targetSec) {
    if (!avgFulSec) return '<span style="color:#6b7280;font-size:11px">—</span>';
    if (!targetSec) return '<span style="color:#9aa0aa;font-size:11px">● No Target</span>';
    const r = avgFulSec / targetSec;
    if (r > 1.15) return '<span style="color:#ef4444;font-size:11px">● Over</span>';
    if (r > 1.0) return '<span style="color:#f59e0b;font-size:11px">● Watch</span>';
    return '<span style="color:#22c55e;font-size:11px">● OK</span>';
  }

  function renderRows(rows) {
    let lastStation = null;
    const countEl = document.getElementById('assignCount');
    if (countEl) countEl.textContent = rows.length + ' items';
    if (!rows.length) {
      document.getElementById('assignBody').innerHTML =
        '<tr><td colspan="6" style="text-align:center;padding:40px 20px;color:#9aa0aa;font-size:14px">No assignment data available for this venue/week.</td></tr>';
      return;
    }
    document.getElementById('assignBody').innerHTML = rows.map(r => {
      const stationDisplay = r.station || '—';
      const stationCell = r.station !== lastStation
        ? '<td style="padding:7px 10px;font-weight:700;color:' + (r.station ? '#d9a441' : '#6b7280') + ';white-space:nowrap;vertical-align:top">' + stationDisplay + '</td>'
        : '<td style="padding:7px 10px;color:#3a3f4a;border-top:none"></td>';
      lastStation = r.station;
      const avgColor = r.avgFulSec && r.targetSec
        ? (r.avgFulSec > r.targetSec * 1.15 ? '#ef4444' : r.avgFulSec > r.targetSec ? '#f59e0b' : '#22c55e')
        : '#9aa0aa';
      return '<tr style="border-top:1px solid #1e2533">' +
        stationCell +
        '<td style="padding:7px 10px;color:#e8eaed">' + r.menuItem + '</td>' +
        '<td style="padding:7px 10px;text-align:right;color:#9aa0aa">' + (r.targetSec ? fmtSec(r.targetSec) : '—') + '</td>' +
        '<td style="padding:7px 10px;text-align:right;font-weight:600;color:' + avgColor + '">' + (r.avgFulSec ? fmtSec(r.avgFulSec) : '—') + '</td>' +
        '<td style="padding:7px 10px;text-align:right;color:#9aa0aa">' + (r.count || '—') + '</td>' +
        '<td style="padding:7px 10px;text-align:center">' + statusBadge(r.avgFulSec, r.targetSec) + '</td>' +
        '</tr>';
    }).join('');
  }

  renderRows(getRows());

  window.applyAssignFilter = function() {
    renderRows(getRows());
  };
}

// ============================================================
// TAB 4: Group Summary
// ============================================================
function renderGroup() {
  const VENUE_LABELS_LOCAL = ${JSON.stringify(VENUE_LABELS)};
  const weekLabel = WEEKS[currentWeekIdx] ? WEEKS[currentWeekIdx].label : 'Week 1';

  const titleEl = document.getElementById('groupTitle');
  if (titleEl) titleEl.textContent = 'RDG Group — ' + weekLabel + ' Performance';

  // Build venue summary data
  const venueData = Object.entries(VENUE_LABELS_LOCAL).map(([key, label]) => {
    const weekKey = WEEKS[currentWeekIdx]?.key;
    const d = ALL_DATA[key]?.[weekKey] || ALL_DATA[key]?.['latest'] || {};
    const stations = (d.stations || []).filter(s => isFoodStation(s.station));
    // Weighted avg fulfillment across food stations
    let totalCount = 0, totalSec = 0;
    stations.forEach(s => { totalCount += s.count; totalSec += s.avg_sec * s.count; });
    const avgFulSec = totalCount > 0 ? totalSec / totalCount : null;
    const avgFulMin = avgFulSec ? avgFulSec / 60 : null;

    // Total tickets (station tickets sum)
    const totalTickets = stations.reduce((acc, s) => acc + s.count, 0);

    // Breaking point
    const bp = d.breakingPoint || null;
    const bpGuests = d.breakingPointGuests || null;

    // % over 15 min: use SUMMARY if available
    const summary = d.summary || [];
    const overCount = summary.filter(x => x.avg_sec >= 900).length;
    const overPct = summary.length > 0 ? (overCount / summary.length * 100).toFixed(0) : null;

    // Stations with targets
    const withTarget = stations.filter(s => s.exp_sec > 0);
    const overTarget = withTarget.filter(s => s.avg_sec > s.exp_sec).length;
    const overTargetPct = withTarget.length > 0 ? (overTarget / withTarget.length * 100).toFixed(0) : null;

    // Top 3 slowest stations
    const top3 = [...stations].sort((a,b)=>b.avg_sec-a.avg_sec).slice(0,3);

    return { key, label, avgFulMin, avgFulSec, totalTickets, bp, bpGuests, overPct, overTargetPct, top3, withTarget };
  });

  // ── Venue scorecards ──
  const cardsEl = document.getElementById('groupCards');
  if (cardsEl) {
    cardsEl.innerHTML = venueData.map(v => {
      const avgColor = v.avgFulMin != null ? avgFulColorByMin(v.avgFulMin) : '#9aa0aa';
      const avgDisp = v.avgFulMin != null ? v.avgFulMin.toFixed(1)+' min' : '—';
      const top3Html = v.top3.map(s =>
        '<div style="font-size:11px;color:#9aa0aa;margin-top:3px">'+
        '<span style="color:'+perfColorHex(s.avg_sec,s.exp_sec)+'">●</span> '+
        s.station+' <strong style="color:#e8eaed">'+fmtSec(s.avg_sec)+'</strong></div>'
      ).join('');
      return '<div class="group-card">'+
        '<div class="venue-name">'+v.label+'</div>'+
        '<div style="text-align:center;margin:10px 0">'+
          '<div class="big-num" style="color:'+avgColor+'">'+avgDisp+'</div>'+
          '<div class="sub">Avg fulfillment</div>'+
        '</div>'+
        '<div class="row4">'+
          '<div class="mini-kpi"><div class="v">'+v.totalTickets.toLocaleString()+'</div><div class="l">Food tickets</div></div>'+
          '<div class="mini-kpi"><div class="v">'+(v.bp||'—')+(v.bp?' / '+(v.bpGuests||'?')+'g':'')+'</div><div class="l">Breaking point</div></div>'+
          '<div class="mini-kpi"><div class="v" style="color:#ef4444">'+(v.overPct!=null?v.overPct+'%':'—')+'</div><div class="l">&gt;15 min items</div></div>'+
          '<div class="mini-kpi"><div class="v" style="color:#f59e0b">'+(v.overTargetPct!=null?v.overTargetPct+'%':'—')+'</div><div class="l">Stations over target</div></div>'+
        '</div>'+
        '<div style="margin-top:12px;border-top:1px solid #262a33;padding-top:8px">'+
          '<div style="font-size:11px;font-weight:600;color:#d9a441;margin-bottom:4px">Top 3 slowest stations</div>'+
          top3Html+
        '</div>'+
      '</div>';
    }).join('');
  }

  // ── Group comparison bar chart ──
  const thrLine = {id:'groupThr',afterDraw(chart){
    const{ctx,chartArea:a,scales}=chart;if(!a||!scales.x)return;
    const x15=scales.x.getPixelForValue(15);
    if(x15<a.left||x15>a.right)return;
    ctx.save();ctx.strokeStyle='#e2706a';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);
    ctx.beginPath();ctx.moveTo(x15,a.top);ctx.lineTo(x15,a.bottom);ctx.stroke();
    ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='11px sans-serif';ctx.textAlign='center';
    ctx.fillText('15 min',x15,a.top-4);ctx.restore();
  }};

  const existing = Chart.getChart('cGroupBar');
  if (existing) existing.destroy();

  const groupCanvas = document.getElementById('cGroupBar');
  if (groupCanvas) {
    new Chart(groupCanvas, {
      type: 'bar',
      data: {
        labels: venueData.map(v => v.label),
        datasets: [{
          label: 'Avg fulfillment (min)',
          data: venueData.map(v => v.avgFulMin != null ? +v.avgFulMin.toFixed(2) : null),
          backgroundColor: venueData.map(v => {
            if (v.avgFulMin == null) return '#6b7280';
            return avgFulColorByMin(v.avgFulMin) + 'cc';
          }),
          borderColor: venueData.map(v => {
            if (v.avgFulMin == null) return '#6b7280';
            return avgFulColorByMin(v.avgFulMin);
          }),
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          label(ctx) {
            const v = venueData[ctx.dataIndex];
            return [ctx.parsed.x.toFixed(1)+' min avg', v.totalTickets.toLocaleString()+' tickets'];
          }
        }}},
        scales: {
          x: { title:{display:true,text:'Avg fulfillment (min)'}, grid:{color:gc}, min:0 },
          y: { grid:{display:false} }
        }
      },
      plugins: [thrLine]
    });
  }
}

// ============================================================
// PAGE SUMMARY (Overview KPI paragraph)
// ============================================================
function renderPageSummary() {
  const el = document.getElementById('pageSummary');
  if (!el) return;
  const d = getD();
  // Worst station
  const foodWithTarget = (d.stations || []).filter(s => isFoodStation(s.station) && s.exp_sec > 0);
  const worst = [...foodWithTarget].sort((a, b) => (b.avg_sec / b.exp_sec) - (a.avg_sec / a.exp_sec))[0];
  // Busiest hour from heatmap
  const HM_G = d.hmGuests || {};
  const HM_F = d.hmFul || {};
  let peakVal = 0, peakDay = '', peakHr = '';
  let peakFulVal = 0;
  Object.entries(HM_G).forEach(([day, hrs]) => {
    Object.entries(hrs).forEach(([hr, v]) => {
      if (v > peakVal) { peakVal = v; peakDay = day; peakHr = hr; }
    });
  });
  if (peakDay && peakHr && HM_F[peakDay]) peakFulVal = HM_F[peakDay][peakHr] || 0;
  // Concurrent tickets estimate from curve
  const CURVE = d.curve || [];
  let peakConc = null;
  if (CURVE.length && peakFulVal > 0) {
    let best = CURVE[0], bestDiff = Math.abs(CURVE[0].ful - peakFulVal);
    CURVE.forEach(c => { const diff = Math.abs(c.ful - peakFulVal); if (diff < bestDiff) { bestDiff = diff; best = c; } });
    peakConc = best ? best.conc : null;
  }
  // Top 2 slowest menu items
  const menuItems = (d.menuItems || d.summary || []);
  const top2 = [...menuItems].sort((a,b) => b.avg_sec - a.avg_sec).slice(0,2);

  let html = '';
  if (worst && worst.avg_sec > worst.exp_sec) {
    const avgMin = (worst.avg_sec / 60).toFixed(1);
    const tgtMin = (worst.exp_sec / 60).toFixed(1);
    const pct = Math.round((worst.avg_sec / worst.exp_sec - 1) * 100);
    html += '<span style="color:#ef4444;font-weight:700;font-size:15px">⚠️ ' + worst.station + ' is breaking — avg ' + avgMin + 'min vs ' + tgtMin + 'min target (' + pct + '% over).</span>';
  } else if (worst) {
    html += '<span style="color:#22c55e;font-weight:700;font-size:15px">✅ All stations on target this week.</span>';
  }
  if (peakDay && peakHr) {
    const concTxt = peakConc ? peakConc + ' concurrent tickets' : '';
    html += ' <span style="color:#9aa0aa;font-size:14px">Kitchen peaks on ' + peakDay + ' ' + peakHr + ' with ' + Math.round(peakVal) + ' guests' + (concTxt ? ' and ' + concTxt : '') + '.</span>';
  }
  if (top2.length >= 2) {
    html += ' <span style="color:#9aa0aa;font-size:14px">Top offending items: <strong style="color:#f59e0b">' + top2[0].item + '</strong> (' + (top2[0].avg_sec/60).toFixed(1) + 'min), <strong style="color:#f59e0b">' + top2[1].item + '</strong> (' + (top2[1].avg_sec/60).toFixed(1) + 'min).</span>';
  } else if (top2.length === 1) {
    html += ' <span style="color:#9aa0aa;font-size:14px">Top offending item: <strong style="color:#f59e0b">' + top2[0].item + '</strong> (' + (top2[0].avg_sec/60).toFixed(1) + 'min).</span>';
  }
  el.innerHTML = html;
}

// ============================================================
// KPI CARDS (top row of overview tab)
// ============================================================
function renderKPIs() {
  const d = getD();
  const foodStations = (d.stations || []).filter(s => isFoodStation(s.station));
  const totalTickets = foodStations.reduce((a, s) => a + s.count, 0);
  const curve = d.curve || [];
  const peakConc = curve.length > 0 ? Math.max(...curve.map(x => x.conc)) : null;
  const { tickets: bpT, guests: bpG } = computeBreakingPoint();

  const el = id => document.getElementById(id);
  const set = (id, val) => { const e = el(id); if (e) e.textContent = val; };

  set('kFoodTickets', totalTickets > 0 ? totalTickets.toLocaleString() : '—');
  set('kPeakConc', peakConc ?? '—');
  set('kBP1', bpT ?? '—');
  set('kBP2', bpG ?? '—');

  // Peak avg concurrent: find the max avg concurrent from the curve (weighted peak)
  const peakOcc = curve.length > 0 ? curve.reduce((best, d) => d.occ > best.occ ? d : best, curve[0]) : null;
  if (peakOcc) {
    set('kPeakAvg', peakOcc.conc);
    const lbl = el('kPeakAvgLabel');
    if (lbl) lbl.textContent = 'Most common concurrent load';
  }
}


// ============================================================
// RENDER ALL
// ============================================================
function renderAll() {
  renderKPIs();
  renderPressure();
  renderBreaking();
  renderLoadPerf();
  render3D();
  renderHeatmaps();
  renderStationBreaking();
  renderStationWoW();
  renderStations();
  renderMenuItems();
  renderAssignment();
  renderGroup();
  renderPageSummary();
}

// ============================================================
// WELCOME POPUP (Fix 2)
// ============================================================
function showWeekWelcomePopup(weekKey) {
  const VENUE_LABELS_WP = ${JSON.stringify(VENUE_LABELS)};
  // Gather per-venue summary for this week
  const venueRows = Object.entries(VENUE_LABELS_WP).map(([key, label]) => {
    const d = ALL_DATA[key]?.[weekKey] || ALL_DATA[key]?.['latest'];
    if (!d) return null;
    const stations = (d.stations || []).filter(s => {
      const n = s.station.toLowerCase();
      return !['bar','champagne','wine','btg','pos','barista','somm','water','service','beach','btl inside','btl outside'].some(p => n.includes(p));
    });
    if (!stations.length) return null;
    let totalCount = 0, totalSec = 0;
    stations.forEach(s => { totalCount += s.count; totalSec += s.avg_sec * s.count; });
    const avgFulMin = totalCount > 0 ? (totalSec / totalCount / 60).toFixed(1) : null;

    // Breaking point
    const curve = d.curve || [];
    let bp = null;
    for (let i = 0; i < curve.length; i++) {
      if (i < 10) continue;
      if (curve[i].occ < 5) continue;
      if (curve[i].occ >= 3 && curve[i].ful >= 15) { bp = curve[i]; break; }
    }
    const peakConc = curve.length ? Math.max(...curve.map(c => c.conc)) : null;
    return { label, bp, peakConc, avgFulMin };
  }).filter(Boolean);

  const overlay = document.createElement('div');
  overlay.id = 'weekWelcomeOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#181b22;border:1px solid #2d3448;border-radius:14px;padding:28px 32px;max-width:580px;width:100%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.6)';

  const weekLabel = weekKey.replace(/^(\d{4})-W(\d+)$/, 'W$2');
  let html = '<div style="font-size:20px;font-weight:700;color:#e8eaed;margin-bottom:6px">Good Morning — Week ' + weekLabel + ' Kitchen Health</div>';
  html += '<div style="font-size:12px;color:#9aa0aa;margin-bottom:20px;border-bottom:1px solid #262a33;padding-bottom:14px">Snapshot of this week BOH performance across all venues.</div>';

  venueRows.forEach(v => {
    html += '<div style="margin-bottom:16px;padding:14px 16px;background:#13161c;border-radius:10px;border:1px solid #1e2533">';
    html += '<div style="font-size:14px;font-weight:700;color:#d9a441;margin-bottom:8px">' + v.label + '</div>';
    if (v.bp) {
      html += '<div style="font-size:12px;color:#ef4444;margin-bottom:4px">⚡ Breaking Point at <strong style="color:#f87171">' + v.bp.conc + ' tickets</strong> (' + Math.round(v.bp.guests) + ' guests)</div>';
    } else {
      html += '<div style="font-size:12px;color:#22c55e;margin-bottom:4px">✅ No breaking point this week</div>';
    }
    if (v.peakConc != null) html += '<div style="font-size:12px;color:#9aa0aa;margin-bottom:2px">Peak concurrent: <strong style="color:#e8eaed">' + v.peakConc + ' tickets</strong></div>';
    if (v.avgFulMin != null) html += '<div style="font-size:12px;color:#9aa0aa">Avg fulfillment: <strong style="color:#e8eaed">' + v.avgFulMin + ' min</strong></div>';
    html += '</div>';
  });

  html += '<div style="margin-top:18px;text-align:center">';
  html += '<button id="weekWelcomeGotIt" style="background:#d9a441;color:#0c0e13;border:none;border-radius:8px;padding:10px 32px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Got it</button>';
  html += '</div>';

  modal.innerHTML = html;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const gotIt = document.getElementById('weekWelcomeGotIt');
  if (gotIt) gotIt.onclick = () => {
    overlay.remove();
    localStorage.setItem('boh_last_seen_week', weekKey);
  };
}

// ============================================================
// VENUE PILLS INIT
// ============================================================
const VENUE_LABELS = ${JSON.stringify(VENUE_LABELS)};
function initVenuePills() {
  const container = document.getElementById('venuePills');
  Object.entries(VENUE_LABELS).forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.className = 'venue-pill' + (key === currentVenue ? ' active' : '');
    btn.textContent = label;
    btn.dataset.venue = key;
    btn.onclick = () => {
      currentVenue = key;
      document.querySelectorAll('.venue-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('dashTitle').textContent = label + ' · BOH Dashboard';
      renderAll();
    };
    container.appendChild(btn);
  });
}

// ============================================================
// WEEK SELECTOR
// ============================================================
function selectWeek(idx) {
  currentWeekIdx = parseInt(idx);
  renderAll();
}
function changeWeek(dir) {
  const next = currentWeekIdx + dir;
  if (next < 0 || next >= WEEKS.length) return;
  currentWeekIdx = next;
  const dd = document.getElementById('weekDropdown');
  if (dd) dd.value = currentWeekIdx;
  const wpBtn2 = document.getElementById('weekPrev');
  const wnBtn2 = document.getElementById('weekNext');
  if (wpBtn2) wpBtn2.disabled = currentWeekIdx === 0;
  if (wnBtn2) wnBtn2.disabled = currentWeekIdx === WEEKS.length - 1;
  renderAll();
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initVenuePills();
  // Fix 1: Ensure latest week is selected by default
  currentWeekIdx = WEEKS.length - 1;
  const dd = document.getElementById('weekDropdown');
  if (dd) dd.value = currentWeekIdx;
  const wpBtn = document.getElementById('weekPrev');
  const wnBtn = document.getElementById('weekNext');
  if (wpBtn) wpBtn.disabled = currentWeekIdx === 0;
  if (wnBtn) wnBtn.disabled = currentWeekIdx >= WEEKS.length - 1;

  // Fix 2: First-open-of-week welcome popup
  const currentWeekKey = WEEKS[currentWeekIdx]?.key || '';
  const lastSeen = localStorage.getItem('boh_last_seen_week');
  if (lastSeen !== currentWeekKey && currentWeekKey) {
    showWeekWelcomePopup(currentWeekKey);
  }

  renderAll();
});
</script>
</body>
</html>`;

// ── Assemble final HTML ───────────────────────────────────────────────────────
let finalHtml = html + newScript;

// Patch the static KPI breaking point boxes with ids
finalHtml = finalHtml
  .replace(
    '<div class="bpbox"><div class="big">26</div><div class="l">tickets → kitchen falls behind</div></div>',
    '<div class="bpbox"><div class="big" id="kpiBP1">26</div><div class="l">tickets → kitchen falls behind</div></div>'
  )
  .replace(
    '<div class="bpbox"><div class="big">141</div><div class="l">guests → kitchen falls behind</div></div>',
    '<div class="bpbox"><div class="big" id="kpiBP2">141</div><div class="l">guests → kitchen falls behind</div></div>'
  )
  .replace(
    '<div class="annotation-box">⚡ Breaking point at <strong>26 concurrent tickets</strong> — avg fulfillment jumps to 16.0 min.</div>',
    '<div class="annotation-box" id="bpAnnotation">⚡ Breaking point at <strong>26 concurrent tickets</strong> — avg fulfillment jumps to 16.0 min.</div><div id="bpMethodNote" style="font-size:11px;color:#9aa0aa;margin-top:4px">BP detected via P75 fulfillment</div>'
  );

// ── Write output ──────────────────────────────────────────────────────────────
const outPath = path.join(DIR, 'dashboard.html');
fs.writeFileSync(outPath, finalHtml, 'utf8');
console.log('✅ Written:', outPath, '(' + Math.round(fs.statSync(outPath).size / 1024) + ' KB)');
