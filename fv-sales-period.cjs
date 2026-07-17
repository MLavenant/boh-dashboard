/**
 * Sales Period math — matches FourVenues Sales Excel export defaults:
 * Period = Last 7 days (America/New_York) × Base price for Accepted + Not completed.
 * created_at on map reservations is ms epoch.
 */
'use strict';

function salesPeriodLast7Days(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const day0 = fmt.format(now); // YYYY-MM-DD in ET
  // NY observes EDT (-04) mid-year; FourVenues payloads use America/New_York.
  // Use a noon-based walk for the start day to avoid DST edge issues.
  const untilMs = new Date(`${day0}T23:59:59-04:00`).getTime();
  // FourVenues "Last 7 days" → date_from = today-7 (e.g. Jul 10 when today is Jul 17)
  const startAnchor = new Date(`${day0}T12:00:00-04:00`);
  startAnchor.setDate(startAnchor.getDate() - 7);
  const fromDay = fmt.format(startAnchor);
  const fromMs = new Date(`${fromDay}T00:00:00-04:00`).getTime();
  return {
    date_from: fromDay,
    date_until: `${day0} 23:59:59`,
    fromMs,
    untilMs,
    label: 'Last 7 days'
  };
}

function isCountableStatus(estado) {
  const e = String(estado || '').toLowerCase().trim().replace(/_/g, '-');
  if (!e) return false;
  if (e === 'aceptada' || e === 'accepted') return true;
  if (e === 'no-completada' || e === 'no completada' || e === 'not-completed' || e === 'not completed') return true;
  return false;
}

/**
 * Summarize booking map: table layout + Base price inside optional sale-date period.
 * When period is provided, matches Sales Excel export (not full-event invent).
 */
function summarizeMapData(mapData, period) {
  const zones = Array.isArray(mapData.data) ? mapData.data : [mapData.data];
  let totalTables = 0, bookedTables = 0, totalRevenue = 0;
  const tierSummary = {};
  const seenTables = new Set();
  const fromMs = period && period.fromMs != null ? period.fromMs : null;
  const untilMs = period && period.untilMs != null ? period.untilMs : null;

  for (const z of zones) {
    const tipos = {};
    (z.tipos || []).forEach(t => { tipos[t.slug] = t.nombre; });
    for (const esp of (z.espacios || [])) {
      if (esp.bloqueado) continue;
      totalTables++;
      const tier = esp.tipos_slugs?.[0] ? (tipos[esp.tipos_slugs[0]] || 'Other') : 'Other';
      if (!tierSummary[tier]) tierSummary[tier] = { total: 0, booked: 0, revenue: 0 };
      tierSummary[tier].total++;
    }
    for (const res of (z.reservas || [])) {
      if (res.is_invitation) continue;
      if (!isCountableStatus(res.estado)) continue;
      const created = Number(res.created_at) || 0;
      if (fromMs != null && created < fromMs) continue;
      if (untilMs != null && created > untilMs) continue;
      const tier = res.tipo_slug ? (tipos[res.tipo_slug] || 'Other') : 'Other';
      const rev = Number(res.precio) || 0;
      totalRevenue += rev;
      if (!tierSummary[tier]) tierSummary[tier] = { total: 0, booked: 0, revenue: 0 };
      tierSummary[tier].revenue += rev;
      const tableKey = String(res.espacio_id || res.mesa_id || res.espacio || res.mesa || res._id || (tier + ':' + bookedTables));
      if (!seenTables.has(tableKey)) {
        seenTables.add(tableKey);
        bookedTables++;
        tierSummary[tier].booked++;
      }
    }
  }
  return { totalTables, bookedTables, totalRevenue, tierSummary };
}

/** Build forecast rows from scraped allData using Sales Period window. */
function buildForecastFromMaps(allData, period) {
  const VENUE_ORDER = ['Casa Neos Beach Club', 'MILA Lounge', 'Casa Neos Lounge'];
  const win = period || salesPeriodLast7Days();
  const results = [];
  for (const venueName of VENUE_ORDER) {
    for (const e of (allData[venueName] || [])) {
      const summary = e.mapData
        ? summarizeMapData(e.mapData, win)
        : { totalTables: 0, bookedTables: 0, totalRevenue: 0, tierSummary: {} };
      let dj = String(e.name || '').trim().replace(/\s*\?+\s*$/, '').trim();
      if (!dj || /^[\?\s]+$/.test(dj)) dj = '';
      results.push({
        venue: venueName,
        date: e.date,
        dj,
        bookedTables: summary.bookedTables,
        totalTables: summary.totalTables,
        totalRevenue: summary.totalRevenue,
        tierSummary: summary.tierSummary,
        hasData: !!e.mapData,
        _source: e.mapData ? 'sales_period_window' : undefined,
        _period: win.label
      });
    }
  }
  return { results, period: win };
}

module.exports = {
  salesPeriodLast7Days,
  isCountableStatus,
  summarizeMapData,
  buildForecastFromMaps
};
