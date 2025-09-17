// Swingalyze — API-first coaching UI with PNG export + overlays (Checkpoint 2025-09-17)

const els = {
  file: document.getElementById('fileInput'),
  analyze: document.getElementById('analyzeBtn'),
  exportBtn: document.getElementById('exportBtn'),
  downloadLink: document.getElementById('downloadLink'),
  statusDot: document.getElementById('statusDot'),
  video: document.getElementById('video'),
  results: document.getElementById('results'),
};

let analysis = null;
let videoBlobUrl = null;

async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      els.statusDot.classList.remove('offline');
      els.statusDot.classList.add('online');
    } else {
      throw new Error('bad status');
    }
  } catch {
    els.statusDot.classList.remove('online');
    els.statusDot.classList.add('offline');
  }
}

function setAnalyzeEnabled(on) { els.analyze.disabled = !on; }
function setExportEnabled(on) { els.exportBtn.disabled = !on; els.downloadLink.classList.toggle('hidden', true); }

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
    analysis = await res.json();
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

function showError(msg) {
  els.results.innerHTML = `<div class="metric"><span class="label">Error</span><div class="code">${escapeHtml(msg)}</div></div>`;
}

function renderResults(a) {
  const tempo = a?.tempo || {};
  const angles = a?.angles || {};
  const stance = a?.stance || {};
  const coach = Array.isArray(a?.coaching) ? a.coaching : [];

  const html = `
    ${metric('Tempo (ratio)', fmt(tempo.ratio))}
    ${metric('Backswing (s)', fmt(tempo.backswing))}
    ${metric('Downswing (s)', fmt(tempo.downswing))}
    ${metric('Spine tilt @impact (°)', fmt(angles.spine_impact_deg ?? angles.spineImpact))}
    ${metric('Shaft angle @impact (°)', fmt(angles.shaft_impact_deg ?? angles.shaftImpact))}
    ${metric('Stance width @impact', fmt(stance.impact ?? stance.impact_fraction))}
    ${metric('Keyframes', code(JSON.stringify(a?.keyframes ?? {}, null, 2)))}
    ${coach.length ? metric('Coaching', `<ul>${coach.map(c=>`<li>${escapeHtml(c)}</li>`).join('')}</ul>`) : ''}
  `;
  els.results.innerHTML = html;
}

