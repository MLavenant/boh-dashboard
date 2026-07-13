const fs = require('fs');

const d = JSON.parse(fs.readFileSync('C:/Cursor/toast-mcp-server/ava_coconut_grove-data.json', 'utf8'));

// Targets derived from AVA CG BOH DASHBOARD Excel (STATIONS HOURLY sheet)
// Where multiple numbered stations map to one new generic name, use average
const TARGETS = {
  'Cold Expo':  Math.round((350 + 515) / 2),   // Cold Expo 1 + Cold Expo 2 avg
  'Hot Expo':   Math.round((582 + 711) / 2),    // Hot Expo 1 + Hot expo 2 avg
  'Fish':       674,
  'Fry':        Math.round((615 + 548) / 2),   // Fry 1 + Fry 2 avg
  'Pastry':     Math.round((497 + 538) / 2),   // Pastry 1 + Pastry 2 avg
  'Saute':      Math.round((615 + 743 + 731) / 3), // Sautee 2 + Sauteed 1+2 Sides avg
  'Meat':       770,
  'Pasta':      655,
  'Salad':      348,  // Garde Manger 1 target (prep station doing salads/garde)
  'Crudo':      509,  // Raw 2 target (raw/crudo prep)
  'Fish Market':674,  // Same as Fish station
  // No Print, Oven, Pizza have no direct target → leave 0
};

let changed = 0;
d.stations.forEach(s => {
  if (TARGETS[s.station] !== undefined) {
    s.exp_sec = TARGETS[s.station];
    changed++;
  }
});

fs.writeFileSync('C:/Cursor/toast-mcp-server/ava_coconut_grove-data.json', JSON.stringify(d));
console.log(`Patched ${changed} stations with exp_sec targets`);
d.stations.forEach(s => console.log(`  ${s.station}: exp_sec=${s.exp_sec}`));
