import fs from "fs";

const raw = fs.readFileSync("C:\\Cursor\\toast-mcp-server\\fetch-lw-clean.json", "utf8");
const newWeek = JSON.parse(raw);
console.error("Venues:", newWeek.map(v => v.venue));

let html = fs.readFileSync("C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html", "latin1");

const startStr  = "var VIP_VENUES = [";
const startIdx  = html.indexOf(startStr);
if (startIdx < 0) { console.error("VIP_VENUES not found"); process.exit(1); }

const endMarker = "];\r\n\r\n/* backward-compat";
const endIdx    = html.indexOf(endMarker, startIdx);
if (endIdx < 0) { console.error("end not found"); process.exit(1); }

const before   = html.slice(0, startIdx);
const existing = html.slice(startIdx + startStr.length, endIdx + 1).trim(); // include ]
const after    = html.slice(endIdx + 1); // from ; onwards

const newEntries = JSON.stringify(newWeek).slice(1, -1); // strip outer []
const newBlock = `var VIP_VENUES = [\n/* --- W29 (Jul 7-13, 2026) LIVE TOAST DATA --- */\n${newEntries},\n/* --- W27 (Jul 4-5, 2026) --- */\n${existing}\n]`;

const newHtml = before + newBlock + after;
fs.writeFileSync("C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html", newHtml, "latin1");
console.error("Done! Wrote", newHtml.length, "chars");
