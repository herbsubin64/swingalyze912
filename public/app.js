// Swingalyze — robust client: configurable API base, retries, contract banner, badges, overlays, JSON/CSV export
// PNG options: frame strip (address•top•impact) and Hi-Res (2×)
// Improvements: API base selector in header, build tag in header, revoke blob URLs.

const els = {
  file: document.getElementById('fileInput'),
  json: document.getElementById('jsonInput'),
  analyze: document.getElementById('analyzeBtn'),
  exportPngBtn: document.getElementById('exportPngBtn'),
  sharePngBtn: document.getElementById('sharePngBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  downloadLink: document.getElementById('downloadLink'),
  statusDot: document.getElementById('statusDot'),
  buildTagEl: document.getElementById('buildTag'),
  apiBaseInput: document.getElementById('apiBaseInput'),
  video: document.getElementById('video'),
  results: document.getElementById('results'),
  optFrameStrip: document.getElementById('optFrameStrip'),
  optHiRes: document.getElementById('optHiRes'),
};

let analysis = null;
let videoBlobUrl = null;
let ranges = null;
let lastPngBlob = null;
let lastDownloadUrl = null;
let buildTag = (typeof window!=='undefined' && window.__BUILD__) ? window.__BUILD__ : 'dev';

// ---------- API Base helpers ----------
function getApiBase(){
  // Priority: ?api=... (once) → localStorage → ''
  try {
    const u = new URL(window.location.href);
    const fromQuery = u.searchParams.get('api');
    if (fromQuery) { localStorage.setItem('apiBase', fromQuery); u.searchParams.delete('api'); history.replaceState({},'',u.toString()); }
  } catch {}
  try { return (localStorage.getItem('apiBase') || '').trim(); } catch { return ''; }
}
function setApiBase(v){
  try { localStorage.setItem('apiBase', (v||'').trim()); } catch {}
}
function apiUrl(path){
  const base = getApiBase();
  try { return new URL(path, base || window.location.origin).toString(); }
  catch { return path; }
}

init();

async function init(){
  // Init API base input
  try {
    if (els.apiBaseInput) {
      els.apiBaseInput.value = getApiBase();
      els.apiBaseInput.addEventListener('change', async () => { setApiBase(els.apiBaseInput.value); await checkStatus(true); });
      els.apiBaseInput.addEventListener('keyup', async (e)=>{ if(e.key==='Enter'){ setApiBase(els.apiBaseInput.value); await checkStatus(true); }});
    }
  } catch {}

  await Promise.all([checkStatus(), loadRanges(), loadBuildTag()]);
  try{ if (els.buildTagEl) els.buildTagEl.textContent = String(buildTag || 'dev'); }catch{}

  // Mobile-friendly defaults: disable Hi-Res on small screens (less memory)
  try{
    if (window.matchMedia && window.matchMedia('(max-width: 640px)').matches) {
      const hi = document.getElementById('optHiRes');
      if (hi) hi.checked = false;
    }
  }catch{}
}

// ---------- Status ----------
async function checkStatus(force=false){
  try {
    const r = await fetch(apiUrl('/api/status'), { cache: force?'no-store':'default' });
    setDot(r.ok);
  } catch { setDot(false); }
}
function setDot(up){ if(!els.statusDot) return; els.statusDot.classList.toggle('online', !!up); els.statusDot.classList.toggle('offline', !up); }

// ---------- Build tag ----------
async function loadBuildTag(){
  try {
    const r = await fetch('./build.json', {cache:'no-store'});
    if (r.ok) { const j = await r.json(); if (typeof j?.sha === 'string') buildTag = j.sha.slice(0,7); }
  } catch {}
}

// ---------- Ranges ----------
async function loadRanges(){ try{ const r=await fetch('./ranges.json',{cache:'no-store'}); ranges=r.ok?await r.json():{}; }catch{ ranges={}; } }

// ---------- UI enable/disable ----------
function setAnalyzeEnabled(on){ if(els.analyze) els.analyze.disabled=!on; }
function setExportEnabled(on){
  if(els.exportPngBtn) els.exportPngBtn.disabled=!on;
  if(els.sharePngBtn) els.sharePngBtn.disabled=!(on && ('share' in navigator));
  if(els.exportCsvBtn) els.exportCsvBtn.disabled=!on;
  if(els.exportJsonBtn) els.exportJsonBtn.disabled=!on;
  if(els.downloadLink) els.downloadLink.classList.add('hidden');
  revokeLastDownloadUrl();
}

// ---------- File load ----------
els.file?.addEventListener('change', () => {
  const file = els.file.files?.[0]; if(!file) return;
  if (!file.type.startsWith('video/')) { showError('Selected file is not a video.'); setAnalyzeEnabled(false); setExportEnabled(false); return; }
  if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
  videoBlobUrl = URL.createObjectURL(file);
  els.video.src = videoBlobUrl;
  setAnalyzeEnabled(true); setExportEnabled(false); analysis = null;
});

// ---------- Load analysis JSON (offline dev path) ----------
els.json?.addEventListener('change', async () => {
  const file = els.json.files?.[0]; if (!file) return;
  try {
    const text = await file.text();
    const raw = JSON.parse(text);
    analysis = normalize(raw);
    renderBanner(validateContract(analysis));
    const baseCoach = Array.isArray(analysis.coaching) ? analysis.coaching : [];
    const extra = generateCoaching(analysis, (ranges?.default || ranges || {}));
    analysis.coaching = dedupe(toTips([...baseCoach, ...extra]));
    els.results.innerHTML = '';
    renderResults(analysis);
    setExportEnabled(true);
  } catch (e) {
    showError('Invalid analysis JSON: ' + (e?.message || e));
    setExportEnabled(false);
  }
});

// ---------- Analyze (uses API base) ----------
els.analyze?.addEventListener('click', async () => {
  const file = els.file?.files?.[0]; if(!file) return;
  setAnalyzeEnabled(false); els.analyze.textContent = 'Analyzing…';
  try {
    const fd = new FormData(); fd.append('video', file);
    const url = apiUrl('/api/analyze');
    const res = await fetchWithRetry(url, { method:'POST', body: fd }, { attempts: 2, timeoutMs: 30000 });
    if (!res.ok) throw await mapHttpError(res);
    const raw = await res.json();
    analysis = normalize(raw);

    renderBanner(validateContract(analysis));

    const baseCoach = Array.isArray(analysis.coaching) ? analysis.coaching : [];
    const extra = generateCoaching(analysis, (ranges?.default || ranges || {}));
    analysis.coaching = dedupe(toTips([...baseCoach, ...extra]));

    els.results.innerHTML = '';
    renderResults(analysis);
    setExportEnabled(true);
  } catch (e) {
    showError(String(e?.message || e));
    setExportEnabled(false);
  } finally {
    els.analyze.textContent = 'Analyze';
    setAnalyzeEnabled(true);
    checkStatus(true);
  }
});

// ---------- Exports ----------
els.exportPngBtn?.addEventListener('click', async () => {
  if (!analysis || !els.video) return;
  const btn = els.exportPngBtn; btn.textContent='Rendering…'; btn.disabled=true;
  try {
    const opts = { includeStrip: !!els.optFrameStrip?.checked, scale: els.optHiRes?.checked ? 2 : 1 };
    lastPngBlob = await renderReportPNG(analysis, els.video, (ranges?.default || ranges || {}), opts);
    const url = URL.createObjectURL(lastPngBlob);
    replaceDownloadUrl(url, `Swingalyze-Report${opts.scale===2?'-2x':''}.png`);
  } catch(e){ showError(e); }
  finally { btn.textContent='Export PNG Report'; btn.disabled=false; }
});

els.sharePngBtn?.addEventListener('click', async () => {
  if (!analysis || !('share' in navigator)) { els.exportPngBtn?.click(); return; }
  try{
    if (!lastPngBlob) {
      const opts = { includeStrip: !!els.optFrameStrip?.checked, scale: els.optHiRes?.checked ? 2 : 1 };
      lastPngBlob = await renderReportPNG(analysis, els.video, (ranges?.default || ranges || {}), opts);
    }
    const file = new File([lastPngBlob], 'Swingalyze-Report.png', { type: 'image/png' });
    await navigator.share({ files: [file], title: 'Swingalyze — Coaching Report', text: 'Swing report' });
  } catch(e){
    const url = URL.createObjectURL(lastPngBlob);
    replaceDownloadUrl(url, 'Swingalyze-Report.png');
  }
});

els.exportJsonBtn?.addEventListener('click', () => {
  if (!analysis) return;
  const payload = { analysis, ranges: (ranges?.default || ranges || {}), build: buildTag, exported_at: new Date().toISOString() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  replaceDownloadUrl(url, 'Swingalyze-Analysis.json');
});

els.exportCsvBtn?.addEventListener('click', () => {
  if (!analysis) return;
  const t = analysis?.tempo || {}, ang = analysis?.angles || {}, st = analysis?.stance || {};
  const rows = [
    ['field','value'],
    ['tempo.ratio', safeNum(t.ratio)],
    ['tempo.backswing', safeNum(t.backswing)],
    ['tempo.downswing', safeNum(t.downswing)],
    ['angles.spine_impact_deg', safeNum(ang.spine_impact_deg)],
    ['angles.shaft_impact_deg', safeNum(ang.shaft_impact_deg)],
    ['stance.impact_fraction', safeNum(st.impact_fraction)],
    ['generated_at', new Date().toISOString()],
    ['build', buildTag]
  ];
  const coach = toTips(analysis.coaching).map((c,i)=>[`coaching[${i}]`, c]);
  const all = rows.concat(coach);
  const csv = all.map(r => r.map(csvEsc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  replaceDownloadUrl(url, 'Swingalyze-Report.csv');
});

function csvEsc(v){ const s=String(v??''); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }
function safeNum(v){ const n=Number(v); return (Number.isFinite(n)? n : ''); }

function replaceDownloadUrl(url, filename){
  revokeLastDownloadUrl();
  lastDownloadUrl = url;
  els.downloadLink.href = url;
  els.downloadLink.download = filename;
  els.downloadLink.classList.remove('hidden');
  els.downloadLink.click();
}
function revokeLastDownloadUrl(){
  try{ if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl); }catch{}
  lastDownloadUrl = null;
}

// ---------- Networking helpers ----------
async function fetchWithRetry(url, options={}, {attempts=2, timeoutMs=30000}={}){
  let last;
  for (let i=0;i<attempts;i++){
    try{
      const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(), timeoutMs);
      const r=await fetch(url, {...options, signal: ctl.signal}); clearTimeout(t);
      if (r.status>=500 && r.status<600 && i<attempts-1){ await wait(400*(i+1)); continue; }
      return r;
    }catch(e){ last=e; if(i===attempts-1) throw new Error('Network error contacting analyzer.'); await wait(300*(i+1)); }
  }
  throw last || new Error('Request failed.');
}
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function mapHttpError(res){
  let msg=''; try{ msg=(await res.text()).trim(); }catch{}
  const extra = msg ? `: ${msg.slice(0,200)}` : '';
  switch(res.status){
    case 400: return new Error('Bad request to /api/analyze'+extra);
    case 413: return new Error('Video too large (413). Try trimming the clip.');
    case 415: return new Error('Unsupported video format (415). Try MP4/H.264.');
    case 422: return new Error('No swing detected (422). Try brighter lighting and a stable angle.');
    case 429: return new Error('Rate limited (429). Please wait and retry.');
    case 500: return new Error('Analyzer internal error (500).');
    default:  return new Error(`HTTP ${res.status}${extra}`);
  }
}

// ---------- Contract banner (UI) ----------
function renderBanner(shape){
  const { ok, issues, warnings } = shape;
  const cls = ok ? 'ok' : (issues.length ? 'bad' : 'warn');
  const items = (issues.length ? issues : warnings).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  const title = ok ? 'Contract OK' : (issues.length ? 'Contract Problems' : 'Contract Warnings');
  const html = `<div class="banner ${cls}"><h3>${title}</h3>${items ? `<ul>${items}</ul>` : ''}</div>`;
  els.results.innerHTML = html + (els.results.innerHTML || '');
}
function validateContract(j){
  const issues = [], warnings = [];
  const reqObject = (n,v)=>{ if(v==null) issues.push(`Missing key: ${n}`); else if(typeof v!=='object'||Array.isArray(v)) issues.push(`${n} must be an object`); };
  const numOrNull = (v,n)=>{ if(v==null) return; if(typeof v!=='number'||Number.isNaN(v)) warnings.push(`${n} should be number`); };
  reqObject('keyframes', j.keyframes);
  reqObject('series', j.series);
  reqObject('angles', j.angles);
  reqObject('stance', j.stance);
  reqObject('tempo', j.tempo);
  if (j.coaching!==undefined && !Array.isArray(j.coaching)) warnings.push('coaching should be an array');
  numOrNull(j.angles?.spine_impact_deg, 'angles.spine_impact_deg');
  numOrNull(j.angles?.shaft_impact_deg, 'angles.shaft_impact_deg');
  numOrNull(j.tempo?.ratio, 'tempo.ratio');
  numOrNull(j.tempo?.backswing, 'tempo.backswing');
  numOrNull(j.tempo?.downswing, 'tempo.downswing');
  numOrNull(j.stance?.impact_fraction, 'stance.impact_fraction');
  let kfOk=false; const kf=j.keyframes||{};
  if (typeof kf.impact==='number') kfOk=true;
  if (Array.isArray(kf.frames) && kf.frames.some(f=>typeof f?.t==='number')) kfOk=true;
  if (!kfOk) issues.push('keyframes must include numeric "impact" or frames[].t');
  return { ok: issues.length===0, issues, warnings };
}

// ---------- Render results ----------
function renderResults(a){
  const t=a?.tempo||{}, ang=a?.angles||{}, st=a?.stance||{}, coach=toTips(a?.coaching);
  const v=(k,val)=>{ const as=assess(val,k,(ranges?.default||ranges||{})); const b=as.badge?`<span class="badge ${as.badge}">${as.badge.toUpperCase()}</span>`:''; return `<div style="display:flex;gap:8px;align-items:center">${fmt(val)} ${b}</div>`; };
  els.results.innerHTML += `
    ${metric('Tempo (ratio)', v('tempo.ratio', t.ratio))}
    ${metric('Backswing (s)', v('tempo.backswing', t.backswing))}
    ${metric('Downswing (s)', v('tempo.downswing', t.downswing))}
    ${metric('Spine tilt @impact (°)', v('angles.spine_impact_deg', ang.spine_impact_deg))}
    ${metric('Shaft angle @impact (°)', v('angles.shaft_impact_deg', ang.shaft_impact_deg))}
    ${metric('Stance width @impact', v('stance.impact_fraction', st.impact_fraction))}
    ${metric('Keyframes', code(JSON.stringify(a?.keyframes??{},null,2)))}
    ${coach.length ? metric('Coaching', `<ul>${coach.map(c=>`<li>${escapeHtml(c)}</li>`).join('')}</ul>`) : metric('Coaching','–')}
  `;
}

function metric(label, valueHtml){ return `<div class="metric"><span class="label">${escapeHtml(label)}</span><div>${valueHtml}</div></div>`; }
function code(s){ return `<pre class="code">${escapeHtml(s)}</pre>`; }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// Robust number formatting: show "–" when null/NaN/∞
function fmt(v){ const n=Number(v); if (v==null || !Number.isFinite(n)) return '–'; return String(Math.round(n*100)/100); }

// ---------- Coaching helpers ----------
function toTips(arr){
  if (!Array.isArray(arr)) return [];
  const tips = arr.map(x=>{
    if (typeof x === 'string') return x.trim();
    if (x && typeof x === 'object') {
      const s = x.text || x.message || x.tip || x.note || x.reason;
      if (typeof s === 'string') return s.trim();
      const label = (typeof x.label==='string' && x.label.trim()) || '';
      const advice = (typeof x.advice==='string' && x.advice.trim()) || '';
      if (label || advice) return `${label}${label&&advice?': ':''}${advice}`.trim();
      try { return JSON.stringify(x); } catch { return String(x); }
    }
    return String(x);
  }).filter(Boolean);
  return tips;
}
function dedupe(arr){ return Array.from(new Set((arr||[]).filter(Boolean).map(v=>String(v).trim()))); }

// ---------- Normalization, ranges ----------
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
  out.angles = { ...a, spine_impact_deg: a.spine_impact_deg ?? a.spineImpact ?? a.spine_impact, shaft_impact_deg: a.shaft_impact_deg ?? a.shaftImpact ?? a.shaft_impact };
  out.stance = { ...s, impact_fraction: s.impact_fraction ?? s.impact ?? s.impactFrac };
  return out;
}

function assess(value, key, rs){
  const n = Number(value);
  if (!Number.isFinite(n) || !rs || !rs[key]) return { badge:'', level:'na' };
  const r=rs[key], inGood=n>=r.good[0]&&n<=r.good[1], inWarn=n>=r.warn[0]&&n<=r.warn[1];
  if (inGood) return { badge:'ok', level:'ok' }; if (inWarn) return { badge:'warn', level:'warn' }; return { badge:'bad', level:'bad' };
}

function generateCoaching(a, rs){
  const tips=[]; const t=a.tempo||{}, ang=a.angles||{}, st=a.stance||{};
  push(t.ratio,'tempo.ratio','Tempo','Aim ~3:1 (smooth back, brisk down)');
  push(t.backswing,'tempo.backswing','Backswing time','Keep backswing controlled, not rushed');
  push(t.downswing,'tempo.downswing','Downswing time','Snap through impact—no decel');
  push(ang.spine_impact_deg,'angles.spine_impact_deg','Spine tilt @ impact','Maintain forward tilt through strike');
  push(ang.shaft_impact_deg,'angles.shaft_impact_deg','Shaft angle @ impact','Hands ahead; compress the ball');
  push(st.impact_fraction,'stance.impact_fraction','Stance width','Match stance to club for balance & turn');
  function push(val,key,label,cue){
    const n=Number(val); if(!Number.isFinite(n) || !rs[key]) return;
    const s=assess(n,key,rs); if(s.level==='bad') tips.push(`${label} out of range: ${fmt(n)}. ${cue}`); else if(s.level==='warn') tips.push(`${label} borderline: ${fmt(n)}. ${cue}`);
  }
  return tips;
}

// ---------- PNG with options ----------
async function renderReportPNG(a, video, rs, opts={}) {
  const scale = Math.max(1, Math.min(3, Number(opts.scale)||1));
  const includeStrip = !!opts.includeStrip;

  const W = 1200, H = includeStrip ? 1780 : 1600, pad = 40;
  const canvas = document.createElement('canvas'); canvas.width=W*scale; canvas.height=H*scale;
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);

  ctx.fillStyle = '#0b0c10'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = 'bold 40px Inter, system-ui, sans-serif'; ctx.fillText('Swingalyze — Coaching Report', pad, pad+20);
  ctx.font = '18px Inter, system-ui, sans-serif'; ctx.fillText(new Date().toLocaleString(), pad, pad+50);

  const impactT = pickImpactTime(a);
  const imgRect = { x: pad, y: pad+90, w: W - pad*2, h: 540 };
  let drewFrame = false, drawn = {dx:imgRect.x,dy:imgRect.y,dw:imgRect.w,dh:imgRect.h};
  try {
    if (video && video.readyState >= 2) {
      drawn = await drawVideoFrame(ctx, video, impactT, imgRect);
      drewFrame = true;
    }
  } catch {}
  if (!drewFrame) {
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(imgRect.x, imgRect.y, imgRect.w, imgRect.h);
    ctx.fillStyle = '#9ca3af'; ctx.font = '16px Inter, system-ui, sans-serif';
    ctx.fillText('No video loaded — rendering metrics & coaching only', imgRect.x + 20, imgRect.y + 30);
    ctx.restore();
  } else {
    drawOverlaysOnImpact(ctx, a, drawn);
  }

  // Metrics & coaching
  const leftX = pad; let y = imgRect.y + imgRect.h + 40; const line = 30;
  const t = a?.tempo || {}, ang = a?.angles || {}, st = a?.stance || {};
  ctx.font = 'bold 28px Inter, system-ui, sans-serif'; ctx.fillText('Key Metrics', leftX, y); y += line;
  ctx.font = '20px Inter, system-ui, sans-serif';
  drawKVb(ctx, leftX, y, 'Tempo (ratio)', t.ratio, 'tempo.ratio', rs); y += line;
  drawKVb(ctx, leftX, y, 'Backswing (s)', t.backswing, 'tempo.backswing', rs); y += line;
  drawKVb(ctx, leftX, y, 'Downswing (s)', t.downswing, 'tempo.downswing', rs); y += line;
  drawKVb(ctx, leftX, y, 'Spine tilt @impact (°)', ang.spine_impact_deg, 'angles.spine_impact_deg', rs); y += line;
  drawKVb(ctx, leftX, y, 'Shaft angle @impact (°)', ang.shaft_impact_deg, 'angles.shaft_impact_deg', rs); y += line;
  drawKVb(ctx, leftX, y, 'Stance width @impact', st.impact_fraction, 'stance.impact_fraction', rs); y += line;

  const rightX = Math.floor(W*0.52); let ry = imgRect.y + imgRect.h + 40;
  ctx.font = 'bold 28px Inter, system-ui, sans-serif'; ctx.fillText('Coaching Tips', rightX, ry); ry += line;
  ctx.font = '20px Inter, system-ui, sans-serif';
  const coaching = toTips(a?.coaching);
  if (coaching.length === 0) ctx.fillText('– No tips provided –', rightX, ry);
  else for (const tip of coaching.slice(0, 10)) { ry = drawBullet(ctx, rightX, ry, tip, W - rightX - pad, line); if (ry > (includeStrip ? H - pad - 210 : H - pad - 60)) break; }

  // Frame strip
  if (includeStrip && video && video.readyState >= 2) {
    const stripY = H - 220;
    await drawFrameStrip(ctx, video, a, { x: pad, y: stripY, w: W - pad*2, h: 160 });
    ctx.globalAlpha = 0.8; ctx.font = '14px Inter, system-ui, sans-serif';
    ctx.fillText('Frames: address • top • impact', pad, stripY - 10);
    ctx.globalAlpha = 1;
  }

  ctx.globalAlpha = 0.8; ctx.font = '16px Inter, system-ui, sans-serif';
  ctx.fillText(`Checkpoint: 2025-09-17 · Branch: feat/recover · Build: ${buildTag} · PNG (client-side${scale>1?', '+scale+'×':''})`, pad, H - 16);
  ctx.globalAlpha = 1;

  return await new Promise((resolve, reject) => { canvas.toBlob(b => b ? resolve(b) : reject('PNG encode failed'), 'image/png', 0.95); });
}

