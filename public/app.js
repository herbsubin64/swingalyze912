// Swingalyze — API-first coaching with per-club tunable ranges + overlays + exports

const els = {
  file: document.getElementById('fileInput'),
  analyze: document.getElementById('analyzeBtn'),
  exportPngBtn: document.getElementById('exportPngBtn'),
  exportJsonBtn: document.getElementById('exportJsonBtn'),
  downloadLink: document.getElementById('downloadLink'),
  statusDot: document.getElementById('statusDot'),
  video: document.getElementById('video'),
  results: document.getElementById('results'),
  clubSelect: document.getElementById('clubSelect'),
};

let analysis = null;
let videoBlobUrl = null;
let rangesAll = null;     // raw from ranges.json (default + club presets)
let activeRanges = null;  // merged: default + selected club
let activeClub = null;

// --- Bootstrap ---
init();

async function init(){
  // Persisted club or URL ?club=driver override
  const urlClub = new URLSearchParams(location.search).get('club');
  const savedClub = localStorage.getItem('swingalyze.club') || '7i';
  activeClub = (urlClub || savedClub || '7i').toLowerCase();
  if (els.clubSelect) els.clubSelect.value = ['driver','7i','wedge'].includes(activeClub) ? activeClub : '7i';

  await Promise.all([checkStatus(), loadRanges()]);
  applyClub(activeClub);
}

async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) { els.statusDot.classList.remove('offline'); els.statusDot.classList.add('online'); }
    else throw new Error('bad status');
  } catch { els.statusDot.classList.remove('online'); els.statusDot.classList.add('offline'); }
}

async function loadRanges() {
  try {
    const res = await fetch('./ranges.json', { cache: 'no-store' });
    rangesAll = res.ok ? await res.json() : {};
  } catch { rangesAll = {}; }
}

function applyClub(club){
  const base = rangesAll?.default || {};
  const override = rangesAll?.[club] || {};
  activeRanges = { ...base, ...override }; // shallow merge is fine (keys are leaf metrics)
  activeClub = club;
  localStorage.setItem('swingalyze.club', club);
  // Re-render badges/coaching if we already have analysis
  if (analysis) {
    // Refresh auto coaching merge with new ranges
    const extra = generateCoaching(analysis, activeRanges);
    const baseCoach = Array.isArray(analysis.coaching) ? analysis.coaching : [];
    analysis.coaching = dedupe([...baseCoach, ...extra]);
    renderResults(analysis);
  }
}

// --- UI events ---
els.clubSelect?.addEventListener('change', (e) => applyClub(e.target.value));

function setAnalyzeEnabled(on){ els.analyze.disabled=!on; }
function setExportEnabled(on){
  els.exportPngBtn.disabled=!on;
  els.exportJsonBtn.disabled=!on;
  els.downloadLink.classList.add('hidden');
}

els.file.addEventListener('change', () => {
  const file = els.file.files?.[0];
  if (!file) return;
  if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
  videoBlobUrl = URL.createObjectURL(file);
  els.video.src = videoBlobUrl;
  setAnalyzeEnabled(true);
  setExportEnabled(false);
  analysis = null;
});

