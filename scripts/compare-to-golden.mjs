/**
 * Compare live /api/analyze to fixtures/golf1.golden.json with tolerances.
 * Usage:
 *   node scripts/compare-to-golden.mjs                # SKIP (no env)
 *   ANALYZE_URL=... ANALYZE_VIDEO=clip.mp4 node ...   # live compare
 *   node scripts/compare-to-golden.mjs fixtures/x.json # compare file→golden
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { request as httpsRequest } from 'node:https';

const GOLDEN = 'fixtures/golf1.golden.json';
const TOLS   = 'fixtures/tolerances.json';

function loadJson(p){ return JSON.parse(fs.readFileSync(p,'utf-8')); }
function exists(p){ try{ fs.accessSync(p); return true; }catch{ return false; } }

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

function pick(obj, p){ return p.split('.').reduce((c,k)=> (c==null?undefined:c[k]), obj); }
function abs(n){ return Math.abs(Number(n)); }

function contractIssues(n){
  const errs=[];
  for (const k of ['keyframes','series','angles','stance','tempo']) {
    const v=n[k]; if (v==null || typeof v!=='object' || Array.isArray(v)) errs.push(`Missing or invalid: ${k}`);
  }
  const kf=n.keyframes||{};
  if (!(typeof kf.impact==='number' || (Array.isArray(kf.frames)&&kf.frames.some(f=>typeof f?.t==='number'))))
    errs.push('keyframes must include numeric "impact" or frames[].t');
  return errs;
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
  try{ return JSON.parse(res.text); }catch{ throw new Error('Analyze JSON parse failed'); }
}

async function main(){
  if (!exists(GOLDEN)) { console.error('❌ Missing golden at', GOLDEN); process.exit(2); }
  if (!exists(TOLS))   { console.error('❌ Missing tolerances at', TOLS); process.exit(2); }

  const golden = normalize(loadJson(GOLDEN));
  const tolerances = loadJson(TOLS);

  let live;
  const fileArg = process.argv[2];
  const BASE = process.env.ANALYZE_URL;
  const VIDEO = process.env.ANALYZE_VIDEO;

  if (fileArg && exists(fileArg)) {
    live = normalize(loadJson(fileArg));
    console.log('Using live analysis from file:', fileArg);
  } else if (BASE && VIDEO && exists(VIDEO)) {
    console.log('Fetching live analysis from', BASE);
    live = normalize(await fetchAnalyze(BASE, VIDEO));
  } else {
    console.log('SKIP compare-to-golden: no ANALYZE_URL/VIDEO and no file arg.');
    process.exit(0);
  }

  const issues = contractIssues(live);
  if (issues.length) { console.error('❌ Live contract errors:\n- '+issues.join('\n- ')); process.exit(1); }

  const fields = Object.keys(tolerances);
  const hardFailures=[]; const warnings=[];
  for (const f of fields){
    const tol = Number(tolerances[f]);
    const gv = Number(pick(golden,f));
    const lv = Number(pick(live,f));
    if ([gv,lv].some(v=>Number.isNaN(v))) { warnings.push(`Skip ${f}: non-numeric (g=${gv}, l=${lv})`); continue; }
    const delta = abs(lv-gv);
    if (delta>tol) hardFailures.push(`${f}: Δ=${delta.toFixed(3)} > tol ${tol}`);
  }
  if (warnings.length) console.log('⚠️  Warnings:\n- '+warnings.join('\n- '));
  if (hardFailures.length){ console.error('❌ Live deviates beyond tolerances:\n- '+hardFailures.join('\n- ')); process.exit(1); }
  console.log('✅ Live matches golden within tolerances.');
}
main().catch(e=>{ console.error('❌ compare-to-golden error:', e.message); process.exit(1); });
