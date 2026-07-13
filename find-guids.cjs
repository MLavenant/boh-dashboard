const fs = require('fs');

// Check captured.json for restaurantGuid values
try {
  const d = JSON.parse(fs.readFileSync('captured.json', 'utf8'));
  const hits = d.filter(x => x.type === 'response' && x.body && x.body.includes('restaurantGuid'));
  hits.forEach(x => {
    const m = x.body.match(/"restaurantGuid"\s*:\s*"([a-f0-9-]{36})"/);
    if (m) console.log(x.url.slice(0, 120), '->', m[1]);
  });
} catch(e) { console.log('captured.json error:', e.message); }

// Also check the session
const session = JSON.parse(fs.readFileSync('toast-session.json', 'utf8'));
const toastSession = session.cookies.find(c => c.name === 'TOAST_SESSION');
if (toastSession) {
  const decoded = decodeURIComponent(toastSession.value);
  const m = decoded.match(/rGuid=([a-f0-9-]{36})/);
  console.log('Session rGuid (last active restaurant):', m ? m[1] : 'not found');
}
