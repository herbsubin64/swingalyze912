// Optional live smoke: hits $ANALYZE_URL/api/status and /api/analyze if provided.
// Skips (exit 0) when env or inputs missing.
import fs from 'node:fs';
import path from 'node:path';
import { request } from 'node:https';
import http from 'node:http';

const BASE = process.env.ANALYZE_URL;           // e.g., http://localhost:3000
const VIDEO = process.env.ANALYZE_VIDEO || '';  // path to small mp4
if (!BASE) { console.log('SKIP live smoke: ANALYZE_URL not set'); process.exit(0); }

function fetchJSON(u){ return fetch(u).then(r=>r.json()); }

(async () => {
  try {
    const st = await fetch(`${BASE}/api/status`);
    if (!st.ok) throw new Error(`/api/status ${st.status}`);
    console.log('status:', st.status);

    if (!VIDEO || !fs.existsSync(VIDEO)) {
      console.log('SKIP live /api/analyze: ANALYZE_VIDEO not set/exists'); process.exit(0);
    }

    // Minimal multipart without deps
    const boundary = '----swingalyze-' + Math.random().toString(16).slice(2);
    const vid = fs.readFileSync(VIDEO);
    const pre = `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${path.basename(VIDEO)}"\r\nContent-Type: video/mp4\r\n\r\n`;
    const post = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(pre), vid, Buffer.from(post)]);

    const url = new URL(`${BASE}/api/analyze`);
    const useHttps = url.protocol === 'https:';
    const mod = useHttps ? request : http.request;

    const res = await new Promise((resolve, reject) => {
      const req = mod({
        hostname: url.hostname,
        port: url.port || (useHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        },
      }, r => {
        const chunks = [];
        r.on('data', c => chunks.push(c));
        r.on('end', () => {
          const buf = Buffer.concat(chunks).toString('utf8');
          resolve({ status: r.statusCode, text: buf });
        });
      });
      req.on('error', reject);
      req.write(body); req.end();
    });

    if (res.status !== 200) throw new Error(`/api/analyze ${res.status}: ${res.text.slice(0,200)}`);
    let j; try { j = JSON.parse(res.text); } catch { throw new Error('Analyze JSON parse failed'); }
    // Require minimal shape
    if (!j || (typeof j !== 'object')) throw new Error('Analyze result missing object');
    ['keyframes','series','angles','stance','tempo'].forEach(k => { if (!(k in j)) throw new Error(`Missing key: ${k}`); });
    console.log('OK live analyze shape');
    process.exit(0);
  } catch (e) {
    console.error('❌ Live smoke FAILED:', e.message);
    process.exit(1);
  }
})();
