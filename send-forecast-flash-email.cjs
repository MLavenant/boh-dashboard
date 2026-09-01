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
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const FB_DB = 'rdg-dj-dashboard-default-rtdb.firebaseio.com';
const DASH_URL = process.env.FORECAST_DASHBOARD_URL || 'https://mlavenant.github.io/rdg-dj/';
const ALERT_TO = (process.env.FORECAST_EMAIL_ALERT_TO || 'matthias@rivieradininggroup.com').trim();
/* graph = Azure Mail.Send | outlook = local Outlook COM (no Azure admin) | skip = no-op */
const VIA = String(process.env.FORECAST_EMAIL_VIA || 'graph').trim().toLowerCase();

const FCAST_TO = [
  /* TEST: only Matthias until Forecast flash capture is verified end-to-end */
  'matthias@rivieradininggroup.com'
];
const FCAST_CC = [];

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

/** Keep cid: references (Send-all emails style). Append test footer if needed. */
function htmlForOutlookCid(html) {
  let out = String(html || '');
  if (!/TEST send/i.test(out)) {
    out = out.replace(
      /<\/div>\s*$/,
      '<p style="margin-top:8px;font-size:11px;color:#8e8e93">Sent automatically after FourVenues Forecast BS Actual refreshed for today. <b>TEST send — Matthias only.</b></p></div>'
    );
  }
  return out;
}

async function passSessionGate(page) {
  /* Name gate blocks the dashboard until localStorage/sessionStorage are set. */
  await page.addInitScript(() => {
    try {
      localStorage.setItem('rdg_presence_name', 'RDG Automation');
      sessionStorage.setItem('rdg_session_active', '1');
      sessionStorage.setItem('rdg_session_activity', String(Date.now()));
    } catch (_) {}
  });
}

async function ensureSessionUnlocked(page) {
  const locked = await page.evaluate(() => {
    return document.body.classList.contains('session-locked')
      || !!(document.getElementById('sessionGate') && !document.getElementById('sessionGate').classList.contains('hidden'));
  });
  if (!locked) return;
  log('Session gate visible — submitting automation name…');
  await page.fill('#sessionGateName', 'RDG Automation');
  await page.click('#sessionGate .btn-save');
  await page.waitForFunction(() => {
    const gate = document.getElementById('sessionGate');
    return !document.body.classList.contains('session-locked')
      && (!gate || gate.classList.contains('hidden'));
  }, { timeout: 60000 });
  await page.waitForTimeout(1500);
}

/**
 * Drive the same path as Forecast → "Send all emails" (prepareForecastFlashEmail /
 * _buildForecastFlashEmailPack): html2canvas page1+page2, jsPDF PDFs, HTML body.
 */
async function captureAllVenues() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
    page.setDefaultTimeout(300000);
    await passSessionGate(page);
    const sep = DASH_URL.includes('?') ? '&' : '?';
    const url = `${DASH_URL}${sep}_auto=1&t=${Date.now()}`;
    log(`Opening ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await ensureSessionUnlocked(page);
    await page.waitForFunction(() => {
      return typeof window._buildForecastFlashEmailPack === 'function'
        && !!(window._fbReady || window._forecastLive);
    }, { timeout: 120000 });
    await page.waitForTimeout(2500);
    await ensureSessionUnlocked(page);

    log('Running dashboard Send-all-emails pack (_buildForecastFlashEmailPack)…');
    const pack = await page.evaluate(async (opts) => {
      if (typeof window._buildForecastFlashEmailPack !== 'function') {
        throw new Error('_buildForecastFlashEmailPack missing — deploy dashboard with Send-all API');
      }
      return await window._buildForecastFlashEmailPack(opts);
    }, { to: FCAST_TO, cc: FCAST_CC });

    if (!pack || !Array.isArray(pack.results) || pack.results.length < 3) {
      const n = pack && pack.results ? pack.results.length : 0;
      throw new Error(`Incomplete forecast pack from Send-all path (${n} venues)`);
    }
    for (const r of pack.results) {
      if (!r.snapB64 || !r.pdfB64) {
        throw new Error(`Missing snap/PDF for ${r.venue || '?'}`);
      }
    }
    log(`Pack ready: ${pack.results.map(r => r.short || r.venue).join(', ')}`);
    return pack;
  } finally {
    await browser.close();
  }
}

function outlookSend({ to, cc, subject, htmlBody, attachmentPaths, inlinePaths, alertOnly }) {
  const ps1 = path.join(__dirname, 'outlook-send-mail.ps1');
  if (!fs.existsSync(ps1)) throw new Error(`Missing ${ps1}`);
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', ps1,
    '-To', to.join(';'),
    '-Subject', subject,
    '-HtmlBodyPath', htmlBody
  ];
  if (cc && cc.length) args.push('-Cc', cc.join(';'));
  if (inlinePaths && inlinePaths.length) {
    args.push('-Inlines', inlinePaths.join(';'));
  }
  if (attachmentPaths && attachmentPaths.length) {
    args.push('-Attachments', attachmentPaths.join('|'));
  }
  if (alertOnly) args.push('-AlertOnly');
  const r = spawnSync('powershell.exe', args, { encoding: 'utf8' });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error(`Outlook send failed (exit ${r.status}): ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  }
}