// ---------- Visual helpers ----------
async function drawFrameStrip(ctx, video, a, rect) {
  const { x, y, w, h } = rect, gap = 12, cellW = (w - gap*2) / 3, cellH = h;
  const times = pickFrameTimes(a), labels=['address','top','impact'], current=video.currentTime;
  for (let i=0;i<3;i++){
    const cx = x + i*(cellW + gap);
    ctx.save(); ctx.fillStyle='#000'; ctx.fillRect(cx, y, cellW, cellH);
    try { await seekTo(video, times[i]); } catch {}
    const vw=video.videoWidth||1280, vh=video.videoHeight||720, s=Math.min(cellW/vw,cellH/vh);
    const dw=vw*s, dh=vh*s, dx=cx+(cellW-dw)/2, dy=y+(cellH-dh)/2;
    ctx.drawImage(video, dx, dy, dw, dh);
    ctx.fillStyle='#e5e7eb'; ctx.font='bold 14px Inter, system-ui, sans-serif'; ctx.fillText(labels[i], cx+8, y+cellH-10);
    ctx.restore();
  }
  try { await seekTo(video, current); } catch {}
}

function pickFrameTimes(a){
  const kf=a?.keyframes||{}, frames=Array.isArray(kf.frames)?kf.frames:[];
  const find=(name)=>frames.find(f=>new RegExp(name,'i').test(f?.label||''));
  const impact=typeof kf.impact==='number'?kf.impact:(find('impact')?.t ?? 0);
  const address=find('address')?.t ?? frames[0]?.t ?? Math.max(0, impact-1.0);
  const top=find('top')?.t ?? frames[Math.floor(frames.length/2)]?.t ?? Math.max(0, impact-0.2);
  return [address, top, impact];
}

