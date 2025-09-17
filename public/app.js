// Swingalyze — robust client: retries, contract banner, badges, overlays, JSON export
// PNG options: frame strip (address•top•impact) and Hi-Res (2×)

const els = {
  file: document.getElementById('fileInput'),
  analyze: document.getElementById('analyzeBtn'),
  exportPngBtn: document.getElementById('exportPngBtn'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  downloadLink: document.getElementById('downloadLink'),
  statusDot: document.getElementById('statusDot'),
  video: document.getElementById('video'),
  results: document.getElementById('results'),
  optFrameStrip: document.getElementById('optFrameStrip'),
  optHiRes: document.getElementById('optHiRes'),
};

let analysis = null;
let videoBlobUrl = null;
let ranges = null;

init();

async function init(){
  await Promise.all([checkStatus(), loadRanges()]);
}

// ---------- Status ----------
async function checkStatus() {
  try { const r = await fetch('/api/status', {cache:'no-store'}); setDot(r.ok); }
  catch { setDot(false); }
}
function setDot(up){
  if(!els.statusDot) return;
  els.statusDot.classList.toggle('online', !!up);
  els.statusDot.classList.toggle('offline', !up);
}

// ---------- Ranges ----------
async function loadRanges() {
  try { const r = await fetch('./ranges.json', {cache:'no-store'}); ranges = r.ok ? await r.json() : {}; }
  catch { ranges = {}; }
}

// ---------- UI enable/disable ----------
function setAnalyzeEnabled(on){ els.analyze && (els.analyze.disabled = !on); }
function setExportEnabled(on){
  els.exportPngBtn && (els.exportPngBtn.disabled = !on);
  els.exportJsonBtn && (els.exportJsonBtn.disabled = !on);
  els.downloadLink && els.downloadLink.classList.add('hidden');
}

// ---------- File load ----------
els.file?.addEventListener('change', () => {
  const file = els.file.files?.[0];
  if(!file) return;
  if (!file.type.startsWith('video/')) {
    showError('Selected file is not a video.');
    setAnalyzeEnabled(false); setExportEnabled(false);
    return;
  }
  if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
  videoBlobUrl = URL.createObjectURL(file);
  els.video.src = videoBlobUrl;
  setAnalyzeEnabled(true); setExportEnabled(false); analysis = null;
});

// ---------- Analyze (timeout + retry + mapped errors) ----------
els.analyze?.addEventListener('click', async () => {
  const file = els.file?.files?.[0]; if(!file) return;
  setAnalyzeEnabled(false); els.analyze.textContent = 'Analyzing…';
  try {
    const fd = new FormData(); fd.append('video', file);
    const res = await fetchWithRetry('/api/analyze', { method:'POST', body: fd }, { attempts: 2, timeoutMs: 60000 });
    if (!res.ok) throw await mapHttpError(res);
    const raw = await res.json();
    analysis = normalize(raw);

    // Contract check → banner
    const shape = validateContract(analysis);
    renderBanner(shape);

    // Coaching: merge generator + normalize to strings
    const baseCoach = Array.isArray(analysis.coaching) ? analysis.coaching : [];
    const extra = generateCoaching(analysis, (ranges?.default || ranges || {}));
    analysis.coaching = dedupe(toTips([...baseCoach, ...extra]));

    renderResults(analysis);
    setExportEnabled(true);
  } catch (e) {
    showError(String(e?.message || e));
    setExportEnabled(false);
  } finally {
    els.analyze.textContent = 'Analyze';
    setAnalyzeEnabled(true);
  }
});

// ---------- Exports ----------
els.exportPngBtn?.addEventListener('click', async () => {
  if (!analysis || !els.video?.src) return;
  const btn = els.exportPngBtn; btn.textContent='Rendering…'; btn.disabled=true;
  try {
    const opts = {
      includeStrip: !!els.optFrameStrip?.checked,
      scale: els.optHiRes?.checked ? 2 : 1
    };
    const pngBlob = await renderReportPNG(analysis, els.video, (ranges?.default || ranges || {}), opts);
    const url = URL.createObjectURL(pngBlob);
    els.downloadLink.href = url;
    els.downloadLink.download = `Swingalyze-Report${opts.scale===2?'-2x':''}.png`;
    els.downloadLink.classList.remove('hidden'); els.downloadLink.click();
  } catch(e){ showError(e); }
  finally { btn.textContent='Export PNG Report'; btn.disabled=false; }
});

els.exportJsonBtn?.addEventListener('click', () => {
  if (!analysis) return;
  const payload = { analysis, ranges: (ranges?.default || ranges || {}) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  els.downloadLink.href=url; els.downloadLink.download='Swingalyze-Analysis.json';
  els.downloadLink.classList.remove('hidden'); els.downloadLink.click();
});

// ---------- Networking helpers ----------
async function fetchWithRetry(url, options={}, {attempts=2, timeoutMs=60000}={}){
  let last;
  for (let i=0;i<attempts;i++){
    try{
      const ctl=new AbortController();
      const t=setTimeout(()=>ctl.abort(), timeoutMs);
      const r=await fetch(url, {...options, signal: ctl.signal});
      clearTimeout(t);
      if (r.status>=500 && r.status<600 && i<attempts-1){ await wait(400*(i+1)); continue; }
      return r;
    }catch(e){
      last=e;
      if(i===attempts-1) throw new Error('Network error contacting analyzer.');
      await wait(300*(i+1));
    }
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
function fmt(v){
  const n = Number(v);
  if (v==null || !Number.isFinite(n)) return '–';
  return String(Math.round(n*100)/100);
}

// ---------- Coaching helpers ----------
function toTips(arr){
  if (!Array.isArray(arr)) return [];
  const tips = arr.map(x=>{
    if (typeof x === 'string') return x.trim();
    if (x && typeof x === 'object') {
      // common fields in analyzers
      const s = x.text || x.message || x.tip || x.note || x.reason;
      if (typeof s === 'string') return s.trim();
      // try "label: advice"
      const label = (typeof x.label==='string' && x.label.trim()) || '';
      const advice = (typeof x.advice==='string' && x.advice.trim()) || '';
      if (label || advice) return `${label}${label&&advice?': ':''}${advice}`.trim();
      // last resort: stringify safely
      try { return JSON.stringify(x); } catch { return String(x); }
    }
    return String(x);
  }).filter(Boolean);
  return tips;
}

// ---------- Normalization, ranges, coaching ----------
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
  const r=rs[key];
  const inGood=n>=r.good[0]&&n<=r.good[1];
  const inWarn=n>=r.warn[0]&&n<=r.warn[1];
  if (inGood) return { badge:'ok', level:'ok' };
  if (inWarn) return { badge:'warn', level:'warn' };
  return { badge:'bad', level:'bad' };
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
    const n = Number(val);
    if(!Number.isFinite(n) || !rs[key]) return;
    const s=assess(n,key,rs);
    if(s.level==='bad') tips.push(`${label} out of range: ${fmt(n)}. ${cue}`);
    else if(s.level==='warn') tips.push(`${label} borderline: ${fmt(n)}. ${cue}`);
  }
  return tips;
}

// ---------- PNG with options: frame strip + 2× scale ----------
async function renderReportPNG(a, video, rs, opts={}) {
  const scale = Math.max(1, Math.min(3, Number(opts.scale)||1));
  const includeStrip = !!opts.includeStrip;

  // Base logical size; we’ll scale canvas for Hi-Res
  const W = 1200, H = includeStrip ? 1780 : 1600, pad = 40;
  const canvas = document.createElement('canvas'); canvas.width=W*scale; canvas.height=H*scale;
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);

  ctx.fillStyle = '#0b0c10'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = 'bold 40px Inter, system-ui, sans-serif';
  ctx.fillText('Swingalyze — Coaching Report', pad, pad+20);
  ctx.font = '18px Inter, system-ui, sans-serif';
  ctx.fillText(new Date().toLocaleString(), pad, pad+50);

  const impactT = pickImpactTime(a);
  const imgRect = { x: pad, y: pad+90, w: W - pad*2, h: 540 };
  const drawn = await drawVideoFrame(ctx, video, impactT, imgRect);
  drawOverlaysOnImpact(ctx, a, drawn);

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

  // Frame strip (address • top • impact)
  if (includeStrip) {
    const stripY = H - 220;
    await drawFrameStrip(ctx, video, a, { x: pad, y: stripY, w: W - pad*2, h: 160 });
    ctx.globalAlpha = 0.8; ctx.font = '14px Inter, system-ui, sans-serif';
    ctx.fillText('Frames: address • top • impact', pad, stripY - 10);
    ctx.globalAlpha = 1;
  }

  ctx.globalAlpha = 0.8; ctx.font = '16px Inter, system-ui, sans-serif';
  ctx.fillText(`Checkpoint: 2025-09-17 · Branch: feat/recover · Exported as PNG (client-side${scale>1?', '+scale+'×':''})`, pad, H - 16);
  ctx.globalAlpha = 1;

  return await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject('PNG encode failed'), 'image/png', 0.95);
  });
}

