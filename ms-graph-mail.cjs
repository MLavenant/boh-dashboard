/**
 * Microsoft Graph mailbox helpers (app-only / client credentials).
 * Reads FourVenues "Sales Report" emails and downloads the Excel link.
 *
 * Env:
 *   AZURE_TENANT_ID
 *   AZURE_CLIENT_ID
 *   AZURE_CLIENT_SECRET
 *   GRAPH_MAILBOX   Entra User principal name (UPN) or mail, e.g. user@mila-group.com
 */
'use strict';

const fs = require('fs');
const path = require('path');

let _resolvedMailboxPath = null;
let _resolvedMailboxInfo = null;

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function log(msg) {
  console.log(`[graph] ${msg}`);
}

async function getAppToken() {
  const tenantId = env('AZURE_TENANT_ID');
  const clientId = env('AZURE_CLIENT_ID');
  const clientSecret = env('AZURE_CLIENT_SECRET');
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET');
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Graph token failed HTTP ${res.status}: ${data.error_description || data.error || JSON.stringify(data).slice(0, 200)}`);
  }
  return data.access_token;
}

async function graphGet(token, apiPath) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${apiPath}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Graph GET ${apiPath} → ${res.status}: ${(data && (data.error && data.error.message)) || text.slice(0, 240)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * Resolve GRAPH_MAILBOX to a Graph /users/{id} path.
 * Accepts UPN, mail, or object id. On 404, searches directory by mail/UPN.
 */
async function resolveMailboxPath(token) {
  if (_resolvedMailboxPath) return _resolvedMailboxPath;

  const raw = env('GRAPH_MAILBOX');
  if (!raw) throw new Error('Missing GRAPH_MAILBOX (Entra User principal name, e.g. you@mila-group.com)');

  const candidates = [raw];
  // Common alias mistakes: rivieradining.com vs mila-group.com etc.
  if (raw.includes('@')) {
    const local = raw.split('@')[0];
    const domain = raw.split('@')[1].toLowerCase();
    if (domain.includes('riviera')) {
      candidates.push(`${local}@mila-group.com`);
      candidates.push(`${local}@mila-group.com`.replace(/group/i, 'group'));
    }
  }

  for (const cand of [...new Set(candidates)]) {
    try {
      const u = await graphGet(token, `/users/${encodeURIComponent(cand)}?$select=id,userPrincipalName,mail,displayName`);
      _resolvedMailboxInfo = {
        id: u.id,
        userPrincipalName: u.userPrincipalName,
        mail: u.mail,
        displayName: u.displayName,
        requested: raw
      };
      _resolvedMailboxPath = `/users/${encodeURIComponent(u.id)}`;
      log(`Mailbox resolved: requested=${raw} → UPN=${u.userPrincipalName} mail=${u.mail || '(none)'} id=${u.id}`);
      return _resolvedMailboxPath;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }

  // Directory search (needs User.Read.All OR Directory.Read.All ideally; Mail.Read alone may not allow)
  // Still try filter — works if app has User.Read.All; otherwise clear error.
  try {
    const filter = encodeURIComponent(`mail eq '${raw.replace(/'/g, "''")}' or userPrincipalName eq '${raw.replace(/'/g, "''")}'`);
    const found = await graphGet(token, `/users?$filter=${filter}&$select=id,userPrincipalName,mail,displayName&$top=5`);
    const u = (found.value || [])[0];
    if (u) {
      _resolvedMailboxInfo = {
        id: u.id,
        userPrincipalName: u.userPrincipalName,
        mail: u.mail,
        displayName: u.displayName,
        requested: raw
      };
      _resolvedMailboxPath = `/users/${encodeURIComponent(u.id)}`;
      log(`Mailbox resolved via search: UPN=${u.userPrincipalName}`);
      return _resolvedMailboxPath;
    }
  } catch (e) {
    log(`Directory search skipped/failed: ${e.message}`);
  }

  throw new Error(
    `GRAPH_MAILBOX '${raw}' is invalid in this tenant (Graph 404). ` +
    `Fix: Azure Portal → Microsoft Entra ID → Users → your user → copy exact User principal name → GitHub secret GRAPH_MAILBOX. ` +
    `Do not guess aliases (e.g. @rivieradining.com vs @mila-group.com).`
  );
}

async function mailboxPath(token) {
  return resolveMailboxPath(token);
}

/** Unwrap TitanHQ / tracking links → direct S3/export URL. */
function extractSalesExcelUrl(html, venueId) {
  const hrefs = [...String(html || '').matchAll(/href=["']([^"']+)["']/gi)]
    .map(m => m[1].replace(/&amp;/g, '&'));
  const plain = [...String(html || '').matchAll(/https?:\/\/[^\s<>"']+/gi)].map(m => m[0].replace(/&amp;/g, '&'));
  const all = [...hrefs, ...plain];
  let fallback = null;
  for (const l of all) {
    let u = l;
    const m = u.match(/[?&]url=([^&]+)/);
    if (m) {
      try { u = decodeURIComponent(m[1]); } catch (_) {}
    }
    if (!/export_excel|sale-detail|\.xls/i.test(u)) continue;
    if (venueId && u.includes(venueId)) return u;
    if (!fallback) fallback = u;
  }
  return venueId ? null : fallback;
}

/**
 * List recent inbox messages and keep Sales Report from FourVenues.
 */
async function listSalesReportMessages({ token, top = 40, maxAgeDays = 14, sinceMs = null } = {}) {
  const since = sinceMs != null
    ? sinceMs
    : Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const mb = await mailboxPath(token);
  const select = encodeURIComponent('id,subject,receivedDateTime,from,body');
  const order = encodeURIComponent('receivedDateTime desc');
  const data = await graphGet(
    token,
    `${mb}/messages?$top=${top}&$orderby=${order}&$select=${select}`
  );
  const out = [];
  for (const msg of data.value || []) {
    const subj = String(msg.subject || '').trim();
    if (!/^Sales Report$/i.test(subj)) continue;
    const from = ((msg.from && msg.from.emailAddress && msg.from.emailAddress.address) || '').toLowerCase();
    if (from && !from.includes('fourvenues')) continue;
    const received = Date.parse(msg.receivedDateTime || 0);
    if (received && received < since - 5000) continue;
    const html = (msg.body && msg.body.content) || '';
    out.push({
      id: msg.id,
      subject: subj,
      receivedDateTime: msg.receivedDateTime,
      receivedMs: received || 0,
      from,
      html
    });
  }
  return out;
}

/**
 * Poll until we have a Sales Report email matching each venueId after sinceMs.
 */
async function waitForVenueSalesReports({ token, venueIds, sinceMs, timeoutSec = 240, pollSec = 15 } = {}) {
  const need = new Set(venueIds);
  const found = new Map();
  const deadline = Date.now() + timeoutSec * 1000;
  log(`Waiting up to ${timeoutSec}s for Sales Report emails (venues=${venueIds.length})…`);
  while (Date.now() < deadline && found.size < need.size) {
    const messages = await listSalesReportMessages({ token, top: 30, sinceMs });
    for (const vid of need) {
      if (found.has(vid)) continue;
      for (const msg of messages) {
        const url = extractSalesExcelUrl(msg.html, vid);
        if (url) {
          found.set(vid, { message: msg, url });
          log(`  got email for venue ${vid.slice(0, 8)}… at ${msg.receivedDateTime}`);
          break;
        }
      }
    }
    if (found.size >= need.size) break;
    await new Promise(r => setTimeout(r, pollSec * 1000));
  }
  return found;
}

function pickReportForVenue(messages, venueId) {
  for (const msg of messages) {
    const url = extractSalesExcelUrl(msg.html, venueId);
    if (url) return { message: msg, url };
  }
  return null;
}

async function downloadUrlToFile(url, outFile) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  return { outFile, size: buf.length };
}

async function downloadLatestSalesReports(opts) {
  const token = await getAppToken();
  await resolveMailboxPath(token);
  const messages = await listSalesReportMessages({
    token,
    top: 50,
    maxAgeDays: opts.maxAgeDays != null ? opts.maxAgeDays : 14,
    sinceMs: opts.sinceMs != null ? opts.sinceMs : null
  });
  const results = [];
  for (const v of opts.venues) {
    const hit = pickReportForVenue(messages, v.id);
    if (!hit) {
      results.push({ venue: v.name, venueKey: v.key, venueId: v.id, error: 'No Sales Report email found for venue' });
      continue;
    }
    const stamp = new Date(hit.message.receivedMs || Date.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outFile = path.join(opts.outDir, `${v.key}_graph_${stamp}.xlsx`);
    try {
      const dl = await downloadUrlToFile(hit.url, outFile);
      results.push({
        venue: v.name,
        venueKey: v.key,
        venueId: v.id,
        outFile: dl.outFile,
        size: dl.size,
        emailReceivedAt: hit.message.receivedDateTime,
        emailAgeHours: Math.round((Date.now() - hit.message.receivedMs) / 3600000)
      });
    } catch (e) {
      results.push({ venue: v.name, venueKey: v.key, venueId: v.id, error: e.message });
    }
  }
  return { messagesFound: messages.length, results, mailbox: _resolvedMailboxInfo };
}

module.exports = {
  getAppToken,
  resolveMailboxPath,
  listSalesReportMessages,
  waitForVenueSalesReports,
  pickReportForVenue,
  extractSalesExcelUrl,
  downloadUrlToFile,
  downloadLatestSalesReports,
  getResolvedMailboxInfo: () => _resolvedMailboxInfo
};
