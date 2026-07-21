/**
 * Encode full FourVenues session for GitHub Actions (gzip + base64).
 * Fits under GitHub's ~64KB secret limit while keeping full auth/localStorage.
 *
 *   node prepare-fv-session-slim.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

const SRC = path.join(__dirname, 'fv-final-session.json');
const OUT_B64 = path.join(__dirname, 'fv-session.b64.txt');
const LIMIT = 60000;

if (!fs.existsSync(SRC)) {
  console.error('Missing', SRC, '— run: node fv-relogin-save.cjs');
  process.exit(1);
}

const raw = fs.readFileSync(SRC);
const gz = zlib.gzipSync(raw, { level: 9 });
const b64 = gz.toString('base64');
fs.writeFileSync(OUT_B64, b64);

console.log('');
console.log('FV session for GitHub secret');
console.log('  raw json:  ', raw.length, 'bytes');
console.log('  gzip:      ', gz.length, 'bytes');
console.log('  b64 chars: ', b64.length, b64.length < LIMIT ? '(fits)' : '(TOO BIG)');
console.log('');

if (b64.length >= LIMIT) {
  console.error('Still too large for one secret');
  process.exit(1);
}

try {
  execSync(
    `powershell -NoProfile -Command "Set-Clipboard -Value (Get-Content -Raw '${OUT_B64.replace(/'/g, "''")}')"`,
    { stdio: 'inherit' }
  );
  console.log('Copied FV_SESSION_B64 to clipboard (gzip+base64 full session).');
} catch (_) {
  console.log('Open and copy:', OUT_B64);
}

console.log('Update secret: https://github.com/MLavenant/boh-dashboard/settings/secrets/actions');
console.log('  Name: FV_SESSION_B64');
console.log('  Value: Ctrl+V');
console.log('');
