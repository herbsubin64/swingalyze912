/**
 * Minimal load test: hits /api/analyze N times (serialized by default).
 * Env: ANALYZE_URL, ANALYZE_VIDEO
 * Args: [count=5] [concurrency=1]
 */
import fs from 'node:fs';
import http from 'node:http';
import { request as httpsRequest } from 'node:https';

const BASE = process.env.ANALYZE_URL;
const VIDEO = process.env.ANALYZE_VIDEO;
if (!BASE || !VIDEO || !fs.existsSync(VIDEO)) {
  console.log('SKIP load-test: missing ANALYZE_URL or ANALYZE_VIDEO');
  process.exit(0);
}
const count = Number(process.argv[2]||5);
const conc  = Math.max(1, Number(process.argv[3]||1));
const tasks = Array.from({length:count}, (_,i)=>i);

function postOnce(i){
  return new Promise((resolve)=>{
    const url = new URL(`${BASE.replace(/\/+$/,'')}/api/analyze`);
    const isHttps = url.protocol==='https:';
    const mod = isHttps ? httpsRequest : http.request;
    const boundary = '----swingalyze-' + Math.random().toString(16).slice(2);
    const vid = fs.readFileSync(VIDEO);
    const pre = `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="t.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;
    const post = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(pre), vid, Buffer.from(post)]);
    const t0 = Date.now();
    const req = mod({
      hostname: url.hostname, port: url.port || (isHttps?443:80),
      path: url.pathname, method:'POST',
      headers: {'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':body.length}
    }, r=>{
      const chunks=[]; r.on('data',c=>chunks.push(c)); r.on('end',()=>{
        const ms = Date.now()-t0; const status=r.statusCode||0;
        let ok=false; try{ ok = status===200 && JSON.parse(Buffer.concat(chunks).toString('utf8')); }catch{}
        resolve({i,status,ms,ok:!!ok});
      });
    });
    req.on('error',()=>resolve({i,status:0,ms:0,ok:false}));
    req.write(body); req.end();
  });
}

async function run(){
  let inFlight=[]; const results=[];
  for (const i of tasks){
    const p = postOnce(i).then(r=>{ results.push(r); return r; });
    inFlight.push(p);
    if (inFlight.length>=conc){ await Promise.race(inFlight); inFlight = inFlight.filter(x=>x.pending); }
  }
  await Promise.all(inFlight);
  const ok = results.filter(r=>r.ok).length;
  const s429 = results.filter(r=>r.status===429).length;
  const s5 = results.filter(r=>r.status>=500 && r.status<600).length;
  const avgMs = Math.round(results.reduce((a,b)=>a+b.ms,0)/Math.max(1,results.length));
  console.log(`Load results: ok=${ok}/${results.length}, 429=${s429}, 5xx=${s5}, avg=${avgMs}ms`);
  if (s5>0) { console.error('❌ 5xx responses under light load.'); process.exit(1); }
  console.log('✅ Load test passed (no 5xx).');
}
run().catch(e=>{ console.error('❌ load-test error:', e.message); process.exit(1); });
