import fs from "fs";
const html = fs.readFileSync("C:\\Users\\MatthiasLavenant\\Documents\\rdg-dj-dashboard\\index.html", "latin1");
const idx = html.indexOf("var VIP_VENUES = [");
console.log("VIP_VENUES at:", idx);
const bcIdx = html.indexOf("backward-compat", idx);
console.log("backward-compat at:", bcIdx);
console.log("Context:", JSON.stringify(html.slice(bcIdx - 10, bcIdx + 40)));
