'use strict';
const fs = require('fs');
const html = fs.readFileSync('dashboard.html', 'utf8');
const scriptStart = html.indexOf('<script>', 22000);
const scriptEnd = html.indexOf('</script>', scriptStart);
const scriptContent = html.slice(scriptStart + 8, scriptEnd);
console.log('Script length chars:', scriptContent.length);

// Check TBK usage
const tbkIdx = scriptContent.indexOf('const TBK');
console.log('\nTBK usage (200 chars):');
console.log(scriptContent.slice(tbkIdx, tbkIdx + 200));

// Check Chart.defaults position
const cdIdx = scriptContent.indexOf('Chart.defaults');
console.log('\nChart.defaults at char:', cdIdx);
console.log('Context around Chart.defaults:');
console.log(scriptContent.slice(Math.max(0, cdIdx - 80), cdIdx + 80));

// Count backticks
let btCount = 0;
for (let i = 0; i < scriptContent.length; i++) {
  if (scriptContent[i] === '`') btCount++;
}
console.log('\nBacktick count in script:', btCount);

// Check DOMContentLoaded
const dclIdx = scriptContent.indexOf('DOMContentLoaded');
console.log('\nDOMContentLoaded block:');
console.log(scriptContent.slice(dclIdx - 10, dclIdx + 250));

// Check for \' patterns that might be problematic
let singleEscCount = 0;
let idx = 0;
while ((idx = scriptContent.indexOf("\\'" , idx)) !== -1) { singleEscCount++; idx++; }
console.log('\nOccurrences of backslash-quote in script:', singleEscCount);
const singleEscIdx = scriptContent.indexOf("\\'");
if (singleEscIdx >= 0) {
  console.log('First occurrence context:');
  console.log(scriptContent.slice(Math.max(0, singleEscIdx - 80), singleEscIdx + 80));
}

// Look for renderLoadPerf
const rlfIdx = scriptContent.indexOf('function renderLoadPerf');
console.log('\nrenderLoadPerf function start:');
console.log(scriptContent.slice(rlfIdx, rlfIdx + 300));