// ---------- Visual helpers ----------
async function drawFrameStrip(ctx, video, a, rect) {
  const { x, y, w, h } = rect;
  const gap = 12;
  const cellW = (w - gap*2) / 3;
  const cellH = h;
  const times = pickFrameTimes(a);
  const labels = ['address','top','impact'];
  const current = video.currentTime;

  for (let i=0; i<3; i++){
    const cx = x + i*(cellW + gap);
    ctx.save();
    ctx.fillStyle = '#000'; ctx.fillRect(cx, y, cellW, cellH);
    try { await seekTo(video, times[i]); } catch {}
    const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
    const scale = Math.min(cellW / vw, cellH / vh);
    const dw = vw * scale, dh = vh * scale;
    const dx = cx + (cellW - dw) / 2, dy = y + (cellH - dh) / 2;
    ctx.drawImage(video, dx, dy, dw, dh);
    ctx.fillStyle = '#e5e7eb'; ctx.font = 'bold 14px Inter, system-ui, sans-serif';
    ctx.fillText(labels[i], cx + 8, y + cellH - 10);
    ctx.restore();
  }
  try { await seekTo(video, current); } catch {}
}

function pickFrameTimes(a) {
  const kf = a?.keyframes || {};
  const frames = Array.isArray(kf.frames) ? kf.frames : [];
  const find = (name) => frames.find(f => new RegExp(name,'i').test(f?.label || ''));
  const impact = typeof kf.impact === 'number' ? kf.impact : (find('impact')?.t ?? 0);
  const address = find('address')?.t ?? frames[0]?.t ?? Math.max(0, impact - 1.0);
  const top = find('top')?.t ?? frames[Math.floor(frames.length/2)]?.t ?? Math.max(0, impact - 0.2);
  return [address, top, impact];
}