function drawKVb(ctx,x,y,key,val,rangeKey,rs){ const s=assess(val,rangeKey,rs), badge=statusBadgeCanvas(ctx,s.badge);
  ctx.fillStyle='#9ca3af'; ctx.fillText(key,x,y); ctx.fillStyle='#e5e7eb'; ctx.fillText(fmt(val),x+260,y); if(badge) badge(ctx,x+340,y-18); }

function statusBadgeCanvas(ctx,type){
  if(!type) return null;
  const m={ ok:{bg:'#064e3b',fg:'#a7f3d0',bd:'#065f46',tx:'OK'}, warn:{bg:'#4d3700',fg:'#fde68a',bd:'#b45309',tx:'WARN'}, bad:{bg:'#3f0a0a',fg:'#fecaca',bd:'#dc2626',tx:'BAD'} }[type];
  return (c,x,y)=>{ c.save(); c.fillStyle=m.bg; c.strokeStyle=m.bd; c.lineWidth=2; roundRect(c,x,y,64,26,13); c.fill(); c.stroke(); c.fillStyle=m.fg; c.font='bold 12px Inter, system-ui, sans-serif'; c.fillText(m.tx,x+14,y+18); c.restore(); };
}
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

function drawBullet(ctx,x,y,text,maxWidth,lineHeight){
  const words=String(text).split(' '); let line=''; ctx.fillStyle='#e5e7eb';
  for(let n=0;n<words.length;n++){ const test=line+words[n]+' '; if(ctx.measureText(test).width>maxWidth&&n>0){ ctx.fillText(line,x,y); line=words[n]+' '; y+=lineHeight; } else line=test; }
  ctx.fillText(line,x,y); return y+lineHeight;
}

