/**
 * FourVenues MCP — Integrations API (X-Api-Key).
 * Forecast rule: sum booking.price for status accepted | not-completed
 * (same as Sales Overview export Base price).
 *
 * Env: FV_API_KEY_MILA, FV_API_KEY_CASA_NEOS, FV_API_KEY_CASA_NEOS_BC
 * Optional: FV_API_KEY_AVA. Keys load from process.env or .env (gitignored).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "module";
import fs from "fs";

const require = createRequire(import.meta.url);
const {
  VENUES,
  getApiKey,
  venuesWithKeys,
  resolveVenue,
  listEvents,
  listBookings,
  getForecastActuals,
  defaultDateRange
} = require("./fv-api-client.cjs");

let applyExportToForecast = null;
try {
  applyExportToForecast = require("./fv-sales-export-lib.cjs").applyExportToForecast;
} catch (_) {}

process.stderr.write("=== FOURVENUES MCP (Integrations API) LOADED ===\n");

const server = new McpServer({ name: "fourvenues", version: "2.0.0" });
const DASHBOARD = process.env.RDG_DASHBOARD_PATH
  || "C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html";

const venueEnum = z.enum(["all", "casa_neos_bc", "mila_lounge", "casa_neos_lounge", "ava_lounge"]);

function writeForecastLive(forecastRows, period) {
  const https = require("https");
  const FB_DB = "rdg-dj-dashboard-default-rtdb.firebaseio.com";
  const miamiDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());

  const livePayload = {
    updatedAt: new Date().toISOString(),
    miamiDay,
    source: "integrations_api",
    period: period || { label: "Integrations API bookings (accepted + not-completed price)" },
    events: {}
  };

  for (const r of forecastRows || []) {
    if (!r.date || !r.venue) continue;
    const totalRevenue = Math.round(Number(r.totalRevenue) || 0);
    const payload = {
      venue: r.venue,
      date: r.date,
      dj: r.dj,
      totalRevenue,
      bookedTables: r.bookings || 0,
      hasData: true,
      _source: "integrations_api"
    };
    const keyDate = (r.venue + "_" + r.date).replace(/[^a-zA-Z0-9_-]/g, "_");
    const keyDj = (r.venue + "_" + r.date + "_" + String(r.dj || "")).replace(/[^a-zA-Z0-9_-]/g, "_");
    livePayload.events[keyDj] = payload;
    const prev = livePayload.events[keyDate];
    if (!prev || (prev.totalRevenue || 0) < totalRevenue) {
      livePayload.events[keyDate] = payload;
    }
  }

  return new Promise((resolve, reject) => {
    const body = JSON.stringify(livePayload);
    const req = https.request({
      hostname: FB_DB,
      path: "/rdg/forecastLive.json",
      method: "PUT",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, r => {
      let d = "";
      r.on("data", c => d += c);
      r.on("end", () => resolve({ http: r.statusCode, eventKeys: Object.keys(livePayload.events).length, livePayload }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

server.tool(
  "list_fourvenues_venues",
  "List RDG FourVenues venues and which Integrations API keys are configured (keys never returned).",
  {},
  async () => {
    const list = VENUES.map(v => ({
      key: v.key,
      name: v.name,
      envKey: v.envKey,
      optional: !!v.optional,
      apiKeyConfigured: !!getApiKey(v)
    }));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          base: "https://api.fourvenues.com/integrations",
          venues: list,
          ready: venuesWithKeys({ includeOptional: false }).map(v => v.key)
        }, null, 2)
      }]
    };
  }
);

server.tool(
  "get_events",
  "List FourVenues events via Integrations API for a date range (default: last 7 days through +21 days).",
  {
    venue: venueEnum.default("all"),
    start: z.string().optional().describe("YYYY-MM-DD"),
    end: z.string().optional().describe("YYYY-MM-DD")
  },
  async ({ venue, start, end }) => {
    const range = { start: start || defaultDateRange().start, end: end || defaultDateRange().end };
    const want = venue === "all"
      ? venuesWithKeys({ includeOptional: false })
      : [resolveVenue(venue)].filter(Boolean);
    if (!want.length) throw new Error("No API keys configured for requested venue(s)");
    const results = [];
    for (const v of want) {
      results.push(await listEvents(v, range));
    }
    return { content: [{ type: "text", text: JSON.stringify({ range, results }, null, 2) }] };
  }
);

server.tool(
  "get_bookings",
  "List FourVenues bookings via Integrations API (optional venue + date range).",
  {
    venue: venueEnum.default("all"),
    start: z.string().optional().describe("YYYY-MM-DD"),
    end: z.string().optional().describe("YYYY-MM-DD"),
    date: z.string().optional().describe("Single day YYYY-MM-DD (overrides start/end)")
  },
  async ({ venue, start, end, date }) => {
    const want = venue === "all"
      ? venuesWithKeys({ includeOptional: false })
      : [resolveVenue(venue)].filter(Boolean);
    if (!want.length) throw new Error("No API keys configured for requested venue(s)");
    const results = [];
    for (const v of want) {
      const pulled = await listBookings(v, { start, end, date });
      results.push({
        venue: pulled.venue,
        venueKey: pulled.venueKey,
        count: pulled.bookings.length,
        bookings: pulled.bookings
      });
    }
    return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }] };
  }
);

server.tool(
  "get_forecast_actuals",
  "Export-equivalent Forecast totals from Integrations API: sum booking price for accepted + not-completed, by venue/date/event. Optionally write Firebase forecastLive and/or patch local FORECAST_DATA.",
  {
    venue: venueEnum.default("all"),
    start: z.string().optional(),
    end: z.string().optional(),
    write_firebase: z.boolean().default(false),
    apply_to_forecast: z.boolean().default(false)
  },
  async ({ venue, start, end, write_firebase, apply_to_forecast }) => {
    const pulled = await getForecastActuals({ venue, start, end });
    let firebase = null;
    let applied = null;
    if (write_firebase && pulled.forecastRows.length) {
      firebase = await writeForecastLive(pulled.forecastRows, pulled.period);
    }
    if (apply_to_forecast && pulled.forecastRows.length) {
      if (!applyExportToForecast) throw new Error("applyExportToForecast unavailable");
      if (!fs.existsSync(DASHBOARD)) throw new Error("Dashboard not found: " + DASHBOARD);
      applied = applyExportToForecast(pulled.forecastRows, DASHBOARD);
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ...pulled,
          firebase: firebase ? { http: firebase.http, eventKeys: firebase.eventKeys } : null,
          applied
        }, null, 2)
      }]
    };
  }
);

/* Deprecated aliases — prefer get_forecast_actuals (API). */
server.tool(
  "get_sales_export",
  "DEPRECATED: use get_forecast_actuals. Previously triggered Playwright Sales export + email. Now returns Integrations API forecast totals.",
  {
    venue: venueEnum.default("all"),
    apply_to_forecast: z.boolean().default(false)
  },
  async ({ venue, apply_to_forecast }) => {
    const pulled = await getForecastActuals({ venue });
    let applied = null;
    if (apply_to_forecast && pulled.forecastRows.length && applyExportToForecast && fs.existsSync(DASHBOARD)) {
      applied = applyExportToForecast(pulled.forecastRows, DASHBOARD);
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          deprecated: true,
          useInstead: "get_forecast_actuals",
          note: "Integrations API path (no email/Playwright).",
          ...pulled,
          applied
        }, null, 2)
      }]
    };
  }
);

