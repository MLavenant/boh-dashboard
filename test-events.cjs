const https = require("https");
function get(url) {
  return new Promise((res,rej)=>{
    https.get(url, {headers:{"accept":"application/json","referer":"https://pro.fourvenues.com/"}}, r=>{
      let d=""; r.on("data",c=>d+=c); r.on("end",()=>res({status:r.statusCode,body:d}));
    }).on("error",rej);
  });
}
(async()=>{
  const todaySec = Math.floor(Date.now()/1000);
  const evQ = JSON.stringify({negocio_id:"Mmgkyvi0903mo01cm3vxg0phrtTEPpSM",eliminado:0,cancelado:0,fecha:{"$gte":todaySec}});
  const r = await get("https://api.fourvenues.com/eventos/?query="+encodeURIComponent(evQ)+"&options="+encodeURIComponent(JSON.stringify({limit:5,sort:{fecha:1}})));
  console.log("Status:", r.status, "Body:", r.body.slice(0,300));
})();