function pickImpactTime(a){
  const kf=a?.keyframes;
  if(kf&&typeof kf==='object'){
    if(typeof kf.impact==='number') return kf.impact;
    if(Array.isArray(kf.frames)){ const imp=kf.frames.find(f=>/impact/i.test(f?.label||'')); if(imp&&typeof imp.t==='number') return imp.t; if(typeof kf.frames[0]?.t==='number') return kf.frames[0].t; }
  }
  return Math.max(0,(window?.video?.currentTime??0));
}

async function drawVideoFrame(ctx, video, t, rect){
  const {x,y,w,h}=rect, cur=video.currentTime; try{ await seekTo(video,t);}catch{}
  const vw=video.videoWidth||1280, vh=video.videoHeight||720, s=Math.min(w/vw,h/vh);
  const dw=vw*s, dh=vh*s, dx=x+(w-dw)/2, dy=y+(h-dh)/2;
  ctx.save(); ctx.fillStyle='#000'; ctx.fillRect(x,y,w,h); ctx.drawImage(video,dx,dy,dw,dh); ctx.restore();
  try{ await seekTo(video,cur);}catch{}; return {dx,dy,dw,dh};
}
function seekTo(video,t){ return new Promise((res,rej)=>{ const onS=()=>{video.removeEventListener('seeked',onS); res();}; const onE=()=>{video.removeEventListener('error',onE); rej('seek error');};
  video.addEventListener('seeked',onS,{once:true}); video.addEventListener('error',onE,{once:true}); try{ video.currentTime=Math.max(0,t);}catch{ rej('seek set failed'); }
  setTimeout(()=>{ video.removeEventListener('seeked',onS); res(); },1200); }); }