async function sendViaGraph(opts) {
  const { sendMail } = require('./ms-graph-mail.cjs');
  try {
    await sendMail(opts);
  } catch (e) {
    if (e.status === 403 || /Mail\.Send/i.test(e.message || '')) {
      const err = new Error('Azure Mail.Send not granted — use local Outlook path (FORECAST_EMAIL_VIA=outlook) until IT enables Mail.Send');
      err.code = 'NO_MAIL_SEND';
      throw err;
    }
    throw e;
  }
}

async function sendFlashEmail(pack) {
  const subject = pack.subject || `DJ Booking Performance Flash : Week ${pack.weekNum}`;
  const baseHtml = pack.htmlBody || '';

  if (VIA === 'outlook') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rdg-fcast-'));
    const htmlPath = path.join(tmp, 'body.html');
    /* Same as Send all emails: HTML keeps cid:… ; JPEGs attached as true inline CIDs. */
    fs.writeFileSync(htmlPath, htmlForOutlookCid(baseHtml), 'utf8');
    const attachmentPaths = [];
    const inlinePaths = [];
    pack.results.forEach(r => {
      const snapName = `${r.short || 'venue'}-snap.jpg`;
      const snapPath = path.join(tmp, snapName);
      fs.writeFileSync(snapPath, Buffer.from(r.snapB64, 'base64'));
      inlinePaths.push(`${snapPath}|${r.cid}`);
      const pdfPath = path.join(tmp, r.pdfName);
      fs.writeFileSync(pdfPath, Buffer.from(r.pdfB64, 'base64'));
      attachmentPaths.push(pdfPath);
    });
    outlookSend({
      to: FCAST_TO,
      cc: FCAST_CC,
      subject,
      htmlBody: htmlPath,
      inlinePaths,
      attachmentPaths
    });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    return subject;
  }

  let htmlBody = baseHtml;
  if (!/TEST send/i.test(htmlBody)) {
    htmlBody = htmlBody.replace(
      /<\/div>\s*$/,
      '<p style="margin-top:8px;font-size:11px;color:#8e8e93">Sent automatically after FourVenues Forecast BS Actual refreshed for today. <b>TEST send — Matthias only.</b></p></div>'
    );
  }
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
  await sendViaGraph({
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

  if (VIA === 'outlook') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rdg-fcast-alert-'));
    const htmlPath = path.join(tmp, 'alert.html');
    fs.writeFileSync(htmlPath, html, 'utf8');
    outlookSend({
      to: [ALERT_TO],
      subject: `ALERT: Forecast flash email failed · ${day}`,
      htmlBody: htmlPath,
      attachmentPaths: [],
      alertOnly: true
    });
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
    return;
  }

  await sendViaGraph({
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
  if (VIA === 'skip') {
    log('FORECAST_EMAIL_VIA=skip — cloud Graph send disabled (use local Outlook)');
    process.exit(0);
  }

  const et = etParts();
  const day = et.date;
  log(`ET ${et.weekday} ${day} ${String(et.hour).padStart(2, '0')}:${String(et.minute).padStart(2, '0')} · via=${VIA} · attempt env=${process.env.FORECAST_EMAIL_ATTEMPT || 'auto'}`);

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
    if (String(process.env.FORECAST_EMAIL_FORCE || '').trim() === '1') {
      log('FORECAST_EMAIL_FORCE=1 — re-sending even though already marked sent today');
    } else {
      log('Already sent today — one email max, skip');
      process.exit(0);
    }
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
    what: VIA === 'outlook'
      ? 'Auto Forecast flash email via local Outlook (no Azure Mail.Send needed)'
      : 'Auto Forecast flash email via Microsoft Graph Mail.Send',
    via: VIA,
    miamiDay: day,
    at: new Date().toISOString(),
    atLocal: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
    attempt
  };

  /* Local Outlook: poll a few minutes for FV after the 9:00 cloud retry starts. */
  if (!fvOk && VIA === 'outlook' && !isFinal) {
    const deadline = Date.now() + 8 * 60 * 1000;
    log('FourVenues not ready — polling up to 8 minutes…');
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 30000));
      try { fv = await fbGet('/rdg/scrapeStatus/fourvenues'); } catch (_) {}
      if (fv && fv.ok === true && fv.miamiDay === day) {
        log(`FourVenues became OK at ${fv.at}`);
        break;
      }
    }
  }
  let fvOkNow = !!(fv && fv.ok === true && fv.miamiDay === day);
  if (!fvOkNow && String(process.env.FORECAST_EMAIL_FORCE || '').trim() === '1') {
    log('FORECAST_EMAIL_FORCE=1 — skipping FourVenues gate for test send');
    fvOkNow = true;
  }
  log(`FourVenues after wait ok=${fvOkNow}`);

  if (!fvOkNow) {
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