els.analyze.addEventListener('click', async () => {
  const file = els.file.files?.[0];
  if (!file) return;
  setAnalyzeEnabled(false);
  els.analyze.textContent = 'Analyzing…';
  try {
    const fd = new FormData();
    fd.append('video', file);
    const res = await fetch('/api/analyze', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    const raw = await res.json();
    analysis = normalize(raw);

    // Merge auto-generated coaching with per-club ranges
    const extra = generateCoaching(analysis, activeRanges);
    const baseCoach = Array.isArray(analysis.coaching) ? analysis.coaching : [];
    analysis.coaching = dedupe([...baseCoach, ...extra]);

    renderResults(analysis);
    setExportEnabled(true);
  } catch (err) {
    console.error(err);
    showError(String(err));
    setExportEnabled(false);
  } finally {
    els.analyze.textContent = 'Analyze';
    setAnalyzeEnabled(true);
  }
});

els.exportPngBtn.addEventListener('click', async () => {
  if (!analysis || !els.video.src) return;
  els.exportPngBtn.textContent = 'Rendering…';
  els.exportPngBtn.disabled = true;
  try {
    const pngBlob = await renderReportPNG(analysis, els.video, activeRanges, activeClub);
    const url = URL.createObjectURL(pngBlob);
    els.downloadLink.href = url;
    els.downloadLink.download = `Swingalyze-Report-${(activeClub||'7i')}.png`;
    els.downloadLink.classList.remove('hidden');
    els.downloadLink.click();
  } catch (e) {
    console.error(e); showError(e);
  } finally {
    els.exportPngBtn.textContent = 'Export PNG Report';
    els.exportPngBtn.disabled = false;
  }
});

els.exportJsonBtn.addEventListener('click', () => {
  if (!analysis) return;
  const payload = { club: activeClub, ranges: activeRanges, analysis };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  els.downloadLink.href = url;
  els.downloadLink.download = `Swingalyze-Analysis-${(activeClub||'7i')}.json`;
  els.downloadLink.classList.remove('hidden');
  els.downloadLink.click();
});

// --- Helpers ---
function showError(msg) {
  els.results.innerHTML = `<div class="metric"><span class="label">Error</span><div class="code">${escapeHtml(msg)}</div></div>`;
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function fmt(v){ return v==null ? '–' : String(Math.round(v*100)/100); }
function dedupe(arr){ return Array.from(new Set(arr)); }

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
  const a = out.angles;
  out.angles = {
    ...a,
    spine_impact_deg: a.spine_impact_deg ?? a.spineImpact ?? a.spineImpactDeg ?? a.spine_impact,
    shaft_impact_deg: a.shaft_impact_deg ?? a.shaftImpact ?? a.shaftImpactDeg ?? a.shaft_impact
  };
  const s = out.stance;
  out.stance = { ...s, impact_fraction: s.impact_fraction ?? s.impact ?? s.impactFrac };
  return out;
}

function assess(value, key, rs) {
  if (value==null || !rs || !rs[key]) return { badge:'', level:'na' };
  const r = rs[key];
  const inGood = value >= r.good[0] && value <= r.good[1];
  const inWarn = value >= r.warn[0] && value <= r.warn[1];
  if (inGood) return { badge:'ok', level:'ok' };
  if (inWarn) return { badge:'warn', level:'warn' };
  return { badge:'bad', level:'bad' };
}

function generateCoaching(a, rs){
  const tips = [];
  const t = a.tempo || {};
  const ang = a.angles || {};
  const st = a.stance || {};
  pushRangeTip(t.ratio, 'tempo.ratio', 'Tempo', 'Aim ~3:1 (smooth back, brisk down)');
  pushRangeTip(t.backswing, 'tempo.backswing', 'Backswing time', 'Keep backswing controlled, not rushed');
  pushRangeTip(t.downswing, 'tempo.downswing', 'Downswing time', 'Snap through impact—no decel');
  pushRangeTip(ang.spine_impact_deg, 'angles.spine_impact_deg', 'Spine tilt @ impact','Maintain forward tilt through strike');
  pushRangeTip(ang.shaft_impact_deg, 'angles.shaft_impact_deg', 'Shaft angle @ impact','Hands ahead; compress the ball');
  pushRangeTip(st.impact_fraction, 'stance.impact_fraction', 'Stance width','Match stance to club for balance & turn');
  function pushRangeTip(val, key, label, cue){
    if (val==null) return;
    const a = assess(Number(val), key, rs);
    if (a.level === 'bad') tips.push(`${label} out of range: ${round2(val)}. ${cue}`);
    else if (a.level === 'warn') tips.push(`${label} borderline: ${round2(val)}. ${cue}`);
  }
  return dedupe(tips);
}

function renderResults(a) {
  const tempo = a?.tempo || {};
  const angles = a?.angles || {};
  const stance = a?.stance || {};
  const coach = Array.isArray(a?.coaching) ? a.coaching : [];

  const badgeCell = (k, val) => {
    const as = assess(Number(val), k, activeRanges);
    const badge = as.badge ? `<span class="badge ${as.badge}">${as.badge.toUpperCase()}</span>` : '';
    return `<div style="display:flex;gap:8px;align-items:center">${fmt(val)} ${badge}</div>`;
  };

  const html = `
    ${metric('Club', `<strong>${escapeHtml((activeClub||'7i').toUpperCase())}</strong>`)}
    ${metric('Tempo (ratio)', badgeCell('tempo.ratio', tempo.ratio))}
    ${metric('Backswing (s)', badgeCell('tempo.backswing', tempo.backswing))}
    ${metric('Downswing (s)', badgeCell('tempo.downswing', tempo.downswing))}
    ${metric('Spine tilt @impact (°)', badgeCell('angles.spine_impact_deg', angles.spine_impact_deg))}
    ${metric('Shaft angle @impact (°)', badgeCell('angles.shaft_impact_deg', angles.shaft_impact_deg))}
    ${metric('Stance width @impact', badgeCell('stance.impact_fraction', stance.impact_fraction))}
    ${metric('Keyframes', code(JSON.stringify(a?.keyframes ?? {}, null, 2)))}
    ${coach.length ? metric('Coaching', `<ul>${coach.map(c=>`<li>${escapeHtml(c)}</li>`).join('')}</ul>`) : metric('Coaching','–')}
  `;
  els.results.innerHTML = html;
}

function metric(label, valueHtml){ return `<div class="metric"><span class="label">${escapeHtml(label)}</span><div>${valueHtml}</div></div>`; }
function code(s){ return `<pre class="code">${escapeHtml(s)}</pre>`; }
function round1(n){ return Math.round(n*10)/10; }
function round2(n){ return Math.round(n*100)/100; }
function safeFmt(v){ return (v==null || Number.isNaN(Number(v))) ? '–' : String(Math.round(Number(v)*100)/100); }

// --- PNG report (includes club label) ---
async function renderReportPNG(a, video, rs, club) {
  const W = 1200, H = 1600, pad = 40;
  const canvas = document.createElement('canvas'); canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0b0c10'; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = 'bold 40px Inter, system-ui, sans-serif';
  ctx.fillText('Swingalyze — Coaching Report', pad, pad+20);
  ctx.font = '18px Inter, system-ui, sans-serif';
  ctx.fillText(`${new Date().toLocaleString()} • Club: ${(club||'7i').toUpperCase()}`, pad, pad+50);

  const impactT = pickImpactTime(a);
  const imgRect = { x: pad, y: pad+90, w: W - pad*2, h: 540 };
  const drawn = await drawVideoFrame(ctx, video, impactT, imgRect);
  drawOverlaysOnImpact(ctx, a, drawn);

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
  const coaching = Array.isArray(a?.coaching) ? a.coaching : [];
  if (coaching.length === 0) ctx.fillText('– No tips provided –', rightX, ry);
  else for (const tip of coaching.slice(0, 10)) { ry = drawBullet(ctx, rightX, ry, tip, W - rightX - pad, line); if (ry > H - pad - 60) break; }

  ctx.globalAlpha = 0.8; ctx.font = '16px Inter, system-ui, sans-serif';
  ctx.fillText('Checkpoint: 2025-09-17 · Branch: feat/recover · Exported as PNG (client-side)', pad, H - pad);
  ctx.globalAlpha = 1;

  return await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject('PNG encode failed'), 'image/png', 0.95);
  });
}