function metric(label, valueHtml) {
  return `<div class="metric"><span class="label">${escapeHtml(label)}</span><div>${valueHtml}</div></div>`;
}
function code(s) { return `<pre class="code">${escapeHtml(s)}</pre>`; }
function fmt(v) { return v==null ? '–' : String(Math.round(v*100)/100); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// ---- Export PNG Report with Visual Overlays ----

els.exportBtn.addEventListener('click', async () => {
  if (!analysis || !els.video.src) return;
  els.exportBtn.textContent = 'Rendering…';
  els.exportBtn.disabled = true;
  try {
    const pngBlob = await renderReportPNG(analysis, els.video);
    const url = URL.createObjectURL(pngBlob);
    els.downloadLink.href = url;
    els.downloadLink.classList.remove('hidden');
    els.downloadLink.click();
  } catch (e) {
    console.error(e);
    showError(e);
  } finally {
    els.exportBtn.textContent = 'Export PNG Report';
    els.exportBtn.disabled = false;
  }
});

async function renderReportPNG(a, video) {
  // Canvas size optimized for phones yet sharp enough for desktop printing
  const W = 1200, H = 1600;
  const pad = 40;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0b0c10'; ctx.fillRect(0,0,W,H);

  // Header
  ctx.fillStyle = '#e5e7eb';
  ctx.font = 'bold 40px Inter, system-ui, sans-serif';
  ctx.fillText('Swingalyze — Coaching Report', pad, pad+20);
  ctx.font = '18px Inter, system-ui, sans-serif';
  const now = new Date().toLocaleString();
  ctx.fillText(now, pad, pad+50);

  // Draw representative frame (impact if available)
  const impactT = pickImpactTime(a);
  const thumbRect = { x: pad, y: pad+90, w: W - pad*2, h: 540 };
  const drawnRect = await drawVideoFrame(ctx, video, impactT, thumbRect); // returns {dx,dy,dw,dh}

  // Overlays (angles + stance) directly on the video sub-rect
  drawOverlaysOnImpact(ctx, a, drawnRect);

  // Metrics block (left)
  const leftX = pad;
  let y = thumbRect.y + thumbRect.h + 40;
  const line = 30;

  const tempo = a?.tempo || {};
  const angles = a?.angles || {};
  const stance = a?.stance || {};

  ctx.font = 'bold 28px Inter, system-ui, sans-serif';
  ctx.fillText('Key Metrics', leftX, y); y += line;
  ctx.font = '20px Inter, system-ui, sans-serif';
  drawKV(ctx, leftX, y, 'Tempo (ratio)', safeFmt(tempo.ratio)); y += line;
  drawKV(ctx, leftX, y, 'Backswing (s)', safeFmt(tempo.backswing)); y += line;
  drawKV(ctx, leftX, y, 'Downswing (s)', safeFmt(tempo.downswing)); y += line;
  drawKV(ctx, leftX, y, 'Spine tilt @impact (°)', safeFmt(angles.spine_impact_deg ?? angles.spineImpact)); y += line;
  drawKV(ctx, leftX, y, 'Shaft angle @impact (°)', safeFmt(angles.shaft_impact_deg ?? angles.shaftImpact)); y += line;
  drawKV(ctx, leftX, y, 'Stance width @impact', safeFmt(stance.impact ?? stance.impact_fraction)); y += line;

  // Coaching block (right)
  const rightX = Math.floor(W*0.52);
  let ry = thumbRect.y + thumbRect.h + 40;
  ctx.font = 'bold 28px Inter, system-ui, sans-serif';
  ctx.fillText('Coaching Tips', rightX, ry); ry += line;
  ctx.font = '20px Inter, system-ui, sans-serif';
  const coaching = Array.isArray(a?.coaching) ? a.coaching : [];
  if (coaching.length === 0) {
    ctx.fillText('– No tips provided –', rightX, ry);
  } else {
    for (const tip of coaching.slice(0, 10)) {
      ry = drawBullet(ctx, rightX, ry, tip, W - rightX - pad, line);
      if (ry > H - pad - 60) break;
    }
  }

  // Footer
  ctx.globalAlpha = 0.8;
  ctx.font = '16px Inter, system-ui, sans-serif';
  ctx.fillText('Checkpoint: 2025-09-17 · Branch: feat/recover · Exported as PNG (client-side)', pad, H - pad);
  ctx.globalAlpha = 1;

  return await new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject('PNG encode failed'), 'image/png', 0.95);
  });
}

function safeFmt(v) { return (v==null || Number.isNaN(v)) ? '–' : String(Math.round(Number(v)*100)/100); }

function drawKV(ctx, x, y, k, v) {
  ctx.fillStyle = '#9ca3af'; ctx.fillText(k, x, y);
  ctx.fillStyle = '#e5e7eb'; ctx.fillText(String(v), x + 260, y);
}

function drawBullet(ctx, x, y, text, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  let line = '';
  ctx.fillStyle = '#e5e7eb';
  for (let n=0; n<words.length; n++) {
    const test = line + words[n] + ' ';
    const metrics = ctx.measureText(test);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + ' ';
      y += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
  return y + lineHeight;
}

function pickImpactTime(a) {
  const kf = a?.keyframes ?? a?.__KEYFRAMES__;
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
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const scale = Math.min(w / vw, h / vh);
  const dw = vw * scale, dh = vh * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.save();
  ctx.fillStyle = '#000'; ctx.fillRect(x,y,w,h);
  ctx.drawImage(video, dx, dy, dw, dh);
  ctx.restore();
  // Restore original time
  try { await seekTo(video, current); } catch {}
  // Return the drawn sub-rect so overlays can align to the image
  return { dx, dy, dw, dh };
}

function seekTo(video, t) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
    const onError = () => { video.removeEventListener('error', onError); reject('seek error'); };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    try { video.currentTime = Math.max(0, t); } catch { reject('seek set failed'); }
    // Fallback timeout in case seeked event is flaky
    setTimeout(() => { video.removeEventListener('seeked', onSeeked); resolve(); }, 1200);
  });
}

