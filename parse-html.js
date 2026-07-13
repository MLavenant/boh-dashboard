import fs from "fs";
const html = fs.readFileSync("C:\\Cursor\\toast-mcp-server\\menu-full.html", "utf8");

// Get the full second script (the one with the handlers)
const allScripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
const mainScript = allScripts[1]?.[1] ?? "";

// Print it all
console.log("=== FULL MAIN SCRIPT ===");
console.log(mainScript);
