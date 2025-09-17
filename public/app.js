// Swingalyze — robust client (contract banner + retries + PNG overlays + ranges/badges + JSON export)

const els = {
  file: document.getElementById('fileInput'),
  analyze: document.getElementById('analyzeBtn'),
  exportPngBtn: document.getElementById('exportPngBtn') || document.getElementById('exportBtn'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  downloadLink: document.getElementById('downloadLink'),
  statusDot: document.getElementById('statusDot'),
  video: document.getElementById('video'),
  results: document.getElementById('results'),
};

let analysis = null;
let videoBlobUrl = null;
let ranges = null;

init();

async function init(){
  await Promise.all([checkStatus(), loadRanges()]);
}

async function checkStatus() {
  try { const r = await fetch('/api/status', {cache:'no-store'}); setDot(r.ok); }
  catch { setDot(false); }
}
function setDot(up){ if(!els.statusDot) return; els.statusDot.classList.toggle('online', !!up); els.statusDot.classList.toggle('offline', !up); }

async function loadRanges() {
  try { const r = await fetch('./ranges.json', {cache:'no-store'}); ranges = r.ok ? await r.json() : {}; }
  catch { ranges = {}; }
}

function setAnalyzeEnabled(on){ els.analyze && (els.analyze.disabled = !on); }
function setExportEnabled(on){
  els.exportPngBtn && (els.exportPngBtn.disabled = !on);
  els.exportJsonBtn && (els.exportJsonBtn.disabled = !on);
  els.downloadLink && els.downloadLink.classList.add('hidden');
}

els.file?.addEventListener('change', () => {
  const file = els.file.files?.[0]; if(!file) return;
  if (!file.type.startsWith('video/')) { showError('Selected file is not a video.'); setAnalyzeEnabled(false); setExportEnabled(false); return; }
  if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
  videoBlobUrl = URL.createObjectURL(file);
  els.video.src = videoBlobUrl;
  setAnalyzeEnabled(true); setExportEnabled(false); analysis = null;
});

els.analyze?.addEventListener('click', async () => {
  const file = els.file?.files?.[0]; if(!file) return;
  setAnalyzeEnabled(false); els.analyze.textContent = 'Analyzing…';
  try {
    const fd = new FormData(); fd.append('video', file);
    const res = await fetchWithRetry('/api/analyze', { method:'POST', body: fd }, { attempts: 2, timeoutMs: 60000 });
    if (!res.ok) throw await mapHttpError(res);
    const raw = await res.json();
    analysis = normalize(raw);

    // Contract check → banner (same spirit as CI)
    const shape = validateContract(analysis);
    renderBanner(shape);

    // Coaching merge
    const baseCoach = Array.isArray(analysis.coaching) ? analysis.coaching : [];
    const extra = generateCoaching(analysis, (ranges?.default || ranges || {}));
    analysis.coaching = dedupe([...baseCoach, ...extra]);

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

els.exportPngBtn?.addEventListener('click', async () => {
  if (!analysis || !els.video?.src) return;
  const btn = els.exportPngBtn; btn.textContent='Rendering…'; btn.disabled=true;
  try {
    const pngBlob = await renderReportPNG(analysis, els.video, (ranges?.default || ranges || {}), null);
    const url = URL.createObjectURL(pngBlob);
    els.downloadLink.href = url;
    els.downloadLink.download = 'Swingalyze-Report.png';
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

// ---- Networking helpers ----
async function fetchWithRetry(url, options={}, {attempts=2, timeoutMs=60000}={}){
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

// ---- Contract banner (UI) ----
function renderBanner(shape){
  const { ok, issues, warnings } = shape;
  const cls = ok ? 'ok' : (issues.length ? 'bad' : 'warn');
  const items = (issues.length ? issues : warnings).map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  const title = ok ? 'Contract OK' : (issues.length ? 'Contract Problems' : 'Contract Warnings');
  const html = `<div class="banner ${cls}"><h3>${title}</h3>${items ? `<ul>${items}</ul>` : ''}</div>`;
  // prepend banner
  els.results.innerHTML = html + (els.results.innerHTML || '');
}

// Mirrors the CI expectations, but tolerant, returns issues/warnings
function validateContract(j){
  const issues = [];
  const warnings = [];

  function reqObject(name,val){ if(val==null) issues.push(`Missing key: ${name}`); else if(typeof val!=='object'||Array.isArray(val)) issues.push(`${name} must be an object`); }
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

  // keyframes: need impact or frames[].t
  let kfOk=false; const kf=j.keyframes||{};
  if (typeof kf.impact==='number') kfOk=true;
  if (Array.isArray(kf.frames) && kf.frames.some(f=>typeof f?.t==='number')) kfOk=true;
  if (!kfOk) issues.push('keyframes must include numeric "impact" or frames[].t');

  return { ok: issues.length===0, issues, warnings };
}

// ---- Render results ----
function renderResults(a){
  const t=a?.tempo||{}, ang=a?.angles||{}, st=a?.stance||{}, coach=Array.isArray(a?.coaching)?a.coaching:[];
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
function fmt(v){ return v==null ? '–' : String(Math.round(Number(v)*100)/100); }
function dedupe(a){ return Array.from(new Set(a)); }

// ---- Normalization, ranges, coaching ----
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
  if (value==null || !rs || !rs[key]) return { badge:'', level:'na' };
  const r=rs[key]; const inGood=value>=r.good[0]&&value<=r.good[1]; const inWarn=value>=r.warn[0]&&value<=r.warn[1];
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
  function push(val,key,label,cue){ if(val==null||!rs[key]) return; const s=assess(Number(val),key,rs); if(s.level==='bad') tips.push(`${label} out of range: ${fmt(val)}. ${cue}`); else if(s.level==='warn') tips.push(`${label} borderline: ${fmt(val)}. ${cue}`); }
  return dedupe(tips);
}

// ---- PNG (unchanged overlays) ----
async function renderReportPNG(a, video, rs) {
  const W=1200,H=1600,pad=40; const canvas=document.createElement('canvas'); canvas.width=W; canvas.height=H; const ctx=canvas.getContext('2d');
  ctx.fillStyle='#0b0c10'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#e5e7eb'; ctx.font='bold 40px Inter, system-ui, sans-serif'; ctx.fillText('Swingalyze — Coaching Report', pad, pad+20);
  ctx.font='18px Inter, system-ui, sans-serif'; ctx.fillText(new Date().toLocaleString(), pad, pad+50);
  const impactT=pickImpactTime(a); const imgRect={x:pad,y:pad+90,w:W-pad*2,h:540}; const drawn=await drawVideoFrame(ctx, video, impactT, imgRect); drawOverlaysOnImpact(ctx, a, drawn);
  const leftX=pad; let y=imgRect.y+imgRect.h+40; const line=30; const t=a?.tempo||{}, ang=a?.angles||{}, st=a?.stance||{};
  ctx.font='bold 28px Inter, system-ui, sans-serif'; ctx.fillText('Key Metrics', leftX, y); y+=line; ctx.font='20px Inter, system-ui, sans-serif';
  drawKVb(ctx,leftX,y,'Tempo (ratio)',t.ratio,'tempo.ratio',rs); y+=line;
  drawKVb(ctx,leftX,y,'Backswing (s)',t.backswing,'tempo.backswing',rs); y+=line;
  drawKVb(ctx,leftX,y,'Downswing (s)',t.downswing,'tempo.downswing',rs); y+=line;
  drawKVb(ctx,leftX,y,'Spine tilt @impact (°)',ang.spine_impact_deg,'angles.spine_impact_deg',rs); y+=line;
  drawKVb(ctx,leftX,y,'Shaft angle @impact (°)',ang.shaft_impact_deg,'angles.shaft_impact_deg',rs); y+=line;
  drawKVb(ctx,leftX,y,'Stance width @impact',st.impact_fraction,'stance.impact_fraction',rs); y+=line;
  const rightX=Math.floor(W*0.52); let ry=imgRect.y+imgRect.h+40; ctx.font='bold 28px Inter, system-ui, sans-serif'; ctx.fillText('Coaching Tips', rightX, ry); ry+=line; ctx.font='20px Inter, system-ui, sans-serif';
  const coaching=Array.isArray(a?.coaching)?a.coaching:[]; if(coaching.length===0) ctx.fillText('– No tips provided –', rightX, ry);
  else for(const tip of coaching.slice(0,10)){ ry=drawBullet(ctx,rightX,ry,tip,W-rightX-pad,line); if(ry>H-pad-60) break; }
  ctx.globalAlpha=.8; ctx.font='16px Inter, system-ui, sans-serif'; ctx.fillText('Checkpoint: 2025-09-17 · Branch: feat/recover · Exported as PNG (client-side)', pad, H-pad); ctx.globalAlpha=1;
  return await new Promise((resolve,reject)=>{ canvas.toBlob(b=>b?resolve(b):reject('PNG encode failed'),'image/png',0.95); });
}
function drawKVb(ctx,x,y,key,val,rangeKey,rs){ const s=assess(Number(val),rangeKey,rs); const badge=statusBadgeCanvas(ctx,s.badge); ctx.fillStyle='#9ca3af'; ctx.fillText(key,x,y); ctx.fillStyle='#e5e7eb'; ctx.fillText(fmt(val),x+260,y); if(badge) badge(ctx,x+340,y-18); }
function statusBadgeCanvas(ctx,type){
  if(!type) return null;
  const m={ ok:{bg:'#064e3b',fg:'#a7f3d0',bd:'#065f46',tx:'OK'}, warn:{bg:'#4d3700',fg:'#fde68a',bd:'#b45309',tx:'WARN'}, bad:{bg:'#3f0a0a',fg:'#fecaca',bd:'#dc2626',tx:'BAD'} }[type];
  return (c,x,y)=>{ c.save(); c.fillStyle=m.bg; c.strokeStyle=m.bd; c.lineWidth=2; roundRect(c,x,y,64,26,13); c.fill(); c.stroke(); c.fillStyle=m.fg; c.font='bold 12px Inter, system-ui, sans-serif'; c.fillText(m.tx,x+14,y+18); c.restore(); };
}
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function drawBullet(ctx,x,y,text,maxWidth,lineHeight){ const words=String(text).split(' '); let line=''; ctx.fillStyle='#e5e7eb'; for(let n=0;n<words.length;n++){ const test=line+words[n]+' '; if(ctx.measureText(test).width>maxWidth&&n>0){ ctx.fillText(line,x,y); line=words[n]+' '; y+=lineHeight; } else line=test; } ctx.fillText(line,x,y); return y+lineHeight; }
function pickImpactTime(a){ const kf=a?.keyframes; if(kf&&typeof kf==='object'){ if(typeof kf.impact==='number') return kf.impact; if(Array.isArray(kf.frames)){ const imp=kf.frames.find(f=>/impact/i.test(f?.label||'')); if(imp&&typeof imp.t==='number') return imp.t; if(typeof kf.frames[0]?.t==='number') return kf.frames[0].t; } } return Math.max(0,(window?.video?.currentTime??0)); }
async function drawVideoFrame(ctx, video, t, rect){ const {x,y,w,h}=rect; const cur=video.currentTime; try{ await seekTo(video,t);}catch{} const vw=video.videoWidth||1280, vh=video.videoHeight||720; const s=Math.min(w/vw,h/vh); const dw=vw*s, dh=vh*s; const dx=x+(w-dw)/2, dy=y+(h-dh)/2; ctx.save(); ctx.fillStyle='#000'; ctx.fillRect(x,y,w,h); ctx.drawImage(video,dx,dy,dw,dh); ctx.restore(); try{ await seekTo(video,cur);}catch{} return {dx,dy,dw,dh}; }
function seekTo(video,t){ return new Promise((res,rej)=>{ const onS=()=>{video.removeEventListener('seeked',onS); res();}; const onE=()=>{video.removeEventListener('error',onE); rej('seek error');}; video.addEventListener('seeked',onS,{once:true}); video.addEventListener('error',onE,{once:true}); try{ video.currentTime=Math.max(0,t);}catch{ rej('seek set failed'); } setTimeout(()=>{ video.removeEventListener('seeked',onS); res(); },1200); }); }
function drawOverlaysOnImpact(ctx,a,rect){ const ang=a?.angles||{}, st=a?.stance||{}; const spineDeg=toNum(ang.spine_impact_deg), shaftDeg=toNum(ang.shaft_impact_deg), stanceFrac=clamp01(toNum(st.impact_fraction)); const {dx,dy,dw,dh}=rect; const toRad=d=>(d*Math.PI)/180;
  if(isFinite(spineDeg)){ const cx=dx+dw*.5, cy=dy+dh*.45, L=Math.min(dw,dh)*.35, r=toRad(-spineDeg); const x1=cx-Math.cos(r)*L, y1=cy-Math.sin(r)*L, x2=cx+Math.cos(r)*L, y2=cy+Math.sin(r)*L; ctx.save(); ctx.strokeStyle='#10b981'; ctx.lineWidth=5; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); ctx.fillStyle='#10b981'; ctx.font='bold 22px Inter, system-ui, sans-serif'; ctx.fillText(`${Math.round(spineDeg*10)/10}° spine`, cx+10, cy-10); ctx.restore(); }
  if(isFinite(shaftDeg)){ const hx=dx+dw*.5, hy=dy+dh*.7, L=Math.min(dw,dh)*.4, r=toRad(-shaftDeg); const x1=hx, y1=hy, x2=hx+Math.cos(r)*L, y2=hy+Math.sin(r)*L; ctx.save(); ctx.strokeStyle='#3b82f6'; ctx.lineWidth=5; ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke(); ctx.fillStyle='#3b82f6'; ctx.font='bold 22px Inter, system-ui, sans-serif'; ctx.fillText(`${Math.round(shaftDeg*10)/10}° shaft`, x2+10, y2); ctx.restore(); }
  if(isFinite(stanceFrac)){ const y=dy+dh*.92, maxW=dw*.8, w=maxW*clamp01(stanceFrac), x=dx+(dw-w)/2; ctx.save(); ctx.strokeStyle='#f59e0b'; ctx.lineWidth=8; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+w,y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x,y-10); ctx.lineTo(x,y+10); ctx.moveTo(x+w,y-10); ctx.lineTo(x+w,y+10); ctx.stroke(); ctx.fillStyle='#fbbf24'; ctx.font='bold 20px Inter, system-ui, sans-serif'; ctx.fillText(`stance ${fmt(stanceFrac)}`, x+w+12, y+6); ctx.restore(); }
}
function clamp01(v){ return !isFinite(v)?NaN:Math.max(0,Math.min(1,v)); }
function toNum(v){ const n=Number(v); return Number.isNaN(n)?NaN:n; }
