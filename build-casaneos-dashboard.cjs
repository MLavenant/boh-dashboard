const fs = require('fs');
const path = require('path');

let rawJson = fs.readFileSync(path.join(__dirname, 'casaneos-data.json'), 'utf8');
if (rawJson.charCodeAt(0) === 0xFEFF) rawJson = rawJson.slice(1);
const firstBrace = rawJson.indexOf('{');
if (firstBrace > 0) rawJson = rawJson.slice(firstBrace);
const data = JSON.parse(rawJson);

const { stations, summary, hmFul, hmGuests, curve, tbk, breakingPoint, breakingPointGuests, stationItemsArr, stationDetails } = data;

const HM_HRS = ['11-12','12-13','13-14','14-15','15-16','16-17','17-18','18-19','19-20','20-21','21-22','22-23','23-24','0-1'];
const HM_DAYS_FULL = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const HM_DAYS_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// Stats from data
const peakConc = curve.length > 0 ? Math.max(...curve.map(r => r.conc)) : '—';
// Find peak avg conc from Workload_DayHourly aggregated (we need it in hm_ful)
// Approximate from curve: max guests in a slot
const peakHourGuests = curve.length > 0 ? Math.max(...curve.map(r => r.guests)).toFixed(1) : '—';
const totalTickets = stations.reduce((s, r) => s + r.count, 0).toLocaleString();

