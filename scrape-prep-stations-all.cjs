'use strict';
/**
 * Scrape Toast Advanced Properties Bulk Editor prep stations for RDG venues.
 * Merges stations into item-station-map.json — never overwrites REF/TARGET targetSec.
 *
 * Usage: node scrape-prep-stations-all.cjs [claudie ava_cg ava_wp casa_neos]
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const ROOT = __dirname;
const SESSION_FILE = path.join(ROOT, 'toast-session.json');
const MAP_FILE = path.join(ROOT, 'item-station-map.json');
const BULK_URL = 'https://www.toasttab.com/advancedproperties/bulkeditor';

const VENUE_CONFIGS = {
  claudie: {
    mapKey: 'claudie',
    selectedSet: '500000037853698711',
    menuMatch(name) {
      return /^(DINNER|LUNCH)$/i.test(clean(name));
    },
    confirmSample(sample) {
      return sample.some(s => /^(DINNER|LUNCH) @/i.test(s) && /claudie/i.test(s));
    },
  },
  ava_cg: {
    mapKey: 'ava_cg',
    selectedSet: '500000056033936853',
    menuMatch(name) {
      const n = clean(name);
      return /^food(\s+menu)?$/i.test(n) || n === 'Food';
    },
    confirmSample(sample) {
      return sample.some(s => /coconut grove/i.test(s));
    },
  },
  ava_wp: {
    mapKey: 'ava_wp',
    selectedSet: '500000013674501001',
    menuMatch(name) {
      const n = clean(name);
      if (/wine|drink|bar|coffee|retail|reservation|n\s*\/\s*a bev/i.test(n)) return false;
      return /dinner food menu|^dinner$|^lunch$|brunch menu/i.test(n);
    },
    confirmSample(sample) {
      return sample.some(s => /AVA MediterrAegean/i.test(s) && !/coconut/i.test(s));
    },
  },
  casa_neos: {
    mapKey: 'casa_neos',
    selectedSet: '500000037911188149',
    menuMatch(name) {
      const n = clean(name);
      return /^(C-FOOD|C-BRUNCH|AVA MediterrAegean Dinner Food Menu|AVA MM Dinner Menu|Brunch Menu|Dinner Food Menu)$/i.test(n);
    },
    confirmSample(sample) {
      return sample.some(s => /casa neos/i.test(s));
    },
  },
};

function clean(s) {
  return String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function isFoodStation(name) {
  const n = clean(name).toLowerCase();
  if (!n) return false;
  return !['bar', 'champagne', 'wine', 'btg', 'pos', 'barista', 'somm', 'water', 'service', 'beach', 'btl', 'drink expo', 'drinks'].some(p => n.includes(p));
}

function parsePrepStationMap(html) {
  const map = {};
  const idx = html.search(/['\"]prep-station['\"]\s*:/);
  if (idx < 0) return map;
  const slice = html.slice(idx, idx + 25000);
  const re = /\{id:"(\d+)",name:"((?:\\.|[^"\\])*)"\}/g;
  let m;
  while ((m = re.exec(slice))) {
    map[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\//g, '/');
  }
  return map;
}

async function ensureSession(context, page) {
  await page.goto('https://www.toasttab.com/restaurants/admin/home', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  for (let i = 0; i < 20; i++) {
    const title = await page.title().catch(() => '');
    if (!/just a moment/i.test(title)) break;
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(1500);
  if (!/\/login/i.test(page.url())) {
    console.log('Session OK');
    return;
  }
  console.log('Session expired — logging in (complete 2FA if prompted)...');
  await page.goto('https://www.toasttab.com/restaurants/admin/login', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(2000);
  const emailSel = 'input[type="text"], input[type="email"], input[name="username"], input[name="email"]';
  await page.waitForSelector(emailSel, { state: 'visible', timeout: 90000 });
  await page.fill(emailSel, process.env.TOAST_EMAIL || '');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 30000 });
  await page.fill('input[type="password"]', process.env.TOAST_PASSWORD || '');
  await page.click('button[type="submit"]');
  console.log('Waiting for login / 2FA (up to 180s)...');
  await page.waitForURL(u => /toasttab\.com/i.test(u.href) && !/\/login/i.test(u.href), { timeout: 180000 });
  await context.storageState({ path: SESSION_FILE });
  console.log('Session saved.');
}

async function dismissOverlays(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[id*="fides"], [class*="fides"], #fides-overlay').forEach(el => el.remove());
    document.querySelectorAll('button').forEach(b => {
      const t = (b.textContent || '').trim();
      if (/opt out of all|opt in to all|got it/i.test(t)) b.click();
    });
  }).catch(() => {});
  await page.waitForTimeout(400);
}

async function listChildren(page, entityType, entityId, archiveMode = 'true') {
  const params = new URLSearchParams({ entityType, archiveMode });
  if (entityId) params.set('entityId', String(entityId));
  const url = `/advancedproperties/listchildren?${params}`;
  return page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { error: t.slice(0, 200) }; }
  }, url);
}

async function switchVenue(page, cfg) {
  console.log(`\n=== ${cfg.mapKey.toUpperCase()} — selectedSet ${cfg.selectedSet} ===`);
  const result = await page.evaluate(async (id) => {
    const body = new URLSearchParams({ selectedSets: id, selectedSetsChanged: 'true' });
    const r = await fetch('/advancedproperties/updateselectedsets', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'follow',
    });
    return { status: r.status, html: await r.text() };
  }, cfg.selectedSet);
  console.log('updateselectedsets →', result.status);

  const stationMap = parsePrepStationMap(result.html || '');
  const top = await listChildren(page, 'Restaurant');
  const sample = (top.children || []).slice(0, 8).map(c => `${c.name} @ ${c.targetname}`);
  console.log('Menus:', sample.join(' | '));

  if (!cfg.confirmSample(sample)) {
    console.warn(`WARNING: ${cfg.mapKey} context not confirmed — available: ${sample.join(' | ')}`);
  }
  return { stationMap, top };
}

async function walkMenus(page, stationIdToName, menuMatch) {
  const items = [];
  const top = await listChildren(page, 'Restaurant');
  if (!top?.children) throw new Error('listchildren Restaurant failed');

  const menuList = top.children.filter(c => c?.entityType === 'Menu' && menuMatch(c.name || ''));
  console.log('Scraping menus:', menuList.map(m => m.name).join(', ') || '(none)');
  if (!menuList.length) {
    console.log('All menus:', top.children.filter(c => c?.name).map(c => c.name).join(' | '));
  }

  for (const menu of menuList) {
    const menuName = clean(menu.name);
    let groupsResp = await listChildren(page, menu.entityType, menu.entityIdString);
    let groups = (groupsResp.children || []).filter(c => c?.entityType === 'MenuGroup' && c.entityIdString);
    if (!groups.length && menu.masterIdString) {
      groupsResp = await listChildren(page, menu.entityType, menu.masterIdString);
      groups = (groupsResp.children || []).filter(c => c?.entityType === 'MenuGroup' && c.entityIdString);
    }
    console.log(`  ${menuName}: ${groups.length} groups`);

    for (const group of groups) {
      const groupName = clean(group.name);
      const itemsResp = await listChildren(page, group.entityType, group.entityIdString);
      const children = (itemsResp.children || []).filter(c => c?.name && c.entityIdString);
      const queue = children.map(c => ({ ...c, _menu: menuName, _group: groupName }));

      while (queue.length) {
        const node = queue.shift();
        if (node.entityType === 'MenuGroup' && node.hasChildren) {
          const nested = await listChildren(page, node.entityType, node.entityIdString);
          for (const ch of (nested.children || [])) {
            if (ch?.name && ch.entityIdString) {
              queue.push({ ...ch, _menu: menuName, _group: clean(node.name) });
            }
          }
          continue;
        }
        if (node.entityType !== 'MenuItem') continue;

        const ids = Array.isArray(node['prep-station']) ? node['prep-station'] : [];
        const stationsRaw = ids.map(id => stationIdToName[String(id)] || String(id));
        const stations = [...new Set(stationsRaw.map(clean).filter(isFoodStation))];
        items.push({
          menuItem: clean(node.name),
          guid: String(node.entityIdString || node.masterIdString || ''),
          menu: node._menu,
          group: node._group,
          stations,
          stationsRaw,
        });
      }
    }
  }

  const map = {};
  for (const it of items) {
    if (!map[it.menuItem] || it.stations.length > map[it.menuItem].stations.length) {
      map[it.menuItem] = it;
    }
  }
  return Object.values(map);
}

function mergeIntoMap(mapKey, items) {
  let map = {};
  if (fs.existsSync(MAP_FILE)) map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  if (!map[mapKey]) map[mapKey] = {};

  let added = 0, updated = 0, kept = 0;
  for (const it of items) {
    const stations = (it.stations || []).filter(s => s && !/^\d{10,}$/.test(String(s)));
    if (!stations.length) { kept++; continue; }
    const existing = map[mapKey][it.menuItem];
    if (!existing) {
      map[mapKey][it.menuItem] = { stations, targetSec: 0, source: 'toast-bulkeditor' };
      added++;
      continue;
    }
    const prev = existing.stations || [];
    const same = prev.length === stations.length && prev.every(s => stations.includes(s));
    if (!same) updated++;
    map[mapKey][it.menuItem] = {
      stations,
      targetSec: existing.targetSec || 0,
      source: existing.targetSec ? 'ref+toast' : (existing.source || 'toast-bulkeditor'),
    };
  }
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2));
  console.log(`${mapKey} merge: +${added} new, ${updated} routes updated, ${kept} empty`);
  console.log(`${mapKey} total: ${Object.keys(map[mapKey]).length}`);
}

async function scrapeVenue(page, cfg) {
  const { stationMap } = await switchVenue(page, cfg);
  if (Object.keys(stationMap).length < 3) {
    throw new Error(`${cfg.mapKey}: prep station name map missing`);
  }
  const items = await walkMenus(page, stationMap, cfg.menuMatch);
  const outFile = path.join(ROOT, 'data', `prep-stations-${cfg.mapKey}.json`);
  const payload = {
    venue: cfg.mapKey,
    scrapedAt: new Date().toISOString(),
    source: BULK_URL,
    itemCount: items.length,
    prepStationLookup: stationMap,
    items: items.sort((a, b) => a.menuItem.localeCompare(b.menuItem)),
  };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`✅ Wrote ${outFile} (${items.length} items)`);
  if (items.length) {
    console.log('Sample:', items.slice(0, 3).map(i =>
      `${i.menuItem} → ${i.stations.join(', ')} [${i.menu}/${i.group}]`
    ).join('\n  '));
  }
  mergeIntoMap(cfg.mapKey, items);
  return items.length;
}

async function run() {
  const args = process.argv.slice(2).filter(Boolean);
  const keys = args.length ? args : Object.keys(VENUE_CONFIGS);
  const venues = keys.map(k => {
    const cfg = VENUE_CONFIGS[k];
    if (!cfg) throw new Error(`Unknown venue: ${k}`);
    return cfg;
  });

  if (!fs.existsSync(path.join(ROOT, 'data'))) fs.mkdirSync(path.join(ROOT, 'data'));

  const hasSession = fs.existsSync(SESSION_FILE);
  const browser = await chromium.launch({ headless: false, slowMo: 30, args: ['--start-maximized'] });
  const context = await browser.newContext({
    ...(hasSession ? { storageState: SESSION_FILE } : {}),
    viewport: { width: 1600, height: 1000 },
  });
  context.setDefaultTimeout(90000);
  const page = await context.newPage();

  await ensureSession(context, page);
  await page.goto(BULK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await dismissOverlays(page);

  const results = {};
  for (const cfg of venues) {
    try {
      results[cfg.mapKey] = await scrapeVenue(page, cfg);
    } catch (e) {
      console.error(`❌ ${cfg.mapKey} failed:`, e.message);
      results[cfg.mapKey] = 0;
    }
  }

  console.log('\n=== Summary ===', results);
  await context.storageState({ path: SESSION_FILE }).catch(() => {});
  await browser.close();
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