/**
 * Draw simple geometric overlays using analyzer outputs at impact:
 * - Spine tilt (green) as a line through torso center
 * - Shaft angle (blue) as a line through hand zone
 * - Stance width (yellow) as a horizontal bar across the feet region
 *
 * Notes:
 * - We don't have per-pixel landmarks here; we render schematic lines using angles/ratios.
 * - All drawing stays inside the video sub-rect returned by drawVideoFrame().
 */
function drawOverlaysOnImpact(ctx, a, rect) {
  const angles = a?.angles || a?.__ANGLES__ || {};
  const stance = a?.stance || a?.__STANCE__ || {};

  const spineDeg = toNum(angles.spine_impact_deg ?? angles.spineImpact);
  const shaftDeg = toNum(angles.shaft_impact_deg ?? angles.shaftImpact);
  const stanceFrac = clamp01(toNum(stance.impact_fraction ?? stance.impact));

  const { dx, dy, dw, dh } = rect;

  // Helpers for drawing lines by angle
  const toRad = (deg) => (deg * Math.PI) / 180;

  // Spine tilt — anchor around mid-torso (center of frame, 45% height)
  if (isFinite(spineDeg)) {
    const cx = dx + dw * 0.5;
    const cy = dy + dh * 0.45;
    const len = Math.min(dw, dh) * 0.35;
    const rad = toRad(-spineDeg); // tilt forward: positive -> lean towards ball (screen right if typical RH)
    const x1 = cx - Math.cos(rad) * len;
    const y1 = cy - Math.sin(rad) * len;
    const x2 = cx + Math.cos(rad) * len;
    const y2 = cy + Math.sin(rad) * len;
    ctx.save();
    ctx.strokeStyle = '#10b981'; // green
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    // Label
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 22px Inter, system-ui, sans-serif';
    ctx.fillText(`${round1(spineDeg)}° spine`, cx + 10, cy - 10);
    ctx.restore();
  }

  // Shaft angle — anchor near hands (center-bottom third)
  if (isFinite(shaftDeg)) {
    const hx = dx + dw * 0.5;
    const hy = dy + dh * 0.7;
    const len = Math.min(dw, dh) * 0.4;
    const rad = toRad(-shaftDeg);
    const x1 = hx;
    const y1 = hy;
    const x2 = hx + Math.cos(rad) * len;
    const y2 = hy + Math.sin(rad) * len;
    ctx.save();
    ctx.strokeStyle = '#3b82f6'; // blue
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    // Label
    ctx.fillStyle = '#3b82f6';
    ctx.font = 'bold 22px Inter, system-ui, sans-serif';
    ctx.fillText(`${round1(shaftDeg)}° shaft`, x2 + 10, y2);
    ctx.restore();
  }

  // Stance width — horizontal bar across foot region using impact fraction
  if (isFinite(stanceFrac)) {
    const y = dy + dh * 0.92;
    const maxW = dw * 0.8;
    const w = maxW * clamp01(stanceFrac); // fraction of max allowable
    const x = dx + (dw - w) / 2;
    ctx.save();
    ctx.strokeStyle = '#f59e0b'; // yellow
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
    // End caps
    ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.moveTo(x + w, y - 10); ctx.lineTo(x + w, y + 10); ctx.stroke();
    // Label
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 20px Inter, system-ui, sans-serif';
    ctx.fillText(`stance ${round2(stanceFrac)}`, x + w + 12, y + 6);
    ctx.restore();
  }
}

function clamp01(v) { return !isFinite(v) ? NaN : Math.max(0, Math.min(1, v)); }
function toNum(v){ const n = Number(v); return Number.isNaN(n) ? NaN : n; }
function round1(n){ return Math.round(n*10)/10; }
function round2(n){ return Math.round(n*100)/100; }

// Init
checkStatus();
