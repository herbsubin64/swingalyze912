/**
 * Harvests a new golden by calling /api/analyze and writing fixtures/<name>.golden.json
 * Usage:
 *   ANALYZE_URL=http://localhost:3000 ANALYZE_VIDEO=./clip.mp4 \
 *   node scripts/harvest-golden.mjs edge-mycase
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { request as httpsRequest } from 'node:https';

const BASE = process.env.ANALYZE_URL;
const VIDEO = process.env.ANALYZE_VIDEO;
const NAME = (process.argv[2] || '').trim();

if (!BASE || !VIDEO || !fs.existsSync(VIDEO) || !NAME) {
  console.error('Usage: ANALYZE_URL=... ANALYZE_VIDEO=clip.mp4 node scripts/harvest-golden.mjs <name>');
  process.exit(2);
}

function normalize(obj){
  const out = {
    keyframes: obj.keyframes ?? obj.__KEYFRAMES__ ?? {},
    series:    obj.series    ?? obj.__SERIES__    ?? {},
    angles:    obj.angles    ?? obj.__ANGLES__    ?? {},
    stance:    obj.stance    ?? obj.__STANCE__    ?? {},
    tempo:     obj.tempo     ?? obj.__TEMPO__     ?? {},
    coaching:  Array.isArray(obj.coaching) ? obj.coaching :
               Array.isArray(obj.__COACHING__) ? obj.__COACHING__ : []
  };
  const a=out.angles, s=out.stance;
  out.angles = {
    ...a,
    spine_impact_deg: a.spine_impact_deg ?? a.spineImpact ?? a.spine_impact ?? a.spineImpactDeg,
    shaft_impact_deg: a.shaft_impact_deg ?? a.shaftImpact ?? a.shaft_impact ?? a.shaftImpactDeg
  };
  out.stance = { ...s, impact_fraction: s.impact_fraction ?? s.impact ?? s.impactFrac };
  return out;
}

async function fetchAnalyze(baseUrl, videoPath){
  const url = new URL(`${baseUrl.replace(/\/+$/,'')}/api/analyze`);
  const useHttps = url.protocol==='https:';
  const mod = useHttps ? httpsRequest : http.request;

  const boundary = '----swingalyze-' + Math.random().toString(16).slice(2);
  const vid = fs.readFileSync(videoPath);
  const pre = `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${path.basename(videoPath)}"\r\nContent-Type: video/mp4\r\n\r\n`;
  const post = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(pre), vid, Buffer.from(post)]);

  return await new Promise((resolve,reject)=>{
    const req = mod({
      hostname: url.hostname, port: url.port || (useHttps?443:80),
      path: url.pathname, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, r=>{
      const chunks=[]; r.on('data',c=>chunks.push(c));
      r.on('end',()=>{
        const status = r.statusCode||0;
        const txt = Buffer.concat(chunks).toString('utf8');
        if (status !== 200) return reject(new Error(`/api/analyze ${status}: ${txt.slice(0,200)}`));
        try { resolve(JSON.parse(txt)); } catch { reject(new Error('Analyze JSON parse failed')); }
      });
    });
    req.on('error',reject); req.write(body); req.end();
  });
}

(async function main(){
  const raw = await fetchAnalyze(BASE, VIDEO);
  const j = normalize(raw);
  const outPath = `fixtures/${NAME}.golden.json`;
  fs.writeFileSync(outPath, JSON.stringify(j, null, 2));
  console.log('✅ Wrote', outPath);
})();
