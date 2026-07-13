const station = 'Cold Expo 1';
try {
  const re = new RegExp(station.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'i');
  console.log('OK:', re.toString());
} catch(e) {
  console.log('ERROR:', e.message);
}