server.tool(
  "get_forecast_base_prices",
  "DEPRECATED alias of get_forecast_actuals (Integrations API).",
  { apply_to_forecast: z.boolean().default(false) },
  async ({ apply_to_forecast }) => {
    const pulled = await getForecastActuals({ venue: "all" });
    let applied = null;
    if (apply_to_forecast && pulled.forecastRows.length && applyExportToForecast && fs.existsSync(DASHBOARD)) {
      applied = applyExportToForecast(pulled.forecastRows, DASHBOARD);
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ deprecated: true, useInstead: "get_forecast_actuals", ...pulled, applied }, null, 2)
      }]
    };
  }
);

server.tool(
  "parse_sales_export_file",
  "DEPRECATED: parse a local Sales Overview XLS export (Accepted + Not completed Base price). Prefer get_forecast_actuals.",
  {
    file_path: z.string(),
    apply_to_forecast: z.boolean().default(false)
  },
  async ({ file_path, apply_to_forecast }) => {
    if (!fs.existsSync(file_path)) throw new Error("File not found: " + file_path);
    const { parseSalesExportFile } = require("./fv-sales-export-lib.cjs");
    const parsed = parseSalesExportFile(file_path);
    const map = new Map();
    for (const r of parsed.rows) {
      const up = (r.partner || "").toUpperCase();
      let venue = "Casa Neos Beach Club";
      if (up.includes("MILA")) venue = "MILA Lounge";
      else if (up.includes("LOUNGE") && up.includes("CASA")) venue = "Casa Neos Lounge";
      else if (up.includes("BEACH")) venue = "Casa Neos Beach Club";
      const key = `${venue}|${r.date}|${r.event}`;
      if (!map.has(key)) map.set(key, { venue, date: r.date, dj: r.event, totalRevenue: 0, bookings: 0 });
      const g = map.get(key);
      g.totalRevenue += r.basePrice;
      g.bookings += 1;
    }
    const forecastRows = [...map.values()].map(g => ({
      ...g, totalRevenue: Math.round(g.totalRevenue * 100) / 100, source: "fourvenues_sales_export_file"
    }));
    let applied = null;
    if (apply_to_forecast && applyExportToForecast) applied = applyExportToForecast(forecastRows, DASHBOARD);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ deprecated: true, file_path, byEvent: parsed.byEvent, forecastRows, applied }, null, 2)
      }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
