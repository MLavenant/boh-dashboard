/**
 * Auto-send Forecast "Send all emails" flash (Mon–Fri).
 *
 * Gates:
 *   - America/New_York weekdays only
 *   - Only at/after 9:00 ET (primary); 9:30 ET is the final attempt
 *   - FourVenues scrapeStatus must be ok for Miami today (forecast BS Actual)
 *   - At most one flash email per Miami day (Firebase lock)
 *
 * If 9:00 cannot send (FV not ready / capture/send error), 9:30 retries.
 * If 9:30 still fails, one failure alert goes to FORECAST_EMAIL_ALERT_TO
 * (default matthias@rivieradininggroup.com).
 *
 * Env:
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, GRAPH_MAILBOX
 *   FORECAST_EMAIL_ATTEMPT=900|930|auto  (optional; auto uses clock)
 *   FORECAST_EMAIL_ALERT_TO  (optional)
 *   FORECAST_DASHBOARD_URL   (optional; default GitHub Pages)
 *
 * Usage:
 *   node send-forecast-flash-email.cjs
 */
'use strict';

const https = require('https');
const { chromium } = require('playwright');
const { sendMail } = require('./ms-graph-mail.cjs');

const FB_DB = 'rdg-dj-dashboard-default-rtdb.firebaseio.com';
const DASH_URL = process.env.FORECAST_DASHBOARD_URL || 'https://mlavenant.github.io/rdg-dj/';
const ALERT_TO = (process.env.FORECAST_EMAIL_ALERT_TO || 'matthias@rivieradininggroup.com').trim();

const FCAST_TO = [
  'michael@rivieradininggroup.com',
  'fabien@rivieradininggroup.com',
  'greg@rivieradininggroup.com',
  'marine@rivieradininggroup.com',
  'sheena@rivieradininggroup.com'
];
const FCAST_CC = [
  'Salesteam@rivieradininggroup.com',
  'matthias@rivieradininggroup.com',
  'takuma@rivieradininggroup.com',
  'VIP@rivieradininggroup.com',
  'yulyana@rivieradininggroup.com',
  'g.moorefield@rivieradininggroup.com',
  'Perrine@rivieradininggroup.com',
  'j.costini@rivieradininggroup.com'
];

const VENUES = ['Casa Neos Beach Club', 'MILA Lounge', 'Casa Neos Lounge'];

function log(msg) {
  console.log(`[forecast-email ${new Date().toISOString()}] ${msg}`);
}

function miamiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function etParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = t => (parts.find(p => p.type === t) || {}).value;
  const weekday = get('weekday');
  const dowMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return {
    weekday,
    dow: dowMap[weekday] || 0,
    hour,
    minute,
    mins: hour * 60 + minute,
    date: miamiToday()
  };
}

function fbPut(fbPath, payload) {
  return new Promise((res, rej) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: FB_DB,
      path: fbPath + '.json',
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, r => {
      r.resume();
      r.on('end', () => res(r.statusCode));
    });
    req.on('error', rej);
    req.write(body);
    req.end();
  });
}

function fbGet(fbPath) {
  return new Promise((res, rej) => {
    const req = https.request({
      hostname: FB_DB,
      path: fbPath + '.json',
      method: 'GET'
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        if (r.statusCode < 200 || r.statusCode >= 300) {
          return rej(new Error(`Firebase GET ${fbPath} → HTTP ${r.statusCode}`));
        }
        try { res(d ? JSON.parse(d) : null); }
        catch (e) { rej(e); }
      });
    });
    req.on('error', rej);
    req.end();
  });
}

function venueShortFile(v) {
  if (/Beach Club/i.test(v)) return 'Casa-Neos-BC';
  if (/Casa Neos Lounge/i.test(v)) return 'Casa-Neos-Lounge';
  if (/MILA/i.test(v)) return 'MILA-Lounge';
  return String(v || 'Venue').replace(/\s+/g, '-');
}

