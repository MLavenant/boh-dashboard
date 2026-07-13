const d = require('fs').readFileSync('test-custom-report.bin').toString('utf8');
const s3 = d.match(/https?:\/\/[^\s"'<>]+\.s3[^\s"'<>]+/g);
console.log('S3 urls:', s3 ? s3.slice(0,5) : 'none');
const dl = d.match(/downloadUrl[^\n]{0,200}/gi);
console.log('downloadUrl mentions:', dl ? dl.slice(0,3) : 'none');
// Look for location header or redirect
const loc = d.match(/location[^\n]{0,200}/gi);
console.log('location mentions:', loc ? loc.slice(0,3) : 'none');
// Check if it looks like a login page
console.log('Is login page?', d.includes('login') || d.includes('Login'));
console.log('Page title:', d.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]);