function drawKVb(ctx, x, y, key, val, rangeKey, rs){
  const status = assess(Number(val), rangeKey, rs);
  const badge = statusBadgeCanvas(ctx, status.badge);
  ctx.fillStyle = '#9ca3af'; ctx.fillText(key, x, y);
  ctx.fillStyle = '#e5e7eb'; ctx.fillText(safeFmt(val), x + 260, y);
  if (badge) { badge(ctx, x + 260 + 80, y - 18); }
}

function statusBadgeCanvas(ctx, type){
  if (!type) return null;
  const styles = {
    ok:   { bg:'#064e3b', fg:'#a7f3d0', border:'#065f46', text:'OK'   },
    warn: { bg:'#4d3700', fg:'#fde68a', border:'#b45309', text:'WARN' },
    bad:  { bg:'#3f0a0a', fg:'#fecaca', border:'#dc2626', text:'BAD'  }
  }[type];
  return (ctx2, x, y) => {
    ctx2.save();
    ctx2.fillStyle = styles.bg; ctx2.strokeStyle = styles.border; ctx2.lineWidth = 2;
    roundRect(ctx2, x, y, 64, 26, 13); ctx2.fill(); ctx2.stroke();
    ctx2.fillStyle = styles.fg; ctx2.font = 'bold 12px Inter, system-ui, sans-serif';
    ctx2.fillText(styles.text, x + 14, y + 18);
    ctx2.restore();
  };
}
function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function drawBullet(ctx, x, y, text, maxWidth, lineHeight) {
  const words = String(text).split(' '); let line = '';
  ctx.fillStyle = '#e5e7eb';
  for (let n=0; n<words.length; n++) {
    const test = line + words[n] + ' ';
    if (ctx.measureText(test).width > maxWidth && n>0) { ctx.fillText(line, x, y); line = words[n] + ' '; y += lineHeight; }
    else line = test;
  }
  ctx.fillText(line, x, y);
  return y + lineHeight;
}

