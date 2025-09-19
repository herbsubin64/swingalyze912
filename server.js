/**
 * Swingalyze Coach v3.1.0 (2025-09-19)
 * New: PDF export (+ optional S3 share). Same analyzer endpoints.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { spawn } = require('child_process');
const PDFDocument = require('pdfkit');

let haveS3 = false;
let S3Client, PutObjectCommand, GetObjectCommand, getSignedUrl;
try {
  ({ S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3'));
  ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
  haveS3 = true;
} catch (_) { /* optional */ }

const PORT = process.env.PORT || 3001;
const SERVICE = 'swingalyze-api';
const VERSION = '3.1.0';
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// Auto-clean uploads older than 24h
(function cleanOld(){ try{
  const now = Date.now();
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    const p = path.join(UPLOAD_DIR, f);
    const st = fs.statSync(p);
    if (st.isFile() && now - st.mtimeMs > 24*3600*1000) fs.unlinkSync(p);
  }
} catch(_){} })();

const jobs = new Map(); // jobId -> { status, path, created, result? }

function send(res, code, body, headers = {}) {
  res.writeHead(code, headers); res.end(body);
}
function sendJSON(res, code, obj) {
  send(res, code, JSON.stringify(obj), {'Content-Type':'application/json'});
}
function serveFile(res, filePath, contentType='text/html') {
  fs.readFile(filePath, (err, data) => {
    if (err) send(res, 404, 'Not found'); else send(res, 200, data, {'Content-Type': contentType});
  });
}
function uid() { return crypto.randomBytes(8).toString('hex'); }

function runPythonAnalyzer(videoPath, opts={}, timeoutMs=25000) {
  const args = ['analyzer_pose.py', videoPath];
  if (typeof opts.horizon_deg === 'number' && Number.isFinite(opts.horizon_deg)) args.push(`--horizon=${opts.horizon_deg}`);
  return new Promise((resolve, reject) => {
    const child = spawn('python3', args, { cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED:'1' } });
    let out = '', err = '';
    const t = setTimeout(()=>{ try{ child.kill('SIGKILL'); }catch{} reject(new Error('python analyzer timeout')); }, timeoutMs);
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => {
      clearTimeout(t);
      if (code === 0) { try { resolve(JSON.parse(out)); } catch { reject(new Error('python json parse fail')); } }
      else { reject(new Error(err || `python exit ${code}`)); }
    });
  });
}

function mockResult(extra = {}) {
  return {
    ok: true,
    received: { hasVideo: !!extra.hasVideo, jobId: extra.jobId || null },
    keyframes: ["address","club-parallel","top","impact","follow-through"],
    tempo: { back: 0.84, down: 0.28, ratio: 3.0, confidence: 0.30 },
    pose:  { angles: { spineToVertical_deg: null, leadArmToGround_deg: null }, confidence: 0.0 },
    ts: Date.now(),
    variant: 'golf1'
  };
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf"
};

// Simple S3 helper
async function putToS3(buffer, key, contentType='application/pdf') {
  if (!haveS3) throw new Error('s3 libs not installed');
  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!bucket || !region) throw new Error('S3_BUCKET and AWS_REGION required');
  const s3 = new S3Client({ region });
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType }));
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 7*24*3600 });
  return { key, url };
}

