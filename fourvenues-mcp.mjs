/**
 * FourVenues MCP — Sales export is the Forecast source of truth.
 * UI path: Sales → sales-overview (NEVER sales-tickets) → Events → Upcoming → Select all → Apply
 *          → ⋮ next to Compare events → Export to Excel → Export data
 * Note: Export emails XLS via POST /ventas_cliente_imprimir (no-reply@fourvenues.com, subject Sales Report).
 * MCP recovers the file via Outlook COM (TitanHQ→S3), optional Graph token, or Downloads.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "module";
import fs from "fs";

const require = createRequire(import.meta.url);
const {
  pullSalesExports,
  parseSalesExportFile,
  applyExportToForecast,
  VENUES
} = require("./fv-sales-export-lib.cjs");
const {
  salesPeriodLast7Days,
  buildForecastFromMaps,
  summarizeMapData
} = require("./fv-sales-period.cjs");

process.stderr.write("=== FOURVENUES MCP LOADED ===\n");

const server = new McpServer({ name: "fourvenues", version: "1.1.0" });
const DASHBOARD = "C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html";
const BOOKINGS = "C:\\Cursor\\toast-mcp-server\\fv-bookings-data.json";

server.tool(
  "get_sales_export",
  "Run FourVenues Overview sales-overview export: Events→Upcoming→Select all→Apply→⋮→Export to Excel. File is EMAILED (no-reply@fourvenues.com Sales Report). MCP polls Outlook, unwraps TitanHQ→S3, downloads Booking-sheet xlsx, sums Base price paid for Accepted+Not completed. NEVER use Tickets tab. Forecast source of truth.",
  {
    venue: z.enum(["all", "casa_neos_bc", "mila_lounge", "casa_neos_lounge"]).default("all"),
    apply_to_forecast: z.boolean().default(false)
  },
  async ({ venue, apply_to_forecast }) => {
    const pulled = await pullSalesExports({ venue, headless: false });
    let applied = null;
    if (apply_to_forecast && pulled.forecastRows.length) {
      applied = applyExportToForecast(pulled.forecastRows, DASHBOARD);
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          note: "Export is emailed to the FourVenues account. If forecastRows is empty, use parse_sales_export_file on the downloaded XLS, or get_forecast_base_prices for export-equivalent totals.",
          pulledAt: pulled.pulledAt,
          forecastRows: pulled.forecastRows,
          errors: pulled.results.filter(r => r.error).map(r => ({ venue: r.venue, error: r.error })),
          applied
        }, null, 2)
      }]
    };
  }
);

server.tool(
  "parse_sales_export_file",
  "Parse a FourVenues sales_*.xls export. Sums Base price (reservations) for Status = accepted OR not-completed per event. Optionally writes into FORECAST_DATA.",
  {
    file_path: z.string(),
    apply_to_forecast: z.boolean().default(false)
  },
  async ({ file_path, apply_to_forecast }) => {
    if (!fs.existsSync(file_path)) throw new Error("File not found: " + file_path);
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
    if (apply_to_forecast) applied = applyExportToForecast(forecastRows, DASHBOARD);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ file_path, byEvent: parsed.byEvent, forecastRows, applied }, null, 2)
      }]
    };
  }
);

server.tool(
  "get_forecast_base_prices",
  "Export-equivalent Forecast totals without waiting for email: Base price (Accepted + Not completed) where reservation created_at falls in Sales Period Last 7 days. Uses latest fv-bookings-data.json map scrape. Optionally apply to FORECAST_DATA.",
  {
    apply_to_forecast: z.boolean().default(false)
  },
  async ({ apply_to_forecast }) => {
    if (!fs.existsSync(BOOKINGS)) throw new Error("Missing bookings scrape: " + BOOKINGS + " — run fv-refresh-all.cjs first");
    const allData = JSON.parse(fs.readFileSync(BOOKINGS, "utf8"));
    const { results, period } = buildForecastFromMaps(allData);
    const booked = results.filter(r => r.totalRevenue > 0);
    let applied = null;
    if (apply_to_forecast) {
      applied = applyExportToForecast(
        results.map(r => ({ venue: r.venue, date: r.date, dj: r.dj, totalRevenue: r.totalRevenue, bookings: r.bookedTables })),
        DASHBOARD
      );
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ period, bookedCount: booked.length, booked, applied }, null, 2)
      }]
    };
  }
);

server.tool(
  "list_fourvenues_venues",
  "List RDG FourVenues venues configured for Sales export.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(VENUES, null, 2) }] })
);

const transport = new StdioServerTransport();
await server.connect(transport);
