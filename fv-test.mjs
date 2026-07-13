import axios from "axios";
const FV_HEADERS = {
  "storage-bucket":"pro","referer":"https://pro.fourvenues.com/",
  "device-id":"Zzzwxt508tg69u21ul5d3enp3tKIcRPS","accept":"application/json, text/plain, */*",
  "content-type":"application/json","app-id":"ajihln7fc0006jhmmi4lh75s2lI9O3jx",
  "user-agent":"Mozilla/5.0"
};
const todaySec = Math.floor(Date.now()/1000);
const q = JSON.stringify({negocio_id:"lah0f2isk8qmsg0zapu016rarffvp0xz",eliminado:0,cancelado:0,fecha:{"$gte":todaySec}});
const res = await axios.get(`https://api.fourvenues.com/eventos/?query=${encodeURIComponent(q)}&options=${encodeURIComponent(JSON.stringify({limit:10,sort:{fecha:1}}))}`,{headers:FV_HEADERS});
console.log("✅ Casa Neos BC upcoming:", res.data.data.length, "events");
res.data.data.slice(0,3).forEach(e=>console.log(" -",new Date(e.fecha*1000).toDateString(),"|",e.nombre));