function isoWeekNum(d = new Date()) {
  const key = (() => {
    try {
      /* Match dashboard getISOWeek if available later; fallback ISO. */
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = t.getUTCDay() || 7;
      t.setUTCDate(t.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
      return Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
    } catch (_) { return ''; }
  })();
  return String(key);
}

/** Minimal PDF: one JPEG image per page (Letter landscape). */
function buildPdfFromJpegs(jpegBuffers, pageW, pageH) {
  const chunks = [];
  function add(strOrBuf) {
    if (Buffer.isBuffer(strOrBuf)) chunks.push(strOrBuf);
    else chunks.push(Buffer.from(String(strOrBuf), 'utf8'));
  }
  const objStarts = [];
  function startObj(n) {
    objStarts[n] = Buffer.concat(chunks).length;
  }

  add('%PDF-1.4\n');
  startObj(1);
  add('1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n');

  const pageIds = jpegBuffers.map((_, i) => 10 + i * 3);
  startObj(2);
  add(`2 0 obj<< /Type /Pages /Kids [ ${pageIds.map(id => id + ' 0 R').join(' ')} ] /Count ${jpegBuffers.length} >>endobj\n`);

  jpegBuffers.forEach((buf, i) => {
    const pageId = 10 + i * 3;
    const imgId = pageId + 1;
    const contentId = pageId + 2;
    const content = `q ${pageW - 36} 0 0 ${pageH - 36} 18 18 cm /Im${i} Do Q\n`;

    startObj(pageId);
    add(`${pageId} 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im${i} ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>endobj\n`);

    startObj(imgId);
    add(`${imgId} 0 obj<< /Type /XObject /Subtype /Image /Width 1600 /Height 1000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${buf.length} >>stream\n`);
    add(buf);
    add('\nendstream\nendobj\n');

    startObj(contentId);
    add(`${contentId} 0 obj<< /Length ${Buffer.byteLength(content)} >>stream\n${content}endstream\nendobj\n`);
  });

  const xrefAt = Buffer.concat(chunks).length;
  const maxObj = 10 + jpegBuffers.length * 3 - 1;
  add(`xref\n0 ${maxObj + 1}\n`);
  add('0000000000 65535 f \n');
  for (let n = 1; n <= maxObj; n++) {
    const off = objStarts[n];
    if (off == null) add('0000000000 65535 f \n');
    else add(String(off).padStart(10, '0') + ' 00000 n \n');
  }
  add(`trailer<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

async function captureVenuePack(page, venue, weekNum, vi) {
  await page.evaluate((v) => {
    curV = v;
    if (typeof buildVenTabs === 'function') buildVenTabs();
    if (typeof updateTopbarLogo === 'function') updateTopbarLogo(curV);
    if (typeof setView === 'function') setView('forecast');
    else if (typeof renderForecast === 'function') renderForecast();
    document.body.classList.add('printing-forecast');
  }, venue);

  await page.waitForSelector('#view-forecast .fcast-print-page1', { timeout: 30000 });
  await page.waitForTimeout(800);

  const p1 = page.locator('#view-forecast .fcast-print-page1');
  const p2 = page.locator('#view-forecast .fcast-print-page2');
  const snap1 = await p1.screenshot({ type: 'jpeg', quality: 92 });
  const snap2 = await p2.screenshot({ type: 'jpeg', quality: 92 });

  await page.evaluate(() => document.body.classList.remove('printing-forecast'));

  const short = venueShortFile(venue);
  const pdfName = `RDG-Booking-Performance-${short}-W${weekNum}.pdf`;
  const pdfBuf = buildPdfFromJpegs([snap1, snap2], 792, 612);
  return {
    venue,
    short,
    pdfName,
    pdfB64: pdfBuf.toString('base64'),
    snapB64: Buffer.from(snap1).toString('base64'),
    cid: `snap${vi}@rdg`
  };
}

async function captureAllVenues() {
  const weekNum = isoWeekNum(new Date());
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
    log(`Opening ${DASH_URL}`);
    await page.goto(DASH_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => {
      return !!(window._fbReady || window._forecastLive || document.querySelector('#view-forecast'));
    }, { timeout: 90000 });
    await page.waitForTimeout(2500);

    await page.evaluate(() => {
      if (typeof setView === 'function') setView('forecast');
    });
    await page.waitForSelector('#view-forecast', { timeout: 30000 });

    const results = [];
    for (let i = 0; i < VENUES.length; i++) {
      log(`Capture ${VENUES[i]}…`);
      results.push(await captureVenuePack(page, VENUES[i], weekNum, i));
    }
    return { results, weekNum };
  } finally {
    await browser.close();
  }
}

function buildHtmlBody(results, todayLabel) {
  let html = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1c1c1e;line-height:1.5">';
  html += '<p>Hi team,</p>';
  html += `<p>Please find below our booking performance as of <b>${todayLabel}</b>.</p>`;
  results.forEach(r => {
    html += `<div style="margin:18px 0 8px;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#48484a">${r.venue}</div>`;
    html += `<img src="cid:${r.cid}" alt="${r.venue} booking performance" style="max-width:100%;border:1px solid #e5e5ea;border-radius:8px;display:block"/>`;
  });
  html += '<p style="margin-top:18px;font-size:12px;color:#8e8e93">PDFs attached for each location (page 1 = Actual vs Target + Details; page 2 = Pick up pace).</p>';
  html += '<p style="margin-top:8px;font-size:11px;color:#8e8e93">Sent automatically after FourVenues Forecast BS Actual refreshed for today.</p>';
  html += '</div>';
  return html;
}

async function sendFlashEmail(pack) {
  const d = new Date();
  const todayLabel = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const subject = `DJ Booking Performance Flash : Week ${pack.weekNum}`;
  const htmlBody = buildHtmlBody(pack.results, todayLabel);
  const attachments = [];
  pack.results.forEach(r => {
    attachments.push({
      name: `${r.short}-snap.jpg`,
      contentType: 'image/jpeg',
      contentBytesBase64: r.snapB64,
      contentId: r.cid,
      isInline: true
    });
    attachments.push({
      name: r.pdfName,
      contentType: 'application/pdf',
      contentBytesBase64: r.pdfB64
    });
  });
  await sendMail({
    to: FCAST_TO,
    cc: FCAST_CC,
    subject,
    htmlBody,
    attachments,
    saveToSentItems: true
  });
  return subject;
}

async function sendFailureAlert(reason) {
  const day = miamiToday();
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1c1c1e;line-height:1.5">
    <p>Forecast flash email did <b>not</b> send for <b>${day}</b>.</p>
    <p><b>Reason:</b> ${String(reason || 'unknown').replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</p>
    <p>Checked Mon–Fri at 9:00 ET, then again at 9:30 ET. Only one flash email is sent per day when FourVenues (Forecast BS Actual) is OK.</p>
    <p>Dashboard System page → FourVenues / Forecast email status for details.</p>
  </div>`;
  await sendMail({
    to: [ALERT_TO],
    subject: `ALERT: Forecast flash email failed · ${day}`,
    htmlBody: html,
    saveToSentItems: true
  });
}

function resolveAttempt(et) {
  const raw = String(process.env.FORECAST_EMAIL_ATTEMPT || 'auto').trim().toLowerCase();
  if (raw === '900' || raw === '9:00' || raw === '0900') return '900';
  if (raw === '930' || raw === '9:30' || raw === '0930') return '930';
  /* auto from clock */
  if (et.mins >= 9 * 60 + 30) return '930';
  return '900';
}

(async () => {
  const et = etParts();
  const day = et.date;
  log(`ET ${et.weekday} ${day} ${String(et.hour).padStart(2, '0')}:${String(et.minute).padStart(2, '0')} · attempt env=${process.env.FORECAST_EMAIL_ATTEMPT || 'auto'}`);

  if (et.dow < 1 || et.dow > 5) {
    log('Weekend — skip');
    process.exit(0);
  }
  if (et.mins < 9 * 60) {
    log('Before 9:00 ET — skip (flash email window is 9:00 / 9:30 only)');
    process.exit(0);
  }

  const attempt = resolveAttempt(et);
  const isFinal = attempt === '930';
  log(`Attempt=${attempt} final=${isFinal}`);

  let prev = null;
  try { prev = await fbGet('/rdg/scrapeStatus/forecastEmail'); }
  catch (e) { log(`Status read warn: ${e.message}`); }

  if (prev && prev.miamiDay === day && prev.sent === true) {
    log('Already sent today — one email max, skip');
    process.exit(0);
  }
  if (prev && prev.miamiDay === day && prev.failedAlertSent === true && isFinal) {
    log('Failure alert already sent today — skip');
    process.exit(0);
  }

  let fv = null;
  try { fv = await fbGet('/rdg/scrapeStatus/fourvenues'); }
  catch (e) {
    log(`FourVenues status read failed: ${e.message}`);
  }
  const fvOk = !!(fv && fv.ok === true && fv.miamiDay === day);
  log(`FourVenues ok=${fvOk} miamiDay=${fv && fv.miamiDay} at=${fv && fv.at}`);

  const statusBase = {
    schedule: 'Mon–Fri 9:00 ET · retry 9:30 · only if FourVenues Forecast BS Actual OK · max 1/day',
    what: 'Auto Forecast flash email (same recipients as dashboard Send all emails)',
    miamiDay: day,
    at: new Date().toISOString(),
    atLocal: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    attempt
  };

  if (!fvOk) {
    const reason = !fv
      ? 'FourVenues status missing'
      : (fv.ok === false
        ? (`FourVenues failed: ${fv.error || fv.message || 'ok=false'}`)
        : (`FourVenues not refreshed for today (status day ${fv.miamiDay || 'n/a'})`));
    if (!isFinal) {
      await fbPut('/rdg/scrapeStatus/forecastEmail', {
        ...statusBase,
        ok: false,
        pending: true,
        sent: false,
        message: `${reason} — will retry at 9:30 ET`
      });
      log(`Pending until 9:30: ${reason}`);
      process.exit(0);
    }
    try {
      await sendFailureAlert(reason);
      await fbPut('/rdg/scrapeStatus/forecastEmail', {
        ...statusBase,
        ok: false,
        sent: false,
        failedAlertSent: true,
        message: reason,
        error: reason
      });
      log('Failure alert sent');
    } catch (e) {
      await fbPut('/rdg/scrapeStatus/forecastEmail', {
        ...statusBase,
        ok: false,
        sent: false,
        failedAlertSent: false,
        message: reason,
        error: `Alert send failed: ${e.message}`
      });
      console.error(e);
      process.exit(1);
    }
    process.exit(0);
  }

  try {
    const pack = await captureAllVenues();
    const subject = await sendFlashEmail(pack);
    await fbPut('/rdg/scrapeStatus/forecastEmail', {
      ...statusBase,
      ok: true,
      sent: true,
      pending: false,
      subject,
      venues: pack.results.map(r => r.venue),
      message: `Sent: ${subject}`
    });
    log(`Sent OK: ${subject}`);
    process.exit(0);
  } catch (e) {
    console.error(e);
    if (!isFinal) {
      await fbPut('/rdg/scrapeStatus/forecastEmail', {
        ...statusBase,
        ok: false,
        pending: true,
        sent: false,
        message: `9:00 attempt failed — will retry at 9:30: ${e.message}`,
        error: e.message
      });
      process.exit(0);
    }
    try {
      await sendFailureAlert(e.message);
      await fbPut('/rdg/scrapeStatus/forecastEmail', {
        ...statusBase,
        ok: false,
        sent: false,
        failedAlertSent: true,
        message: e.message,
        error: e.message
      });
    } catch (e2) {
      await fbPut('/rdg/scrapeStatus/forecastEmail', {
        ...statusBase,
        ok: false,
        sent: false,
        failedAlertSent: false,
        error: `${e.message} | alert: ${e2.message}`
      });
      process.exit(1);
    }
    process.exit(0);
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
