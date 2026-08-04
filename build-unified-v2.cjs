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
  // Sort chronologically so the latest week is always last (index = length-1)
  rollingWeeks.sort((a, b) => String(a.key).localeCompare(String(b.key)));
} catch(e) {
  // fallback
}
// Clean CI/Pages worktrees do not include data/rolling.json. Discover immutable
// week payloads from tracked venue files instead of silently falling back to W27.
if (!rollingWeeks.length) {
  const foundWeeks = new Set();
  for (const file of fs.readdirSync(__dirname)) {
    const m = file.match(/-data-(\d{4}-W\d{2})\.json$/);
    if (m) foundWeeks.add(m[1]);
  }
  rollingWeeks = [...foundWeeks]
    .sort()
    .map((key) => ({ label: 'W' + key.slice(-2), key }));
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

// Item-level targets from Excel ref files
let ITEM_TARGETS = {};
try {
  ITEM_TARGETS = JSON.parse(fs.readFileSync(path.join(DIR, 'item-targets.json'), 'utf8'));
} catch(e) { /* file not found, skip */ }

// Static Menu Item → Stations + Target from REF sheets (authoritative assignment)
let ITEM_STATION_MAP = {};
try {
  ITEM_STATION_MAP = JSON.parse(fs.readFileSync(path.join(DIR, 'item-station-map.json'), 'utf8'));
} catch(e) { /* file not found, skip */ }

let CHEF_TARGET_OVERRIDES = {};
try {
  CHEF_TARGET_OVERRIDES = JSON.parse(fs.readFileSync(path.join(DIR, 'chef-target-overrides.json'), 'utf8'));
} catch(e) { /* file not found, skip */ }

// Pipeline health / sanity check status
let PIPELINE_HEALTH = {};
try {
  PIPELINE_HEALTH = JSON.parse(fs.readFileSync(path.join(DIR, 'pipeline-health.json'), 'utf8'));
} catch(e) { /* file not found, skip */ }

function applyTargets(venueKey, data) {
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
// Normalize Windows template line endings so structural replacements are
// deterministic in local, clean worktree, and GitHub Pages builds.
const template = fs
  .readFileSync(path.join(DIR, 'dashboard-claudie.html'), 'utf8')
  .replace(/\r\n/g, '\n');
const buildStamp = new Date().toISOString();
const latestWeekKey = rollingWeeks.length ? rollingWeeks[rollingWeeks.length - 1].key : 'unknown';

// ── Split at <script> ─────────────────────────────────────────────────────────
const scriptTagIdx = template.indexOf('\n<script>');
const htmlPart = template.slice(0, scriptTagIdx);

// ── Modify HTML header to add venue pills + week selector ────────────────────
let html = htmlPart
  .replace('<title>Claudie · BOH Dashboard</title>',
    `<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">\n` +
    `<meta http-equiv="Pragma" content="no-cache">\n` +
    `<meta http-equiv="Expires" content="0">\n` +
    `<title>BOH Dashboard · ${latestWeekKey}</title>`)
  .replace(
    '<header>\n  <h1>Claudie · BOH Dashboard</h1>\n  <span class="badge">Week of Jun 29 – Jul 5, 2026 · Updated Jul 6, 2026</span>\n</header>',
    `<header>
  <h1 id="dashTitle">BOH Dashboard</h1>
  <span class="badge" id="dashBadge">Latest ${latestWeekKey} · Built ${buildStamp.slice(0, 16).replace('T', ' ')} UTC</span>
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
  /<div class="section-title">Station Selector<\/div>\r?\n<div class="station-pills" id="stationPills"><\/div>/,
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
<div class="station-pills" id="stationPills"></div>
<div class="card" id="staffingCard" style="margin-top:18px;display:none">
  <h2 style="margin:0 0 4px">Staffing by Station Family</h2>
  <p class="note" id="staffingNote" style="margin-top:0">Food-production families only (no FOH). Volume = <strong>item quantity</strong>. Read <strong style="color:#d9a441">items / person</strong> and <strong>fulfillment</strong> — no over/understaff labels.</p>
  <div id="staffingGrid" style="overflow-x:auto"></div>
  <p id="staffingMatchNote" style="font-size:11px;color:#9aa0aa;margin:8px 0 0"></p>
</div>`
);

// Add Assignment + Group + Settings tabs to nav
html = html.replace(
  '<button class="tab-btn" onclick="switchTab(\'menu\',this)">Menu Items</button>\n</nav>',
  '<button class="tab-btn" onclick="switchTab(\'menu\',this)">Menu Items</button>\n  <button class="tab-btn" onclick="switchTab(\'assignment\',this)">📋 Assignment</button>\n  <button class="tab-btn" onclick="switchTab(\'group\',this)">🏢 Group</button>\n  <button class="tab-btn" onclick="switchTab(\'settings\',this)">⚙️ Settings</button>\n</nav>'
);

// Add Visual 4 (WoW) + Stations Recap before Visual 5 (3D)
html = html.replace(
  '</div>\n\n<!-- Visual 5: 3D -->',
  `</div>

<!-- Stations Recap (between Visual 3 and Visual 4) -->
<div class="card" id="stationsRecapCard">
  <h2>Stations Recap — This Week</h2>
  <p class="note">All food stations ranked worst → best vs target. Click a row to open Stations tab.</p>
  <div id="stationsRecap" style="overflow-x:auto"></div>
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
  <p class="note">Bubble size = order count. Color: green ≤10 min, yellow 10–15 min, red &gt;15 min. Noise filtered: count &lt; 3, avg &gt; 45 min, deposits / packages / beverages excluded.</p>
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
  <p class="note">Stations from Toast Bulk Editor (monthly refresh). <strong>Target</strong> = item should be fulfilled in X minutes — click to edit; chefs set targets for new items. Saves in your browser; use <em>Export chef targets</em> then drop file into repo as <code>chef-target-overrides.json</code>. REF/TARGET values are never overwritten by the scrape.</p>
  <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
    <input id="assignSearch" type="text" placeholder="Search items…" oninput="applyAssignFilter()" style="padding:6px 12px;background:#1e2533;border:1px solid #2d3448;color:#e8eaed;border-radius:8px;font-size:13px;font-family:inherit;width:220px;outline:none">
    <select id="assignTargetFilter" onchange="applyAssignFilter()" style="padding:6px 12px;background:#1e2533;border:1px solid #2d3448;color:#e8eaed;border-radius:8px;font-size:13px;font-family:inherit;outline:none">
      <option value="all">All items</option>
      <option value="no-target">No chef target</option>
      <option value="has-target">Has chef target</option>
      <option value="no-station">No station</option>
    </select>
    <button type="button" onclick="exportChefTargets()" style="padding:6px 14px;background:#2d3448;border:1px solid #3d4458;color:#e8eaed;border-radius:8px;font-size:13px;cursor:pointer">Export chef targets</button>
    <button type="button" id="assignRefreshBtn" onclick="refreshAssignmentFromToast()" style="padding:6px 14px;background:#1e3a2f;border:1px solid #2d6a4f;color:#86efac;border-radius:8px;font-size:13px;cursor:pointer" title="Scrapes Toast prep stations + rebuilds assignment map for this venue">↻ Refresh from Toast</button>
    <span id="assignCount" style="font-size:12px;color:#9aa0aa"></span>
    <span id="assignSaveStatus" style="font-size:12px;color:#22c55e"></span>
  </div>
  <div style="overflow-x:auto">
    <table id="assignTable" style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#1e2533;text-align:left">
          <th style="padding:8px 10px;color:#9aa0aa;font-weight:600;white-space:nowrap">Station</th>
          <th style="padding:8px 10px;color:#9aa0aa;font-weight:600">Menu Item</th>
          <th style="padding:8px 10px;color:#9aa0aa;font-weight:600;text-align:right;white-space:nowrap">Target (min)</th>
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

<!-- ========== TAB 4: GROUP / RDG PORTFOLIO ========== -->
<section id="tab-group" class="tab-section">
<div id="portfolioTopChrome" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:4px">
  <div>
    <div class="section-title" id="groupTitle" style="margin:0">RDG Portfolio — ${rollingWeeks[rollingWeeks.length-1].label} Performance</div>
    <p class="note" id="groupSubtitle" style="margin:6px 0 0">All RDG food venues including Claudie. Main KPIs: <strong>avg fulfillment</strong> and <strong>items / person</strong>. Claudie staffing cells stay empty until FTE×labor join is available.</p>
  </div>
  <button type="button" id="portfolioPdfBtn" onclick="exportPortfolioPdf()" style="padding:8px 14px;border-radius:8px;border:1px solid #d9a441;background:#262a33;color:#e8eaed;cursor:pointer;font-size:13px;font-family:inherit;white-space:nowrap">📄 Export PDF</button>
</div>
<div id="portfolioPrintRoot">
<div class="card portfolio-print-card" id="portfolioCardScoreboard" style="margin-bottom:16px">
  <h2>Portfolio Scoreboard</h2>
  <p class="note">Location vs location — fulfillment speed and items handled per person.</p>
  <div id="groupPortfolioTable" style="overflow-x:auto"></div>
</div>
<div class="card portfolio-print-card" id="portfolioCardStations" style="margin-top:16px">
  <h2>Stations Comparison across RDG</h2>
  <p class="note">Same station family: avg fulfillment vs items / person. This is how we assess performance location vs location.</p>
  <div id="groupFamilyTable" style="overflow-x:auto"></div>
</div>
<div class="card portfolio-print-card" id="portfolioCardAlike" style="margin-top:16px">
  <h2>Items Top 10 Variance — like-to-like (food only)</h2>
  <p class="note">Food dishes only. Cross-venue matches after stripping location prefixes (e.g. <strong>CL-Tenderloin</strong> ↔ <strong>C-Tenderloin</strong>). Ranked by fulfillment spread.</p>
  <div id="groupItemVarianceAlikeTable" style="overflow-x:auto"></div>
</div>
<div class="card portfolio-print-card" id="portfolioCardTarget" style="margin-top:16px">
  <h2>Items Top 10 Variance — with Target (food only)</h2>
  <p class="note">Food dishes only — spirits, wine, cocktails, and coffee/tea are excluded. Highest fulfillment spread where a <strong>target</strong> exists. Matches exact names and like-to-like prefixes (CL-… / C-… / ACG-…).</p>
  <div id="groupItemVarianceTargetTable" style="overflow-x:auto"></div>
</div>
</div>
</section>

<!-- ========== TAB: SETTINGS / SANITY ========== -->
<section id="tab-settings" class="tab-section">
<div class="section-title">Settings — Pipeline Health</div>
<div id="settingsHealthRoot"></div>
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

// Replace Stations-tab placeholder with week-over-week fulfillment table
html = html.replace(
  `<div class="card">
  <h2>Station Performance — Actual vs Target</h2>
  <p class="note">Sorted by avg fulfillment descending. Grey tick = target. Food stations only.</p>
  <canvas id="cStations" style="max-height:420px"></canvas>
  <div class="legend">
    <span><span class="sw" style="background:#22c55e"></span>On target</span>
    <span><span class="sw" style="background:#f59e0b"></span>Up to +15% over</span>
    <span><span class="sw" style="background:#ef4444"></span>&gt;+15% over</span>
    <span><span class="sw" style="background:#5aa9e6"></span>No target</span>
  </div>
</div>
<div class="coming-note">📊 3-week trend comparison — coming when Week 2 data is available</div>

</section>`,
  `<div class="card">
  <h2>Station Performance — Actual vs Target</h2>
  <p class="note">Sorted by avg fulfillment descending. Grey tick = target. Food stations only.</p>
  <canvas id="cStations" style="max-height:420px"></canvas>
  <div class="legend">
    <span><span class="sw" style="background:#22c55e"></span>On target</span>
    <span><span class="sw" style="background:#f59e0b"></span>Up to +15% over</span>
    <span><span class="sw" style="background:#ef4444"></span>&gt;+15% over</span>
    <span><span class="sw" style="background:#5aa9e6"></span>No target</span>
  </div>
</div>
<div class="card" id="stationWowCard" style="margin-top:18px">
  <h2>Station Fulfillment — Week over Week</h2>
  <p class="note">This location only. Avg fulfillment (minutes) for every food station across stored weeks. Green ≤10 · amber 10–15 · red &gt;15. Blank = station not present that week. Values come from each weekly save — no extra scrape needed.</p>
  <div id="stationWowTable" style="overflow-x:auto"></div>
</div>

</section>`
);

// Add page summary paragraph after KPI row
html = html.replace(
  '</div>\n\n<!-- Visual 1 -->',
  '</div>\n<p id="pageSummary" style="color:#9aa0aa;font-size:13px;margin:12px 0 0;line-height:1.6;max-width:780px"></p>\n\n<!-- Visual 1 -->'
);

// Insert staffing table + Visual 1B (1-min service break) after Visual 1
html = html.replace(
  '<!-- Visual 2+3 -->',
  `<!-- Overview: Staffing Performance (per location) — primary staffing view -->
<div class="card" id="overviewStaffingCard" style="display:none;margin-bottom:14px">
  <h2>Staffing Performance by Station Family</h2>
  <p class="note">Per location. Volume = food item quantity. Main readouts: <strong style="color:#d9a441">items / person</strong> and <strong>fulfillment</strong>.</p>
  <div id="overviewStaffingGrid" style="overflow-x:auto"></div>
  <p id="overviewStaffingNote" style="font-size:11px;color:#9aa0aa;margin:8px 0 0"></p>
</div>

<!-- Service Break Timeline (1-min) -->
<div class="card" id="serviceBreakCard">
  <h2>Visual 1B — Service Break Timeline (1-min)</h2>
  <p class="note">X-axis = clock time (1-minute steps). Blue bars = <strong>concurrent tickets open</strong> in the kitchen. Gold line = <strong>avg fulfillment of those open tickets</strong>. Red band / markers = minutes where open-ticket avg &gt; 15 min. This is the live pressure view — different from Breaking Point (which is a capacity curve, not a clock).</p>
  <div id="serviceBreakDayPills" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>
  <canvas id="cServiceBreak" style="max-height:420px"></canvas>
  <div class="legend">
    <span><span class="sw" style="background:#5aa9e6"></span>Concurrent tickets open</span>
    <span><span class="sw" style="background:#d9a441"></span>Avg fulfillment of open tickets (min)</span>
    <span><span class="sw" style="background:#e2706a"></span>Over 15 min (break)</span>
  </div>
  <div class="annotation-box" id="serviceBreakNote">Select a day to see minute-by-minute kitchen pressure.</div>
</div>

<!-- Visual 2+3 -->`
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
/* Portfolio PDF prep (also used while measuring before print) + print output */
body.printing-portfolio header,
body.printing-portfolio .tab-nav,
body.printing-portfolio #venuePills,
body.printing-portfolio #weekSelector,
body.printing-portfolio #portfolioTopChrome,
body.printing-portfolio footer,
body.printing-portfolio #weekWelcomePopup,
body.printing-portfolio #assignmentHelperBanner,
body.printing-portfolio .coming-note,
body.printing-portfolio #portfolioPdfBtn {
  display:none !important;
}
body.printing-portfolio .wrap { max-width:none !important; padding:0 !important; margin:0 !important; width:100% !important; }
body.printing-portfolio .tab-section { display:none !important; }
body.printing-portfolio #tab-group.tab-section,
body.printing-portfolio #tab-group.tab-section.active { display:block !important; margin:0 !important; padding:0 !important; }
body.printing-portfolio #portfolioPrintRoot {
  display:flex !important;
  flex-direction:column;
  gap:6px;
  width:fit-content !important;
  max-width:100% !important;
  margin:0 auto !important;
  transform:scale(var(--print-scale, 1));
  transform-origin:top center;
}
body.printing-portfolio #portfolioCardScoreboard,
body.printing-portfolio #portfolioCardStations,
body.printing-portfolio #portfolioCardAlike,
body.printing-portfolio #portfolioCardTarget { width:100%; }
body.printing-portfolio #portfolioPrintRoot .card {
  background:#181b22 !important;
  border:1px solid #262a33 !important;
  border-radius:6px !important;
  padding:5px 7px !important;
  margin:0 !important;
  box-shadow:none !important;
}
body.printing-portfolio #portfolioPrintRoot .card h2 { font-size:10px !important; margin:0 0 2px !important; color:#e8eaed !important; }
body.printing-portfolio #portfolioPrintRoot .card p.note,
body.printing-portfolio #portfolioPrintRoot .card > p { display:none !important; }
body.printing-portfolio #portfolioPrintRoot table { width:100% !important; font-size:7px !important; border-collapse:collapse !important; }
body.printing-portfolio #portfolioPrintRoot th,
body.printing-portfolio #portfolioPrintRoot td { padding:1px 3px !important; line-height:1.2 !important; }
body.printing-portfolio #portfolioPrintRoot td div { display:none !important; } /* hide alias sub-lines */
body.printing-portfolio #portfolioPrintRoot [style*="overflow"] { overflow:visible !important; }
body.printing-portfolio #portfolioPrintRoot .portfolio-print-empty { display:none !important; }

@media print {
  @page { size: landscape; margin: 4mm; }
  html, body {
    background:#0d1117 !important;
    color:#e8eaed !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    width:100% !important;
    height:auto !important;
    margin:0 !important;
    padding:0 !important;
  }
  body.printing-portfolio #portfolioPrintRoot .card {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
</style>`);

// ── Build ALL_DATA JS string ──────────────────────────────────────────────────
const allDataJS = `const ALL_DATA = ${JSON.stringify(VENUES, null, 0)};
const ITEM_TARGETS_DATA = ${JSON.stringify(ITEM_TARGETS, null, 0)};
const ITEM_STATION_MAP_DATA = ${JSON.stringify(ITEM_STATION_MAP, null, 0)};
const CHEF_TARGET_OVERRIDES = ${JSON.stringify(CHEF_TARGET_OVERRIDES, null, 0)};
const PIPELINE_HEALTH_DATA = ${JSON.stringify(PIPELINE_HEALTH, null, 0)};`;

// ── Generate the new <script> block ──────────────────────────────────────────
const newScript = `
<script>
// ============================================================
// MULTI-VENUE DATA
// ============================================================
${allDataJS}

const WEEKS = ${JSON.stringify(rollingWeeks)};
const FB_BOH_DB = 'https://rdg-dj-dashboard-default-rtdb.firebaseio.com';
let BOH_CLOUD_STATUS = null; // /rdg/scrapeStatus/bohWeekly
let BOH_CLOUD_META = null;   // /rdg/boh/meta
// Always open on the chronologically latest week
let currentWeekIdx = (() => {
  let best = 0;
  for (let i = 1; i < WEEKS.length; i++) {
    if (String(WEEKS[i].key) > String(WEEKS[best].key)) best = i;
  }
  return WEEKS.length ? best : 0;
})();
let currentVenue = 'claudie';
function ensureServiceThroughput(data) {
  if (!data || !data.staffing || !data.staffing.byFamily) return data || {};
  const staffing = data.staffing;
  const familyHours = {};
  Object.entries(staffing.toastStationFamily || {}).forEach(([station, family]) => {
    const detail = data.stationDetails && data.stationDetails[station];
    if (!detail || !detail.byDayHour) return;
    if (!familyHours[family]) familyHours[family] = {};
    Object.entries(detail.byDayHour).forEach(([day, hours]) => {
      if (!familyHours[family][day]) familyHours[family][day] = new Set();
      Object.entries(hours || {}).forEach(([hourKey, cell]) => {
        if ((cell.count || 0) > 0) familyHours[family][day].add(hourKey);
      });
    });
  });
  Object.entries(staffing.byFamily).forEach(([family, fam]) => {
    let weekVolume = 0;
    let weekServiceHours = 0;
    Object.entries(fam.days || {}).forEach(([day, cell]) => {
      const derivedHours = familyHours[family] && familyHours[family][day]
        ? familyHours[family][day].size
        : 0;
      if (!(cell.serviceHours > 0)) cell.serviceHours = derivedHours;
      const volume = cell.volume != null ? cell.volume : (cell.itemCount || 0);
      cell.itemsPerServiceHour = cell.serviceHours > 0
        ? +(volume / cell.serviceHours).toFixed(2)
        : null;
      weekVolume += volume || 0;
      weekServiceHours += cell.serviceHours || 0;
    });
    fam.weekServiceHours = weekServiceHours;
    fam.weekItemsPerServiceHour = weekServiceHours > 0
      ? +(weekVolume / weekServiceHours).toFixed(2)
      : null;
  });
  return data;
}
function getD() {
  const weekKey = WEEKS[currentWeekIdx]?.key;
  return ensureServiceThroughput(
    ALL_DATA[currentVenue]?.[weekKey] || ALL_DATA[currentVenue]?.['latest'] || {}
  );
}

function weekShortLabel(weekKey) {
  const s = String(weekKey || '');
  const i = s.lastIndexOf('W');
  return i >= 0 ? s.slice(i) : s;
}

function ensureWeekInList(weekKey) {
  if (!weekKey) return;
  if (WEEKS.some(w => w.key === weekKey)) return;
  WEEKS.push({ label: weekShortLabel(weekKey), key: weekKey });
  WEEKS.sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

async function fbGetJson(path) {
  const url = FB_BOH_DB + path + '.json';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Firebase GET ' + path + ' HTTP ' + res.status);
  return res.json();
}

/** Prefer Firebase live weeks, but never clobber richer embedded Pages data. */
function weekPayloadRichness(d) {
  if (!d || typeof d !== 'object') return 0;
  let score = 0;
  if (d.staffing && d.staffing.byFamily) score += 200 + Object.keys(d.staffing.byFamily).length * 10;
  if (d.serviceBreakTimeline && d.serviceBreakTimeline.byDay) score += 40;
  if (Array.isArray(d.stations) && d.stations.length) score += Math.min(d.stations.length, 40);
  if (Array.isArray(d.summary) && d.summary.length) score += Math.min(d.summary.length, 40);
  if (d.stationDayVolume && typeof d.stationDayVolume === 'object') score += 25;
  if (Array.isArray(d.assignmentData) && d.assignmentData.length) score += 15;
  if (d.guestsSeated && d.guestsSeated.total != null) score += 10;
  if (Array.isArray(d.hourProfile) && d.hourProfile.length) score += 5;
  if (Array.isArray(d.curve) && d.curve.length) score += 5;
  return score;
}
function weekPayloadBuiltAtMs(d) {
  const t = d && (d.staffing && d.staffing.builtAt || d.builtAt || d.generatedAt || d.processedAt);
  if (!t) return 0;
  const ms = Date.parse(t);
  return isFinite(ms) ? ms : 0;
}
function mergeBohWeekPayload(local, cloud) {
  if (!cloud || typeof cloud !== 'object') return local || cloud;
  if (!local || typeof local !== 'object') return cloud;
  const localScore = weekPayloadRichness(local);
  const cloudScore = weekPayloadRichness(cloud);
  const localTs = weekPayloadBuiltAtMs(local);
  const cloudTs = weekPayloadBuiltAtMs(cloud);
  // Embedded Pages payload is richer, or equally rich but fresher → keep local
  // (prevents stale Firebase wiping staffing / −5s metrics / day volumes)
  if (localScore > cloudScore || (localScore === cloudScore && localTs > cloudTs)) {
    return Object.assign({}, cloud, local);
  }
  const out = Object.assign({}, local, cloud);
  // Field-level: never drop local staffing / timeline when cloud is thinner or older
  const localFam = local.staffing && local.staffing.byFamily ? Object.keys(local.staffing.byFamily).length : 0;
  const cloudFam = cloud.staffing && cloud.staffing.byFamily ? Object.keys(cloud.staffing.byFamily).length : 0;
  const localStaffTs = weekPayloadBuiltAtMs({ staffing: local.staffing }) || localTs;
  const cloudStaffTs = weekPayloadBuiltAtMs({ staffing: cloud.staffing }) || cloudTs;
  if (local.staffing && (!cloud.staffing || localFam > cloudFam || (localFam === cloudFam && localStaffTs > cloudStaffTs))) {
    out.staffing = local.staffing;
  }
  if (local.serviceBreakTimeline && !cloud.serviceBreakTimeline) {
    out.serviceBreakTimeline = local.serviceBreakTimeline;
  }
  // Keep non-empty local analytics when cloud omitted them (partial Firebase writes)
  ['stations','summary','stationDetails','stationDayVolume','assignmentData','curve','curveByDay','hourProfile','guestsSeated','hmFul','hmGuests','tbk','breakingPoint','breakingPointGuests'].forEach(function(k) {
    const lv = local[k];
    const cv = cloud[k];
    const localOk = lv != null && !(Array.isArray(lv) && lv.length === 0) && !(typeof lv === 'object' && !Array.isArray(lv) && !Object.keys(lv).length);
    const cloudEmpty = cv == null || (Array.isArray(cv) && cv.length === 0) || (typeof cv === 'object' && !Array.isArray(cv) && !Object.keys(cv).length);
    if (localOk && cloudEmpty) out[k] = lv;
  });
  return out;
}
async function loadBohFromFirebase() {
  try {
    const meta = await fbGetJson('/rdg/boh/meta');
    if (!meta || !meta.latestWeek) return false;
    BOH_CLOUD_META = meta;
    const venues = meta.venues || ['claudie', 'casaneos', 'ava_cg', 'ava_wp', 'mila'];
    const weekKey = meta.latestWeek;
    ensureWeekInList(weekKey);
    (meta.weeks || []).forEach(ensureWeekInList);

    const weekKeys = new Set(meta.weeks || [weekKey]);
    WEEKS.forEach(w => weekKeys.add(w.key));

    for (const wk of weekKeys) {
      for (const venueKey of venues) {
        try {
          const data = await fbGetJson('/rdg/boh/weeks/' + encodeURIComponent(wk) + '/' + encodeURIComponent(venueKey));
          if (!data || typeof data !== 'object') continue;
          if (!ALL_DATA[venueKey]) ALL_DATA[venueKey] = {};
          const prev = ALL_DATA[venueKey][wk];
          ALL_DATA[venueKey][wk] = mergeBohWeekPayload(prev, data);
          ensureWeekInList(wk);
        } catch (e) { /* week/venue may not exist yet */ }
      }
    }

    let best = 0;
    for (let i = 1; i < WEEKS.length; i++) {
      if (String(WEEKS[i].key) > String(WEEKS[best].key)) best = i;
    }
    currentWeekIdx = best;
    const dd = document.getElementById('weekDropdown');
    if (dd) {
      dd.innerHTML = WEEKS.map((w, i) =>
        '<option value="' + i + '"' + (i === currentWeekIdx ? ' selected' : '') + '>' + w.label + '</option>'
      ).join('');
    }
    const badge = document.getElementById('dashBadge');
    if (badge && meta.updatedAt) {
      badge.textContent = 'Latest ' + weekKey + ' · Cloud ' + new Date(meta.updatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    }
    try { BOH_CLOUD_STATUS = await fbGetJson('/rdg/scrapeStatus/bohWeekly'); } catch (e) { BOH_CLOUD_STATUS = null; }
    return true;
  } catch (e) {
    console.warn('BOH Firebase live load skipped:', e.message || e);
    try { BOH_CLOUD_STATUS = await fbGetJson('/rdg/scrapeStatus/bohWeekly'); } catch (_) {}
    return false;
  }
}

// ============================================================
// FOOD STATION FILTER
// ============================================================
const FOOD_EXCL_PATTERNS = ['bar','champagne','wine','btg','pos','barista','somm','water','service','beach','btl inside','btl outside'];
function isFoodStation(name) {
  const n = name.toLowerCase();
  return !FOOD_EXCL_PATTERNS.some(p => n.includes(p));
}
/** Portfolio / menu: drop beverages, bar noise, and absurd cook times */
const PORTFOLIO_BEV_KEYWORDS = [
  'evian','pellegrino','perrier','water','coke','coca','diet','sprite','soda','juice','lemonade','iced tea','ginger ale','still','sparkling',
  'beer','kronenbourg','heineken','stella','bud','corona','draft',
  'wine','champagne','prosecco','sancerre','pinot','chardonnay','bordeaux','burgundy','rosé','rose','chablis','malbec','cabernet','merlot','syrah','shiraz','riesling','sauvignon',
  'vodka','gin','rum','tequila','whiskey','whisky','bourbon','scotch','mezcal','cognac','armagnac','brandy','port','sherry','vermouth','liqueur','aperitif',
  'reposado','anejo','blanco','vsop','xo',
  'martini','negroni','cocktail','spritz','aperol','campari','margarita','mimosa','bloody mary','daiquiri','hemingway','old fashioned','moscow mule','french 75','pisco','pornstar','paper plane',
  'laphroaig','oban','remy','hennessy','macallan','glenlivet','glenfiddich','balvenie','jameson','johnnie','walker','beefeater','tanqueray','bombay','hendrick',
  'grey goose','ketel','absolut','belvedere','tito','patron','don julio','casamigos','bacardi','havana','plantaray','maestro dobel','santa teresa','st germain','st. germain','chartreuse','frangelico','sambuca','limoncello','amaretto',
  'maker','woodford','basil hayden','buffalo trace','hibiki','monkey 47','sipsmith',"angel's",'envy','envye',
  'espresso','coffee','latte','cappuccino','cappuc','macchiato','cortadito','carajillo','tea','barista','americano','earl grey',
  'paloma','tonic','gl ','benoit','chauveau','et fill','paris for you','by day','by night',
  'deposit','beo','package','gift card','gratuity','comp ','void','all in ',
];
function isPortfolioBeverageName(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return true;
  if (PORTFOLIO_BEV_KEYWORDS.some(kw => n.includes(kw))) return true;
  // Spirit age tags: "10yr", "14 yr", "12-year"
  if (/\\b\\d{1,2}\\s*-?\\s*(yr|year)s?\\b/i.test(n)) return true;
  return false;
}
function isPortfolioFoodItem(name, stations, avgSec) {
  if (isPortfolioBeverageName(name)) return false;
  if (avgSec != null && (avgSec <= 0 || avgSec > 90 * 60)) return false; // drop absurd / unclosed times
  const foodSt = (stations || []).filter(isFoodStation);
  // Prefer mapped food stations; if no station info, still allow non-beverage names
  if (stations && stations.length && !foodSt.length) return false;
  return true;
}

// Static REF assignment helpers (authoritative item → stations + target)
function venueSlugForMap() {
  const map = { claudie:'claudie', casaneos:'casa_neos', ava_cg:'ava_cg', ava_wp:'ava_wp', mila:'mila' };
  return map[currentVenue] || currentVenue;
}
function chefStorageKey() {
  return 'bohChefTargets_' + venueSlugForMap();
}
function loadChefLocal() {
  try { return JSON.parse(localStorage.getItem(chefStorageKey()) || '{}'); } catch { return {}; }
}
function getEffectiveTargetSec(menuItem, refSec) {
  const local = loadChefLocal();
  if (local[menuItem] != null && local[menuItem] > 0) return local[menuItem];
  const embedded = (CHEF_TARGET_OVERRIDES[venueSlugForMap()] || {})[menuItem];
  if (embedded > 0) return embedded;
  return refSec || 0;
}
function getStaticItemMap() {
  let base = ITEM_STATION_MAP_DATA[venueSlugForMap()] || {};
  // MILA (and any venue with empty REF map): fall back to live assignmentData so Assignment tab works
  if (!Object.keys(base).length) {
    const live = {};
    (getD().assignmentData || []).forEach(d => {
      if (!d.menuItem || !d.station) return;
      if (!live[d.menuItem]) {
        live[d.menuItem] = {
          stations: [d.station],
          targetSec: d.targetSec || 0,
          source: 'assignmentData',
        };
      } else if (d.station && !live[d.menuItem].stations.includes(d.station)) {
        live[d.menuItem].stations.push(d.station);
      }
    });
    base = live;
  }
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = { ...v, targetSec: getEffectiveTargetSec(k, v.targetSec || 0) };
  }
  return out;
}
function stationNamesMatch(a, b) {
  const na = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nb = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}
/** Prefer Toast item-fulfillment avg (assignmentData); fall back to summary. */
function getItemLiveByName() {
  const byName = {};
  (getD().summary || []).forEach(d => {
    const name = d.menuItem || d.item;
    if (!name) return;
    byName[name] = {
      qty: d.qty != null ? d.qty : (d.count || 0),
      avgFulSec: d.avgFulSec != null ? d.avgFulSec : (d.avg_sec || null),
    };
  });
  // assignmentData.avgFulSec is from custom item-fulfillment report — preferred Avg Time
  (getD().assignmentData || []).forEach(d => {
    if (!d.menuItem) return;
    const prev = byName[d.menuItem] || { qty: 0, avgFulSec: null };
    byName[d.menuItem] = {
      qty: prev.qty || d.count || 0,
      avgFulSec: d.avgFulSec != null ? d.avgFulSec : prev.avgFulSec,
    };
  });
  return byName;
}
/** Items for a station — ONLY from static REF map. Avg Time from item-fulfillment. */
function getStaticItemsForStation(stationName) {
  const map = getStaticItemMap();
  const liveByName = getItemLiveByName();
  const out = [];
  Object.entries(map).forEach(([menuItem, info]) => {
    const stations = info.stations || [];
    if (!stations.some(st => stationNamesMatch(st, stationName))) return;
    const live = liveByName[menuItem] || {};
    out.push({
      menuItem,
      qty: live.qty || 0,
      avgFulSec: live.avgFulSec || 0,
      targetSec: info.targetSec || 0,
    });
  });
  return out.sort((a, b) => (b.qty || 0) - (a.qty || 0) || a.menuItem.localeCompare(b.menuItem));
}

/**
 * Derive each station target from the targets of its assigned items.
 * Target = sum(item target × weekly item quantity) / sum(weekly item quantity).
 * Untargeted items are excluded. Without weekly volume, use the simple average.
 */
function applyDerivedStationTargets() {
  const data = getD();
  const itemMap = getStaticItemMap();
  const volumeByItem = {};
  (data.summary || []).forEach(row => {
    const name = row.menuItem || row.item;
    if (name) volumeByItem[name] = Number(row.qty != null ? row.qty : row.count) || 0;
  });

  (data.stations || []).forEach(station => {
    let weightedTarget = 0;
    let targetedVolume = 0;
    let allAssignedVolume = 0;
    const targetValues = [];

    Object.entries(itemMap).forEach(([item, info]) => {
      if (!(info.stations || []).some(s => stationNamesMatch(s, station.station))) return;
      const volume = volumeByItem[item] || 0;
      allAssignedVolume += volume;
      if (!(info.targetSec > 0)) return;
      targetValues.push(info.targetSec);
      if (volume > 0) {
        weightedTarget += info.targetSec * volume;
        targetedVolume += volume;
      }
    });

    station.exp_sec = targetedVolume > 0
      ? weightedTarget / targetedVolume
      : (targetValues.length
          ? targetValues.reduce((sum, value) => sum + value, 0) / targetValues.length
          : 0);
    station.target_source = 'assigned-items';
    station.target_coverage = allAssignedVolume > 0 ? targetedVolume / allAssignedVolume : null;

    const detail = (data.stationDetails || {})[station.station];
    if (detail) {
      Object.values(detail.hourly || {}).forEach(row => { row.exp_sec = station.exp_sec; });
      Object.values(detail.byDayHour || {}).forEach(hours => {
        Object.values(hours || {}).forEach(row => { row.exp_sec = station.exp_sec; });
      });
    }
  });
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
  const rounded = Math.round(s);
  const m = Math.floor(rounded / 60), sec = rounded % 60;
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
  const group = btn && btn.closest ? btn.closest('.hm-toggle') : null;
  if (group) group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  else document.querySelectorAll('.hm-toggle button').forEach(b => b.classList.remove('active'));
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
let pressureDay = 'Total';

function getPressureCurve(day) {
  const d = getD();
  const byDay = d.curveByDay || {};
  if (day && day !== 'Total' && byDay[day] && byDay[day].length) return byDay[day];
  if (byDay.Total && byDay.Total.length) return byDay.Total;
  return d.curve || [];
}

function computeBreakingPoint(curveOverride) {
  const curve = curveOverride || getPressureCurve('Total');
  let bpEntry = null;
  for (let i = 0; i < curve.length; i++) {
    if (i < 10) continue;
    const row = curve[i];
    if (row.occ < 5) continue;
    if (row.occ >= 3 && row.ful >= getThreshold()) { bpEntry = row; break; }
  }
  if (!bpEntry) return { tickets: null, guests: null };
  return { tickets: bpEntry.conc, guests: Math.round(bpEntry.guests) };
}

function setPressureDay(day, btn) {
  pressureDay = day || 'Total';
  const wrap = document.getElementById('pressureDayToggle');
  if (wrap) {
    wrap.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-day') === pressureDay);
    });
  } else if (btn) {
    btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  renderPressure();
}

// ============================================================
// VISUAL 1: Kitchen Pressure Curve
// ============================================================
function renderPressure() {
  const CURVE = getPressureCurve(pressureDay);
  if (!CURVE || !CURVE.length) {
    const ex = Chart.getChart('cPressure');
    if (ex) ex.destroy();
    const annEl = document.getElementById('bpAnnotation');
    if (annEl) {
      annEl.innerHTML = pressureDay === 'Total'
        ? 'No pressure-curve data for this week.'
        : 'No pressure-curve data for <strong>' + pressureDay + '</strong>.';
    }
    return;
  }
  const BP = computeBreakingPoint(CURVE).tickets;
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
  const dayLabel = pressureDay === 'Total' ? 'all days' : pressureDay;
  const annEl = document.getElementById('bpAnnotation');
  if (annEl) {
    if (BP != null) {
      annEl.innerHTML = '⚡ Breaking point at <strong>'+BP+' concurrent tickets</strong> ('+dayLabel+') — avg fulfillment jumps to '+(CURVE.find(d=>d.conc===BP)||{ful:'?'}).ful+' min.';
    } else {
      annEl.innerHTML = 'No breaking point detected for <strong>'+dayLabel+'</strong> — avg fulfillment stays below threshold across observed load levels.';
    }
  }
  const bpNote = document.getElementById('bpMethodNote');
  if (bpNote) bpNote.textContent = 'BP = first load level (skip 1–10) where avg fulfillment crosses the target · view: ' + dayLabel;
  // Page KPIs stay on week Total so day toggle only changes Visual 1
  const bpObj = computeBreakingPoint(getPressureCurve('Total'));
  const bp1 = document.getElementById('kpiBP1');
  const bp2 = document.getElementById('kpiBP2');
  if (bp1) bp1.textContent = bpObj.tickets ?? '—';
  if (bp2) bp2.textContent = bpObj.guests ?? '—';
}

// ============================================================
// VISUAL TEST: Time-of-day profile (10am → 4am)
// ============================================================
function renderHourProfile() {
  const profile = getD().hourProfile || [];
  const existing = Chart.getChart('cHourProfile');
  if (existing) existing.destroy();
  const canvas = document.getElementById('cHourProfile');
  if (!canvas) return;
  if (!profile.length) {
    const note = document.getElementById('hourProfileNote');
    if (note) note.textContent = 'No hour-profile data yet — reprocess venue week to enable.';
    return;
  }

  const labels = profile.map(p => p.label || p.hour);
  const occ = profile.map(p => p.avgOcc || 0);
  const ful = profile.map(p => p.avgFulMin);
  const thr = getThreshold();
  let peakIdx = 0;
  for (let i = 1; i < occ.length; i++) if (occ[i] > occ[peakIdx]) peakIdx = i;
  const peak = profile[peakIdx];

  const thrPlugin = {
    id: 'hourThr',
    beforeDraw(chart) {
      const { ctx, chartArea: a, scales } = chart;
      if (!a || !scales.y1) return;
      const yThr = scales.y1.getPixelForValue(thr);
      if (yThr < a.top || yThr > a.bottom) return;
      ctx.save();
      ctx.strokeStyle = '#e2706a';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.left, yThr);
      ctx.lineTo(a.right, yThr);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#e2706a';
      ctx.font = '11px sans-serif';
      ctx.fillText(thr + ' min target', a.left + 4, yThr - 4);
      ctx.restore();
    }
  };

  new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Avg occurrences / day',
          data: occ,
          backgroundColor: labels.map((_, i) => i === peakIdx ? 'rgba(226,112,106,0.7)' : 'rgba(74,159,255,0.55)'),
          borderColor: labels.map((_, i) => i === peakIdx ? '#e2706a' : '#4a9eff'),
          borderWidth: 1,
          yAxisID: 'y',
          order: 2,
          borderRadius: 2,
        },
        {
          type: 'line',
          label: 'Avg fulfillment (min)',
          data: ful,
          borderColor: '#d9a441',
          backgroundColor: 'rgba(217,164,65,0)',
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5,
          borderWidth: 2.5,
          yAxisID: 'y1',
          order: 1,
          spanGaps: true,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { title: { display: true, text: 'Hour of day (10am → 4am)' }, grid: { color: gc } },
        y: { position: 'left', title: { display: true, text: 'Avg occurrences / day' }, grid: { color: gc }, min: 0 },
        y1: { position: 'right', title: { display: true, text: 'Fulfillment time (min)' }, grid: { display: false }, min: 0, suggestedMax: 24 },
      },
      plugins: { legend: { position: 'top', labels: { boxWidth: 12 } } },
    },
    plugins: [thrPlugin],
  });

  const note = document.getElementById('hourProfileNote');
  if (note && peak) {
    const fulTxt = peak.avgFulMin != null ? peak.avgFulMin.toFixed(1) + ' min avg fulfillment' : 'no fulfillment data';
    note.innerHTML = '⚡ Peak volume at <strong>' + (peak.label || peak.hour) + '</strong> — ' +
      peak.avgOcc + ' tickets/day on average · ' + fulTxt + '.';
  }
}

// ============================================================
// Service Break Timeline (1-min concurrent open tickets + avg ful)
// ============================================================
let _serviceBreakDay = null;
function renderServiceBreakTimeline() {
  const card = document.getElementById('serviceBreakCard');
  const canvas = document.getElementById('cServiceBreak');
  const pillsEl = document.getElementById('serviceBreakDayPills');
  const note = document.getElementById('serviceBreakNote');
  const existing = Chart.getChart('cServiceBreak');
  if (existing) existing.destroy();
  if (!card || !canvas) return;

  if (currentVenue === 'rdg_portfolio') {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';

  const timeline = getD().serviceBreakTimeline;
  const byDay = timeline && timeline.byDay ? timeline.byDay : null;
  const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const days = DAY_ORDER.filter(d => byDay && byDay[d] && byDay[d].labels && byDay[d].labels.length);

  if (!days.length) {
    if (pillsEl) pillsEl.innerHTML = '';
    if (note) note.textContent = 'No 1-min break timeline yet — reprocess this venue week to enable.';
    return;
  }

  // Default = day with most broken minutes (fallback Friday / first)
  if (!_serviceBreakDay || !days.includes(_serviceBreakDay)) {
    let best = days[0];
    let bestBroken = -1;
    days.forEach(d => {
      const b = byDay[d].brokenMinutes || 0;
      if (b > bestBroken) { bestBroken = b; best = d; }
    });
    if (bestBroken <= 0 && days.includes('Friday')) best = 'Friday';
    _serviceBreakDay = best;
  }

  if (pillsEl) {
    pillsEl.innerHTML = days.map(d => {
      const broken = byDay[d].brokenMinutes || 0;
      const active = d === _serviceBreakDay;
      return '<button type="button" data-day="'+d+'" style="padding:5px 12px;border-radius:16px;cursor:pointer;font-size:12px;font-family:inherit;border:1px solid '+(active?'#d9a441':'#2d3448')+';background:'+(active?'#262a33':'#1e2533')+';color:'+(active?'#e8eaed':'#9aa0aa')+'">'+d.slice(0,3)+(broken?' · '+broken+'m':'')+'</button>';
    }).join('');
    pillsEl.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => { _serviceBreakDay = btn.dataset.day; renderServiceBreakTimeline(); };
    });
  }

  const series = byDay[_serviceBreakDay];
  const thr = (timeline && timeline.thresholdMin) || getThreshold();
  const labels = series.labels;
  const conc = series.conc;
  const ful = series.ful;
  const brokenFlags = ful.map(v => v != null && v > thr);

  // Tick every ~30–60 minutes for readability
  const step = labels.length > 600 ? 60 : 30;
  const thrPlugin = {
    id: 'svcBreakThr',
    beforeDraw(chart) {
      const { ctx, chartArea: a, scales } = chart;
      if (!a || !scales.y1 || !scales.x) return;
      ctx.save();
      for (let i = 0; i < brokenFlags.length; i++) {
        if (!brokenFlags[i]) continue;
        const x0 = scales.x.getPixelForValue(i);
        const x1 = scales.x.getPixelForValue(Math.min(i + 1, labels.length - 1));
        ctx.fillStyle = 'rgba(226,112,106,0.18)';
        ctx.fillRect(x0, a.top, Math.max(1, x1 - x0), a.bottom - a.top);
      }
      ctx.restore();
      const yThr = scales.y1.getPixelForValue(thr);
      if (yThr >= a.top && yThr <= a.bottom) {
        ctx.save();
        ctx.strokeStyle = '#e2706a';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(a.left, yThr);
        ctx.lineTo(a.right, yThr);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#e2706a';
        ctx.font = '11px sans-serif';
        ctx.fillText(thr + ' min', a.left + 4, yThr - 4);
        ctx.restore();
      }
    }
  };

  new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Concurrent tickets open',
          data: conc,
          backgroundColor: brokenFlags.map(b => b ? 'rgba(226,112,106,0.55)' : 'rgba(74,159,255,0.45)'),
          borderWidth: 0,
          yAxisID: 'y',
          order: 2,
          barPercentage: 1,
          categoryPercentage: 1,
        },
        {
          type: 'line',
          label: 'Avg fulfillment of open tickets (min)',
          data: ful,
          borderColor: '#d9a441',
          backgroundColor: 'rgba(217,164,65,0)',
          tension: 0.15,
          pointRadius: 0,
          pointHoverRadius: 3,
          borderWidth: 2,
          yAxisID: 'y1',
          order: 1,
          spanGaps: true,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          title: { display: true, text: 'Time of day (1-min)' },
          grid: { color: gc },
          ticks: {
            maxRotation: 0,
            autoSkip: false,
            callback(val, idx) {
              if (idx % step !== 0) return '';
              return labels[idx];
            },
          },
        },
        y: { position: 'left', title: { display: true, text: 'Concurrent tickets open' }, grid: { color: gc }, min: 0 },
        y1: { position: 'right', title: { display: true, text: 'Avg fulfillment (min)' }, grid: { display: false }, min: 0, suggestedMax: Math.max(22, thr + 4) },
      },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12 } },
        tooltip: {
          callbacks: {
            title(items) {
              const i = items[0] && items[0].dataIndex;
              return _serviceBreakDay + ' · ' + (labels[i] || '');
            },
            afterBody(items) {
              const i = items[0] && items[0].dataIndex;
              if (i == null) return '';
              return brokenFlags[i] ? '⚠ OVER 15 min — kitchen broken' : 'Under 15 min';
            },
          },
        },
      },
    },
    plugins: [thrPlugin],
  });

  if (note) {
    const bm = series.brokenMinutes || 0;
    const first = series.firstBreak || null;
    const peak = series.peakConcWhileBroken || 0;
    if (bm > 0) {
      note.innerHTML = '<strong>'+_serviceBreakDay+'</strong>: broke for <strong style="color:#ef4444">'+bm+' minutes</strong>' +
        (first ? ' · first break at <strong>'+first+'</strong>' : '') +
        (peak ? ' · peak concurrent while broken: <strong>'+peak+'</strong> tickets' : '') +
        '. Breaking Point capacity curve is separate (Visual 2).';
    } else {
      note.innerHTML = '<strong>'+_serviceBreakDay+'</strong>: open-ticket avg stayed ≤ '+thr+' min all service · '+
        (series.ticketCount||0)+' tickets. This chart shows minute-level spikes that hourly averages can hide.';
    }
  }
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
    const targetCoverageLabel = s.target_coverage != null ? 'Target · ' + Math.round(s.target_coverage * 100) + '% mix covered' : 'Target';
    document.getElementById('kDetail').innerHTML = '<div style="border-top:1px solid #262a33;padding-top:14px"><h2 style="font-size:15px;margin:0 0 10px">' + s.station + '</h2><div class="kpis" style="margin-bottom:0"><div class="kpi"><div class="v" style="font-size:19px">' + s.count + '</div><div class="l">Tickets</div></div><div class="kpi"><div class="v" style="font-size:19px">' + fmtSec(s.avg_sec) + '</div><div class="l">Avg time</div></div><div class="kpi"><div class="v" style="font-size:19px">' + (s.exp_sec > 0 ? fmtSec(s.exp_sec) : '—') + '</div><div class="l">' + targetCoverageLabel + '</div></div><div class="kpi"><div class="v" style="font-size:19px;color:' + sc + '">' + ratio + '</div><div class="l">' + st + '</div></div></div></div>';
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
  const weeks = WEEKS.slice().sort((a, b) => String(a.key).localeCompare(String(b.key)));
  const numWeeks = weeks.length;

  // Sort worst -> best by current week avg_sec desc
  const sorted = [...STATIONS].sort((a,b) => b.avg_sec - a.avg_sec);
  const labels = sorted.map(s => s.station);

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

  const palette = ['#22c55e','#5aa9e6','#d9a441','#a78bfa','#f472b6','#38bdf8'];
  const datasets = weeks.map((w, wi) => {
    const data = sorted.map(s => {
      const st = (ALL_DATA[currentVenue]?.[w.key]?.stations || []).find(x => x.station === s.station);
      return st && st.avg_sec > 0 ? +(st.avg_sec / 60).toFixed(2) : null;
    });
    const isCurrent = wi === weeks.findIndex(x => x.key === WEEKS[currentWeekIdx]?.key);
    return {
      label: w.label,
      data,
      backgroundColor: isCurrent ? data.map(v => v == null ? '#2d3448' : (v >= 15 ? '#ef4444' : v >= 10 ? '#f59e0b' : '#22c55e')) : (palette[wi % palette.length] + '99'),
      borderColor: isCurrent ? data.map(v => v == null ? '#2d3448' : (v >= 15 ? '#ef4444' : v >= 10 ? '#f59e0b' : '#22c55e')) : palette[wi % palette.length],
      borderWidth: isCurrent ? 1.5 : 1,
      borderRadius: 3
    };
  });

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
            if (ctx.parsed.x == null) return ctx.dataset.label + ': —';
            return ctx.dataset.label + ': ' + ctx.parsed.x.toFixed(1) + ' min';
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
  if (wowSubEl) wowSubEl.textContent = 'Grouped bars = weeks. Current week colored by ful band. Sorted by current week — worst at top.';
}

// ============================================================
// Station Breaking Lines — removed from UI
// ============================================================
function sbToggleAllLines() { /* no-op */ }
function renderStationBreaking() { /* no-op: canvas removed */ }



// ============================================================
// TAB 2: Station Selector & Detail
// ============================================================
function signalColor(code) {
  if (code === 'understaffed_pressure') return '#ef4444';
  if (code === 'overstaffed_slack') return '#38bdf8';
  if (code === 'process_issue') return '#f59e0b';
  if (code === 'efficient_busy') return '#22c55e';
  if (code === 'in_band') return '#a3e635';
  return '#9aa0aa';
}
function fmtFulMin(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  return (sec / 60).toFixed(1) + 'm';
}
function buildStaffingTableHtml(staffing, guests) {
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const FOOD_FAMILIES = ['Saute','Fry','Garde Manger','Raw','Sushi','Robata','Pastry','Expo','Pizza','Prep'];
  const families = FOOD_FAMILIES.filter(f => staffing.byFamily[f]);
  if (!families.length) {
    return { html: '<p style="color:#9aa0aa;font-size:13px">No BOH station-family staffing for this week.</p>', note: '' };
  }
  let html = '';
  if (guests && guests.total != null) {
    html += '<div style="font-size:12px;color:#9aa0aa;margin-bottom:10px">Guests seated this week: <strong style="color:#e8eaed">'+(guests.total||0).toLocaleString()+'</strong></div>';
  }
  html += '<table style="border-collapse:collapse;font-size:12px;min-width:920px;width:100%">';
  html += '<thead><tr>'+
    '<th style="text-align:left;padding:8px;color:#9aa0aa;background:#1e2533">Family</th>'+
    '<th style="padding:8px;color:#9aa0aa;background:#1e2533;text-align:center">Week ful</th>'+
    '<th style="padding:8px;color:#d9a441;background:#1e2533;text-align:center">Week items/person</th>';
  DAYS.forEach(d => { html += '<th style="padding:8px;color:#9aa0aa;background:#1e2533;text-align:center">'+d.slice(0,3)+'</th>'; });
  html += '</tr></thead><tbody>';
  families.forEach(f => {
    const fam = staffing.byFamily[f];
    html += '<tr style="border-top:1px solid #262a33"><td style="padding:10px 8px;color:#e8eaed;font-weight:700;white-space:nowrap;vertical-align:top">'+f+
      '<div style="font-size:10px;color:#9aa0aa;font-weight:400;margin-top:2px">'+fam.weekHeadsUnique+' worked · roster '+fam.rosterCount+'</div></td>';
    html += '<td style="padding:10px 8px;text-align:center;vertical-align:top;font-size:16px;font-weight:700;color:#e8eaed">'+(fam.weekAvgFulSec!=null?fmtFulMin(fam.weekAvgFulSec):'—')+'</td>';
    html += '<td style="padding:10px 8px;text-align:center;vertical-align:top;font-size:18px;font-weight:700;color:#d9a441">'+(fam.weekItemsPerHeadDay!=null?fam.weekItemsPerHeadDay:'—')+'</td>';
    DAYS.forEach(day => {
      const c = fam.days[day] || {};
      const tip = [
        (c.heads||0)+' staff',
        (c.hours||0)+' labor hours',
        'volume '+(c.volume!=null?c.volume:(c.itemCount||0))+' items'+(c.volumeSource==='ticketCount'?' (ticket fallback)':''),
        'items/person '+(c.itemsPerHead!=null?c.itemsPerHead:'—'),
        'ful '+fmtFulMin(c.avgFulSec)
      ].join(' · ');
      html += '<td title="'+tip.replace(/"/g,'&quot;')+'" style="padding:8px 6px;text-align:center;vertical-align:top;background:#13161c">'+
        '<div style="font-size:11px;color:#9aa0aa">'+(c.heads||0)+' staff</div>'+
        '<div style="font-size:15px;font-weight:700;color:#d9a441;line-height:1.3;margin:2px 0">'+(c.itemsPerHead!=null?c.itemsPerHead:'—')+'<span style="font-size:10px;font-weight:500">/p</span></div>'+
        '<div style="font-size:12px;font-weight:600;color:#e8eaed">'+fmtFulMin(c.avgFulSec)+'</div>'+
        '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  const ms = staffing.matchStats;
  const note = ms
    ? 'Food families only · closed food tickets · matched '+ms.laborShiftsMatched+' labor days · unmatched '+ms.laborShiftsUnmatched
    : 'Food families only · closed food tickets';
  return { html, note };
}
function renderStaffingGrid() {
  const card = document.getElementById('staffingCard');
  const grid = document.getElementById('staffingGrid');
  const matchNote = document.getElementById('staffingMatchNote');
  const ovCard = document.getElementById('overviewStaffingCard');
  const ovGrid = document.getElementById('overviewStaffingGrid');
  const ovNote = document.getElementById('overviewStaffingNote');

  if (currentVenue === 'rdg_portfolio') {
    if (card) card.style.display = 'none';
    if (ovCard) ovCard.style.display = 'none';
    return;
  }
  const staffing = getD().staffing;
  if (!staffing || !staffing.byFamily) {
    if (card) card.style.display = 'none';
    if (ovCard) ovCard.style.display = 'none';
    return;
  }
  const guests = staffing.guestsSeated || getD().guestsSeated;
  const built = buildStaffingTableHtml(staffing, guests);
  if (card && grid) {
    card.style.display = '';
    grid.innerHTML = built.html;
    if (matchNote) matchNote.textContent = built.note;
  }
  if (ovCard && ovGrid) {
    ovCard.style.display = '';
    ovGrid.innerHTML = built.html;
    if (ovNote) ovNote.textContent = built.note;
  }
}

function renderStations() {
  renderStaffingGrid();
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

  // ── Sparkline SVG from multi-week station avg ──
  function makeSparkline(stationName) {
    const weeks = WEEKS.slice().sort((a, b) => String(a.key).localeCompare(String(b.key)));
    const vals = weeks.map(w => {
      const st = (ALL_DATA[currentVenue]?.[w.key]?.stations || []).find(s => s.station === stationName);
      return st && st.avg_sec > 0 ? st.avg_sec / 60 : null;
    });
    const W = 48, H = 16;
    const present = vals.filter(v => v != null);
    if (!present.length) {
      return '<svg class="sparkline-svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'"></svg>';
    }
    if (present.length === 1) {
      const v = present[0];
      const col = avgFulColorByMin(v);
      return '<svg class="sparkline-svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'
        + '<circle cx="'+(W/2)+'" cy="'+(H/2)+'" r="3" fill="'+col+'"/>'
        + '</svg>';
    }
    const minV = Math.min(...present), maxV = Math.max(...present);
    const span = Math.max(0.5, maxV - minV);
    const pts = [];
    vals.forEach((v, i) => {
      if (v == null) return;
      const x = 3 + (i / Math.max(1, vals.length - 1)) * (W - 6);
      const y = H - 3 - ((v - minV) / span) * (H - 6);
      pts.push({ x, y, v });
    });
    const path = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    return '<svg class="sparkline-svg" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'
      + '<path d="'+path+'" fill="none" stroke="#5aa9e6" stroke-width="1.5"/>'
      + '<circle cx="'+last.x.toFixed(1)+'" cy="'+last.y.toFixed(1)+'" r="2.5" fill="'+avgFulColorByMin(last.v)+'"/>'
      + '</svg>';
  }

  // ── Trend arrow from last two weeks ──
  function trendArrow(stationName) {
    const weeks = WEEKS.slice().sort((a, b) => String(a.key).localeCompare(String(b.key)));
    if (weeks.length < 2) return '<span style="color:#9aa0aa;font-size:11px">→</span>';
    const a = weeks[weeks.length - 2], b = weeks[weeks.length - 1];
    const sa = (ALL_DATA[currentVenue]?.[a.key]?.stations || []).find(s => s.station === stationName);
    const sb = (ALL_DATA[currentVenue]?.[b.key]?.stations || []).find(s => s.station === stationName);
    if (!sa || !sb || !(sa.avg_sec > 0) || !(sb.avg_sec > 0)) return '<span style="color:#9aa0aa;font-size:11px">→</span>';
    const dMin = (sb.avg_sec - sa.avg_sec) / 60;
    if (Math.abs(dMin) < 0.3) return '<span style="color:#9aa0aa;font-size:11px" title="flat vs prior week">→</span>';
    if (dMin < 0) return '<span style="color:#22c55e;font-size:11px" title="faster vs prior week">↓ '+Math.abs(dMin).toFixed(1)+'m</span>';
    return '<span style="color:#ef4444;font-size:11px" title="slower vs prior week">↑ '+dMin.toFixed(1)+'m</span>';
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
    // ONLY items from static REF assignment for this station
    const items = getStaticItemsForStation(s.station);
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
      const maxSec = Math.max(...topItems.map(i => i.avgFulSec || i.targetSec || 0), 60);
      itemsHtml = '<table class="items-table"><thead><tr><th>Menu Item</th><th>Count</th><th>Avg Time</th><th>vs Target</th><th style="min-width:120px">Bar</th></tr></thead><tbody>';
      topItems.forEach(it => {
        const avg = it.avgFulSec || 0;
        const name = it.menuItem || '—';
        const cnt = it.qty || 0;
        const tgt = it.targetSec || 0;
        const over = tgt > 0 && avg > tgt;
        const deltaStr = !tgt
          ? '<span style="color:#6b7280">no target</span>'
          : (avg <= 0
            ? '<span style="color:#6b7280">no sales</span>'
            : (avg > tgt
              ? '<span style="color:#e2706a">+'+fmtSec(avg - tgt)+'</span>'
              : '<span style="color:#74d39a">'+fmtSec(tgt - avg)+' under</span>'));
        const pct = tgt > 0 ? Math.min(100, (avg / (tgt * 1.5)) * 100) : Math.min(100, (avg / maxSec) * 100);
        const barColor = !tgt || avg <= 0 ? '#6b7280' : (over ? '#ef4444' : '#22c55e');
        itemsHtml += '<tr><td>'+(over?'<span style="color:#e2706a">'+name+'</span>':name)+'</td><td style="color:#9aa0aa">'+cnt+'</td><td style="font-weight:600">'+(avg>0?fmtSec(avg):'—')+'</td><td>'+deltaStr+'</td><td><div class="bar-cell"><div class="bar-bg"><div class="bar-fill" style="width:'+pct+'%;background:'+barColor+'"></div></div><span style="font-size:10px;color:#9aa0aa;white-space:nowrap">'+(tgt?fmtSec(tgt):'—')+'</span></div></td></tr>';
      });
      itemsHtml += '</tbody></table>';
      if (items.length > 20) itemsHtml += '<p style="font-size:11px;color:#9aa0aa;margin:6px 0 0">+'+(items.length-20)+' more items</p>';
    } else {
      itemsHtml = '<p style="color:#9aa0aa;font-size:12px">No items assigned to this station in the static REF list.</p>';
    }

    const statusSpan = statusClass
      ? '<span class="status-badge '+statusClass+'">'+statusText+'</span>'
      : '<span style="color:#9aa0aa;font-size:12px">'+statusText+'</span>';
    const ratioColor = ratio ? (ratio>1.15?'#ef4444':ratio>1?'#f59e0b':'#22c55e') : '#9aa0aa';
    const ratioDisp = ratio ? (ratio*100).toFixed(0)+'%' : '—';

    // Staffing strip for this Toast station's FTE family — daily efficiency compare
    let staffingHtml = '';
    const staffing = getD().staffing;
    const famName = staffing && staffing.toastStationFamily ? staffing.toastStationFamily[s.station] : null;
    if (famName && staffing.byFamily && staffing.byFamily[famName]) {
      const fam = staffing.byFamily[famName];
      const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
      const tue = fam.days.Tuesday || {};
      const fri = fam.days.Friday || {};
      const tueIph = tue.itemsPerHead;
      const friIph = fri.itemsPerHead;
      let tueFriNote = '';
      if (tueIph != null && friIph != null && tueIph > 0) {
        const ratio = friIph / tueIph;
        const faster = friIph > tueIph;
        tueFriNote = 'Tue vs Fri items/person: <strong style="color:#e8eaed">'+tueIph+'</strong> → <strong style="color:#e8eaed">'+friIph+'</strong> ('+
          (faster ? 'Friday +' : 'Friday ')+((ratio-1)*100).toFixed(0)+'% vs Tuesday). ' +
          'Heads Tue/Fri: '+(tue.heads||0)+'/'+(fri.heads||0)+' · Ful '+fmtFulMin(tue.avgFulSec)+' / '+fmtFulMin(fri.avgFulSec)+'.';
      }
      staffingHtml = '<div style="margin-bottom:16px;padding:12px;background:#13161c;border:1px solid #262a33;border-radius:10px">'+
        '<div style="font-size:13px;font-weight:600;color:#d9a441;margin-bottom:6px">Staffing performance · '+famName+' family</div>'+
        '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px">'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px">'+fam.weekHeadsUnique+'</div><div class="l">Unique cooks worked</div></div>'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px">'+fam.rosterCount+'</div><div class="l">On FTE roster</div></div>'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px;color:#d9a441">'+(fam.weekItemsPerHeadDay!=null?fam.weekItemsPerHeadDay:'—')+'</div><div class="l">Items / person</div></div>'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px">'+(fam.weekAvgFulSec!=null?fmtFulMin(fam.weekAvgFulSec):'—')+'</div><div class="l">Avg fulfillment</div></div>'+
        '</div>'+
        (tueFriNote ? '<div style="font-size:12px;color:#9aa0aa;margin-bottom:10px">'+tueFriNote+'</div>' : '')+
        '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:11px;width:100%;min-width:640px">'+
        '<thead><tr style="color:#9aa0aa;text-align:center">'+
        '<th style="text-align:left;padding:4px 6px">Day</th><th style="padding:4px 6px">Staff</th><th style="padding:4px 6px">Labor h</th><th style="padding:4px 6px">Items</th><th style="padding:4px 6px">Items/person</th><th style="padding:4px 6px">Ful</th></tr></thead><tbody>'+
        DAYS.map(day => {
          const c = fam.days[day] || {};
          const highlight = (day === 'Tuesday' || day === 'Friday') ? 'background:#1a2030;' : '';
          return '<tr style="'+highlight+'border-top:1px solid #262a33">'+
            '<td style="padding:5px 6px;color:#e8eaed;font-weight:600;text-align:left">'+day.slice(0,3)+'</td>'+
            '<td style="padding:5px 6px;text-align:center;color:#e8eaed">'+(c.heads||0)+'</td>'+
            '<td style="padding:5px 6px;text-align:center;color:#9aa0aa">'+(c.hours||0)+'</td>'+
            '<td style="padding:5px 6px;text-align:center;color:#9aa0aa">'+(c.volume!=null?c.volume:(c.itemCount||0))+'</td>'+
            '<td style="padding:5px 6px;text-align:center;color:#d9a441;font-weight:700;font-size:13px">'+(c.itemsPerHead!=null?c.itemsPerHead:'—')+'</td>'+
            '<td style="padding:5px 6px;text-align:center;color:#e8eaed;font-weight:600">'+fmtFulMin(c.avgFulSec)+'</td></tr>';
        }).join('')+
        '</tbody></table></div></div>';
    } else if (staffing) {
      staffingHtml = '<div style="margin-bottom:12px;font-size:12px;color:#9aa0aa">No FTE staffing map for this Toast station.</div>';
    }

    document.getElementById('stationDetail').innerHTML =
      '<div class="station-header">'+
        '<h2>'+s.station+'</h2>'+statusSpan+
        '<div class="kpis" style="margin:0 0 0 auto;grid-template-columns:repeat(4,auto)">'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px">'+s.count+'</div><div class="l">Tickets</div></div>'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px">'+fmtSec(s.avg_sec)+'</div><div class="l">Avg time</div></div>'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px">'+(s.exp_sec?fmtSec(s.exp_sec):'—')+'</div><div class="l">Target'+(s.target_coverage != null?' · '+Math.round(s.target_coverage*100)+'% mix':'')+'</div></div>'+
          '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px;color:'+ratioColor+'">'+ratioDisp+'</div><div class="l">vs Target</div></div>'+
          (s.bp_tickets != null ? '<div class="kpi" style="padding:8px 12px"><div class="v" style="font-size:16px;color:#e2706a">'+s.bp_tickets+'</div><div class="l">Station BP</div></div>' : '')+
        '</div>'+
      '</div>'+
      staffingHtml+
      '<div style="margin-bottom:16px">'+
        '<div style="font-size:13px;font-weight:600;color:#d9a441;margin-bottom:4px">⚡ Breaking Point</div>'+
        '<div style="font-size:12px;color:#9aa0aa">'+brkText+'</div>'+
      '</div>'+
      '<div style="font-size:13px;font-weight:600;color:#d9a441;margin-bottom:4px">Hourly Heatmap (Day × Hour)</div>'+
      hmHtml+
      '<div style="font-size:13px;font-weight:600;color:#d9a441;margin:16px 0 4px">Menu Items at this station (from static REF assignment)</div>'+
      itemsHtml +
      '<details style="margin-top:16px;cursor:pointer"><summary style="font-size:13px;font-weight:600;color:#d9a441;outline:none">❓ WHY is this station slow? (top 3 items)</summary>' +
      '<div style="margin-top:8px;background:#1a1d25;border-radius:8px;padding:10px;border:1px solid #2d3448">' +
      (items.filter(it => (it.avgFulSec||0) > 0).length > 0 ? '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr><th style="text-align:left;color:#9aa0aa;padding:4px 8px">Item</th><th style="text-align:right;color:#9aa0aa;padding:4px 8px">Avg Time</th><th style="text-align:right;color:#9aa0aa;padding:4px 8px">Tickets</th></tr></thead><tbody>' +
        [...items].filter(it => (it.avgFulSec||0) > 0).sort((a,b)=>(b.avgFulSec||0)-(a.avgFulSec||0)).slice(0,3).map(it => {
          const tgt = it.targetSec || 0;
          const over = tgt > 0 && (it.avgFulSec||0) > tgt;
          return '<tr><td style="padding:4px 8px;color:#e8eaed">' + (it.menuItem||'—') + '</td><td style="padding:4px 8px;text-align:right;font-weight:600;color:' + (over ? '#ef4444' : '#22c55e') + '">' + fmtSec(it.avgFulSec||0) + '</td><td style="padding:4px 8px;text-align:right;color:#9aa0aa">' + (it.qty||0) + '</td></tr>';
        }).join('') +
        '</tbody></table>'
      : '<p style="color:#9aa0aa;font-size:12px;margin:0">No item sales data this week for assigned REF items.</p>') +
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

  renderStationWowTable();
}

/** Stations tab: per-restaurant table of all food stations × weeks (avg ful min). */
function renderStationWowTable() {
  const el = document.getElementById('stationWowTable');
  if (!el) return;
  if (currentVenue === 'rdg_portfolio') {
    el.innerHTML = '<p style="color:#9aa0aa;font-size:13px;margin:0">Pick a restaurant pill to see that location’s station week-over-week table.</p>';
    return;
  }
  const weeks = WEEKS.slice().sort((a, b) => String(a.key).localeCompare(String(b.key)));
  const stationNames = new Set();
  weeks.forEach(w => {
    ((ALL_DATA[currentVenue] && ALL_DATA[currentVenue][w.key] && ALL_DATA[currentVenue][w.key].stations) || [])
      .filter(s => isFoodStation(s.station))
      .forEach(s => stationNames.add(s.station));
  });
  const latestKey = weeks.length ? weeks[weeks.length - 1].key : null;
  const stations = [...stationNames].sort((a, b) => {
    const sa = ((ALL_DATA[currentVenue] && ALL_DATA[currentVenue][latestKey] && ALL_DATA[currentVenue][latestKey].stations) || []).find(s => s.station === a);
    const sb = ((ALL_DATA[currentVenue] && ALL_DATA[currentVenue][latestKey] && ALL_DATA[currentVenue][latestKey].stations) || []).find(s => s.station === b);
    return ((sb && sb.avg_sec) || 0) - ((sa && sa.avg_sec) || 0);
  });
  if (!stations.length) {
    el.innerHTML = '<p style="color:#9aa0aa;font-size:13px;margin:0">No food station data for this location yet.</p>';
    return;
  }
  let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px"><thead><tr style="color:#9aa0aa;border-bottom:1px solid #262a33">'
    + '<th style="text-align:left;padding:8px 10px">Station</th>'
    + weeks.map(w => '<th style="text-align:right;padding:8px 8px;white-space:nowrap">' + w.label + '</th>').join('')
    + '<th style="text-align:right;padding:8px 8px;white-space:nowrap">Δ vs prior</th>'
    + '</tr></thead><tbody>';
  stations.forEach(name => {
    const mins = weeks.map(w => {
      const st = ((ALL_DATA[currentVenue] && ALL_DATA[currentVenue][w.key] && ALL_DATA[currentVenue][w.key].stations) || []).find(s => s.station === name);
      return st && st.avg_sec > 0 ? st.avg_sec / 60 : null;
    });
    const last = mins[mins.length - 1];
    const prev = mins.length >= 2 ? mins[mins.length - 2] : null;
    let deltaCell = '<td style="padding:8px;text-align:right;color:#9aa0aa">—</td>';
    if (last != null && prev != null) {
      const d = last - prev;
      if (Math.abs(d) < 0.05) deltaCell = '<td style="padding:8px;text-align:right;color:#9aa0aa">0.0</td>';
      else if (d < 0) deltaCell = '<td style="padding:8px;text-align:right;color:#22c55e;font-weight:600">' + d.toFixed(1) + '</td>';
      else deltaCell = '<td style="padding:8px;text-align:right;color:#ef4444;font-weight:600">+' + d.toFixed(1) + '</td>';
    }
    html += '<tr style="border-top:1px solid #262a33">'
      + '<td style="padding:8px 10px;color:#e8eaed;font-weight:600">' + name + '</td>'
      + mins.map(m => m == null
        ? '<td style="padding:8px;text-align:right;color:#4b5563">—</td>'
        : '<td style="padding:8px;text-align:right;font-weight:700;color:' + avgFulColorByMin(m) + '">' + m.toFixed(1) + '</td>'
      ).join('')
      + deltaCell
      + '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ============================================================
// TAB 3: Menu Items
// ============================================================
function renderMenuItems() {
  // ONLY items from static REF assignment; Avg Time from item-fulfillment
  const staticMap = getStaticItemMap();
  const hasStatic = Object.keys(staticMap).length > 0;
  const liveByName = getItemLiveByName();

  let SUMMARY;
  if (hasStatic) {
    SUMMARY = Object.entries(staticMap).map(([item, info]) => {
      const live = liveByName[item] || {};
      return {
        item,
        count: live.qty || 0,
        avg_sec: live.avgFulSec || 0,
        exp_sec: info.targetSec || 0,
      };
    });
  } else {
    SUMMARY = (getD().summary || []).map(d => ({
      item: d.item || d.menuItem || '',
      count: d.count != null ? d.count : (d.qty || 0),
      avg_sec: d.avg_sec != null ? d.avg_sec : (d.avgFulSec || 0),
      exp_sec: d.exp_sec || d.targetSec || 0,
    })).filter(d => d.item);
  }
  // MILA: exclude MB-* market/banquet lines from menu analytics
  // Use [ \\t_-] (not \\s) so template-literal emit cannot collapse whitespace class
  if (currentVenue === 'mila') {
    SUMMARY = SUMMARY.filter(d => !/^MB[ \\t_-]/i.test(String(d.item || '').trim()));
  }

  const THR_SEC = 900;
  let currentSort = 'time';
  let currentSearch = '';

  // Station map from static REF only
  const itemStationMap = {};
  Object.entries(staticMap).forEach(([item, info]) => {
    const foodSt = (info.stations || []).find(st => isFoodStation(st));
    if (foodSt) itemStationMap[item] = foodSt;
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

  // Targets from static REF only
  const itemExpSecMap = {};
  Object.entries(staticMap).forEach(([item, info]) => {
    if (info.targetSec > 0) itemExpSecMap[item] = info.targetSec;
  });
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

  // ── Worst Offenders callout (same noise filters as bubble) ──
  const NOISE_NAME_RE_WORST = /deposit|all\\s*in|beo|package|gift\\s*card|gratuity|service\\s*charge|comp\\b|void|water|soda|coke|wine|beer|cocktail|vodka|gin|rum|tequila|whiskey|champagne|prosecco|latte|espresso|coffee|\\bstill\\b|sparkling|margarita|mimosa|aperol|campari/i;
  const top5worst = [...SUMMARY]
    .filter(d => (d.count||0) >= 3 && d.avg_sec > 0 && d.avg_sec <= 45*60 && d.item && !NOISE_NAME_RE_WORST.test(d.item))
    .sort((a,b)=>b.avg_sec-a.avg_sec)
    .slice(0,5);
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

    const NOISE_NAME_RE = /deposit|all\\s*in|beo|package|gift\\s*card|gratuity|service\\s*charge|comp\\b|void|water|soda|coke|wine|beer|cocktail|vodka|gin|rum|tequila|whiskey|champagne|prosecco|latte|espresso|coffee|\\bstill\\b|sparkling|margarita|mimosa|aperol|campari/i;
    const food = SUMMARY.filter(d => {
      const st = itemStationMap[d.item];
      if (st && !isFoodStation(st)) return false;
      if (!d.item || NOISE_NAME_RE.test(d.item)) return false;
      // Noise: tiny sample or absurd cook times that crush the Y scale
      if ((d.count || 0) < 3) return false;
      if (!(d.avg_sec > 0) || d.avg_sec > 45 * 60) return false;
      return true;
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
          y: { title: { display:true, text:'Avg fulfillment (min)' }, grid:{color:gc}, min:0, suggestedMax: 45 }
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
  const staticMap = getStaticItemMap();
  const liveByName = getItemLiveByName();

  const DATA = Object.entries(staticMap).map(([menuItem, info]) => {
    const live = liveByName[menuItem] || {};
    const stations = (info.stations || []).filter(st => isFoodStation(st));
    const targetSec = info.targetSec || null;
    return {
      menuItem,
      station: stations.length ? stations.join(', ') : null,
      targetSec,
      targetMin: targetSec ? Math.round(targetSec / 60 * 10) / 10 : '',
      avgFulSec: live.avgFulSec || null,
      count: live.qty || null,
    };
  });

  DATA.sort((a, b) => {
    if (a.station && !b.station) return -1;
    if (!a.station && b.station) return 1;
    if (a.station && b.station) return a.station.localeCompare(b.station) || a.menuItem.localeCompare(b.menuItem);
    return a.menuItem.localeCompare(b.menuItem);
  });

  const searchEl = document.getElementById('assignSearch');
  if (searchEl) { searchEl.value = ''; }
  const filterEl = document.getElementById('assignTargetFilter');
  if (filterEl) { filterEl.value = 'all'; }
  const saveEl = document.getElementById('assignSaveStatus');
  if (saveEl) saveEl.textContent = '';

  function getRows() {
    const q = (document.getElementById('assignSearch')?.value || '').toLowerCase();
    const mode = document.getElementById('assignTargetFilter')?.value || 'all';
    return DATA.filter(r => {
      if (mode === 'no-target' && r.targetSec) return false;
      if (mode === 'has-target' && !r.targetSec) return false;
      if (mode === 'no-station' && r.station) return false;
      if (!q) return true;
      return r.menuItem.toLowerCase().includes(q) || (r.station||'').toLowerCase().includes(q);
    });
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
      const esc = r.menuItem.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
      const tgtInput = '<input type="number" min="0" step="0.5" class="chef-target-inp" data-item="' + esc + '" value="' + (r.targetMin !== '' ? r.targetMin : '') + '" placeholder="min" title="Fulfillment target in minutes" style="width:72px;padding:4px 6px;background:#1e2533;border:1px solid #2d3448;color:#e8eaed;border-radius:6px;font-size:12px;text-align:right" onchange="updateChefTarget(this)">';
      return '<tr style="border-top:1px solid #1e2533">' +
        stationCell +
        '<td style="padding:7px 10px;color:#e8eaed">' + r.menuItem + '</td>' +
        '<td style="padding:7px 10px;text-align:right">' + tgtInput + '</td>' +
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

  window.updateChefTarget = function(inp) {
    const item = inp.getAttribute('data-item');
    const min = parseFloat(inp.value);
    const store = loadChefLocal();
    const row = DATA.find(d => d.menuItem === item);
    if (min > 0 && !isNaN(min)) {
      const sec = Math.round(min * 60);
      store[item] = sec;
      if (row) { row.targetSec = sec; row.targetMin = min; }
    } else {
      delete store[item];
      if (row) { row.targetSec = getEffectiveTargetSec(item, ITEM_STATION_MAP_DATA[venueSlugForMap()]?.[item]?.targetSec || 0) || null; row.targetMin = row.targetSec ? row.targetSec / 60 : ''; }
    }
    localStorage.setItem(chefStorageKey(), JSON.stringify(store));
    const st = document.getElementById('assignSaveStatus');
    if (st) st.textContent = 'Saved locally · station targets recalculated';
    applyDerivedStationTargets();
    renderStationsRecap();
    renderStations();
    renderRows(getRows());
  };

  window.exportChefTargets = function() {
    const venue = venueSlugForMap();
    const merged = { ...(CHEF_TARGET_OVERRIDES[venue] || {}), ...loadChefLocal() };
    const out = { ...CHEF_TARGET_OVERRIDES, [venue]: merged };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chef-target-overrides.json';
    a.click();
    URL.revokeObjectURL(a.href);
    const st = document.getElementById('assignSaveStatus');
    if (st) st.textContent = 'Exported — replace chef-target-overrides.json in repo';
  };

  async function pingAssignmentHelper() {
    try {
      const resp = await fetch('http://127.0.0.1:3855/health', { cache: 'no-store' });
      if (!resp.ok) return false;
      const body = await resp.json().catch(() => ({}));
      return !!body.ok;
    } catch (_) {
      return false;
    }
  }

  window.checkAssignmentHelper = async function() {
    const st = document.getElementById('assignSaveStatus');
    if (!st) return;
    const online = await pingAssignmentHelper();
    if (online) {
      st.style.color = '#22c55e';
      st.textContent = 'Refresh helper online';
    } else {
      st.style.color = '#ef4444';
      st.textContent = 'Refresh helper offline — start: node assignment-refresh-server.cjs';
    }
    return online;
  };

  window.refreshAssignmentFromToast = async function() {
    const st = document.getElementById('assignSaveStatus');
    const btn = document.getElementById('assignRefreshBtn');
    const venue = venueSlugForMap();
    const weekKey = WEEKS[currentWeekIdx]?.key || '';
    if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
    if (st) { st.style.color = '#f59e0b'; st.textContent = 'Calling local Toast refresh helper…'; }
    try {
      const online = await pingAssignmentHelper();
      if (!online) {
        throw new Error('HELPER_OFFLINE');
      }
      const resp = await fetch('http://127.0.0.1:3855/refresh-assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue, week: weekKey }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error || ('HTTP ' + resp.status));
      if (st) { st.style.color = '#22c55e'; st.textContent = 'Refreshed ' + (body.items || '?') + ' items — reload dashboard.html'; }
      if (confirm('Toast assignment refreshed.\\n\\nReload this page to see new stations/items?')) {
        location.reload();
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      const offline = msg === 'HELPER_OFFLINE' || /Failed to fetch|NetworkError|Load failed/i.test(msg);
      if (st) {
        st.style.color = '#ef4444';
        st.textContent = offline
          ? 'Refresh helper offline — start: node assignment-refresh-server.cjs'
          : ('Refresh failed: ' + msg);
      }
      alert(
        offline
          ? ('Could not reach the local Toast refresh helper.\\n\\n' +
             '1) In a terminal at C:\\\\Cursor\\\\toast-mcp-server, run:\\n   node assignment-refresh-server.cjs\\n' +
             '2) Keep that window open\\n' +
             '3) Click Refresh from Toast again')
          : ('Toast refresh failed:\\n\\n' + msg)
      );
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh from Toast'; }
    }
  };

  // Surface helper status when Assignment tab opens
  const _origSwitchTab = window.switchTab;
  if (typeof _origSwitchTab === 'function' && !_origSwitchTab._assignHelperHook) {
    window.switchTab = function(tab, el) {
      const r = _origSwitchTab(tab, el);
      if (tab === 'assignment') setTimeout(() => window.checkAssignmentHelper && window.checkAssignmentHelper(), 50);
      return r;
    };
    window.switchTab._assignHelperHook = true;
  }
}

// ============================================================
// TAB 4: Group / RDG Portfolio Summary (client-side aggregator)
// ============================================================
const PORTFOLIO_VENUE_KEYS = ['claudie','casaneos','ava_cg','ava_wp','mila'];
function buildVenueWeekScorecard(key, label, weekKey) {
  const d = ALL_DATA[key]?.[weekKey] || ALL_DATA[key]?.['latest'] || {};
  const stations = (d.stations || []).filter(s => isFoodStation(s.station));
  let totalCount = 0, totalSec = 0;
  stations.forEach(s => { totalCount += s.count; totalSec += s.avg_sec * s.count; });
  const avgFulSec = totalCount > 0 ? totalSec / totalCount : null;
  const avgFulMin = avgFulSec != null ? avgFulSec / 60 : null;
  const totalTickets = stations.reduce((acc, s) => acc + s.count, 0);
  const bp = d.breakingPoint || null;
  const bpGuests = d.breakingPointGuests || null;
  const guestsSeated = (d.guestsSeated && d.guestsSeated.total != null)
    ? d.guestsSeated.total
    : ((d.staffing && d.staffing.guestsSeated && d.staffing.guestsSeated.total != null) ? d.staffing.guestsSeated.total : null);
  const staffing = d.staffing;
  const saute = staffing && staffing.byFamily ? staffing.byFamily.Saute : null;
  const sauteIph = saute ? saute.weekItemsPerHeadDay : null;
  const sauteFul = saute && saute.weekAvgFulSec != null ? saute.weekAvgFulSec / 60 : null;
  // Portfolio-wide BOH items/person across food families with labor
  let bohVolume = 0, bohHeadDays = 0;
  const familyStats = {};
  if (staffing && staffing.byFamily) {
    Object.keys(staffing.byFamily).forEach(f => {
      const fam = staffing.byFamily[f];
      const headDays = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
        .reduce((s, d) => s + ((fam.days && fam.days[d] && fam.days[d].heads) || 0), 0);
      familyStats[f] = {
        iph: fam.weekItemsPerHeadDay,
        fulMin: fam.weekAvgFulSec != null ? +(fam.weekAvgFulSec / 60).toFixed(1) : null,
        volume: fam.weekItemCount,
        hours: fam.weekHours,
      };
      if (fam.weekItemCount) bohVolume += fam.weekItemCount;
      bohHeadDays += headDays;
    });
  }
  const bohIph = bohHeadDays > 0 ? +(bohVolume / bohHeadDays).toFixed(1) : null;
  const top3 = [...stations].sort((a,b)=>b.avg_sec-a.avg_sec).slice(0,3);
  const mapSlug = ({ claudie:'claudie', casaneos:'casa_neos', ava_cg:'ava_cg', ava_wp:'ava_wp', mila:'mila' })[key] || key;
  const venueMap = ITEM_STATION_MAP_DATA[mapSlug] || {};
  const chefMap = CHEF_TARGET_OVERRIDES[mapSlug] || {};
  function targetFor(name) {
    if (chefMap[name] > 0) return chefMap[name];
    const ref = venueMap[name];
    if (ref && ref.targetSec > 0) return ref.targetSec;
    return 0;
  }
  function stationsFor(name, assignStation) {
    const fromMap = ((venueMap[name] && venueMap[name].stations) || []).slice();
    if (assignStation) fromMap.push(assignStation);
    return [...new Set(fromMap.filter(Boolean))];
  }
  // Item map for cross-venue variance (summary preferred; fall back to assignmentData)
  const itemMap = {};
  (d.summary || []).forEach(row => {
    const name = String(row.menuItem || row.item || '').trim();
    if (!name) return;
    const avg = row.avg_sec != null ? row.avg_sec : (row.avgFulSec != null ? row.avgFulSec : null);
    const qty = row.qty != null ? row.qty : (row.count != null ? row.count : 0);
    if (avg == null || !(avg > 0)) return;
    const stations = stationsFor(name, null);
    if (!isPortfolioFoodItem(name, stations, avg)) return;
    itemMap[name.toLowerCase()] = { name, avgSec: avg, qty, targetSec: targetFor(name), stations };
  });
  (d.assignmentData || []).forEach(row => {
    const name = String(row.menuItem || '').trim();
    if (!name) return;
    const avg = row.avgFulSec != null ? row.avgFulSec : null;
    const tAssign = row.targetSec > 0 ? row.targetSec : 0;
    const stations = stationsFor(name, row.station || null);
    if (avg != null && avg > 0 && !isPortfolioFoodItem(name, stations, avg)) return;
    if (!itemMap[name.toLowerCase()]) {
      if (avg == null || !(avg > 0)) return;
      if (!isPortfolioFoodItem(name, stations, avg)) return;
      itemMap[name.toLowerCase()] = { name, avgSec: avg, qty: row.qty || row.count || 0, targetSec: tAssign || targetFor(name), stations };
    } else {
      const cur = itemMap[name.toLowerCase()];
      if (!cur.targetSec && tAssign) cur.targetSec = tAssign;
      else if (!cur.targetSec) cur.targetSec = targetFor(name);
      if (row.station && isFoodStation(row.station) && !(cur.stations || []).includes(row.station)) {
        cur.stations = [...(cur.stations || []), row.station];
      }
    }
  });
  return { key, label, avgFulMin, avgFulSec, totalTickets, bp, bpGuests, guestsSeated, top3, sauteIph, sauteFul, bohIph, familyStats, hasStaffing: !!staffing, itemMap };
}
function renderGroup() {
  const VENUE_LABELS_LOCAL = ${JSON.stringify(VENUE_LABELS)};
  const weekLabel = WEEKS[currentWeekIdx] ? WEEKS[currentWeekIdx].label : 'Week 1';
  const weekKey = WEEKS[currentWeekIdx]?.key;
  const portfolioMode = currentVenue === 'rdg_portfolio';

  const titleEl = document.getElementById('groupTitle');
  if (titleEl) titleEl.textContent = (portfolioMode ? 'RDG Portfolio — ' : 'RDG Group — ') + weekLabel + ' Performance';

  const entries = portfolioMode
    ? PORTFOLIO_VENUE_KEYS.map(k => [k, VENUE_LABELS_LOCAL[k]]).filter(([,l]) => l)
    : Object.entries(VENUE_LABELS_LOCAL);
  const venueData = entries.map(([key, label]) => buildVenueWeekScorecard(key, label, weekKey));

  // Destroy legacy group bar if an older HTML shell still has the canvas
  const legacyBar = Chart.getChart('cGroupBar');
  if (legacyBar) legacyBar.destroy();

  // ── Scoreboard first (fulfillment + items/person) ──
  const scoreEl = document.getElementById('groupPortfolioTable');
  if (scoreEl) {
    let th = '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="color:#9aa0aa;border-bottom:1px solid #262a33">'+
      '<th style="text-align:left;padding:10px 8px">Venue</th>'+
      '<th style="padding:10px 8px;text-align:right">Avg fulfillment</th>'+
      '<th style="padding:10px 8px;text-align:right">Items / person</th>'+
      '<th style="padding:10px 8px;text-align:right">Guests seated</th>'+
      '<th style="padding:10px 8px;text-align:right">Breaking point</th></tr></thead><tbody>';
    venueData.forEach(v => {
      th += '<tr style="border-top:1px solid #262a33;cursor:pointer" onclick="selectVenueFromPortfolio(\\''+v.key+'\\')">'+
        '<td style="padding:10px 8px;color:#e8eaed;font-weight:700">'+v.label+'</td>'+
        '<td style="padding:10px 8px;text-align:right;font-weight:700;color:'+(v.avgFulMin!=null?avgFulColorByMin(v.avgFulMin):'#9aa0aa')+'">'+(v.avgFulMin!=null?v.avgFulMin.toFixed(1)+' min':'—')+'</td>'+
        '<td style="padding:10px 8px;text-align:right;font-weight:700;color:#d9a441">'+(v.bohIph!=null?v.bohIph:'—')+'</td>'+
        '<td style="padding:10px 8px;text-align:right">'+(v.guestsSeated!=null?v.guestsSeated.toLocaleString():'—')+'</td>'+
        '<td style="padding:10px 8px;text-align:right">'+(v.bp||'—')+(v.bpGuests!=null?' / '+v.bpGuests+'g':'')+'</td></tr>';
    });
    scoreEl.innerHTML = th + '</tbody></table>';
  }

  // Legacy card row (removed from portfolio shell) — clear if present
  const cardsEl = document.getElementById('groupCards');
  if (cardsEl) cardsEl.innerHTML = '';

  // ── Station family comparison: fulfillment + items/person ──
  const famEl = document.getElementById('groupFamilyTable');
  if (famEl) {
    const FOOD_FAMILIES = ['Saute','Fry','Garde Manger','Raw','Sushi','Robata','Pastry','Expo','Pizza','Prep'];
    let fh = '<table style="width:100%;border-collapse:collapse;font-size:12px;min-width:720px"><thead><tr style="color:#9aa0aa;border-bottom:1px solid #262a33">'+
      '<th style="text-align:left;padding:8px">Station family</th>';
    venueData.forEach(v => {
      fh += '<th style="padding:8px;text-align:center" colspan="2">'+v.label+'</th>';
    });
    fh += '</tr><tr style="color:#6b7280;border-bottom:1px solid #262a33"><th style="padding:4px 8px"></th>';
    venueData.forEach(() => {
      fh += '<th style="padding:4px 8px;text-align:right;font-weight:500">Ful</th><th style="padding:4px 8px;text-align:right;font-weight:500">Items/person</th>';
    });
    fh += '</tr></thead><tbody>';
    FOOD_FAMILIES.forEach(f => {
      const any = venueData.some(v => v.familyStats[f] && (v.familyStats[f].iph != null || v.familyStats[f].fulMin != null));
      // Always show family rows in portfolio so Claudie empty cells are visible when others have data
      if (!any && !portfolioMode) return;
      if (!any) return;
      fh += '<tr style="border-top:1px solid #262a33"><td style="padding:8px;color:#e8eaed;font-weight:600">'+f+'</td>';
      venueData.forEach(v => {
        const st = v.familyStats[f] || {};
        const fulColor = st.fulMin != null ? avgFulColorByMin(st.fulMin) : '#9aa0aa';
        fh += '<td style="padding:8px;text-align:right;color:'+fulColor+'">'+(st.fulMin!=null?st.fulMin+'m':'—')+'</td>'+
          '<td style="padding:8px;text-align:right;color:#d9a441;font-weight:600">'+(st.iph!=null?st.iph:'—')+'</td>';
      });
      fh += '</tr>';
    });
    fh += '</tbody></table>';
    if (!venueData.some(v => v.hasStaffing)) {
      fh = '<p style="color:#9aa0aa;font-size:13px">Staffing efficiency appears after FTE × labor join for each venue.</p>' + fh;
    } else if (portfolioMode && venueData.some(v => !v.hasStaffing)) {
      fh = '<p style="color:#9aa0aa;font-size:13px;margin:0 0 8px">Claudie (and any venue without staffing join) shows — for family items/person until FTE×labor is available.</p>' + fh;
    }
    famEl.innerHTML = fh;
  }

  // ── Items top 10 variance (food only: with target + like-to-like) ──
  const VENUE_ITEM_PREFIX_RE = /^(AVACGPFMS|AVACGPF|AVACG|ACG|CLPFL|CLIN|CLEV|CLEL|CLPF|CLR|CLK|CLE|CLL|CL|CNSM|CMS|CSM|CIN|CE|CN|C|AVAWP|AWP|AOB|AEV|AMO|AM0|A|MEV|MG|MP|MILA|MM|M)[-_\\s]+/i;
  function rdgItemBaseName(name) {
    return String(name || '').trim().replace(VENUE_ITEM_PREFIX_RE, '').replace(/\\s+/g, ' ').trim().toLowerCase();
  }
  function rankVarianceRows(rows, venueDataLocal, limit) {
    const ranked = rows.map(row => {
      const vals = venueDataLocal.map(v => {
        const hit = row.byVenue[v.key];
        return hit ? hit.avgSec / 60 : null;
      }).filter(x => x != null && isFinite(x));
      if (vals.length < 2) return null;
      const mn = Math.min(...vals);
      const mx = Math.max(...vals);
      let targetSec = 0;
      venueDataLocal.forEach(v => {
        const hit = row.byVenue[v.key];
        if (hit && hit.targetSec > targetSec) targetSec = hit.targetSec;
      });
      return { ...row, spread: mx - mn, n: vals.length, targetSec };
    }).filter(Boolean).sort((a, b) => b.spread - a.spread);
    return limit ? ranked.slice(0, limit) : ranked;
  }
  function renderVarianceTable(el, ranked, venueDataLocal, opts) {
    if (!el) return;
    if (!ranked.length) {
      el.innerHTML = '<p style="color:#9aa0aa;font-size:13px">'+(opts.empty || 'No matching items this week.')+'</p>';
      return;
    }
    let vh = '<table style="width:100%;border-collapse:collapse;font-size:12px;min-width:780px"><thead><tr style="color:#9aa0aa;border-bottom:1px solid #262a33">'+
      '<th style="text-align:left;padding:8px">#</th>'+
      '<th style="text-align:left;padding:8px">Menu item</th>';
    if (opts.showTarget) vh += '<th style="padding:8px;text-align:right">Target</th>';
    venueDataLocal.forEach(v => { vh += '<th style="padding:8px;text-align:right">'+v.label+'</th>'; });
    vh += '<th style="padding:8px;text-align:right;color:#d9a441">Spread</th></tr></thead><tbody>';
    ranked.forEach((row, i) => {
      const sub = row.aliases && row.aliases.length
        ? '<div style="font-size:10px;color:#6b7280;font-weight:400;margin-top:2px">'+row.aliases.join(' · ')+'</div>'
        : '';
      vh += '<tr style="border-top:1px solid #262a33"><td style="padding:8px;color:#6b7280">'+(i+1)+'</td>'+
        '<td style="padding:8px;color:#e8eaed;font-weight:600">'+row.name+sub+'</td>';
      if (opts.showTarget) {
        vh += '<td style="padding:8px;text-align:right;color:#9aa0aa">'+(row.targetSec>0?(row.targetSec/60).toFixed(1)+'m':'—')+'</td>';
      }
      venueDataLocal.forEach(v => {
        const hit = row.byVenue[v.key];
        if (!hit) {
          vh += '<td style="padding:8px;text-align:right;color:#6b7280">—</td>';
          return;
        }
        const min = hit.avgSec / 60;
        vh += '<td style="padding:8px;text-align:right;color:'+avgFulColorByMin(min)+'">'+min.toFixed(1)+'m</td>';
      });
      vh += '<td style="padding:8px;text-align:right;font-weight:700;color:#d9a441">'+row.spread.toFixed(1)+'m</td></tr>';
    });
    vh += '</tbody></table>';
    el.innerHTML = vh;
  }

  // Exact-name + like-to-like base groups (shared builder)
  const byExact = {};
  const byBase = {};
  venueData.forEach(v => {
    Object.values(v.itemMap || {}).forEach(info => {
      // itemMap is already food-filtered at build time; keep a soft re-check
      if (!isPortfolioFoodItem(info.name, info.stations, info.avgSec)) return;
      const norm = info.name.toLowerCase();
      if (!byExact[norm]) byExact[norm] = { name: info.name, byVenue: {}, aliases: new Set() };
      byExact[norm].byVenue[v.key] = info;
      byExact[norm].aliases.add(info.name);

      const base = rdgItemBaseName(info.name);
      if (!base || base.length < 3) return;
      if (!byBase[base]) byBase[base] = { name: info.name.replace(VENUE_ITEM_PREFIX_RE, '').trim() || info.name, byVenue: {}, aliases: new Set() };
      const prev = byBase[base].byVenue[v.key];
      if (!prev || (info.qty || 0) >= (prev.qty || 0)) byBase[base].byVenue[v.key] = info;
      byBase[base].aliases.add(info.name);
      const display = info.name.replace(VENUE_ITEM_PREFIX_RE, '').trim();
      if (display && (!byBase[base].name || display.length <= byBase[base].name.length)) byBase[base].name = display;
    });
  });

  function toRankable(groups, { requireTarget, requireDistinctNames }) {
    return Object.values(groups).map(row => {
      const aliases = [...(row.aliases || [])];
      const distinct = new Set(aliases.map(a => a.toLowerCase()));
      if (Object.keys(row.byVenue).length < 2) return null;
      if (requireDistinctNames && distinct.size < 2) return null;
      const hasTarget = Object.values(row.byVenue).some(x => x.targetSec > 0);
      if (requireTarget && !hasTarget) return null;
      return {
        name: row.name,
        byVenue: row.byVenue,
        aliases: requireDistinctNames ? aliases.sort() : (distinct.size > 1 ? aliases.sort() : null),
      };
    }).filter(Boolean);
  }

  // Table 1: highest variance among items that have a Target (matched exact OR like-to-like)
  const withTargetRows = [
    ...toRankable(byExact, { requireTarget: true, requireDistinctNames: false }),
    ...toRankable(byBase, { requireTarget: true, requireDistinctNames: true }),
  ];
  // Dedupe by base-ish key preferring larger spread later via rank
  const seenTarget = new Set();
  const withTargetDedup = [];
  rankVarianceRows(withTargetRows, venueData).forEach(row => {
    const key = rdgItemBaseName(row.name) || row.name.toLowerCase();
    if (seenTarget.has(key)) return;
    seenTarget.add(key);
    withTargetDedup.push(row);
  });
  renderVarianceTable(
    document.getElementById('groupItemVarianceTargetTable'),
    withTargetDedup.slice(0, 10),
    venueData,
    { showTarget: true, empty: 'No shared items with a target and 2+ venue times this week.' }
  );

  // Table 2: like-to-like only (CL-X vs C-X / ACG-X …), target not required
  const alikeRows = toRankable(byBase, { requireTarget: false, requireDistinctNames: true });
  renderVarianceTable(
    document.getElementById('groupItemVarianceAlikeTable'),
    rankVarianceRows(alikeRows, venueData, 10),
    venueData,
    { showTarget: false, empty: 'No like-to-like prefixed matches (e.g. CL-… vs C-…) across 2+ venues this week.' }
  );
}
function selectVenueFromPortfolio(key) {
  currentVenue = key;
  document.querySelectorAll('.venue-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.venue === key);
  });
  const label = (${JSON.stringify(VENUE_LABELS)})[key] || key;
  document.getElementById('dashTitle').textContent = label + ' · BOH Dashboard';
  const groupBtn = document.querySelector('.tab-btn[onclick*="group"]');
  // Stay on Group if coming from scorecard click while browsing portfolio; otherwise re-render venue tabs
  renderAll();
}
function exportPortfolioPdf() {
  // Ensure Portfolio tab + RDG Portfolio venue are active
  const groupBtn = document.querySelector('.tab-btn[onclick*="group"]');
  if (groupBtn) switchTab('group', groupBtn);
  if (currentVenue !== 'rdg_portfolio') {
    currentVenue = 'rdg_portfolio';
    document.querySelectorAll('.venue-pill').forEach(b => {
      b.classList.toggle('active', b.dataset.venue === 'rdg_portfolio');
    });
    const title = document.getElementById('dashTitle');
    if (title) title.textContent = 'RDG Portfolio · BOH Dashboard';
    renderAll();
  }

  const root = document.getElementById('portfolioPrintRoot') || document.getElementById('tab-group');
  // Hide empty variance cards so print doesn't leave blank blocks
  ['portfolioCardAlike', 'portfolioCardTarget'].forEach(id => {
    const card = document.getElementById(id);
    if (!card) return;
    const tbl = card.querySelector('[id$="Table"]');
    const hasRows = tbl && tbl.querySelectorAll('tbody tr').length > 0;
    card.classList.toggle('portfolio-print-empty', !hasRows);
  });

  const cleanup = () => {
    document.body.classList.remove('printing-portfolio');
    if (root) {
      root.style.removeProperty('--print-scale');
      root.style.removeProperty('width');
    }
    window.removeEventListener('afterprint', cleanup);
  };
  window.removeEventListener('afterprint', cleanup);
  window.addEventListener('afterprint', cleanup);

  document.body.classList.add('printing-portfolio');
  if (root) root.style.setProperty('--print-scale', '1');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (root) {
        // Landscape printable area (~Letter). Uniform scale only — never stretch axes.
        const maxW = 1000;
        const maxH = 700;
        const w = Math.max(root.scrollWidth, root.offsetWidth, 1);
        const h = Math.max(root.scrollHeight, root.offsetHeight, 1);
        // Fit entirely on one page; allow mild upscale so short content isn't a postage stamp
        let scale = Math.min(maxW / w, maxH / h);
        scale = Math.min(1.25, Math.max(0.42, scale));
        root.style.setProperty('--print-scale', String(scale));
      }
      setTimeout(() => window.print(), 120);
    });
  });
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
  const menuItems = (d.summary || []).map(x => ({
    item: x.item || x.menuItem || '',
    avg_sec: x.avg_sec != null ? x.avg_sec : (x.avgFulSec || 0),
  })).filter(x => x.item);
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
// STATIONS RECAP (Overview)
// ============================================================
function renderStationsRecap() {
  const el = document.getElementById('stationsRecap');
  if (!el) return;
  const stations = (getD().stations || [])
    .filter(s => isFoodStation(s.station))
    .slice()
    .sort((a, b) => {
      const ra = a.exp_sec > 0 ? a.avg_sec / a.exp_sec : -1;
      const rb = b.exp_sec > 0 ? b.avg_sec / b.exp_sec : -1;
      return rb - ra;
    });

  if (!stations.length) {
    el.innerHTML = '<div style="color:#9aa0aa;padding:12px">No food station data for this week.</div>';
    return;
  }

  let html = '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html += '<thead><tr style="border-bottom:1px solid #2d3448;color:#9aa0aa;text-align:left">';
  html += '<th style="padding:8px 10px">Station</th>';
  html += '<th style="padding:8px 10px;text-align:right">Tickets</th>';
  html += '<th style="padding:8px 10px;text-align:right">Avg Time</th>';
  html += '<th style="padding:8px 10px;text-align:right">Target</th>';
  html += '<th style="padding:8px 10px;text-align:right">vs Target</th>';
  html += '<th style="padding:8px 10px">Status</th>';
  html += '<th style="padding:8px 10px;text-align:right">Station BP</th>';
  html += '</tr></thead><tbody>';

  stations.forEach(s => {
    const ratio = s.exp_sec > 0 ? s.avg_sec / s.exp_sec : null;
    let badge = '<span style="color:#9aa0aa">⚪ NO TARGET</span>';
    let rowColor = '#e8eaed';
    if (ratio != null) {
      if (ratio <= 1.0) { badge = '<span style="color:#22c55e">✅ ON TARGET</span>'; rowColor = '#e8eaed'; }
      else if (ratio <= 1.2) { badge = '<span style="color:#f59e0b">⚠️ WATCH</span>'; rowColor = '#fde68a'; }
      else { badge = '<span style="color:#ef4444">🔴 BREAKING</span>'; rowColor = '#fca5a5'; }
    }
    const vsTxt = ratio != null
      ? ((ratio - 1) * 100 >= 0 ? '+' : '') + Math.round((ratio - 1) * 100) + '%'
      : '—';
    const vsColor = ratio == null ? '#9aa0aa' : (ratio <= 1 ? '#22c55e' : (ratio <= 1.2 ? '#f59e0b' : '#ef4444'));
    html += '<tr style="border-bottom:1px solid #1e2533;cursor:pointer" onclick="openStationFromRecap(\\'' + s.station.replace(/'/g, '') + '\\')">';
    html += '<td style="padding:9px 10px;font-weight:600;color:' + rowColor + '">' + s.station + '</td>';
    html += '<td style="padding:9px 10px;text-align:right;color:#9aa0aa">' + (s.count || 0).toLocaleString() + '</td>';
    html += '<td style="padding:9px 10px;text-align:right;font-weight:700;color:' + vsColor + '">' + fmtSec(s.avg_sec) + '</td>';
    html += '<td style="padding:9px 10px;text-align:right;color:#9aa0aa">' + (s.exp_sec > 0 ? fmtSec(s.exp_sec) : '—') + '</td>';
    html += '<td style="padding:9px 10px;text-align:right;color:' + vsColor + ';font-weight:600">' + vsTxt + '</td>';
    html += '<td style="padding:9px 10px">' + badge + '</td>';
    html += '<td style="padding:9px 10px;text-align:right;color:#9aa0aa">' + (s.bp_tickets != null ? s.bp_tickets + ' tix' : '—') + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function openStationFromRecap(stationName) {
  const btn = document.querySelector('.tab-btn[onclick*="stations"]');
  if (btn) switchTab('stations', btn);
  setTimeout(() => {
    const pills = document.querySelectorAll('#stationPills .station-pill');
    pills.forEach(p => {
      const nameEl = p.querySelector('.sp-name');
      const name = nameEl ? nameEl.textContent.trim() : (p.textContent || '').trim();
      if (name === stationName) p.click();
    });
  }, 80);
}

// ============================================================
// TAB: SETTINGS / PIPELINE HEALTH
// ============================================================
function renderSettings() {
  const root = document.getElementById('settingsHealthRoot');
  if (!root) return;
  const H = PIPELINE_HEALTH_DATA || {};
  const cloud = BOH_CLOUD_STATUS || {};
  const fmtWhen = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch(e) { return iso; }
  };
  const badge = (st) => {
    if (st === 'pass') return '<span style="color:#22c55e">✅ PASS</span>';
    if (st === 'warn') return '<span style="color:#f59e0b">⚠️ WARN</span>';
    return '<span style="color:#ef4444">❌ FAIL</span>';
  };

  let html = '';

  // Cloud automation (DJ-style scrapeStatus) — source of truth for laptop-off
  const cloudOk = cloud.ok === true;
  const cloudColor = cloud.at ? (cloudOk ? '#22c55e' : '#ef4444') : '#f59e0b';
  const cloudLabel = !cloud.at ? 'NO CLOUD STATUS YET' : (cloudOk ? 'CLOUD OK' : 'CLOUD FAILED');
  html += '<div class="card" style="border-color:' + cloudColor + '40">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">';
  html += '<div><h2 style="margin:0">Cloud Automation (Firebase)</h2>';
  html += '<p class="note" style="margin:6px 0 0">Primary: GitHub-hosted Actions Mon ~8:30 AM ET · backup ~9:00 AM · laptop can be off</p></div>';
  html += '<div style="font-size:18px;font-weight:800;color:' + cloudColor + '">' + cloudLabel + '</div>';
  html += '</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px">';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Last cloud run</td><td style="padding:8px 0;text-align:right;color:#e8eaed">' + (cloud.atLocal || fmtWhen(cloud.at)) + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Week published</td><td style="padding:8px 0;text-align:right;color:#e8eaed">' + (cloud.weekLabel || (BOH_CLOUD_META && BOH_CLOUD_META.latestWeek) || '—') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Schedule</td><td style="padding:8px 0;text-align:right;color:#e8eaed">' + (cloud.schedule || 'Mon ~8:30 AM ET · backup ~9:00 AM') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">What</td><td style="padding:8px 0;text-align:right;color:#e8eaed;max-width:420px">' + (cloud.what || '—') + '</td></tr>';
  html += '<tr><td style="padding:8px 0;color:#9aa0aa">Message</td><td style="padding:8px 0;text-align:right;color:#e8eaed">' + (cloud.message || '—') + '</td></tr>';
  html += '</table></div>';

  if (!H.generatedAt) {
    html += '<div class="card"><p class="note">No embedded pipeline-health.json yet. Cloud status above is live from Firebase when available.</p></div>';
    root.innerHTML = html;
    return;
  }

  const overallColor = H.overall === 'pass' ? '#22c55e' : (H.overall === 'warn' ? '#f59e0b' : '#ef4444');
  const overallLabel = H.overall === 'pass' ? 'ALL CLEAR' : (H.overall === 'warn' ? 'NEEDS ATTENTION' : 'FAILED CHECKS');
  const sched = H.schedule || {};
  const schedOk = !!sched.matchesExpected;

  // Overall status
  html += '<div class="card" style="border-color:' + overallColor + '40">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">';
  html += '<div><h2 style="margin:0">Pipeline Status (embedded)</h2><p class="note" style="margin:6px 0 0">Latest week checked: <strong style="color:#e8eaed">' + (H.latestWeek || '—') + '</strong> · Generated ' + fmtWhen(H.generatedAt) + '</p></div>';
  html += '<div style="font-size:18px;font-weight:800;color:' + overallColor + '">' + overallLabel + '</div>';
  html += '</div>';
  html += '<div class="kpis" style="margin-top:14px;grid-template-columns:repeat(3,1fr)">';
  html += '<div class="kpi"><div class="v" style="color:#22c55e">' + ((H.totals&&H.totals.pass)||0) + '</div><div class="l">Passed</div></div>';
  html += '<div class="kpi"><div class="v" style="color:#f59e0b">' + ((H.totals&&H.totals.warn)||0) + '</div><div class="l">Warnings</div></div>';
  html += '<div class="kpi"><div class="v" style="color:#ef4444">' + ((H.totals&&H.totals.fail)||0) + '</div><div class="l">Failures</div></div>';
  html += '</div></div>';

  // Schedule card
  html += '<div class="card">';
  html += '<h2>Automatic Update Schedule</h2>';
  html += '<p class="note">Primary: GitHub-hosted <code>boh-weekly.yml</code> Mon ~8:30 AM ET with a ~9:00 AM backup. Laptop Task Scheduler is emergency-only.</p>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Laptop task registered</td><td style="padding:8px 0;text-align:right;font-weight:600;color:' + (sched.exists?'#22c55e':'#ef4444') + '">' + (sched.exists?'Yes':'No') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Laptop schedule</td><td style="padding:8px 0;text-align:right;color:#e8eaed">' + (sched.days||'—') + ' ' + (sched.startTime||'') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Matches Monday 8:30 (legacy)</td><td style="padding:8px 0;text-align:right;font-weight:700;color:' + (schedOk?'#22c55e':'#ef4444') + '">' + (schedOk?'✅ Yes':'❌ No') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Next laptop run</td><td style="padding:8px 0;text-align:right;color:#e8eaed">' + (sched.nextRun||'—') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Last laptop run</td><td style="padding:8px 0;text-align:right;color:#e8eaed">' + (sched.lastRun||'—') + '</td></tr>';
  html += '<tr><td style="padding:8px 0;color:#9aa0aa">Laptop task status</td><td style="padding:8px 0;text-align:right;color:#e8eaed">' + (sched.status||'—') + '</td></tr>';
  html += '</table></div>';

  const msched = H.monthlyPrepSchedule || {};
  const mschedOk = !!msched.matchesExpected;
  html += '<div class="card">';
  html += '<h2>Monthly Prep Stations Scrape</h2>';
  html += '<p class="note">Expected: 1st of every month at 9:00 AM. Scrapes Toast Bulk Editor for Claudie, AVA CG, AVA WP, Casa Neos — updates stations only; REF targets preserved.</p>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Task registered</td><td style="padding:8px 0;text-align:right;font-weight:600;color:' + (msched.exists?'#22c55e':'#ef4444') + '">' + (msched.exists?'Yes':'No') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Schedule</td><td style="padding:8px 0;text-align:right;color:#e8eaed">' + (msched.months||'—') + ' day ' + (msched.days||'—') + ' @ ' + (msched.startTime||'') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Matches 1st @ 9:00</td><td style="padding:8px 0;text-align:right;font-weight:700;color:' + (mschedOk?'#22c55e':'#ef4444') + '">' + (mschedOk?'✅ Yes':'❌ No') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #1e2533"><td style="padding:8px 0;color:#9aa0aa">Next run</td><td style="padding:8px 0;text-align:right;color:#e8eaed">' + (msched.nextRun||'—') + '</td></tr>';
  html += '<tr><td style="padding:8px 0;color:#9aa0aa">Last scrape files</td><td style="padding:8px 0;text-align:right;color:#e8eaed;font-size:12px">';
  (H.prepStationFiles || []).forEach((f, i) => {
    if (i) html += '<br>';
    html += f.venue + ': ' + (f.mtime ? fmtWhen(f.mtime) + ' (' + (f.rows||0) + ' items)' : '<span style="color:#ef4444">not scraped</span>');
  });
  html += '</td></tr></table>';
  if ((H.monthlyPrepSteps || []).length) {
    html += '<ol style="margin:12px 0 0;padding-left:18px;color:#e8eaed;font-size:13px;line-height:1.7">';
    H.monthlyPrepSteps.forEach(s => {
      html += '<li><strong style="color:#d9a441">' + s.name + '</strong> — <span style="color:#9aa0aa">' + s.how + '</span></li>';
    });
    html += '</ol>';
  }
  html += '</div>';

  // What gets updated
  html += '<div class="card">';
  html += '<h2>What Updates Automatically</h2>';
  html += '<p class="note">Cloud pipeline: <code>boh-weekly.yml</code> → <code>weekly-save-cloud.cjs</code> → Firebase <code>/rdg/boh</code> + Pages. Emergency local: <code>weekly-auto-run.bat</code>.</p>';
  html += '<ol style="margin:0;padding-left:18px;color:#e8eaed;font-size:13px;line-height:1.7">';
  (H.pipelineSteps || []).forEach(s => {
    html += '<li><strong style="color:#d9a441">' + s.name + '</strong> — <span style="color:#9aa0aa">' + s.how + '</span></li>';
  });
  html += '</ol></div>';

  // Per-venue sanity
  html += '<div class="card">';
  html += '<h2>Sanity Check by Venue — ' + (H.latestWeek||'') + '</h2>';
  html += '<p class="note">Toast kitchen timing, item details, item fulfillment, OpenTable covers, and processed JSON.</p>';

  (H.venues || []).forEach(v => {
    const vColor = v.overall === 'pass' ? '#22c55e' : (v.overall === 'warn' ? '#f59e0b' : '#ef4444');
    html += '<div style="margin:14px 0;padding:12px 14px;background:#13161c;border:1px solid #1e2533;border-radius:10px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html += '<div style="font-weight:700;color:#d9a441">' + v.label + '</div>';
    html += '<div style="font-size:12px;font-weight:700;color:' + vColor + '">' + String(v.overall||'').toUpperCase() + '</div>';
    html += '</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
    (v.checks || []).forEach(c => {
      html += '<tr style="border-top:1px solid #1e2533">';
      html += '<td style="padding:6px 0;color:#9aa0aa;width:90px">' + c.source + '</td>';
      html += '<td style="padding:6px 0;color:#e8eaed">' + c.label + '</td>';
      html += '<td style="padding:6px 0;color:#9aa0aa">' + c.message + '</td>';
      html += '<td style="padding:6px 0;text-align:right;white-space:nowrap">' + badge(c.status) + '</td>';
      html += '</tr>';
    });
    html += '</table></div>';
  });
  html += '</div>';

  // File freshness
  const files = H.files || {};
  html += '<div class="card">';
  html += '<h2>Key Files Freshness</h2>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:13px">';
  const fileRows = [
    ['Dashboard HTML', files.dashboardHtml],
    ['Rolling data', files.rolling],
    ['Toast session', files.sessionToast],
    ['OpenTable session', files.sessionOT],
    ['Item–Station REF map', files.itemStationMap],
  ];
  fileRows.forEach(([label, meta]) => {
    html += '<tr style="border-bottom:1px solid #1e2533">';
    html += '<td style="padding:8px 0;color:#9aa0aa">' + label + '</td>';
    html += '<td style="padding:8px 0;text-align:right;color:#e8eaed">' + (meta ? fmtWhen(meta.mtime) : '<span style="color:#ef4444">Missing</span>') + '</td>';
    html += '</tr>';
  });
  html += '</table>';
  html += '<p class="note" style="margin-top:12px">Manual re-check anytime: <code>node pipeline-health.cjs</code> then <code>node build-unified-v2.cjs</code></p>';
  html += '</div>';

  root.innerHTML = html;
}

// ============================================================
// RENDER ALL
// ============================================================
function renderAll() {
  // RDG Portfolio is not a real venue week — only render Group aggregator + settings
  if (currentVenue === 'rdg_portfolio') {
    renderGroup();
    renderSettings();
    const pageSum = document.getElementById('pageSummary');
    if (pageSum) pageSum.innerHTML = 'RDG Portfolio compares Claudie, Casa Neos, AVA Coconut Grove, AVA Winter Park, and MILA for the selected week. Pick a location pill to drill into station detail.';
    const sbc = document.getElementById('serviceBreakCard');
    if (sbc) sbc.style.display = 'none';
    const ov = document.getElementById('overviewStaffingCard');
    if (ov) ov.style.display = 'none';
    return;
  }
  applyDerivedStationTargets();
  // Keep day selection; sync toggle UI to current pressureDay
  const wrap = document.getElementById('pressureDayToggle');
  if (wrap) {
    wrap.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-day') === pressureDay);
    });
  }
  renderKPIs();
  renderStationsRecap();
  renderPressure();
  renderStaffingGrid();
  renderServiceBreakTimeline();
  renderBreaking();
  renderLoadPerf();
  render3D();
  renderHeatmaps();
  renderStationWoW();
  renderStations();
  renderMenuItems();
  renderAssignment();
  renderGroup();
  renderSettings();
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
  const pills = [...Object.entries(VENUE_LABELS), ['rdg_portfolio', 'RDG Portfolio']];
  pills.forEach(([key, label]) => {
    const btn = document.createElement('button');
    btn.className = 'venue-pill' + (key === currentVenue ? ' active' : '');
    btn.textContent = label;
    btn.dataset.venue = key;
    btn.onclick = () => {
      currentVenue = key;
      _serviceBreakDay = null;
      document.querySelectorAll('.venue-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('dashTitle').textContent = label + ' · BOH Dashboard';
      if (key === 'rdg_portfolio') {
        // Portfolio is a client-side aggregator — open Group tab, never feed empty getD() into charts
        const groupBtn = [...document.querySelectorAll('.tab-btn')].find(b => (b.getAttribute('onclick')||'').includes("'group'"));
        if (groupBtn) switchTab('group', groupBtn);
      }
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
  _serviceBreakDay = null;
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
document.addEventListener('DOMContentLoaded', async () => {
  initVenuePills();
  // Embedded fallback first, then prefer Firebase live weeks (DJ-style)
  currentWeekIdx = WEEKS.length - 1;
  const dd = document.getElementById('weekDropdown');
  if (dd) dd.value = currentWeekIdx;
  const wpBtn = document.getElementById('weekPrev');
  const wnBtn = document.getElementById('weekNext');
  if (wpBtn) wpBtn.disabled = currentWeekIdx === 0;
  if (wnBtn) wnBtn.disabled = currentWeekIdx >= WEEKS.length - 1;

  renderAll();
  try {
    const loaded = await loadBohFromFirebase();
    if (loaded) {
      if (wpBtn) wpBtn.disabled = currentWeekIdx === 0;
      if (wnBtn) wnBtn.disabled = currentWeekIdx >= WEEKS.length - 1;
      renderAll();
    } else {
      renderSettings();
    }
  } catch (e) {
    console.warn(e);
    renderSettings();
  }

  const currentWeekKey = WEEKS[currentWeekIdx]?.key || '';
  const lastSeen = localStorage.getItem('boh_last_seen_week');
  if (lastSeen !== currentWeekKey && currentWeekKey) {
    showWeekWelcomePopup(currentWeekKey);
  }
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
