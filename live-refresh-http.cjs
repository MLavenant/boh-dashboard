/**
 * HTTP endpoint for Live Refresh (Toast on demand).
 * Deploy on Azure App Service / any always-on Node host, or run locally for tests.
 *
 *   set TOAST_CLIENT_ID=...
 *   set TOAST_API_SECRET=...
 *   set LIVE_REFRESH_KEY=optional-shared-secret
 *   set PORT=8787
 *   node live-refresh-http.cjs
 *
 * POST /live-refresh   (header x-live-key if LIVE_REFRESH_KEY set)
 * GET  /health
 */
'use strict';

const http = require('http');
const { pullToastLive } = require('./toast-live-lib.cjs');

const PORT = Number(process.env.PORT || 8787);
const KEY = process.env.LIVE_REFRESH_KEY || '';

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-live-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(res, 204, {});
  }
  const url = (req.url || '').split('?')[0];
  if (req.method === 'GET' && (url === '/health' || url === '/')) {
    return send(res, 200, { ok: true, service: 'rdg-live-refresh', port: PORT });
  }
  if (req.method === 'POST' && (url === '/live-refresh' || url === '/')) {
    if (KEY) {
      const got = req.headers['x-live-key'] || '';
      if (got !== KEY) return send(res, 401, { ok: false, error: 'unauthorized' });
    }
    try {
      const result = await pullToastLive({ force: true, trigger: 'live_refresh_http' });
      return send(res, result.ok ? 200 : 502, result);
    } catch (e) {
      return send(res, 500, { ok: false, error: String(e.message || e) });
    }
  }
  send(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[live-refresh-http] listening on :${PORT}`);
  console.log(`[live-refresh-http] POST /live-refresh  GET /health`);
});
