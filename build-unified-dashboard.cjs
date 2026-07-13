'use strict';
const fs = require('fs');
const path = require('path');

const DIR = __dirname;

function readJson(filename) {
  const p = path.join(DIR, filename);
  if (!fs.existsSync(p)) {
    console.warn('WARNING: missing', filename);
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('ERROR parsing', filename, ':', e.message);
    return {};
  }
}

const claudieData   = readJson('dashboard-data.json');
const caneosData    = readJson('casaneos-data.json');
const avaCgData     = readJson('ava_coconut_grove-data.json');
const avaWpData     = readJson('ava_winter_park-data.json');
const milaData      = readJson('mila-data.json');

// Structure: ALL_WEEKS_DATA["2026-W27"][venue] = { ... }
const weekData = {
  claudie:   claudieData,
  casaneos:  caneosData,
  ava_cg:    avaCgData,
  ava_wp:    avaWpData,
  mila:      milaData,
};

const allWeeksDataJs = `const ALL_WEEKS_DATA = {
  "2026-W27": ${JSON.stringify(weekData)}
};`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RDG · BOH Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"><\/script>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#e8eaed;font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
.wrap{max-width:1300px;margin:0 auto;padding:0 20px 64px}
header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:20px 0 12px;border-bottom:1px solid #1e2533;margin-bottom:0}
h1{font-size:22px;margin:0;flex:1 1 auto}
.week-nav{display:flex;align-items:center;gap:6px;flex:0 0 auto}
.week-nav button{padding:4px 10px;border:1px solid #2d3448;background:#1e2533;color:#9aa0aa;border-radius:6px;cursor:pointer;font-size:13px;font-family:inherit;transition:all .15s;line-height:1.2}
.week-nav button:hover:not(:disabled){border-color:#d9a441;color:#e8eaed}
.week-nav button:disabled{opacity:0.35;cursor:default}
.week-nav select{padding:4px 8px;border:1px solid #2d3448;background:#1e2533;color:#e8eaed;border-radius:6px;font-size:13px;font-family:inherit;cursor:pointer;outline:none}
.week-label{color:#d9a441;font-size:13px;font-weight:600;white-space:nowrap}
.venue-pills{display:flex;gap:6px;flex-wrap:wrap;flex:0 0 auto}
.venue-pill{padding:6px 18px;border:1px solid #2d3448;background:#1e2533;color:#9aa0aa;border-radius:20px;cursor:pointer;font-size:13px;font-family:inherit;font-weight:600;transition:all .15s}
.venue-pill:hover{border-color:#d9a441;color:#e8eaed}
.venue-pill.active{background:#2a2210;color:#d9a441;border-color:#d9a441}
.tab-nav{display:flex;gap:2px;border-bottom:2px solid #1e2533;margin:16px 0 22px;padding-bottom:0}
.tab-btn{padding:9px 22px;border:none;border-bottom:3px solid transparent;background:none;color:#9aa0aa;font:600 14px/1 inherit;cursor:pointer;border-radius:6px 6px 0 0;transition:all .15s;margin-bottom:-2px}
.tab-btn:hover{background:#1a1f28;color:#e8eaed}
.tab-btn.active{background:#181b22;color:#e8eaed;border-bottom:3px solid #d9a441}
.tab-section{display:none}
.tab-section.active{display:block}
.card{background:#181b22;border:1px solid #262a33;border-radius:12px;padding:18px;margin-bottom:18px}
.card h2{font-size:16px;margin:0 0 3px;color:#e8eaed}
.card p.note{color:#9aa0aa;font-size:12px;margin:0 0 14px}
.row{display:grid;gap:18px}
.row.two{grid-template-columns:1fr 1fr}
.row.three{grid-template-columns:1fr 1fr 1fr}
@media(max-width:820px){.row.two,.row.three{grid-template-columns:1fr}}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.kpi{background:#181b22;border:1px solid #262a33;border-radius:12px;padding:13px 15px}
.kpi .v{font-size:24px;font-weight:700;color:#d9a441}
.kpi .l{color:#9aa0aa;font-size:12px;margin-top:2px}
.kpi.alert .v{color:#e2706a}
.bpbox{background:#13161c;border:1px solid #2d323c;border-radius:10px;padding:12px 14px;margin-bottom:12px}
.bpbox .big{font-size:28px;font-weight:700;color:#e2706a}
.bpbox .l{color:#9aa0aa;font-size:12px}
.legend{display:flex;gap:14px;font-size:12px;color:#9aa0aa;margin-top:10px;flex-wrap:wrap}
.sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:5px}
canvas{display:block;width:100%!important;height:400px!important}
canvas.sm{height:260px!important}
footer{color:#9aa0aa;font-size:12px;margin-top:30px;text-align:center}
.annotation-box{background:#1a2436;border:1px solid #2d4a6a;border-radius:8px;padding:8px 12px;font-size:12px;color:#7ec8e3;margin-top:8px;display:inline-block}
.trend-badge{display:inline-block;background:#1f2330;border:1px solid #2d3448;color:#8a9ab5;border-radius:6px;padding:3px 10px;font-size:11px;margin-top:10px}
.hm-wrap{overflow-x:auto}
.hm-table{border-collapse:collapse;font-size:11.5px;width:100%}
.hm-table th{padding:5px 6px;background:#1e2533;color:#9aa0aa;text-align:center;white-space:nowrap;font-weight:600;min-width:52px}
.hm-table th.row-head{text-align:left;padding-left:8px;min-width:60px;position:sticky;left:0;z-index:2}
.hm-table td{padding:5px 4px;text-align:center;font-size:11px;font-weight:600;min-width:52px;border:1px solid #0d1117}
.hm-table td.row-head{text-align:left;padding:5px 8px;background:#181b22;color:#9aa0aa;white-space:nowrap;position:sticky;left:0;border-right:2px solid #262a33;font-weight:500;font-size:12px}
.hm-toggle{display:flex;gap:8px;margin-bottom:12px}
.hm-toggle button{padding:5px 16px;border:1px solid #2d3448;background:#1e2533;color:#9aa0aa;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit}
.hm-toggle button.active{background:#262a33;color:#e8eaed;border-color:#d9a441}
.section-title{font-size:17px;font-weight:700;color:#d9a441;margin:28px 0 12px;padding-bottom:6px;border-bottom:1px solid #262a33}
table.menu-tbl{width:100%;border-collapse:collapse;font-size:13px}
table.menu-tbl th{background:#1e2533;color:#9aa0aa;padding:7px 10px;text-align:left;font-weight:600;cursor:pointer;user-select:none}
table.menu-tbl th:hover{color:#e8eaed}
table.menu-tbl td{padding:6px 10px;border-bottom:1px solid #1e2533}
table.menu-tbl tr:hover td{background:#1e2533}
.over{color:#e2706a;font-weight:600}
.ok{color:#74d39a}
.coming-note{background:#131720;border:1px solid #2d3448;border-radius:8px;padding:10px 14px;font-size:12px;color:#8a9ab5;margin-top:18px;text-align:center}
.station-pills{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}
.station-pill{padding:6px 16px;border:1px solid #2d3448;background:#1e2533;color:#9aa0aa;border-radius:20px;cursor:pointer;font-size:13px;font-family:inherit;transition:all .15s}
.station-pill:hover{border-color:#d9a441;color:#e8eaed}
.station-pill.active{background:#262a33;color:#e8eaed;border-color:#d9a441;font-weight:600}
.station-pill.green{border-left:3px solid #22c55e}
.station-pill.amber{border-left:3px solid #f59e0b}
.station-pill.red{border-left:3px solid #ef4444}
.station-detail{background:#181b22;border:1px solid #262a33;border-radius:12px;padding:20px}
.station-header{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #262a33}
.station-header h2{font-size:18px;margin:0}
.status-badge{padding:3px 12px;border-radius:12px;font-size:12px;font-weight:700}
.status-green{background:#1a3a1a;color:#22c55e;border:1px solid #22c55e}
.status-red{background:#3a1a1a;color:#ef4444;border:1px solid #ef4444}
.status-amber{background:#3a2a00;color:#f59e0b;border:1px solid #f59e0b}
.items-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
.items-table th{background:#1e2533;color:#9aa0aa;padding:6px 8px;text-align:left;font-weight:600}
.items-table td{padding:5px 8px;border-bottom:1px solid #1a1d24}
.items-table tr:hover td{background:#1e2533}
.bar-cell{display:flex;align-items:center;gap:6px}
.bar-bg{flex:1;height:8px;background:#1e2533;border-radius:4px;overflow:hidden;min-width:60px}
.bar-fill{height:100%;border-radius:4px}
.search-bar{width:100%;padding:8px 14px;background:#1e2533;border:1px solid #2d3448;border-radius:8px;color:#e8eaed;font:14px/1 inherit;margin-bottom:14px;outline:none}
.search-bar:focus{border-color:#d9a441}
.sort-btns{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.sort-btn{padding:5px 14px;border:1px solid #2d3448;background:#1e2533;color:#9aa0aa;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit}
.sort-btn.active{background:#262a33;color:#e8eaed;border-color:#d9a441}
.menu-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px}
.menu-stat{background:#13161c;border:1px solid #1e2533;border-radius:8px;padding:10px 12px;text-align:center}
.menu-stat .v{font-size:20px;font-weight:700}
.menu-stat .l{color:#9aa0aa;font-size:11px;margin-top:2px}
#errBox{display:none;background:#3a1a1a;border:1px solid #ef4444;border-radius:8px;padding:12px;margin:12px 0;color:#ef4444;font-size:13px;white-space:pre-wrap}
</style>
</head>
<body>
<div class="wrap">
<div id="errBox"></div>
<header>
  <h1>RDG · BOH Dashboard</h1>
  <div class="week-nav">
    <button id="weekPrev" onclick="shiftWeek(-1)" disabled title="Previous week">◀</button>
    <span class="week-label" id="weekLabel">Week of Jun 29 – Jul 5, 2026</span>
    <button id="weekNext" onclick="shiftWeek(1)" disabled title="Next week">▶</button>
  </div>
  <div class="venue-pills">
    <button class="venue-pill active" id="pill-claudie"  onclick="switchVenue('claudie',this)">Claudie</button>
    <button class="venue-pill"        id="pill-casaneos" onclick="switchVenue('casaneos',this)">Casa Neos</button>
    <button class="venue-pill"        id="pill-ava_cg"   onclick="switchVenue('ava_cg',this)">AVA Coconut Grove</button>
    <button class="venue-pill"        id="pill-ava_wp"   onclick="switchVenue('ava_wp',this)">AVA Winter Park</button>
    <button class="venue-pill"        id="pill-mila"     onclick="switchVenue('mila',this)">MILA</button>
  </div>
</header>

<nav class="tab-nav">
  <button class="tab-btn active" onclick="switchTab('overview',this)">Overview</button>
  <button class="tab-btn" onclick="switchTab('stations',this)">Stations</button>
  <button class="tab-btn" onclick="switchTab('menu',this)">Menu Items</button>
</nav>

<!-- TAB 1: OVERVIEW -->
<section id="tab-overview" class="tab-section active">
<div class="kpis" id="kpiBar"></div>

<div class="card">
  <h2>Visual 1 — Kitchen Pressure Curve</h2>
  <p class="note">X-axis = concurrent tickets open. Left Y = occurrences. Right Y = avg fulfillment time (min). Red dashed = 15-min target.</p>
  <canvas id="cPressure"></canvas>
  <div class="legend">
    <span><span class="sw" style="background:#5aa9e6"></span>Occurrences</span>
    <span><span class="sw" style="background:#d9a441"></span>Avg fulfillment (min)</span>
    <span><span class="sw" style="background:#e2706a"></span>15-min target</span>
  </div>
  <div id="bpAnnotation" class="annotation-box"></div>
  <div><span class="trend-badge">📊 Trend vs prior 3 weeks: available from Jul 14</span></div>
</div>

<div class="row two">
  <div class="card">
    <h2>Visual 2 — Breaking Point</h2>
    <p class="note">Avg fulfillment time and guests vs concurrent ticket load.</p>
    <div class="row two" style="margin-bottom:12px;gap:8px">
      <div class="bpbox"><div class="big" id="bpTickets">—</div><div class="l">tickets → kitchen falls behind</div></div>
      <div class="bpbox"><div class="big" id="bpGuests">—</div><div class="l">guests → kitchen falls behind</div></div>
    </div>
    <canvas id="cBreaking" class="sm"></canvas>
    <div><span class="trend-badge">📊 Trend vs prior 3 weeks: available from Jul 14</span></div>
  </div>
  <div class="card">
    <h2>Visual 3 — Load vs Performance</h2>
    <p class="note">Bucketed view (10-ticket steps): avg fulfillment time per band.</p>
    <canvas id="cLoadPerf" class="sm"></canvas>
    <div class="legend">
      <span><span class="sw" style="background:#d9a441"></span>Avg fulfillment (min)</span>
      <span><span class="sw" style="background:#e2706a"></span>15-min target</span>
    </div>
    <div><span class="trend-badge">📊 Trend vs prior 3 weeks: available from Jul 14</span></div>
  </div>
</div>

<div class="card">
  <div style="display:flex;align-items:baseline;gap:16px;flex-wrap:wrap">
    <h2 style="margin:0">Visual 4 — 3D Station View (Food stations only)</h2>
    <span style="margin-left:auto">
      <span style="font-size:28px;font-weight:700;color:#d9a441" id="kTotal">—</span>
      <span style="color:#9aa0aa;font-size:12px;display:block;margin-top:-4px">stations over target</span>
    </span>
  </div>
  <p class="note">Each block = a food station. Height ∝ avg fulfillment time. <strong style="color:#2e8b57">Green</strong> ≤ target, <strong style="color:#c99a2e">amber</strong> up to +15%, <strong style="color:#c0392b">red</strong> &gt;+15%. Drag to rotate, scroll to zoom, click for detail.</p>
  <div id="kitchen" style="height:500px;border-radius:10px;overflow:hidden;background:#0c0e13;cursor:grab"></div>
  <div class="legend" style="margin-top:10px">
    <span><span class="sw" style="background:#2e8b57"></span>On target</span>
    <span><span class="sw" style="background:#c99a2e"></span>Up to +15% over</span>
    <span><span class="sw" style="background:#c0392b"></span>&gt;15% over target</span>
    <span><span class="sw" style="background:#6b7280"></span>No target</span>
  </div>
  <div id="kDetail" style="margin-top:14px"></div>
</div>

<div class="card">
  <h2>Visual 5 — Day × Hour Heatmaps</h2>
  <p class="note">Toggle between fulfillment time and guest count.</p>
  <div class="hm-toggle">
    <button class="active" id="hmBtnFul" onclick="showHM('ful',this)">⏱ Avg Fulfillment Time (min)</button>
    <button id="hmBtnGuests" onclick="showHM('guests',this)">👥 Avg Guests Seated (OT)</button>
  </div>
  <div id="hmFul">
    <div style="font-size:12px;color:#9aa0aa;margin-bottom:6px">Color scale: <span style="color:#22c55e">■</span> ≤10 min → <span style="color:#f59e0b">■</span> 10–15 min → <span style="color:#ef4444">■</span> &gt;15 min</div>
    <div class="hm-wrap" id="hmFulWrap"></div>
  </div>
  <div id="hmGuests" style="display:none">
    <div style="font-size:12px;color:#9aa0aa;margin-bottom:6px">Color scale: <span style="color:#b3d9f7">■</span> few → <span style="color:#1565c0">■</span> many guests</div>
    <div class="hm-wrap" id="hmGuestsWrap"></div>
  </div>
</div>
</section>

<!-- TAB 2: STATIONS -->
<section id="tab-stations" class="tab-section">
<div class="section-title">Station Selector</div>
<div class="station-pills" id="stationPills"></div>
<div class="station-detail" id="stationDetail">
  <p style="color:#9aa0aa;font-size:13px">Select a station above to view details.</p>
</div>
<div class="section-title" style="margin-top:28px">All Stations — Performance Chart</div>
<div class="card">
  <h2>Station Performance — Actual vs Target</h2>
  <p class="note">Sorted by avg fulfillment descending. Grey tick = target. Food stations only.</p>
  <canvas id="cStations"></canvas>
  <div class="legend">
    <span><span class="sw" style="background:#22c55e"></span>On target</span>
    <span><span class="sw" style="background:#f59e0b"></span>Up to +15% over</span>
    <span><span class="sw" style="background:#ef4444"></span>&gt;+15% over</span>
    <span><span class="sw" style="background:#5aa9e6"></span>No target</span>
  </div>
</div>
</section>

<!-- TAB 3: MENU ITEMS -->
<section id="tab-menu" class="tab-section">
<div class="section-title">Menu Item Performance</div>
<div class="card">
  <div class="menu-stats" id="menuStats"></div>
  <input class="search-bar" id="menuSearch" placeholder="🔍 Search menu items…" oninput="applyMenuFilters()">
  <div class="sort-btns">
    <span style="color:#9aa0aa;font-size:12px;line-height:28px">Sort by:</span>
    <button class="sort-btn active" id="sortTime"  onclick="setSort('time',this)">Slowest first</button>
    <button class="sort-btn"        id="sortCount" onclick="setSort('count',this)">Most ordered</button>
    <button class="sort-btn"        id="sortName"  onclick="setSort('name',this)">Name A–Z</button>
    <button class="sort-btn"        id="sortFast"  onclick="setSort('fast',this)">Fastest first</button>
  </div>
  <div style="overflow-x:auto">
    <table class="menu-tbl" id="menuTable">
      <thead><tr>
        <th style="width:36px">#</th>
        <th>Menu Item</th>
        <th style="width:70px">Count</th>
        <th style="width:110px">Avg Time</th>
        <th style="width:180px">vs 15 min threshold</th>
        <th style="width:70px">Status</th>
      </tr></thead>
      <tbody id="menuBody"></tbody>
    </table>
  </div>
</div>
</section>

<footer id="footerEl">Source: RDG BOH Dashboard · Week of Jun 29 – Jul 5, 2026 · Fulfillment = Fired → Fulfilled</footer>
</div>

<script>
// ============================================================
// EMBEDDED DATA
// ============================================================
${allWeeksDataJs}

// ============================================================
// WEEK METADATA
// ============================================================
const WEEK_META = {
  "2026-W27": { label: "Week of Jun 29 – Jul 5, 2026", short: "Jun 29 – Jul 5" }
};
const WEEK_KEYS = Object.keys(WEEK_META).sort();

// ============================================================
// STATE
// ============================================================
let currentVenue = 'claudie';
let currentWeek  = WEEK_KEYS[0];
let currentHmMode = 'ful';
let menuSort = 'time';
let menuSearch = '';
let _charts = {};
let _threeRenderer = null, _threeScene = null, _threeCamera = null, _threeAnimId = null;
let _threeTheta = 0, _threePhi = Math.PI / 4, _threeRadius = 12;

const VENUE_LABELS  = { claudie:'Claudie', casaneos:'Casa Neos', ava_cg:'AVA Coconut Grove', ava_wp:'AVA Winter Park', mila:'MILA' };
const VENUE_SOURCES = { claudie:'dashboard-data.json', casaneos:'casaneos-data.json', ava_cg:'ava_coconut_grove-data.json', ava_wp:'ava_winter_park-data.json', mila:'mila-data.json' };

// ============================================================
// UTILS
// ============================================================
const gc = '#262a33';

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
  const r1=(ha>>16)&255, g1=(ha>>8)&255, b1=ha&255;
  const r2=(hb>>16)&255, g2=(hb>>8)&255, b2=hb&255;
  const r=Math.round(r1+(r2-r1)*t), g=Math.round(g1+(g2-g1)*t), bl=Math.round(b1+(b2-b1)*t);
  return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+bl.toString(16).padStart(2,'0');
}
function textFor(bg) {
  if (bg === '#1a1d24') return '#3a3d44';
  const h = parseInt(bg.replace('#',''), 16);
  const r=(h>>16)&255, g=(h>>8)&255, b=h&255;
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
  const maxGuests = (currentVenue === 'casaneos') ? 400 : 180;
  return lerpColor('#b3d9f7','#1565c0', Math.min(1, g/maxGuests));
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
function destroyChart(id) {
  if (_charts[id]) { try { _charts[id].destroy(); } catch(e) {} delete _charts[id]; }
}

// ============================================================
// WEEK NAVIGATION
// ============================================================
function updateWeekNav() {
  const idx = WEEK_KEYS.indexOf(currentWeek);
  document.getElementById('weekPrev').disabled = idx <= 0;
  document.getElementById('weekNext').disabled = idx >= WEEK_KEYS.length - 1;
  document.getElementById('weekLabel').textContent = (WEEK_META[currentWeek] || {}).label || currentWeek;
}

function shiftWeek(delta) {
  const idx = WEEK_KEYS.indexOf(currentWeek);
  const newIdx = idx + delta;
  if (newIdx < 0 || newIdx >= WEEK_KEYS.length) return;
  currentWeek = WEEK_KEYS[newIdx];
  updateWeekNav();
  renderAll();
}

// ============================================================
// VENUE SWITCH
// ============================================================
function switchVenue(v, btn) {
  console.log('switching to', v);
  currentVenue = v;
  document.querySelectorAll('.venue-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else { const el = document.getElementById('pill-' + v); if (el) el.classList.add('active'); }
  renderAll();
}

function switchTab(name, btn) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'overview' && _threeRenderer) {
    const host = document.getElementById('kitchen');
    const W = host.clientWidth || 900;
    _threeRenderer.setSize(W, 500);
    _threeCamera.aspect = W / 500;
    _threeCamera.updateProjectionMatrix();
  }
}

function showHM(mode, btn) {
  currentHmMode = mode;
  document.querySelectorAll('.hm-toggle button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('hmFul').style.display    = mode === 'ful'    ? '' : 'none';
  document.getElementById('hmGuests').style.display = mode === 'guests' ? '' : 'none';
}

// ============================================================
// RENDER ALL
// ============================================================
function renderAll() {
  let d;
  try {
    d = ALL_WEEKS_DATA[currentWeek][currentVenue];
    if (!d) throw new Error('No data for venue: ' + currentVenue + ' in week: ' + currentWeek);
  } catch(e) {
    showError('Data error: ' + e.message);
    return;
  }
  hideError();

  const label = VENUE_LABELS[currentVenue] || currentVenue;
  const weekLabel = (WEEK_META[currentWeek] || {}).label || currentWeek;
  document.getElementById('footerEl').textContent =
    'Source: ' + (VENUE_SOURCES[currentVenue] || '') + ' · ' + label + ' · ' + weekLabel + ' · Fulfillment = Fired → Fulfilled · Food stations only';

  renderKPIs(d);
  renderPressureChart(d);
  renderBreakingChart(d);
  renderLoadPerfChart(d);
  renderThreeD(d);
  renderHeatmaps(d);
  renderStationPills(d);
  renderMenuTab(d);
}

function showError(msg) {
  const el = document.getElementById('errBox');
  el.textContent = msg;
  el.style.display = 'block';
}
function hideError() {
  document.getElementById('errBox').style.display = 'none';
}

// ============================================================
// KPIs
// ============================================================
function renderKPIs(d) {
  const totalTickets = (d.stations || []).reduce((s, r) => s + (r.count || 0), 0);
  const curve = d.curve || [];
  const peakConc = curve.length ? Math.max(...curve.map(r => r.conc)) : '—';
  const bp  = d.breakingPoint || '—';
  const bpG = d.breakingPointGuests || '—';
  const peakAvgConc = curve.length
    ? +(curve.reduce((mx, r) => r.occ > mx.occ ? r : mx, curve[0]).conc).toFixed(1) : '—';
  document.getElementById('kpiBar').innerHTML =
    kpi(totalTickets.toLocaleString(), 'Food tickets (week)', false) +
    kpi(peakConc, 'Peak concurrent tickets', true) +
    kpi(bp,  'Breaking point (tickets)', true) +
    kpi(bpG, 'Breaking point (guests)', true) +
    kpi(peakAvgConc, 'Peak avg concurrent', false) +
    kpi('15 min', 'Fulfillment target', false);
}
function kpi(v, l, alert) {
  return '<div class="kpi' + (alert?' alert':'') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>';
}

// ============================================================
// CHART 1: PRESSURE CURVE
// ============================================================
function renderPressureChart(d) {
  destroyChart('cPressure');
  const curve = d.curve || [];
  if (!curve.length) {
    document.getElementById('bpAnnotation').textContent = 'No curve data available.';
    return;
  }
  const bp = d.breakingPoint;
  const bpRow = bp ? curve.find(r => r.conc === bp) : null;
  document.getElementById('bpAnnotation').innerHTML = bp
    ? '⚡ Breaking point at <strong>' + bp + ' concurrent tickets</strong> — avg fulfillment jumps to ' + (bpRow ? bpRow.ful.toFixed(1) : '?') + ' min.'
    : 'No breaking point detected in this data.';
  document.getElementById('bpTickets').textContent = bp || '—';
  document.getElementById('bpGuests').textContent  = d.breakingPointGuests || '—';

  _charts['cPressure'] = new Chart(document.getElementById('cPressure'), {
    type: 'bar',
    data: {
      labels: curve.map(r => r.conc),
      datasets: [
        { type:'bar',  label:'Occurrences',         data: curve.map(r => r.occ), backgroundColor: curve.map(r => bp && r.conc >= bp ? 'rgba(226,112,106,0.45)' : 'rgba(90,169,230,0.6)'), yAxisID:'yOcc', order:2 },
        { type:'line', label:'Avg fulfillment (min)',data: curve.map(r => r.ful), borderColor:'#d9a441', backgroundColor:'transparent', pointRadius:2, tension:0.3, yAxisID:'yFul', order:1 },
        { type:'line', label:'15-min target',        data: curve.map(() => 15),  borderColor:'#e2706a', borderDash:[6,4], pointRadius:0, yAxisID:'yFul', order:0 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      scales: {
        x:    { grid:{display:false}, title:{display:true, text:'Concurrent tickets open'} },
        yOcc: { position:'left',  grid:{color:gc}, title:{display:true, text:'Occurrences'}, min:0 },
        yFul: { position:'right', grid:{display:false}, title:{display:true, text:'Avg fulfillment (min)'}, min:0, suggestedMax:25 },
      },
      plugins: { legend:{display:false} }
    }
  });
}

// ============================================================
// CHART 2: BREAKING POINT
// ============================================================
function renderBreakingChart(d) {
  destroyChart('cBreaking');
  const curve = d.curve || [];
  if (!curve.length) return;
  const bp = d.breakingPoint;
  _charts['cBreaking'] = new Chart(document.getElementById('cBreaking'), {
    type: 'line',
    data: {
      labels: curve.map(r => r.conc),
      datasets: [
        { label:'Avg guests seated',    data:curve.map(r => r.guests), borderColor:'#5aa9e6', backgroundColor:'transparent', pointRadius:0, tension:0.3, yAxisID:'yG' },
        { label:'Avg fulfillment (min)',data:curve.map(r => r.ful),    borderColor:'#d9a441', backgroundColor:'transparent', pointRadius:0, tension:0.3, yAxisID:'yF' },
        { label:'15-min target',         data:curve.map(() => 15),      borderColor:'#e2706a', borderDash:[5,4], pointRadius:0, yAxisID:'yF' },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      scales: {
        x:  { grid:{display:false}, title:{display:true, text:'Concurrent tickets'} },
        yG: { position:'left',  grid:{color:gc}, title:{display:true, text:'Avg guests seated'}, min:0 },
        yF: { position:'right', grid:{display:false}, title:{display:true, text:'Fulfillment (min)'}, min:0, suggestedMax:25 },
      },
      plugins: { legend:{display:false} }
    }
  });
}

// ============================================================
// CHART 3: LOAD VS PERFORMANCE
// ============================================================
function renderLoadPerfChart(d) {
  destroyChart('cLoadPerf');
  const tbk = d.tbk || [];
  if (!tbk.length) return;
  const colors = tbk.map(r => r.ful >= 15 ? '#ef4444' : r.ful >= 12 ? '#f59e0b' : '#22c55e');
  _charts['cLoadPerf'] = new Chart(document.getElementById('cLoadPerf'), {
    type: 'bar',
    data: {
      labels: tbk.map(r => r.bucket),
      datasets: [{ label:'Avg fulfillment (min)', data:tbk.map(r => r.ful), backgroundColor:colors, borderRadius:4 }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      scales: {
        x: { grid:{display:false}, title:{display:true, text:'Ticket load band'} },
        y: { grid:{color:gc}, title:{display:true, text:'Avg fulfillment (min)'}, min:0, suggestedMax:25 },
      },
      plugins: { legend:{display:false} }
    }
  });
}

// ============================================================
// VISUAL 4: THREE.JS 3D
// ============================================================
function renderThreeD(d) {
  if (_threeAnimId) { cancelAnimationFrame(_threeAnimId); _threeAnimId = null; }
  if (_threeRenderer) { try { _threeRenderer.dispose(); } catch(e) {} _threeRenderer = null; }
  const host = document.getElementById('kitchen');
  host.innerHTML = '';
  const stations = d.stations || [];
  const overTarget = stations.filter(s => s.exp_sec && s.avg_sec > s.exp_sec).length;
  document.getElementById('kTotal').textContent = overTarget;

  if (!stations.length) {
    host.innerHTML = '<div style="color:#9aa0aa;padding:20px;text-align:center;line-height:500px">No station data</div>';
    return;
  }

  const W = host.clientWidth || 900, H = 500;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0e13);
  const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  _threeRenderer = renderer;
  _threeScene = scene;
  _threeCamera = camera;

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  const maxFul = Math.max(...stations.map(s => s.avg_sec), 1);
  const cols = Math.ceil(Math.sqrt(stations.length));
  const spacingX = 2.2, spacingZ = 2.2;
  const startX = -(cols - 1) * spacingX / 2;
  const startZ = -(Math.ceil(stations.length / cols) - 1) * spacingZ / 2;

  stations.forEach((s, i) => {
    const h = Math.max(0.1, (s.avg_sec / maxFul) * 4);
    const ratio = s.exp_sec ? s.avg_sec / s.exp_sec : null;
    let color;
    if (!ratio)        color = 0x6b7280;
    else if (ratio <= 1.0)  color = 0x2e8b57;
    else if (ratio <= 1.15) color = 0xc99a2e;
    else                    color = 0xc0392b;
    const geo = new THREE.BoxGeometry(1.5, h, 1.5);
    const mat = new THREE.MeshLambertMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    const col = i % cols, row = Math.floor(i / cols);
    mesh.position.set(startX + col * spacingX, h / 2, startZ + row * spacingZ);
    mesh.userData = s;
    scene.add(mesh);

    const c2 = document.createElement('canvas');
    c2.width = 256; c2.height = 64;
    const ctx = c2.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillRect(0,0,256,64);
    ctx.fillStyle = '#e8eaed'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
    ctx.fillText((s.station.length > 14 ? s.station.slice(0,13)+'…' : s.station), 128, 30);
    ctx.font = '14px Arial'; ctx.fillStyle = '#d9a441';
    ctx.fillText(fmtSec(s.avg_sec), 128, 52);
    const tex  = new THREE.CanvasTexture(c2);
    const lGeo = new THREE.PlaneGeometry(1.8, 0.45);
    const lMat = new THREE.MeshBasicMaterial({ map:tex, transparent:true, depthWrite:false });
    const lbl  = new THREE.Mesh(lGeo, lMat);
    lbl.position.set(mesh.position.x, h + 0.35, mesh.position.z);
    lbl.rotation.x = -Math.PI / 6;
    scene.add(lbl);
  });

  const camDist = Math.max(8, cols * 2.5);
  _threeRadius = camDist;
  _threeTheta = 0; _threePhi = Math.PI / 4;
  function updateCam() {
    camera.position.set(
      _threeRadius * Math.sin(_threeTheta) * Math.sin(_threePhi),
      _threeRadius * Math.cos(_threePhi),
      _threeRadius * Math.cos(_threeTheta) * Math.sin(_threePhi)
    );
    camera.lookAt(0, 0, 0);
  }
  updateCam();

  let isDragging = false, prevMx = 0, prevMy = 0;
  renderer.domElement.addEventListener('mousedown', e => { isDragging=true; prevMx=e.clientX; prevMy=e.clientY; });
  window.addEventListener('mouseup', () => { isDragging=false; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    _threeTheta -= (e.clientX - prevMx) * 0.01;
    _threePhi   = Math.max(0.1, Math.min(Math.PI/2, _threePhi - (e.clientY - prevMy) * 0.01));
    prevMx = e.clientX; prevMy = e.clientY;
    updateCam();
  });
  renderer.domElement.addEventListener('wheel', e => {
    _threeRadius = Math.max(4, Math.min(30, _threeRadius + e.deltaY * 0.05));
    updateCam();
  });

  const raycaster = new THREE.Raycaster();
  const mouse2 = new THREE.Vector2();
  renderer.domElement.addEventListener('click', e => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse2.x = (e.clientX - rect.left) / rect.width  *  2 - 1;
    mouse2.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse2, camera);
    const hits = raycaster.intersectObjects(scene.children.filter(c => c.userData && c.userData.station));
    if (hits.length) {
      const s = hits[0].object.userData;
      document.getElementById('kDetail').innerHTML =
        '<div style="background:#13161c;border:1px solid #262a33;border-radius:8px;padding:10px 14px;font-size:13px">' +
        '<strong style="color:#d9a441">' + s.station + '</strong> — ' +
        'Avg: <strong>' + fmtSec(s.avg_sec) + '</strong> · ' +
        'Target: <strong>' + (s.exp_sec ? fmtSec(s.exp_sec) : 'N/A') + '</strong> · ' +
        'Count: <strong>' + s.count + '</strong></div>';
    }
  });

  function animate() {
    _threeAnimId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();
}

// ============================================================
// VISUAL 5: HEATMAPS
// ============================================================
function renderHeatmaps(d) {
  const HM_HRS       = ["11-12","12-13","13-14","14-15","15-16","16-17","17-18","18-19","19-20","20-21","21-22","22-23","23-24","0-1","1-2"];
  const HM_DAYS_FULL = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const HM_DAYS_SHORT= ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

  function buildTable(data, colorFn) {
    const allDays = HM_DAYS_FULL.filter(day => data[day]);
    const allHrs  = HM_HRS.filter(hr => allDays.some(day => data[day] && data[day][hr] != null));
    if (!allDays.length || !allHrs.length) return '<p style="color:#9aa0aa;font-size:12px">No data</p>';
    let t = '<table class="hm-table"><thead><tr><th class="row-head">Hour</th>';
    allDays.forEach(day => { t += '<th>' + HM_DAYS_SHORT[HM_DAYS_FULL.indexOf(day)] + '</th>'; });
    t += '</tr></thead><tbody>';
    allHrs.forEach(hr => {
      t += '<tr><td class="row-head">' + hr + '</td>';
      allDays.forEach(day => {
        const val = data[day] ? data[day][hr] : null;
        const bg  = colorFn(val);
        const fg  = textFor(bg);
        const disp = val != null ? (typeof val==='number' && val < 100 ? val.toFixed(1) : Math.round(val)) : '';
        t += '<td style="background:' + bg + ';color:' + fg + '">' + disp + '</td>';
      });
      t += '</tr>';
    });
    t += '</tbody></table>';
    return t;
  }

  document.getElementById('hmFulWrap').innerHTML    = buildTable(d.hmFul    || {}, v => fulColor(v));
  document.getElementById('hmGuestsWrap').innerHTML = buildTable(d.hmGuests || {}, v => guestColor(v));
}

// ============================================================
// TAB 2: STATIONS
// ============================================================
function renderStationPills(d) {
  const stations = d.stations || [];
  document.getElementById('stationPills').innerHTML = stations.map((s, i) => {
    const ratio = s.exp_sec ? s.avg_sec / s.exp_sec : null;
    const cls   = ratio == null ? '' : ratio > 1.15 ? 'red' : ratio > 1.0 ? 'amber' : 'green';
    return '<button class="station-pill ' + cls + (i===0?' active':'') + '" onclick="selectStation(\'' + s.station.replace(/'/g,"\\'") + '\',this)">' + s.station + '</button>';
  }).join('');
  if (stations.length) selectStation(stations[0].station, null);

  destroyChart('cStations');
  const stSorted = [...stations].sort((a,b) => b.avg_sec - a.avg_sec);
  function barCol(s) {
    if (!s.exp_sec) return '#5aa9e6';
    const r = s.avg_sec / s.exp_sec;
    if (r <= 1.0) return '#22c55e';
    if (r <= 1.15) return '#f59e0b';
    return '#ef4444';
  }
  const thrPlugin = {
    id: 'targetLines',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea:a, scales } = chart; if (!a) return;
      stSorted.forEach((s, i) => {
        if (!s.exp_sec) return;
        const x  = scales.x.getPixelForValue(i);
        const y  = scales.y.getPixelForValue(s.exp_sec / 60);
        const hw = (scales.x.getPixelForValue(1) - scales.x.getPixelForValue(0)) * 0.3;
        ctx.save(); ctx.strokeStyle='#888'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x-hw,y); ctx.lineTo(x+hw,y); ctx.stroke(); ctx.restore();
      });
    }
  };
  _charts['cStations'] = new Chart(document.getElementById('cStations'), {
    type: 'bar',
    data: { labels: stSorted.map(s=>s.station), datasets: [{ label:'Avg fulfillment (min)', data:stSorted.map(s=>+(s.avg_sec/60).toFixed(2)), backgroundColor:stSorted.map(barCol), borderRadius:4 }] },
    options: {
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      scales: {
        x: { grid:{display:false}, ticks:{maxRotation:45,minRotation:30} },
        y: { title:{display:true,text:'Avg fulfillment time (min)'}, grid:{color:gc}, min:0 }
      },
      plugins: { legend:{display:false}, tooltip:{ callbacks:{ label(ctx) {
        const s=stSorted[ctx.dataIndex];
        const lines=['Avg: '+fmtSec(s.avg_sec)+' ('+ctx.parsed.y.toFixed(1)+' min)','Count: '+s.count];
        if (s.exp_sec) { lines.push('Target: '+fmtSec(s.exp_sec)); lines.push('Ratio: '+(s.avg_sec/s.exp_sec*100).toFixed(1)+'%'); } else lines.push('No target');
        return lines;
      }}}}
    },
    plugins: [thrPlugin]
  });
}

function selectStation(name, btn) {
  document.querySelectorAll('.station-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else { document.querySelectorAll('.station-pill').forEach(p => { if (p.textContent===name) p.classList.add('active'); }); }

  const d = ALL_WEEKS_DATA[currentWeek][currentVenue];
  const s = (d.stations || []).find(x => x.station === name);
  if (!s) return;
  const det   = (d.stationDetails   || {})[name] || {};
  const items = ((d.stationItemsArr || {})[name] || []);

  const ratio = s.exp_sec ? s.avg_sec / s.exp_sec : null;
  let statusClass='', statusText='No target';
  if (ratio) {
    if (ratio > 1.15) { statusClass='status-red';   statusText='Over target ✗'; }
    else if (ratio > 1.0) { statusClass='status-amber'; statusText='Slightly over'; }
    else                  { statusClass='status-green'; statusText='On target ✓'; }
  }

  const brkHours = (det.breakingHours||[]).filter(r=>r.avg_sec>900);
  const brkText  = brkHours.length > 0
    ? brkHours.slice(0,5).map(r=>r.day+' '+r.hr+' ('+fmtSec(r.avg_sec)+')').join(', ')
    : 'None found (≤15 min all periods)';

  const hourly = det.hourly || {};
  const hourlyHours = Object.keys(hourly).sort();
  const target = s.exp_sec || 0;

  let hmHtml = '';
  if (hourlyHours.length > 0) {
    hmHtml = '<div style="overflow-x:auto;margin-top:12px"><table style="border-collapse:collapse;font-size:11px;min-width:600px">';
    hmHtml += '<tr><th style="background:#1e2533;padding:4px 6px;text-align:left;color:#9aa0aa;white-space:nowrap">Hour</th>';
    hourlyHours.forEach(hr => { hmHtml += '<th style="background:#1e2533;padding:4px 5px;text-align:center;color:#9aa0aa;white-space:nowrap;min-width:52px">'+hr+'</th>'; });
    hmHtml += '</tr><tr><td style="background:#181b22;padding:4px 6px;color:#9aa0aa;white-space:nowrap">Avg</td>';
    hourlyHours.forEach(hr => {
      const sec = hourly[hr] ? hourly[hr].avg_sec : null;
      const bg  = hmColor(sec, target); const fg = textFor(bg);
      hmHtml += '<td title="'+(sec!=null?fmtSec(sec):'no data')+'" style="padding:4px;background:'+bg+';color:'+fg+';text-align:center;font-weight:600">'+(sec!=null?fmtSec(sec):'')+' </td>';
    });
    hmHtml += '</tr>';
    const byDayHour = det.byDayHour || {};
    ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].forEach(day => {
      if (!byDayHour[day]) return;
      hmHtml += '<tr><td style="background:#13161c;padding:3px 6px 3px 14px;color:#9aa0aa;font-size:10px;white-space:nowrap">'+day.slice(0,3)+'</td>';
      hourlyHours.forEach(hr => {
        const dd  = byDayHour[day][hr];
        const sec = dd ? dd.avg_sec : null;
        const tgt2= dd ? dd.exp_sec : target;
        const bg  = hmColor(sec, tgt2||target); const fg = textFor(bg);
        hmHtml += '<td style="padding:3px 4px;background:'+bg+';color:'+fg+';text-align:center;font-size:10px">'+(sec&&sec>0?fmtSec(sec):'')+' </td>';
      });
      hmHtml += '</tr>';
    });
    hmHtml += '</table></div>';
  }

  const topItems = items.slice(0,20);
  let itemsHtml = '';
  if (topItems.length > 0) {
    const maxSec = Math.max(...topItems.map(i=>i.avg_sec), s.exp_sec||0, 900);
    itemsHtml = '<table class="items-table"><thead><tr><th>Menu Item</th><th>Count</th><th>Avg Time</th><th>vs Target</th><th style="min-width:120px">Bar</th></tr></thead><tbody>';
    topItems.forEach(it => {
      const over  = it.avg_sec > (s.exp_sec||900);
      const delta = s.exp_sec ? it.avg_sec-s.exp_sec : it.avg_sec-900;
      const deltaStr = s.exp_sec
        ? (delta>0 ? '<span style="color:#e2706a">+'+fmtSec(delta)+'</span>' : '<span style="color:#74d39a">'+fmtSec(-delta)+' under</span>')
        : '—';
      const pct = Math.min(100,(it.avg_sec/maxSec)*100);
      const bc  = over ? '#ef4444' : '#22c55e';
      itemsHtml += '<tr><td>'+(over?'<span style="color:#e2706a">'+it.item+'</span>':it.item)+'</td><td style="color:#9aa0aa">'+it.count+'</td><td style="font-weight:600">'+fmtSec(it.avg_sec)+'</td><td>'+deltaStr+'</td><td><div class="bar-cell"><div class="bar-bg"><div class="bar-fill" style="width:'+pct+'%;background:'+bc+'"></div></div><span style="font-size:10px;color:#9aa0aa;white-space:nowrap">'+fmtSec(it.avg_sec)+'</span></div></td></tr>';
    });
    itemsHtml += '</tbody></table>';
    if (items.length>20) itemsHtml += '<p style="font-size:11px;color:#9aa0aa;margin:6px 0 0">+'+(items.length-20)+' more items</p>';
  } else {
    itemsHtml = '<p style="color:#9aa0aa;font-size:12px">No item-level data available.</p>';
  }

  const statusSpan = statusClass ? '<span class="status-badge '+statusClass+'">'+statusText+'</span>' : '<span style="color:#9aa0aa;font-size:12px">'+statusText+'</span>';
  const ratioColor = ratio ? (ratio>1.15?'#ef4444':ratio>1?'#f59e0b':'#22c55e') : '#9aa0aa';
  const ratioDisp  = ratio ? (ratio*100).toFixed(0)+'%' : '—';
  document.getElementById('stationDetail').innerHTML =
    '<div class="station-header"><h2>'+s.station+'</h2>'+statusSpan+
    '<div class="kpis" style="margin:0 0 0 auto;grid-template-columns:repeat(4,auto)">'+
    kpi(s.count,'Tickets',false)+kpi(fmtSec(s.avg_sec),'Avg time',false)+kpi((s.exp_sec?fmtSec(s.exp_sec):'—'),'Target',false)+
    '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px;color:'+ratioColor+'">'+ratioDisp+'</div><div class="l">vs Target</div></div>'+
    '</div></div>'+
    '<div style="margin-bottom:16px"><div style="font-size:13px;font-weight:600;color:#d9a441;margin-bottom:4px">⚡ Breaking Point</div><div style="font-size:12px;color:#9aa0aa">'+brkText+'</div></div>'+
    '<div style="font-size:13px;font-weight:600;color:#d9a441;margin-bottom:4px">Hourly Heatmap (Day × Hour)</div>'+hmHtml+
    '<div style="font-size:13px;font-weight:600;color:#d9a441;margin:16px 0 4px">Menu Items at this station</div>'+itemsHtml;
}

// ============================================================
// TAB 3: MENU
// ============================================================
function renderMenuTab(d) {
  const SUMMARY = d.summary || [];
  const over15   = SUMMARY.filter(x=>x.avg_sec>=900).length;
  const b1015    = SUMMARY.filter(x=>x.avg_sec>=600&&x.avg_sec<900).length;
  const under10  = SUMMARY.filter(x=>x.avg_sec<600).length;
  document.getElementById('menuStats').innerHTML =
    '<div class="menu-stat"><div class="v">'+SUMMARY.length+'</div><div class="l">Total items</div></div>'+
    '<div class="menu-stat"><div class="v" style="color:#ef4444">'+over15+'</div><div class="l">Over 15 min</div></div>'+
    '<div class="menu-stat"><div class="v" style="color:#f59e0b">'+b1015+'</div><div class="l">10–15 min</div></div>'+
    '<div class="menu-stat"><div class="v" style="color:#22c55e">'+under10+'</div><div class="l">Under 10 min</div></div>';
  document.getElementById('menuSearch').value = menuSearch = '';
  renderMenuBody(SUMMARY);
}

function renderMenuBody(SUMMARY) {
  let data = SUMMARY || (ALL_WEEKS_DATA[currentWeek][currentVenue].summary || []);
  if (menuSearch) data = data.filter(x => x.item.toLowerCase().includes(menuSearch.toLowerCase()));
  const s = [...data];
  if      (menuSort==='time')  s.sort((a,b)=>b.avg_sec-a.avg_sec);
  else if (menuSort==='fast')  s.sort((a,b)=>a.avg_sec-b.avg_sec);
  else if (menuSort==='count') s.sort((a,b)=>b.count-a.count);
  else                         s.sort((a,b)=>a.item.localeCompare(b.item));
  const MAX_SEC = 1800, THR_SEC = 900;
  function statusLabel(sec) {
    if (sec>=900) return '<span style="color:#ef4444;font-size:11px">● &gt;15 min</span>';
    if (sec>=600) return '<span style="color:#f59e0b;font-size:11px">● 10–15 min</span>';
    return '<span style="color:#22c55e;font-size:11px">● &lt;10 min</span>';
  }
  function barCol(sec) { return sec>=900?'#ef4444':sec>=600?'#f59e0b':'#22c55e'; }
  const tgtPct = (THR_SEC/MAX_SEC)*100;
  document.getElementById('menuBody').innerHTML = s.map((d,i) => {
    const over   = d.avg_sec >= THR_SEC;
    const diff   = d.avg_sec - THR_SEC;
    const diffStr= diff>0 ? '<span class="over">+'+fmtSec(diff)+'</span>' : '<span class="ok">'+fmtSec(-diff)+' under</span>';
    const pct    = Math.min(100,(d.avg_sec/MAX_SEC)*100);
    const bc     = barCol(d.avg_sec);
    return '<tr>'+
      '<td style="color:#9aa0aa">'+(i+1)+'</td>'+
      '<td style="'+(over?'color:#e2706a;font-weight:600':'')+'">'+d.item+'</td>'+
      '<td style="color:#9aa0aa;text-align:right">'+d.count+'</td>'+
      '<td style="font-weight:700;color:'+bc+'">'+fmtMin(d.avg_sec)+'</td>'+
      '<td style="min-width:160px"><div style="position:relative;height:10px;background:#1e2533;border-radius:5px;overflow:visible"><div style="position:absolute;left:0;top:0;height:100%;width:'+pct+'%;background:'+bc+';border-radius:5px"></div><div style="position:absolute;left:'+tgtPct+'%;top:-2px;width:2px;height:14px;background:#e2706a;border-radius:1px"></div></div></td>'+
      '<td>'+statusLabel(d.avg_sec)+'</td>'+
      '</tr>';
  }).join('');
}

window.applyMenuFilters = function() {
  menuSearch = document.getElementById('menuSearch').value;
  renderMenuBody(ALL_WEEKS_DATA[currentWeek][currentVenue].summary || []);
};
window.setSort = function(s, btn) {
  menuSort = s;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMenuBody(ALL_WEEKS_DATA[currentWeek][currentVenue].summary || []);
};
window.selectStation = selectStation;
window.switchVenue   = switchVenue;
window.switchTab     = switchTab;
window.showHM        = showHM;
window.shiftWeek     = shiftWeek;

// ============================================================
// INIT — wait for DOM + CDNs
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  try {
    updateWeekNav();
    renderAll();
  } catch(e) {
    showError('Initialization error: ' + e.message + '\\n' + e.stack);
  }
});
<\/script>
</body>
</html>`;

fs.writeFileSync(path.join(DIR, 'dashboard.html'), html, 'utf8');
const size = fs.statSync(path.join(DIR, 'dashboard.html')).size;
console.log('Written dashboard.html, size:', size, 'bytes');
console.log('Done!');