// Build the PDF (one page, thumbnails + metrics)
async function buildPdf({ title, notes, report, slots, build }) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 36 });
    const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', ()=>resolve(Buffer.concat(chunks)));

    doc.fontSize(16).text(title || 'Swingalyze Coach Report', { continued:false });
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor('#666').text(`${build || `Swingalyze Coach v${VERSION}` }  •  ${new Date().toLocaleString()}`);
    doc.moveDown(0.5);
    if (notes) { doc.fillColor('#111').fontSize(11).text(notes); doc.moveDown(0.5); }

    // Metrics
    const tempo = report?.tempo || {};
    const pose  = report?.pose  || {};
    doc.fillColor('#111').fontSize(12).text('Metrics', { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(10);
    const trows = [
      ['Backswing (s)', tempo.back ?? '—'],
      ['Downswing (s)', tempo.down ?? '—'],
      ['Ratio', tempo.ratio ?? '—'],
      ['Tempo confidence', tempo.confidence ?? '—'],
      ['Spine vs Vertical (impact, °)', pose?.angles?.spineToVertical_deg ?? '—'],
      ['Lead-arm vs Ground (°, impact)', pose?.angles?.leadArmToGround_deg ?? '—'],
      ['Pose confidence', pose.confidence ?? '—'],
    ];
    trows.forEach(([k,v]) => doc.text(`${k}: ${typeof v === 'number' ? v : v}`));
    doc.moveDown(0.5);

    // Thumbnails row
    doc.fontSize(12).text('Keyframes', { underline: true });
    doc.moveDown(0.25);
    const order = ['address','club-parallel','top','impact','follow-through'];
    const w = 140, h = 80, gap = 12;
    let x = doc.x, y = doc.y;
    order.forEach((slot, i) => {
      const s = slots?.[slot] || {};
      const dataUrl = s.thumbnail_png;
      if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        const buf = Buffer.from(dataUrl.split(',')[1] || '', 'base64');
        doc.image(buf, x + i*(w+gap), y, { width: w, height: h });
        doc.rect(x + i*(w+gap), y, w, h).strokeColor('#ddd').stroke();
        doc.fontSize(9).fillColor('#111').text(slot, x + i*(w+gap), y + h + 2, { width: w, align: 'center' });
      } else {
        doc.rect(x + i*(w+gap), y, w, h).strokeColor('#ddd').stroke();
        doc.fontSize(9).fillColor('#999').text(slot, x + i*(w+gap), y + h/2 - 6, { width: w, align: 'center' });
      }
    });
    doc.moveDown(8); // spacer

    // Coaching tips (basic)
    doc.addPage();
    doc.fontSize(12).fillColor('#111').text('Coaching Notes', { underline: true });
    doc.moveDown(0.25).fontSize(10);
    const tips = [];
    const rr = Number(tempo.ratio || 0);
    const tc = Number(tempo.confidence || 0);
    if (tc < 0.4) tips.push('Tempo provisional — camera/light may reduce accuracy.');
    if (rr === 0) tips.push('Record a swing or step frames to estimate tempo.');
    else if (rr < 2.8) tips.push("Tempo fast (<3:1). Count 'one-two' up, 'one' down.");
    else if (rr > 3.2) tips.push('Tempo slow (>3:1). Start the downswing sooner.');
    else tips.push('Tempo ~3:1 — money. Keep the same cadence.');
    const s = report?.pose?.angles?.spineToVertical_deg;
    const a = report?.pose?.angles?.leadArmToGround_deg;
    const pc = Number(report?.pose?.confidence || 0);
    if (pc >= 0.5) {
      if (typeof s === 'number') {
        if (s < 2) tips.push('Add a touch more spine tilt at impact.');
        else if (s <= 6) tips.push('Spine tilt looks solid into impact.');
        else tips.push('A lot of tilt — keep trail side taller to avoid chunks.');
      }
      if (typeof a === 'number') {
        if (a < 60) tips.push('Lead arm shallow / handle high — feel hinge then rotate.');
        else if (a <= 100) tips.push('Lead-arm angle in a playable window.');
        else tips.push('Lead arm steep / handle low — soften grip and rotate through.');
      }
    } else tips.push('Pose low confidence — retake with better light / full body.');
    tips.forEach(t => doc.text(`• ${t}`));

    doc.end();
  });
}