// ---------- Overlays on the main frame ----------
function drawOverlaysOnImpact(ctx, a, rect) {
  const ang=a?.angles||{}, st=a?.stance||{};
  const spineDeg=toNum(ang.spine_impact_deg), shaftDeg=toNum(ang.shaft_impact_deg), stanceFrac=clamp01(toNum(st.impact_fraction));
  const { dx, dy, dw, dh } = rect; const toRad=(deg)=>(deg*Math.PI)/180;

  if (isFinite(spineDeg)) {
    const cx=dx+dw*0.5, cy=dy+dh*0.45, len=Math.min(dw,dh)*0.35, rad=toRad(-spineDeg);
    const x1=cx-Math.cos(rad)*len, y1=cy-Math.sin(rad)*len, x2=cx+Math.cos(rad)*len, y2=cy+Math.sin(rad)*len;
    ctx.save(); ctx.strokeStyle='#10b981'; ctx.lineWidth=5; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    ctx.fillStyle='#10b981'; ctx.font='bold 22px Inter, system-ui, sans-serif'; ctx.fillText(`${Math.round(spineDeg*10)/10}° spine`, cx+10, cy-10); ctx.restore();
  }
  if (isFinite(shaftDeg)) {
    const hx=dx+dw*0.5, hy=dy+dh*0.7, len=Math.min(dw,dh)*0.4, rad=toRad(-shaftDeg);
    const x1=hx, y1=hy, x2=hx+Math.cos(rad)*len, y2=hy+Math.sin(rad)*len;
    ctx.save(); ctx.strokeStyle='#3b82f6'; ctx.lineWidth=5; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    ctx.fillStyle='#3b82f6'; ctx.font='bold 22px Inter, system-ui, sans-serif'; ctx.fillText(`${Math.round(shaftDeg*10)/10}° shaft`, x2+10, y2); ctx.restore();
  }
  if (isFinite(stanceFrac)) {
    const y=dy+dh*0.92, maxW=dw*0.8, w=maxW*clamp01(stanceFrac), x=dx+(dw-w)/2;
    ctx.save(); ctx.strokeStyle='#f59e0b'; ctx.lineWidth=8; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+w,y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x,y-10); ctx.lineTo(x,y+10); ctx.moveTo(x+w,y-10); ctx.lineTo(x+w,y+10); ctx.stroke();
    ctx.fillStyle='#fbbf24'; ctx.font='bold 20px Inter, system-ui, sans-serif'; ctx.fillText(`stance ${fmt(stanceFrac)}`, x+w+12, y+6); ctx.restore();
  }
}

// ---------- Small utils ----------
function round1(n){ return Math.round(Number(n)*10)/10; }
function clamp01(v){ return !isFinite(v)?NaN:Math.max(0,Math.min(1,v)); }
function toNum(v){ const n=Number(v); return Number.isNaN(n)?NaN:n; }

// ---------- UI error ----------
function showError(msg){ els.results.innerHTML=`<div class="metric"><span class="label">Error</span><div class="code">${escapeHtml(msg)}</div></div>`; }