const BP = breakingPoint || '—';
const BPG = breakingPointGuests || '—';

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Casa Neos · BOH Dashboard</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0d1117;color:#e8eaed;font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
.wrap{max-width:1300px;margin:0 auto;padding:0 20px 64px}
header{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;padding:20px 0 0}
h1{font-size:22px;margin:0}
.badge{margin-left:auto;color:#9aa0aa;font-size:13px}
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
canvas{width:100%!important}
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
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Casa Neos · BOH Kitchen Dashboard</h1>
  <span class="badge">Week of May 11–17, 2026 · Updated Jul 8, 2026</span>
</header>

<nav class="tab-nav">
  <button class="tab-btn active" onclick="switchTab('overview',this)">Overview</button>
  <button class="tab-btn" onclick="switchTab('stations',this)">Stations</button>
  <button class="tab-btn" onclick="switchTab('menu',this)">Menu Items</button>
</nav>

<!-- ========== TAB 1: OVERVIEW ========== -->
<section id="tab-overview" class="tab-section active">

<div class="kpis">
  <div class="kpi"><div class="v">${totalTickets}</div><div class="l">Food tickets (week)</div></div>
  <div class="kpi alert"><div class="v">${peakConc}</div><div class="l">Peak concurrent tickets</div></div>
  <div class="kpi alert"><div class="v">${BP}</div><div class="l">Breaking point (tickets)</div></div>
  <div class="kpi alert"><div class="v">${BPG}</div><div class="l">Breaking point (guests)</div></div>
  <div class="kpi"><div class="v">${peakHourGuests}</div><div class="l">Peak avg concurrent guests</div></div>
  <div class="kpi"><div class="v">15 min</div><div class="l">Fulfillment target</div></div>
</div>

<!-- Visual 1 -->
<div class="card">
  <h2>Visual 1 — Kitchen Pressure Curve</h2>
  <p class="note">X-axis = concurrent tickets open. Left Y = occurrences. Right Y = avg fulfillment time (min). Red dashed = 15-min target. Crossing point (≥${BP} concurrent) is where kitchen falls behind.</p>
  <canvas id="cPressure" style="max-height:400px"></canvas>
  <div class="legend">
    <span><span class="sw" style="background:#5aa9e6"></span>Occurrences</span>
    <span><span class="sw" style="background:#d9a441"></span>Avg fulfillment (min)</span>
    <span><span class="sw" style="background:#e2706a"></span>15-min target</span>
  </div>
  <div class="annotation-box">⚡ Breaking point at <strong>${BP} concurrent tickets</strong> — avg fulfillment jumps above 15.0 min.</div>
  <div><span class="trend-badge">📊 Trend vs prior 3 weeks: available from Jul 14</span></div>
</div>

<!-- Visual 2+3 -->
<div class="row two">
  <div class="card">
    <h2>Visual 2 — Breaking Point</h2>
    <p class="note">Avg fulfillment time and guests vs concurrent ticket load.</p>
    <div class="row two" style="margin-bottom:12px;gap:8px">
      <div class="bpbox"><div class="big">${BP}</div><div class="l">tickets → kitchen falls behind</div></div>
      <div class="bpbox"><div class="big">${BPG}</div><div class="l">guests → kitchen falls behind</div></div>
    </div>
    <canvas id="cBreaking" style="max-height:260px"></canvas>
    <div><span class="trend-badge">📊 Trend vs prior 3 weeks: available from Jul 14</span></div>
  </div>
  <div class="card">
    <h2>Visual 3 — Load vs Performance</h2>
    <p class="note">Bucketed view: avg fulfillment time per ticket-count band.</p>
    <canvas id="cLoadPerf" style="max-height:260px"></canvas>
    <div class="legend">
      <span><span class="sw" style="background:#d9a441"></span>Avg fulfillment (min)</span>
      <span><span class="sw" style="background:#e2706a"></span>15-min target</span>
    </div>
    <div><span class="trend-badge">📊 Trend vs prior 3 weeks: available from Jul 14</span></div>
  </div>
</div>

<!-- Visual 4: 3D -->
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

<!-- Visual 5: Heatmaps -->
<div class="card">
  <h2>Visual 5 — Day × Hour Heatmaps</h2>
  <p class="note">Toggle between fulfillment time and guest count. Y-axis = hour window. X-axis = day of week.</p>
  <div class="hm-toggle">
    <button class="active" onclick="showHM('ful',this)">⏱ Avg Fulfillment Time (min)</button>
    <button onclick="showHM('guests',this)">👥 Avg Guests Seated (OT)</button>
  </div>
  <div id="hmFul">
    <div style="font-size:12px;color:#9aa0aa;margin-bottom:6px">Color scale: <span style="color:#22c55e">■</span> ≤10 min → <span style="color:#f59e0b">■</span> 10–15 min → <span style="color:#ef4444">■</span> &gt;15 min</div>
    <div class="hm-wrap"><table class="hm-table" id="hmFulTable"></table></div>
    <div class="legend" style="margin-top:8px">
      <span><span class="sw" style="background:#22c55e"></span>≤10 min</span>
      <span><span class="sw" style="background:#f59e0b"></span>10–15 min</span>
      <span><span class="sw" style="background:#ef4444"></span>&gt;15 min</span>
      <span><span class="sw" style="background:#1a1d24"></span>No data</span>
    </div>
  </div>
  <div id="hmGuests" style="display:none">
    <div style="font-size:12px;color:#9aa0aa;margin-bottom:6px">Color scale: <span style="color:#b3d9f7">■</span> few → <span style="color:#1565c0">■</span> many guests</div>
    <div class="hm-wrap"><table class="hm-table" id="hmGuestsTable"></table></div>
    <div class="legend" style="margin-top:8px">
      <span><span class="sw" style="background:#b3d9f7"></span>Few guests</span>
      <span><span class="sw" style="background:#1565c0"></span>Many guests (300+)</span>
      <span><span class="sw" style="background:#1a1d24"></span>No data</span>
    </div>
  </div>
</div>

</section>

<!-- ========== TAB 2: STATIONS ========== -->
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
  <canvas id="cStations" style="max-height:480px"></canvas>
  <div class="legend">
    <span><span class="sw" style="background:#22c55e"></span>On target</span>
    <span><span class="sw" style="background:#f59e0b"></span>Up to +15% over</span>
    <span><span class="sw" style="background:#ef4444"></span>&gt;+15% over</span>
    <span><span class="sw" style="background:#5aa9e6"></span>No target</span>
  </div>
</div>
<div class="coming-note">📊 3-week trend comparison — coming when Week 2 data is available</div>

</section>

<!-- ========== TAB 3: MENU ITEMS ========== -->
<section id="tab-menu" class="tab-section">

<div class="section-title">Menu Item Performance</div>
<div class="card">
  <div class="menu-stats" id="menuStats"></div>
  <input class="search-bar" id="menuSearch" placeholder="🔍 Search menu items…" oninput="applyMenuFilters()">
  <div class="sort-btns">
    <span style="color:#9aa0aa;font-size:12px;line-height:28px">Sort by:</span>
    <button class="sort-btn active" id="sortTime" onclick="setSort('time',this)">Slowest first</button>
    <button class="sort-btn" id="sortCount" onclick="setSort('count',this)">Most ordered</button>
    <button class="sort-btn" id="sortName" onclick="setSort('name',this)">Name A–Z</button>
    <button class="sort-btn" id="sortFast" onclick="setSort('fast',this)">Fastest first</button>
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
<div class="coming-note">📊 3-week trend comparison — coming when Week 2 data is available</div>

</section>

<footer>Source: <em>Week 20cntest.xlsx</em> · Fulfillment = Fired Date → Fulfilled Date · Food stations only</footer>
</div>

<script>
// ============================================================
// EMBEDDED DATA
// ============================================================
const CURVE = ${JSON.stringify(curve)};
const TBK = ${JSON.stringify(tbk)};
const STATIONS = ${JSON.stringify(stations)};
const SUMMARY = ${JSON.stringify(summary)};
const HM_FUL = ${JSON.stringify(hmFul)};
const HM_GUESTS = ${JSON.stringify(hmGuests)};
const STATION_ITEMS = ${JSON.stringify(stationItemsArr)};
const STATION_DETAILS = ${JSON.stringify(stationDetails)};
const HM_HRS = ${JSON.stringify(HM_HRS)};
const HM_DAYS_FULL = ${JSON.stringify(HM_DAYS_FULL)};
const HM_DAYS_SHORT = ${JSON.stringify(HM_DAYS_SHORT)};
const BP = ${JSON.stringify(breakingPoint)};
const BPG = ${JSON.stringify(breakingPointGuests)};

// ============================================================
// UTILS
// ============================================================
const THRESHOLD = 15;
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
  return lerpColor('#b3d9f7','#1565c0', Math.min(1, g/320));
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
// CHART.JS DEFAULTS
// ============================================================
Chart.defaults.color = '#9aa0aa';
Chart.defaults.borderColor = gc;
Chart.defaults.font.family = 'inherit';

// ============================================================
// VISUAL 1: Kitchen Pressure Curve
// ============================================================
(function() {
  const labels = CURVE.map(d => d.conc);
  const bpPlugin = {
    id:'bpZone',
    beforeDraw(chart) {
      const {ctx, chartArea:a, scales} = chart;
      if (!a || !scales.x) return;
      const bpIdx = labels.indexOf(BP);
      if (bpIdx < 0) return;
      const xBp = scales.x.getPixelForValue(bpIdx);
      ctx.save();
      ctx.fillStyle='rgba(226,112,106,0.07)';
      ctx.fillRect(xBp,a.top,a.right-xBp,a.height);
      const yThr=scales.y1.getPixelForValue(THRESHOLD);
      if(yThr>=a.top&&yThr<=a.bottom){ctx.strokeStyle='#e2706a';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(a.left,yThr);ctx.lineTo(a.right,yThr);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='11px sans-serif';ctx.textAlign='left';ctx.fillText('15 min target',a.left+4,yThr-4);}
      ctx.strokeStyle='#e2706a';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(xBp,a.top);ctx.lineTo(xBp,a.bottom);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.fillText('⚡ BP:'+BP,xBp,a.top+14);
      ctx.restore();
    }
  };
  new Chart(document.getElementById('cPressure'),{
    data:{labels,datasets:[
      {type:'bar',label:'Occurrences',data:CURVE.map(d=>d.occ),backgroundColor:labels.map(l=>l>=BP?'rgba(226,112,106,0.55)':'rgba(90,169,230,0.55)'),borderColor:labels.map(l=>l>=BP?'#e2706a':'#5aa9e6'),borderWidth:1,yAxisID:'y',order:2,borderRadius:2},
      {type:'line',label:'Avg fulfillment (min)',data:CURVE.map(d=>d.ful),borderColor:'#d9a441',backgroundColor:'rgba(217,164,65,0.0)',tension:0.3,pointRadius:2,pointHoverRadius:5,borderWidth:2.5,yAxisID:'y1',order:1}
    ]},
    options:{interaction:{mode:'index',intersect:false},scales:{x:{title:{display:true,text:'Concurrent tickets open'},grid:{color:gc}},y:{position:'left',title:{display:true,text:'Occurrences'},grid:{color:gc},min:0},y1:{position:'right',title:{display:true,text:'Avg fulfillment (min)'},grid:{display:false},min:0,suggestedMax:28}},plugins:{legend:{position:'top',labels:{boxWidth:12}}}},
    plugins:[bpPlugin]
  });
})();

// ============================================================
// VISUAL 2: Breaking Point
// ============================================================
(function() {
  const labels = CURVE.map(d => d.conc);
  const refLines={id:'refLines',afterDraw(chart){
    const {ctx,chartArea:a,scales}=chart;if(!a)return;
    const bpIdx=labels.indexOf(BP);
    if(bpIdx>=0){const xBp=scales.x.getPixelForValue(bpIdx);ctx.save();ctx.strokeStyle='#e2706a';ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(xBp,a.top);ctx.lineTo(xBp,a.bottom);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='11px sans-serif';ctx.fillText('BP: '+BP,xBp+4,a.top+14);ctx.restore();}
    const yThr=scales.y.getPixelForValue(THRESHOLD);if(yThr>=a.top&&yThr<=a.bottom){ctx.save();ctx.strokeStyle='#e2706a';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(a.left,yThr);ctx.lineTo(a.right,yThr);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='11px sans-serif';ctx.fillText('15 min',a.left+4,yThr-4);ctx.restore();}
    const yGBp=scales.y1.getPixelForValue(BPG);if(yGBp>=a.top&&yGBp<=a.bottom){ctx.save();ctx.strokeStyle='#5aa9e6';ctx.lineWidth=1;ctx.setLineDash([4,3]);ctx.beginPath();ctx.moveTo(a.left,yGBp);ctx.lineTo(a.right,yGBp);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#5aa9e6';ctx.font='11px sans-serif';ctx.textAlign='right';ctx.fillText('BP: '+BPG+' guests',a.right-4,yGBp-4);ctx.restore();}
  }};
  new Chart(document.getElementById('cBreaking'),{
    data:{labels,datasets:[
      {type:'line',label:'Avg fulfillment (min)',data:CURVE.map(d=>d.ful),borderColor:'#d9a441',backgroundColor:'rgba(217,164,65,0.12)',fill:true,tension:0.3,pointRadius:0,yAxisID:'y',order:1},
      {type:'line',label:'Avg guests seated',data:CURVE.map(d=>d.guests),borderColor:'#5aa9e6',backgroundColor:'rgba(90,169,230,0.08)',fill:true,tension:0.3,pointRadius:0,yAxisID:'y1',order:2}
    ]},
    options:{interaction:{mode:'index',intersect:false},scales:{x:{title:{display:true,text:'Concurrent tickets open'},grid:{color:gc}},y:{position:'left',title:{display:true,text:'Avg fulfillment (min)'},grid:{color:gc},suggestedMax:28},y1:{position:'right',title:{display:true,text:'Avg guests seated'},grid:{display:false},suggestedMax:420}},plugins:{legend:{position:'top',labels:{boxWidth:12}}}},
    plugins:[refLines]
  });
})();

// ============================================================
// VISUAL 3: Load vs Performance
// ============================================================
(function(){
  const thrLine={id:'thr',afterDraw(chart){const{ctx,chartArea:a,scales}=chart;if(!a||!scales.y)return;const yy=scales.y.getPixelForValue(THRESHOLD);if(yy<a.top||yy>a.bottom)return;ctx.save();ctx.strokeStyle='#e2706a';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(a.left,yy);ctx.lineTo(a.right,yy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#e2706a';ctx.font='11px sans-serif';ctx.fillText(THRESHOLD+' min target',a.left+6,yy-4);ctx.restore();}};
  new Chart(document.getElementById('cLoadPerf'),{type:'bar',data:{labels:TBK.map(b=>b.bucket),datasets:[{label:'Avg fulfillment (min)',data:TBK.map(b=>b.ful),backgroundColor:TBK.map(b=>b.ful>THRESHOLD?'#8a3f1a':'#d9a441'),borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{x:{title:{display:true,text:'Concurrent tickets open (bucket)'},grid:{display:false}},y:{title:{display:true,text:'Avg fulfillment (min)'},grid:{color:gc},suggestedMax:28}}},plugins:[thrLine]});
})();

// ============================================================
// VISUAL 4: 3D Station View
// ============================================================
(function(){
  const host = document.getElementById('kitchen');
  if (!window.THREE) {
    host.innerHTML='<div style="padding:40px;color:#9aa0aa;text-align:center">Three.js failed to load. Check CDN connection.<br><small>CDN: cdnjs.cloudflare.com</small></div>';
    return;
  }
  // Casa Neos kitchen layout — two main lines
  const LAYOUT = {
    'Grilll 1':[-7,-4],'Grill (K1)':[-5,-4],'Grill 1 (Side)':[-3,-4],'Grill 2':[-1,-4],
    'Meat':[1,-4],'Fish':[3,-4],'Maki 2':[5,-4],'Paella':[7,-4],
    'Sautee 1':[-7,-2],'Sautee 2':[-5,-2],'Sauteed 1 (Sides)':[-3,-2],'Sauteed 2 (Sides)':[-1,-2],
    'Fry 1':[1,-2],'Fry 2':[3,-2],'Pasta 1st floor':[5,-2],'Hot Line':[7,-2],
    'Hot Expo 1':[-5,0],'Hot expo 2':[-3,0],'Cold Expo 1':[0,0],'Cold Expo 2':[2,0],
    'Garde Manger 1':[-7,2],'Raw 2':[-5,2],'ICO':[-3,2],'Condiments':[-1,2],
    'Pastry 1':[1,2],'Pastry 2':[3,2],
    'NO PRINT':[6,2],
  };
  const ZONES=[['HOT GRILL',-4,-5],['HOT LINE',3,-3],['EXPO',-1.5,-0.7],['COLD LINE',-4,2.7]];
  function perfColor(s){
    if(!s.exp_sec||s.exp_sec===0)return 0x6b7280;
    const r=s.avg_sec/s.exp_sec;
    if(r<=1.0)return 0x2e8b57;
    if(r<=1.15)return 0xc99a2e;
    return 0xc0392b;
  }
  function tSprite(t,sub,color,big){
    const c=document.createElement('canvas');c.width=256;c.height=sub?80:48;
    const g=c.getContext('2d');
    g.font='bold '+(big?24:20)+'px sans-serif';g.fillStyle=color||'#fff';g.textAlign='center';
    g.fillText(t,128,sub?30:32);
    if(sub){g.font='20px sans-serif';g.fillStyle='#ffd479';g.fillText(sub,128,62);}
    return new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true}));
  }
  let W=host.clientWidth||900,H=500;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x0c0e13);
  const camera=new THREE.PerspectiveCamera(45,W/H,0.1,200);
  const renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(window.devicePixelRatio||1);renderer.setSize(W,H);
  host.appendChild(renderer.domElement);
  window._threeRenderer=renderer;window._threeCamera=camera;
  scene.add(new THREE.AmbientLight(0xffffff,0.82));
  const dl=new THREE.DirectionalLight(0xffffff,0.6);dl.position.set(6,14,8);scene.add(dl);
  const kitchen=new THREE.Group();scene.add(kitchen);
  const FW=22,FD=14;
  const floor=new THREE.Mesh(new THREE.BoxGeometry(FW,0.2,FD),new THREE.MeshLambertMaterial({color:0x161a21}));
  floor.position.y=-0.1;kitchen.add(floor);
  const grid=new THREE.GridHelper(Math.max(FW,FD),20,0x2a2f3a,0x1e222a);grid.position.y=0.02;kitchen.add(grid);
  const wallMat=new THREE.MeshLambertMaterial({color:0x222831});
  function wall(w,d,x,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,1.6,d),wallMat);m.position.set(x,0.8,z);kitchen.add(m);}
  wall(FW,0.25,0,-FD/2);wall(FW,0.25,0,FD/2);wall(0.25,FD,-FW/2,0);wall(0.25,FD,FW/2,0);
  ZONES.forEach(([t,x,z])=>{const sp=tSprite(t,null,'#7f8794',false);sp.scale.set(3.0,0.6,1);sp.position.set(x,0.25,z);kitchen.add(sp);});
  const withTargets=STATIONS.filter(s=>s.exp_sec>0);
  const overTarget=withTargets.filter(s=>s.avg_sec>s.exp_sec).length;
  document.getElementById('kTotal').textContent=overTarget+'/'+withTargets.length+' over target';
  const boxes=[];let gi=0;
  STATIONS.forEach(s=>{
    let pos=LAYOUT[s.station];
    if(!pos){const col=gi%6,row=Math.floor(gi/6);pos=[(col-2.5)*1.8,6.5+row*1.8];gi++;}
    const[x,z]=pos;
    const mins=s.avg_sec?s.avg_sec/60:0;
    const h=Math.max(0.4,Math.min(6,mins*0.32));
    const box=new THREE.Mesh(new THREE.BoxGeometry(1.3,h,1.3),new THREE.MeshLambertMaterial({color:perfColor(s)}));
    box.position.set(x,0.35+h/2,z);box.userData=s;kitchen.add(box);boxes.push(box);
    const shortName=s.station.replace('Sauteed','Sautd').replace('(Sides)','Sides').replace('1st floor','1F').replace('Garde Manger','G.Mngr');
    const label=tSprite(shortName,(mins?mins.toFixed(1):'–')+' min','#fff',true);
    label.scale.set(2.8,0.88,1);label.position.set(x,0.35+h+0.85,z);kitchen.add(label);
  });
  let rotY=0.7,rotX=0.7,dist=26;
  function place(){camera.position.set(dist*Math.sin(rotY)*Math.cos(rotX),dist*Math.sin(rotX),dist*Math.cos(rotY)*Math.cos(rotX));camera.lookAt(0,0.6,0);}
  place();
  let drag=false,px=0,py=0,moved=0,spin=true;
  const dom=renderer.domElement;
  dom.addEventListener('pointerdown',e=>{drag=true;moved=0;px=e.clientX;py=e.clientY;spin=false;host.style.cursor='grabbing';});
  window.addEventListener('pointerup',e=>{if(drag&&moved<6)pick(e);drag=false;host.style.cursor='grab';});
  window.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-px,dy=e.clientY-py;moved+=Math.abs(dx)+Math.abs(dy);rotY-=dx*0.008;rotX=Math.max(0.2,Math.min(1.45,rotX+dy*0.006));px=e.clientX;py=e.clientY;place();});
  dom.addEventListener('wheel',e=>{e.preventDefault();dist=Math.max(9,Math.min(50,dist+(e.deltaY>0?1.4:-1.4)));place();},{passive:false});
  const ray=new THREE.Raycaster(),m2=new THREE.Vector2();
  function pick(e){const r=dom.getBoundingClientRect();m2.x=((e.clientX-r.left)/r.width)*2-1;m2.y=-((e.clientY-r.top)/r.height)*2+1;ray.setFromCamera(m2,camera);const hit=ray.intersectObjects(boxes,false);if(hit.length)selectStation3D(hit[0].object.userData);}
  function selectStation3D(s){
    const ratio=s.exp_sec>0?(s.avg_sec/s.exp_sec*100).toFixed(1)+'%':'no target';
    let sc='#74d39a',st='On target';
    if(!s.exp_sec){sc='#9aa0aa';st='No target';}
    else if(s.avg_sec/s.exp_sec>1.15){sc='#e2706a';st='Over target';}
    else if(s.avg_sec>s.exp_sec){sc='#c99a2e';st='Slightly over';}
    document.getElementById('kDetail').innerHTML='<div style="border-top:1px solid #262a33;padding-top:14px"><h2 style="font-size:15px;margin:0 0 10px">'+s.station+'</h2><div class="kpis" style="margin-bottom:0"><div class="kpi"><div class="v" style="font-size:19px">'+s.count+'</div><div class="l">Tickets</div></div><div class="kpi"><div class="v" style="font-size:19px">'+fmtSec(s.avg_sec)+'</div><div class="l">Avg time</div></div><div class="kpi"><div class="v" style="font-size:19px">'+(s.exp_sec>0?fmtSec(s.exp_sec):'—')+'</div><div class="l">Target</div></div><div class="kpi"><div class="v" style="font-size:19px;color:'+sc+'">'+ratio+'</div><div class="l">'+st+'</div></div></div></div>';
  }
  function loop(){requestAnimationFrame(loop);if(spin)kitchen.rotation.y+=0.0022;renderer.render(scene,camera);}
  loop();
  window.addEventListener('resize',()=>{W=host.clientWidth||W;renderer.setSize(W,H);camera.aspect=W/H;camera.updateProjectionMatrix();});
})();

