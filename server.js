import express from "express";
import cors from "cors";
import compression from "compression";
import http from "http";

const app = express();
app.use(compression());
app.use(express.json({ limit: "20mb" }));
app.use(cors({ origin: [/\.app\.github\.dev$/] }));

// Health
app.get("/api/status", (_req, res) => {
  res.json({ ok: true, ts: Date.now(), service: "swingalyze-api" });
});

// Simple page to prove UI + API same origin
const html = `
<!doctype html><meta charset="utf-8"><title>Swingalyze</title>
<body style="font:16px system-ui;background:#0b1220;color:#e8eefc;padding:24px">
<h1>✅ Swingalyze baseline is running</h1>
<p>API status below (from <code>/api/status</code>):</p>
<pre id="out" style="background:#111827;padding:12px;border-radius:8px"></pre>
<script>fetch('/api/status').then(r=>r.json()).then(j=>out.textContent=JSON.stringify(j,null,2)).catch(e=>out.textContent=String(e))</script>
</body>`;
app.get("/", (req,res)=>res.send(html));

// Auto-retry ports 3000→3010 so EADDRINUSE won't block you
const START = Number(process.env.PORT || 3000), MAX = 3010;
function start(port){
  return new Promise((resolve,reject)=>{
    const srv = http.createServer(app);
    srv.on("error", (e)=>{
      if(e.code==="EADDRINUSE" && port<MAX){ console.log(`[srv] ${port} in use → ${port+1}`); resolve(start(port+1)); }
      else reject(e);
    });
    srv.listen(port, "0.0.0.0", ()=>{
      const chosen = srv.address().port;
      console.log(`[srv] Listening on ${chosen}`);
      if(process.env.CODESPACE_NAME){
        console.log(`[srv] Open: https://${process.env.CODESPACE_NAME}-${chosen}.app.github.dev`);
      } else {
        console.log(`[srv] Open: http://localhost:${chosen}`);
      }
    });
  });
}
start(START).catch(e=>{ console.error(e); process.exit(1); });
