import axios from "axios";

// Fetch the login page (no auth needed) to find JS bundle URLs
const loginRes = await axios.get("https://www.toasttab.com/restaurants/admin/login", {
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  validateStatus: () => true,
  timeout: 15000,
});
console.log("Login page status:", loginRes.status);

if (typeof loginRes.data === "string") {
  // Find JS chunk URLs
  const scriptUrls = loginRes.data.match(/https:\/\/[^"' ]*\.js[^"' ]*/g) || [];
  const chunks = [...new Set(scriptUrls)];
  console.log("Found script URLs:", chunks.slice(0, 10));

  // Find any inline API patterns
  const apiPats = loginRes.data.match(/\/restaurants\/admin\/[^"' ]{1,100}/g) || [];
  apiPats.slice(0, 10).forEach(p => console.log("admin path:", p));
}

// Try fetching a known Toast CDN bundle for the reports module
const cdnAttempts = [
  "https://cdn.toasttab.com/npm/@toasttab/toast-reports-spa",
  "https://static.toasttab.com/restaurants/admin/reports",
];
for (const url of cdnAttempts) {
  try {
    const r = await axios.get(url, { validateStatus: () => true, timeout: 5000 });
    console.log(url, "->", r.status);
  } catch (e) {
    console.log(url, "-> error:", e.message.slice(0, 50));
  }
}