// ============================================================
// VISUAL 5: Day x Hour Heatmaps
// ============================================================
(function(){
  function buildHM(tblId, getVal, colorFn, dispFn, tipFn) {
    const tbl = document.getElementById(tblId);
    let html = '<thead><tr><th class="row-head" style="background:#1e2533">Hour</th>';
    HM_DAYS_SHORT.forEach(d => { html += '<th style="background:#1e2533;min-width:72px">'+d+'</th>'; });
    html += '</tr></thead><tbody>';
    HM_HRS.forEach(hr => {
      html += '<tr><td class="row-head" style="background:#181b22;font-weight:600;color:#9aa0aa">'+hr+'</td>';
      HM_DAYS_FULL.forEach(day => {
        const v = getVal(day, hr);
        const bg = colorFn(v);
        const fg = textFor(bg);
        html += '<td title="'+tipFn(day,hr,v)+'" style="background:'+bg+';color:'+fg+';padding:6px 3px">'+dispFn(v)+'</td>';
      });
      html += '</tr>';
    });
    html += '</tbody>';
    tbl.innerHTML = html;
  }
  buildHM('hmFulTable',
    (day,hr) => HM_FUL[day]&&HM_FUL[day][hr]!=null?HM_FUL[day][hr]:null,
    fulColor,
    v => v!=null?v.toFixed(1):'',
    (day,hr,v) => v!=null?day+' '+hr+': '+v.toFixed(1)+' min':day+' '+hr+': no data'
  );
  buildHM('hmGuestsTable',
    (day,hr) => HM_GUESTS[day]&&HM_GUESTS[day][hr]?HM_GUESTS[day][hr]:null,
    guestColor,
    v => v!=null?v.toFixed(0):'',
    (day,hr,v) => v!=null?day+' '+hr+': '+v.toFixed(0)+' guests':day+' '+hr+': no data'
  );
})();