// HTTP server
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  // Health
  if (req.method === 'GET' && pathname === '/api/status') {
    return sendJSON(res, 200, { ok: true, ts: Date.now(), service: SERVICE, version: VERSION, s3: !!(haveS3 && process.env.S3_BUCKET) });
  }

  // Upload (raw bytes)
  if (req.method === 'POST' && pathname === '/api/upload') {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (!ct.startsWith('video/') && ct !== 'application/octet-stream') {
      return sendJSON(res, 400, { ok:false, error:'Send raw video bytes (Content-Type: video/*)' });
    }
    const id = uid();
    const filePath = path.join(UPLOAD_DIR, `${id}.mp4`);
    const ws = fs.createWriteStream(filePath);
    let written = 0;
    req.on('data', chunk => {
      written += chunk.length;
      if (written > MAX_UPLOAD_BYTES) { ws.destroy(); fs.unlink(filePath, ()=>{}); req.destroy(); }
    });
    req.pipe(ws);
    ws.on('finish', () => {
      if (written > MAX_UPLOAD_BYTES) return sendJSON(res, 413, { ok:false, error:`File too large (> ${Math.round(MAX_UPLOAD_BYTES/1024/1024)}MB)` });
      jobs.set(id, { status:'queued', path:filePath, created: Date.now() });
      return sendJSON(res, 200, { ok:true, jobId: id, path: filePath });
    });
    ws.on('error', (e) => sendJSON(res, 500, { ok:false, error: e.message }));
    return;
  }

  // Job status
  if (req.method === 'GET' && pathname.startsWith('/api/job/')) {
    const id = pathname.split('/').pop();
    const job = jobs.get(id);
    if (!job) return sendJSON(res, 404, { ok:false, error:'job not found' });
    return sendJSON(res, 200, { ok:true, status: job.status });
  }

  // Analyze (supports optional horizon_deg)
  if (req.method === 'POST' && pathname === '/api/analyze') {
    let body=''; req.on('data', c => body += c);
    req.on('end', async () => {
      let payload={}; try { payload = body ? JSON.parse(body) : {}; } catch {}
      const jobId = payload.jobId || null;
      const horizon_deg = (typeof payload.horizon_deg === 'number') ? payload.horizon_deg : null;
      const job = jobId ? jobs.get(jobId) : null;
      if (!job || !job.path) return sendJSON(res, 200, mockResult({ hasVideo:false }));

      job.status = 'processing';
      try {
        const py = await runPythonAnalyzer(job.path, { horizon_deg });
        const result = {
          ok: true,
          received: { jobId, hasVideo: true },
          keyframes: ["address","club-parallel","top","impact","follow-through"],
          tempo: py.tempo || mockResult({hasVideo:true}).tempo,
          pose:  py.pose  || mockResult({hasVideo:true}).pose,
          ts: Date.now(),
          variant: 'golf1'
        };
        job.status = 'done'; job.result = result;
        return sendJSON(res, 200, result);
      } catch (e) {
        job.status = 'failed';
        return sendJSON(res, 200, mockResult({ hasVideo:true, jobId }));
      }
    });
    return;
  }

  // Export PDF (optional S3 upload)
  if (req.method === 'POST' && pathname === '/api/export/pdf') {
    let body=''; req.on('data', c => body += c);
    req.on('end', async () => {
      let payload={}; try { payload = body ? JSON.parse(body) : {}; } catch {}
      try {
        const pdf = await buildPdf({
          title: payload?.meta?.title || 'Swingalyze Coach Report',
          notes: payload?.meta?.notes || '',
          build: payload?.meta?.build || `Swingalyze Coach v${VERSION}`,
          report: payload.report || {},
          slots: payload.slots || {}
        });

        // If s3=true and env is present, upload & return URL
        if (payload?.s3 === true && haveS3 && process.env.S3_BUCKET) {
          const key = `reports/${new Date().toISOString().slice(0,10)}/${uid()}.pdf`;
          const { url: signedUrl, key: s3key } = await putToS3(pdf, key, 'application/pdf');
          return sendJSON(res, 200, { ok:true, uploaded:true, s3key, url: signedUrl });
        }

        // else, return the PDF directly
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="swingalyze_report.pdf"',
          'Content-Length': pdf.length
        });
        return res.end(pdf);
      } catch (e) {
        return sendJSON(res, 500, { ok:false, error: e.message });
      }
    });
    return;
  }

  // Static
  const safe = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(process.cwd(), safe);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'text/plain; charset=utf-8';
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return serveFile(res, filePath, contentType);
  return serveFile(res, path.join(process.cwd(), 'index.html'));
});

// Bind 0.0.0.0 for Codespaces/containers
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[srv] Listening on ${PORT}`);
  console.log(`[srv] Open: http://localhost:${PORT}`);
});
