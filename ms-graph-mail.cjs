/**
 * Microsoft Graph mailbox helpers (app-only / client credentials).
 * Reads FourVenues "Sales Report" emails and downloads the Excel link.
 *
 * Env:
 *   AZURE_TENANT_ID
 *   AZURE_CLIENT_ID
 *   AZURE_CLIENT_SECRET
 *   GRAPH_MAILBOX   e.g. matthias@rivieradininggroup.com
 */
'use strict';

const fs = require('fs');
const path = require('path');

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
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

function mailboxPath() {
  const mailbox = env('GRAPH_MAILBOX');
  if (!mailbox) throw new Error('Missing GRAPH_MAILBOX (e.g. you@company.com)');
  return `/users/${encodeURIComponent(mailbox)}`;
}

async function graphGet(token, apiPath) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${apiPath}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Graph GET ${apiPath} → ${res.status}: ${(data && (data.error && data.error.message)) || text.slice(0, 240)}`);
  }
  return data;
}

/** Unwrap TitanHQ / tracking links → direct S3/export URL. */
function extractSalesExcelUrl(html, venueId) {
  const hrefs = [...String(html || '').matchAll(/href=["']([^"']+)["']/gi)]
    .map(m => m[1].replace(/&amp;/g, '&'));
  // Also catch plain https links in text bodies
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
 * Client-side filter (Graph $filter + $orderby combo is fragile).
 */
async function listSalesReportMessages({ token, top = 40, maxAgeDays = 14 } = {}) {
  const since = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const select = encodeURIComponent('id,subject,receivedDateTime,from,body');
  const order = encodeURIComponent('receivedDateTime desc');
  const data = await graphGet(
    token,
    `${mailboxPath()}/messages?$top=${top}&$orderby=${order}&$select=${select}`
  );
  const out = [];
  for (const msg of data.value || []) {
    const subj = String(msg.subject || '').trim();
    if (!/^Sales Report$/i.test(subj)) continue;
    const from = ((msg.from && msg.from.emailAddress && msg.from.emailAddress.address) || '').toLowerCase();
    if (from && !from.includes('fourvenues')) continue;
    const received = Date.parse(msg.receivedDateTime || 0);
    if (received && received < since) continue;
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
 * Pick newest Sales Report whose Excel link matches venueId (if given).
 * Returns { message, url } or null.
 */
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

/**
 * For each venue, download the newest matching Sales Report Excel via Graph.
 * @param {{ venues: Array<{key,name,id}>, outDir: string, maxAgeDays?: number }} opts
 */
async function downloadLatestSalesReports(opts) {
  const token = await getAppToken();
  const messages = await listSalesReportMessages({
    token,
    top: 50,
    maxAgeDays: opts.maxAgeDays != null ? opts.maxAgeDays : 14
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
  return { messagesFound: messages.length, results };
}

module.exports = {
  getAppToken,
  listSalesReportMessages,
  pickReportForVenue,
  extractSalesExcelUrl,
  downloadUrlToFile,
  downloadLatestSalesReports
};
