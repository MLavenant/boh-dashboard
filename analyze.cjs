'use strict';
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('dashboard.html', 'utf8');

console.log('Has weekPrev element:', html.includes('id="weekPrev"'));
console.log('Has weekNext element:', html.includes('id="weekNext"'));

const scriptStart = html.indexOf('<script>', 22000);
const scriptEnd = html.indexOf('</script>', scriptStart);
const scriptContent = html.slice(scriptStart + 8, scriptEnd);

try {
  new vm.Script(scriptContent);
  console.log('✅ Script compiles without syntax errors!');
} catch (e) {
  console.log('❌ SYNTAX ERROR:', e.message);
}

// Verify DOMContentLoaded has null guards
const dclIdx = scriptContent.indexOf('DOMContentLoaded');
console.log('\nDOMContentLoaded block:');
console.log(scriptContent.slice(dclIdx - 10, dclIdx + 350));
