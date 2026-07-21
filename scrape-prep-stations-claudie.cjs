'use strict';
// Backward-compatible wrapper — scrapes Claudie only
require('child_process').execSync('node scrape-prep-stations-all.cjs claudie', {
  stdio: 'inherit',
  cwd: __dirname,
});