// ============================================================
// TAB 2: Station Selector & Detail
// ============================================================
(function(){
  function pillClass(s) {
    if (!s.exp_sec) return '';
    const r = s.avg_sec / s.exp_sec;
    if (r <= 1.0) return 'green';
    if (r <= 1.15) return 'amber';
    return 'red';
  }

  const pillsEl = document.getElementById('stationPills');
  STATIONS.forEach((s, idx) => {
    const btn = document.createElement('button');
    btn.className = 'station-pill ' + pillClass(s);
    btn.textContent = s.station;
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
    const items = STATION_ITEMS[s.station] || [];
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
      const byDayHour = det.byDayHour || {};
      ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].forEach(day => {
        if (!byDayHour[day]) return;
        hmHtml += '<tr><td style="background:#13161c;padding:3px 6px 3px 14px;color:#9aa0aa;font-size:10px;white-space:nowrap">'+day.slice(0,3)+'</td>';
        hourlyHours.forEach(hr => {
          const d = byDayHour[day][hr];
          const sec = d ? d.avg_sec : null;
          const tgt2 = d ? d.exp_sec : target;
          const bg = hmColor(sec, tgt2||target);
          const fg = textFor(bg);
          hmHtml += '<td style="padding:3px 4px;background:'+bg+';color:'+fg+';text-align:center;font-size:10px">'+(sec&&sec>0?fmtSec(sec):'')+'</td>';
        });
        hmHtml += '</tr>';
      });
      hmHtml += '</table></div>';
    }

    const topItems = items.slice(0, 20);
    let itemsHtml = '';
    if (topItems.length > 0) {
      const maxSec = Math.max(...topItems.map(i=>i.avg_sec), s.exp_sec||0, 900);
      itemsHtml = '<table class="items-table"><thead><tr><th>Menu Item</th><th>Count</th><th>Avg Time</th><th>vs Target</th><th style="min-width:120px">Bar</th></tr></thead><tbody>';
      topItems.forEach(it => {
        const over = it.avg_sec > (s.exp_sec||900);
        const delta = s.exp_sec ? it.avg_sec - s.exp_sec : it.avg_sec - 900;
        const deltaStr = s.exp_sec
          ? (delta>0?'<span style="color:#e2706a">+'+fmtSec(delta)+'</span>':'<span style="color:#74d39a">'+fmtSec(-delta)+' under</span>')
          : '—';
        const pct = Math.min(100, (it.avg_sec / maxSec) * 100);
        const barColor = over ? '#ef4444' : '#22c55e';
        itemsHtml += '<tr><td>'+(over?'<span style="color:#e2706a">'+it.item+'</span>':it.item)+'</td><td style="color:#9aa0aa">'+it.count+'</td><td style="font-weight:600">'+fmtSec(it.avg_sec)+'</td><td>'+deltaStr+'</td><td><div class="bar-cell"><div class="bar-bg"><div class="bar-fill" style="width:'+pct+'%;background:'+barColor+'"></div></div><span style="font-size:10px;color:#9aa0aa;white-space:nowrap">'+fmtSec(it.avg_sec)+'</span></div></td></tr>';
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
        '</div>'+
      '</div>'+
      '<div style="margin-bottom:16px">'+
        '<div style="font-size:13px;font-weight:600;color:#d9a441;margin-bottom:4px">⚡ Breaking Point</div>'+
        '<div style="font-size:12px;color:#9aa0aa">'+brkText+'</div>'+
      '</div>'+
      '<div style="font-size:13px;font-weight:600;color:#d9a441;margin-bottom:4px">Hourly Heatmap (Day × Hour)</div>'+
      hmHtml+
      '<div style="font-size:13px;font-weight:600;color:#d9a441;margin:16px 0 4px">Menu Items at this station (from ticket drop)</div>'+
      itemsHtml;
  }

  renderStationDetail(STATIONS[0]);

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
  new Chart(document.getElementById('cStations'),{
    type:'bar',
    data:{labels:stSorted.map(s=>s.station),datasets:[{label:'Avg fulfillment (min)',data:stSorted.map(s=>+(s.avg_sec/60).toFixed(2)),backgroundColor:stSorted.map(barColor),borderRadius:4}]},
    options:{interaction:{mode:'index',intersect:false},scales:{x:{grid:{display:false},ticks:{maxRotation:55,minRotation:40,font:{size:11}}},y:{title:{display:true,text:'Avg fulfillment time (min)'},grid:{color:gc},min:0}},plugins:{legend:{display:false},tooltip:{callbacks:{label(ctx){const s=stSorted[ctx.dataIndex];const lines=['Avg: '+fmtSec(s.avg_sec)+' ('+ctx.parsed.y.toFixed(1)+' min)','Count: '+s.count];if(s.exp_sec){lines.push('Target: '+fmtSec(s.exp_sec));lines.push('Ratio: '+(s.avg_sec/s.exp_sec*100).toFixed(1)+'%');}else lines.push('No target');return lines;}}}}},
    plugins:[thrPlugin]
  });
})();

// ============================================================
// TAB 3: Menu Items
// ============================================================
(function(){
  const THR_SEC = 900;
  let currentSort = 'time';
  let currentSearch = '';

  const over15 = SUMMARY.filter(d=>d.avg_sec>=900).length;
  const b1015 = SUMMARY.filter(d=>d.avg_sec>=600&&d.avg_sec<900).length;
  const under10 = SUMMARY.filter(d=>d.avg_sec<600).length;
  document.getElementById('menuStats').innerHTML =
    '<div class="menu-stat"><div class="v">'+SUMMARY.length+'</div><div class="l">Total items</div></div>'+
    '<div class="menu-stat"><div class="v" style="color:#ef4444">'+over15+'</div><div class="l">Over 15 min</div></div>'+
    '<div class="menu-stat"><div class="v" style="color:#f59e0b">'+b1015+'</div><div class="l">10–15 min</div></div>'+
    '<div class="menu-stat"><div class="v" style="color:#22c55e">'+under10+'</div><div class="l">Under 10 min</div></div>';

  function sorted(data) {
    const s = [...data];
    if (currentSort === 'time') s.sort((a,b)=>b.avg_sec-a.avg_sec);
    else if (currentSort === 'fast') s.sort((a,b)=>a.avg_sec-b.avg_sec);
    else if (currentSort === 'count') s.sort((a,b)=>b.count-a.count);
    else s.sort((a,b)=>a.item.localeCompare(b.item));
    return s;
  }

  function itemStatusColor(sec) {
    if (sec >= 900) return '#ef4444';
    if (sec >= 600) return '#f59e0b';
    return '#22c55e';
  }
  function itemStatusLabel(sec) {
    if (sec >= 900) return '<span style="color:#ef4444;font-size:11px">● >15 min</span>';
    if (sec >= 600) return '<span style="color:#f59e0b;font-size:11px">● 10–15 min</span>';
    return '<span style="color:#22c55e;font-size:11px">● <10 min</span>';
  }

  function renderMenu() {
    let data = SUMMARY;
    if (currentSearch) data = data.filter(d=>d.item.toLowerCase().includes(currentSearch.toLowerCase()));
    const s = sorted(data);
    const MAX_SEC = 1800;
    document.getElementById('menuBody').innerHTML = s.map((d,i) => {
      const over = d.avg_sec >= THR_SEC;
      const diff = d.avg_sec - THR_SEC;
      const diffStr = diff > 0
        ? '<span class="over">+'+fmtSec(diff)+'</span>'
        : '<span class="ok">'+fmtSec(-diff)+' under</span>';
      const pct = Math.min(100, (d.avg_sec / MAX_SEC) * 100);
      const barCol = itemStatusColor(d.avg_sec);
      const tgtPct = (THR_SEC / MAX_SEC) * 100;
      return '<tr>'+
        '<td style="color:#9aa0aa">'+(i+1)+'</td>'+
        '<td style="'+(over?'color:#e2706a;font-weight:600':'')+'">'+d.item+'</td>'+
        '<td style="color:#9aa0aa;text-align:right">'+d.count+'</td>'+
        '<td style="font-weight:700;color:'+barCol+'">'+fmtMin(d.avg_sec)+'</td>'+
        '<td style="min-width:160px"><div style="position:relative;height:10px;background:#1e2533;border-radius:5px;overflow:visible"><div style="position:absolute;left:0;top:0;height:100%;width:'+pct+'%;background:'+barCol+';border-radius:5px"></div><div style="position:absolute;left:'+tgtPct+'%;top:-2px;width:2px;height:14px;background:#e2706a;border-radius:1px"></div></div></td>'+
        '<td>'+itemStatusLabel(d.avg_sec)+'</td>'+
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
  renderMenu();
})();
</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'dashboard-casaneos.html'), html, 'utf8');
console.log('Dashboard written to dashboard-casaneos.html');
console.log('File size:', Math.round(fs.statSync(path.join(__dirname, 'dashboard-casaneos.html')).size / 1024), 'KB');
