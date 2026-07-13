import fs from "fs";

const SESSION_FILE = "C:\\Cursor\\toast-mcp-server\\toast-session.json";
const session = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));

// Check origins/localStorage
const origins = session.origins || [];
console.log("Origins count:", origins.length);
for (const origin of origins) {
  console.log("\nOrigin:", origin.origin);
  const ls = origin.localStorage || [];
  console.log("  localStorage keys:", ls.map(i => i.name).join(", "));
  for (const item of ls) {
    if (item.name.includes("auth") || item.name.includes("token") || item.name.includes("access")) {
      // Print a snippet
      const v = item.value || "";
      console.log("  KEY:", item.name);
      // If it looks like JSON, parse it
      try {
        const parsed = JSON.parse(v);
        console.log("  parsed keys:", Object.keys(parsed));
        if (parsed.access_token) console.log("  access_token:", parsed.access_token.slice(0, 50) + "...");
        if (parsed.body) {
          const body = typeof parsed.body === "string" ? JSON.parse(parsed.body) : parsed.body;
          if (body.access_token) console.log("  body.access_token:", body.access_token.slice(0, 80) + "...");
        }
      } catch {
        console.log("  value[:100]:", v.slice(0, 100));
      }
    }
  }
}