function drawKVb(ctx, x, y, key, val, rangeKey, rs){
  const s=assess(val,rangeKey,rs); const badge=statusBadgeCanvas(ctx,s.badge);
  ctx.fillStyle='#9ca3af'; ctx.fillText(key,x,y);
  ctx.fillStyle='#e5e7eb'; ctx.fillText(fmt(val),x+260,y);
  if(badge) badge(ctx,x+340,y-18);
}

function statusBadgeCanvas(ctx,type){
  if(!type) return null;
  const m={ ok:{bg:'#064e3b',fg:'#a7f3d0',bd:'#065f46',tx:'OK'}, warn:{bg:'#4d3700',fg:'#fde68a',bd:'#b45309',tx:'WARN'}, bad:{bg:'#3f0a0a',fg:'#fecaca',bd:'#dc2626',tx:'BAD'} }[type];
  return (c,x,y)=>{ c.save(); c.fillStyle=m.bg; c.strokeStyle=m.bd; c.lineWidth=2; roundRect(c,x,y,64,26,13); c.fill(); c.stroke(); c.fillStyle=m.fg; c.font='bold 12px Inter, system-ui, sans-serif'; c.fillText(m.tx,x+14,y+18); c.restore(); };
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function drawBullet(ctx,x,y,text,maxWidth,lineHeight){
  const words=String(text).split(' '); let line='';
  ctx.fillStyle='#e5e7eb';
  for(let n=0;n<words.length;n++){
    const test=line+words[n]+' ';
    if(ctx.measureText(test).width>maxWidth&&n>0){ ctx.fillText(line,x,y); line=words[n]+' '; y+=lineHeight; }
    else line=test;
  }
  ctx.fillText(line,x,y);
  return y+lineHeight;
}

function pickImpactTime(a){
  const kf=a?.keyframes;
  if(kf&&typeof kf==='object'){
    if(typeof kf.impact==='number') return kf.impact;
    if(Array.isArray(kf.frames)){
      const imp=kf.frames.find(f=>/impact/i.test(f?.label||''));
      if(imp&&typeof imp.t==='number') return imp.t;
      if(typeof kf.frames[0]?.t==='number') return kf.frames[0].t;
    }
  }
  return Math.max(0,(window?.video?.currentTime??0));
}

async function drawVideoFrame(ctx, video, t, rect){
  const {x,y,w,h}=rect;
  const cur=video.currentTime;
  try{ await seekTo(video,t);}catch{}
  const vw=video.videoWidth||1280, vh=video.videoHeight||720;
  const s=Math.min(w/vw,h/vh);
  const dw=vw*s, dh=vh*s;
  const dx=x+(w-dw)/2, dy=y+(h-dh)/2;
  ctx.save(); ctx.fillStyle='#000'; ctx.fillRect(x,y,w,h); ctx.drawImage(video,dx,dy,dw,dh); ctx.restore();
  try{ await seekTo(video,cur);}catch{}
  return {dx,dy,dw,dh};
}

function seekTo(video,t){
  return new Promise((res,rej)=>{
    const onS=()=>{video.removeEventListener('seeked',onS); res();};
    const onE=()=>{video.removeEventListener('error',onE); rej('seek error');};
    video.addEventListener('seeked',onS,{once:true});
    video.addEventListener('error',onE,{once:true});
    try{ video.currentTime=Math.max(0,t);}catch{ rej('seek set failed'); }
    setTimeout(()=>{ video.removeEventListener('seeked',onS); res(); },1200);
  });
}

// ---------- Overlays on the main frame ----------
function drawOverlaysOnImpact(ctx, a, rect) {
  const ang = a?.angles || {};
  const st = a?.stance || {};
  const spineDeg = toNum(ang.spine_impact_deg);
  const shaftDeg = toNum(ang.shaft_impact_deg);
  const stanceFrac = clamp01(toNum(st.impact_fraction));
  const { dx, dy, dw, dh } = rect;
  const toRad = (deg) => (deg * Math.PI) / 180;

  if (isFinite(spineDeg)) {
    const cx = dx + dw * 0.5, cy = dy + dh * 0.45, len = Math.min(dw, dh) * 0.35;
    const rad = toRad(-spineDeg);
    const x1 = cx - Math.cos(rad) * len, y1 = cy - Math.sin(rad) * len;
    const x2 = cx + Math.cos(rad) * len, y2 = cy + Math.sin(rad) * len;
    ctx.save(); ctx.strokeStyle='#10b981'; ctx.lineWidth=5;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    ctx.fillStyle='#10b981'; ctx.font='bold 22px Inter, system-ui, sans-serif';
    ctx.fillText(`${round1(spineDeg)}° spine`, cx + 10, cy - 10); ctx.restore();
  }

  if (isFinite(shaftDeg)) {
    const hx = dx + dw * 0.5, hy = dy + dh * 0.7, len = Math.min(dw, dh) * 0.4;
    const rad = toRad(-shaftDeg);
    const x1 = hx, y1 = hy, x2 = hx + Math.cos(rad) * len, y2 = hy + Math.sin(rad) * len;
    ctx.save(); ctx.strokeStyle='#3b82f6'; ctx.lineWidth=5;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    ctx.fillStyle='#3b82f6'; ctx.font='bold 22px Inter, system-ui, sans-serif';
    ctx.fillText(`${round1(shaftDeg)}° shaft`, x2 + 10, y2); ctx.restore();
  }

  if (isFinite(stanceFrac)) {
    const y = dy + dh * 0.92, maxW = dw * 0.8, w = maxW * clamp01(stanceFrac), x = dx + (dw - w) / 2;
    ctx.save(); ctx.strokeStyle='#f59e0b'; ctx.lineWidth=8;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.moveTo(x + w, y - 10); ctx.lineTo(x + w, y + 10); ctx.stroke();
    ctx.fillStyle='#fbbf24'; ctx.font='bold 20px Inter, system-ui, sans-serif';
    ctx.fillText(`stance ${fmt(stanceFrac)}`, x + w + 12, y + 6); ctx.restore();
  }
}

// ---------- Small utils ----------
function round1(n){ return Math.round(Number(n)*10)/10; }
function clamp01(v){ return !isFinite(v)?NaN:Math.max(0,Math.min(1,v)); }
function toNum(v){ const n=Number(v); return Number.isNaN(n)?NaN:n; }

// ---------- UI error ----------
function showError(msg) {
  els.results.innerHTML = `<div class="metric"><span class="label">Error</span><div class="code">${escapeHtml(msg)}</div></div>`;
}
