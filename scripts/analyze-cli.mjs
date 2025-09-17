/**
 * CLI: call /api/analyze with a video and print key metrics + first tips.
 * Usage:
 *   ANALYZE_URL=http://localhost:3000 node scripts/analyze-cli.mjs ./clip.mp4
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { request as httpsRequest } from 'node:https';

const BASE = process.env.ANALYZE_URL || '';
const VIDEO = process.argv[2];

if (!BASE || !VIDEO || !fs.existsSync(VIDEO)) {
  console.error('Usage: ANALYZE_URL=http://host node scripts/analyze-cli.mjs ./clip.mp4');
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
function toTips(arr){
  if (!Array.isArray(arr)) return [];
  return arr.map(x=>{
    if (typeof x==='string') return x.trim();
    if (x && typeof x==='object'){
      const s = x.text || x.message || x.tip || x.note || x.reason;
      if (typeof s==='string') return s.trim();
      const label = (typeof x.label==='string' && x.label.trim()) || '';
      const advice = (typeof x.advice==='string' && x.advice.trim()) || '';
      if (label || advice) return `${label}${label&&advice?': ':''}${advice}`.trim();
      try { return JSON.stringify(x); } catch { return String(x); }
    }
    return String(x);
  }).filter(Boolean);
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

  const res = await new Promise((resolve,reject)=>{
    const req = mod({
      hostname: url.hostname, port: url.port || (useHttps?443:80),
      path: url.pathname, method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    }, r=>{
      const chunks=[]; r.on('data',c=>chunks.push(c));
      r.on('end',()=>resolve({status:r.statusCode||0,text:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject); req.write(body); req.end();
  });
  if (res.status!==200) throw new Error(`/api/analyze ${res.status}: ${res.text.slice(0,200)}`);
  return JSON.parse(res.text);
}

(async function main(){
  const raw = await fetchAnalyze(BASE, VIDEO);
  const a = normalize(raw);
  const t=a.tempo||{}, ang=a.angles||{}, st=a.stance||{};
  const tips = toTips(a.coaching).slice(0,5);
  console.log('tempo.ratio=', t.ratio, 'backswing=', t.backswing, 'downswing=', t.downswing);
  console.log('angles.spine_impact_deg=', ang.spine_impact_deg, 'angles.shaft_impact_deg=', ang.shaft_impact_deg);
  console.log('stance.impact_fraction=', st.impact_fraction);
  console.log('tips=', tips);
})();