function pickImpactTime(a) {
  const kf = a?.keyframes;
  if (kf && typeof kf === 'object') {
    if (typeof kf.impact === 'number') return kf.impact;
    if (Array.isArray(kf.frames)) {
      const imp = kf.frames.find(f => /impact/i.test(f?.label || ''));
      if (imp && typeof imp.t === 'number') return imp.t;
      if (typeof kf.frames[0]?.t === 'number') return kf.frames[0].t;
    }
  }
  return Math.max(0, (window?.video?.currentTime ?? 0));
}

async function drawVideoFrame(ctx, video, t, rect) {
  const { x, y, w, h } = rect;
  const current = video.currentTime;
  try { await seekTo(video, t); } catch {}
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const scale = Math.min(w / vw, h / vh);
  const dw = vw * scale, dh = vh * scale;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(x,y,w,h); ctx.drawImage(video, dx, dy, dw, dh); ctx.restore();
  try { await seekTo(video, current); } catch {}
  return { dx, dy, dw, dh };
}

function seekTo(video, t){
  return new Promise((resolve, reject) => {
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
    const onError = () => { video.removeEventListener('error', onError); reject('seek error'); };
    video.addEventListener('seeked', onSeeked, { once:true });
    video.addEventListener('error', onError, { once:true });
    try { video.currentTime = Math.max(0, t); } catch { reject('seek set failed'); }
    setTimeout(() => { video.removeEventListener('seeked', onSeeked); resolve(); }, 1200);
  });
}

/* Visual overlays (spine/shaft/stance) */
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
    ctx.fillText(`stance ${round2(stanceFrac)}`, x + w + 12, y + 6); ctx.restore();
  }
}

function clamp01(v){ return !isFinite(v) ? NaN : Math.max(0, Math.min(1, v)); }
function toNum(v){ const n = Number(v); return Number.isNaN(n) ? NaN : n; }
function round2(n){ return Math.round(n*100)/100; }
