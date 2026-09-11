'use strict';
/**
 * Refresh Toast prep-station assignments via Menus API (no Bulk Editor / Cloudflare).
 * Usage: node refresh-prep-from-api.cjs [mila]
 *
 * Resolves prepStation GUIDs → names using prior item-station-map votes + sushi heuristics,
 * writes data/prep-stations-{venue}.json for extract-item-stations.cjs.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

const MCP = 'C:\\Cursor\\toast-mcp-server';
dotenv.config({ path: path.join(MCP, '.env'), override: true });
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

const { isFoodStationName } = require('./food-station.cjs');

const TOAST_BASE = 'https://ws-api.toasttab.com';
const GUID_MILA = process.env.GUID_MILA;
const OUT_MENU = path.join(__dirname, 'data', 'menu-mila-raw.json');
const OUT_PREP = path.join(__dirname, 'data', 'prep-stations-mila.json');
const MAP_FILE = path.join(__dirname, 'item-station-map.json');

async function getToken() {
  const res = await axios.post(`${TOAST_BASE}/authentication/v1/authentication/login`, {
    clientId: process.env.TOAST_CLIENT_ID,
    clientSecret: process.env.TOAST_API_SECRET || process.env.TOAST_CLIENT_SECRET,
    userAccessType: 'TOAST_MACHINE_CLIENT',
  });
  return res.data.token.accessToken;
}

async function toastGet(apiPath, token, venueGuid) {
  const res = await axios.get(`${TOAST_BASE}${apiPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Toast-Restaurant-External-ID': venueGuid,
      'Content-Type': 'application/json',
    },
    validateStatus: () => true,
  });
  if (res.status >= 400) {
    throw new Error(`${apiPath} → ${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
  }
  return res.data;
}

function walkItems(data) {
  const out = [];
  const menus = data.menus || [];
  for (const menu of menus) {
    const walkGroup = (group, menuName, parentGroup = '') => {
      const groupName = group.name || parentGroup;
      for (const it of group.menuItems || []) {
        out.push({
          menuItem: it.name,
          guid: String(it.multiLocationId || it.guid || ''),
          menu: menuName,
          group: groupName,
          prepGuids: Array.isArray(it.prepStations) ? it.prepStations.slice() : [],
        });
      }
      for (const nested of group.menuGroups || []) {
        walkGroup(nested, menuName, groupName);
      }
    };
    for (const g of menu.menuGroups || []) walkGroup(g, menu.name || '');
  }
  return out;
}

function looksLikeSushiItem(name) {
  return /\b(nigiri|sashimi|maki|omakase|ikura|toro|uni|hotate|hamachi|maguro|chirashi|hand\s*roll|sushi|temaki|uramaki|hosomaki)\b/i.test(
    String(name || '')
  );
}

function resolveGuidNames(menuItems, milaMap, apiStations) {
  const guidToName = {};
  if (apiStations && typeof apiStations === 'object') {
    const list = Array.isArray(apiStations) ? apiStations : Object.values(apiStations);
    for (const st of list) {
      const id = st.guid || st.id || st.entityGuid;
      const name = st.name || st.stationName || st.label;
      if (id && name) guidToName[String(id)] = String(name);
    }
  }

  // Vote from existing named map
  const votes = new Map();
  for (const it of menuItems) {
    const known = milaMap[it.menuItem];
    if (!known?.stations?.length || !it.prepGuids.length) continue;
    const named = known.stations.filter(isFoodStationName);
    if (!named.length) continue;
    if (named.length === it.prepGuids.length) {
      for (let i = 0; i < named.length; i++) {
        const g = it.prepGuids[i];
        if (!votes.has(g)) votes.set(g, new Map());
        const m = votes.get(g);
        m.set(named[i], (m.get(named[i]) || 0) + 3);
      }
    } else {
      for (const g of it.prepGuids) {
        if (!votes.has(g)) votes.set(g, new Map());
        const m = votes.get(g);
        for (const n of named) m.set(n, (m.get(n) || 0) + 1);
      }
    }
  }
  for (const [g, m] of votes) {
    if (guidToName[g]) continue;
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) guidToName[g] = best[0];
  }

  // Sushi Bar: GUID most specific to sushi-named items
  const sushiVotes = new Map();
  const overallVotes = new Map();
  for (const it of menuItems) {
    for (const g of it.prepGuids) {
      overallVotes.set(g, (overallVotes.get(g) || 0) + 1);
      if (looksLikeSushiItem(it.menuItem)) sushiVotes.set(g, (sushiVotes.get(g) || 0) + 1);
    }
  }
  const ranked = [...sushiVotes.entries()]
    .map(([g, n]) => ({ g, n, overall: overallVotes.get(g) || 0, share: n / Math.max(1, overallVotes.get(g) || 0) }))
    .sort((a, b) => b.share - a.share || b.n - a.n);
  console.log('Top sushi GUID candidates:', ranked.slice(0, 6));

  const hasSushi = Object.values(guidToName).some((n) => /\bsushi\s*bar\b/i.test(n));
  if (!hasSushi) {
    const pick = ranked.find((r) => r.n >= 8 && r.share >= 0.35) || ranked[0];
    if (pick) {
      guidToName[pick.g] = 'Sushi Bar';
      console.log('Mapped', pick.g, '→ Sushi Bar (sushi items', pick.n, 'share', pick.share.toFixed(2), ')');
    }
  }
  return guidToName;
}

async function main() {
  if (!GUID_MILA) throw new Error('GUID_MILA missing in .env');
  const token = await getToken();
  console.log('Token OK, fetching menus…');
  const menu = await toastGet('/menus/v2/menus', token, GUID_MILA);
  fs.writeFileSync(OUT_MENU, JSON.stringify(menu, null, 2));
  console.log('Saved', OUT_MENU, 'bytes', fs.statSync(OUT_MENU).size);

  // Try config endpoints for prep station names
  const tryPaths = [
    '/config/v2/prepStations',
    '/config/v2/prepstations',
    '/restaurants/v1/prepStations',
    '/menus/v2/prepStations',
  ];
  let apiStations = null;
  for (const p of tryPaths) {
    try {
      apiStations = await toastGet(p, token, GUID_MILA);
      console.log('API stations from', p, Array.isArray(apiStations) ? apiStations.length : typeof apiStations);
      fs.writeFileSync(path.join(__dirname, 'data', 'prep-station-api-mila.json'), JSON.stringify(apiStations, null, 2));
      break;
    } catch (e) {
      console.log('skip', p, e.message.slice(0, 120));
    }
  }

  const menuItems = walkItems(menu);
  console.log('menu items', menuItems.length);
  const milaMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')).mila || {};
  const guidToName = resolveGuidNames(menuItems, milaMap, apiStations);

  // If API returned named stations, print them
  console.log('GUID map:', guidToName);

  const byName = {};
  for (const it of menuItems) {
    if (!it.menuItem) continue;
    const stationsRaw = it.prepGuids.map((g) => guidToName[g] || g);
    let stations = [...new Set(stationsRaw.filter((s) => isFoodStationName(s) && !/^[0-9a-f-]{36}$/i.test(s)))];
    if (looksLikeSushiItem(it.menuItem) && !stations.some((s) => /sushi/i.test(s))) {
      stations = ['Sushi Bar', ...stations.filter((s) => !/^[0-9a-f-]{36}$/i.test(s))];
    }
    const row = {
      menuItem: it.menuItem,
      guid: it.guid,
      menu: it.menu,
      group: it.group,
      stations,
      stationsRaw,
    };
    if (!byName[it.menuItem] || row.stations.length > byName[it.menuItem].stations.length) {
      byName[it.menuItem] = row;
    }
  }
  const items = Object.values(byName).sort((a, b) => a.menuItem.localeCompare(b.menuItem));
  const sushi = items.filter((i) => i.stations.some((s) => /sushi/i.test(s)));
  const payload = {
    venue: 'mila',
    scrapedAt: new Date().toISOString(),
    source: 'toast-api-menus-v2',
    itemCount: items.length,
    prepStationLookup: guidToName,
    items,
  };
  fs.writeFileSync(OUT_PREP, JSON.stringify(payload, null, 2));
  console.log('Wrote', OUT_PREP);
  console.log('items', items.length, 'sushi-routed', sushi.length);
  console.log('Ikura', byName['M-Ikura Nigiri']);
  console.log('sample sushi', sushi.slice(0, 10).map((i) => `${i.menuItem} → ${i.stations.join(', ')}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
