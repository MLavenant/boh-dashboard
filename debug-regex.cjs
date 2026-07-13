const fs = require('fs');
const html = fs.readFileSync('C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html', 'latin1');

const date  = '2026-07-11';
const venue = 'Casa Neos Beach Club';

// Find the raw context around this date
const idx = html.indexOf('"' + date + '"');
if (idx >= 0) {
  const ctx = html.substring(idx - 100, idx + 300);
  console.log('CONTEXT:\n', ctx);
  console.log('\nHas bs_a null?', ctx.includes('bs_a:null'));
  console.log('Has bs_a: null?', ctx.includes('bs_a": null'));
  console.log('Has bs_a :null?', ctx.includes('bs_a :null'));
}

// Test simple replace
const simple = html.replace(/"d":"2026-07-11"([^}]*)"bs_a":null/, '"d":"2026-07-11"$1"bs_a":12345');
if (simple !== html) {
  console.log('\nSimple replace WORKED');
} else {
  console.log('\nSimple replace FAILED');
  // Try to see exact chars around bs_a
  const bsIdx = html.indexOf('bs_a', idx);
  if (bsIdx >= 0) {
    console.log('bs_a context:', JSON.stringify(html.substring(bsIdx, bsIdx + 20)));
  }
}
