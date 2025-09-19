/**
 * Swingalyze Coach v3.1.1
 * Change: on upload, canonicalize video to MP4 (H.264/AAC) using ffprobe/ffmpeg.
 * - If source is H.264: remux (fast, lossless) -> .mp4
 * - Else: transcode to H.264 720p/30fps with AAC -> .mp4
 * Analyzer & PDF endpoints unchanged.
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
} catch (_) {}

const PORT = process.env.PORT || 3001;
const SERVICE = 'swingalyze-api';
const VERSION = '3.1.1';
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

(function cleanOld(){ try{
  const now = Date.now();
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    const p = path.join(UPLOAD_DIR, f);
    const st = fs.statSync(p);
    if (st.isFile() && now - st.mtimeMs > 24*3600*1000) fs.unlinkSync(p);
  }
} catch(_){} })();

const jobs = new Map(); // jobId -> { status, path, created, result? }

function send(res, code, body, headers = {}) { res.writeHead(code, headers); res.end(body); }
function sendJSON(res, code, obj) { send(res, code, JSON.stringify(obj), {'Content-Type':'application/json'}); }
function serveFile(res, filePath, contentType='text/html') {
  fs.readFile(filePath, (err, data) => err ? send(res, 404, 'Not found') : send(res, 200, data, {'Content-Type': contentType}));
}
function uid() { return crypto.randomBytes(8).toString('hex'); }

function run(cmd, args, opts={}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, opts);
    let out = '', err = '';
    if (p.stdout) p.stdout.on('data', d => out += d.toString());
    if (p.stderr) p.stderr.on('data', d => err += d.toString());
    p.on('close', code => code === 0 ? resolve({out, err}) : reject(new Error(err || `${cmd} exit ${code}`)));
  });
}

async function canonicalizeToMp4(srcPath, destPath) {
  // Probe codec
  let codec = '';
  try {
    const probe = await run('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=codec_name','-of','default=nw=1:nk=1', srcPath]);
    codec = (probe.out || '').trim();
  } catch { /* fall back to transcode */ }

  // If already H.264 → remux; else transcode to h264 720p/30
  if (codec === 'h264') {
    await run('ffmpeg', ['-y','-i', srcPath, '-c','copy','-movflags','+faststart', destPath], { stdio:'ignore' });
  } else {
    await run('ffmpeg', ['-y','-i', srcPath,
      '-vf','scale=-2:720,fps=30',
      '-c:v','libx264','-preset','veryfast','-crf','22',
      '-c:a','aac','-b:a','128k',
      '-movflags','+faststart',
      destPath
    ], { stdio:'ignore' });
  }
  return destPath;
}

function runPythonAnalyzer(videoPath, opts={}, timeoutMs=25000) {
  const args = ['analyzer_pose.py', videoPath];
  if (typeof opts.horizon_deg === 'number' && Number.isFinite(opts.horizon_deg)) args.push(`--horizon=${opts.horizon_deg}`);
  return new Promise((resolve, reject) => {
    const child = spawn('python3', args, { cwd: process.cwd(), env: { ...process.env, PYTHONUNBUFFERED:'1' } });
    let out = '', err = '';
    const t = setTimeout(()=>{ try{ child.kill('SIGKILL'); }catch{} reject(new Error('python analyzer timeout')); }, timeoutMs);
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => { clearTimeout(t);
      if (code === 0) { try { resolve(JSON.parse(out)); } catch { reject(new Error('python json parse fail')); } }
      else reject(new Error(err || `python exit ${code}`));
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

// --- HTTP server ---
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  // Health
  if (req.method === 'GET' && pathname === '/api/status') {
    return sendJSON(res, 200, { ok: true, ts: Date.now(), service: SERVICE, version: VERSION });
  }

  // Upload (raw bytes) -> canonical MP4 job
  if (req.method === 'POST' && pathname === '/api/upload') {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (!ct.startsWith('video/') && ct !== 'application/octet-stream') {
      return sendJSON(res, 400, { ok:false, error:'Send raw video bytes (Content-Type: video/*)' });
    }
    const id = uid();
    const tmpPath = path.join(UPLOAD_DIR, `${id}.upload`);
    const ws = fs.createWriteStream(tmpPath);
    let written = 0, tooBig = false;
    req.on('data', chunk => {
      written += chunk.length;
      if (written > MAX_UPLOAD_BYTES) { tooBig = true; ws.destroy(); req.destroy(); }
    });
    req.pipe(ws);
    ws.on('finish', async () => {
      if (tooBig) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return sendJSON(res, 413, { ok:false, error:`File too large (> ${Math.round(MAX_UPLOAD_BYTES/1024/1024)}MB)` });
      }
      try {
        const mp4Path = path.join(UPLOAD_DIR, `${id}.mp4`);
        await canonicalizeToMp4(tmpPath, mp4Path);
        try { fs.unlinkSync(tmpPath); } catch {}
        jobs.set(id, { status:'ready', path: mp4Path, created: Date.now() });
        return sendJSON(res, 200, { ok:true, jobId: id });
      } catch (e) {
        try { fs.unlinkSync(tmpPath); } catch {}
        return sendJSON(res, 500, { ok:false, error: 'transcode_failed' });
      }
    });
    ws.on('error', () => sendJSON(res, 500, { ok:false, error:'upload_fail' }));
    return;
  }

  // Job status
  if (req.method === 'GET' && pathname.startsWith('/api/job/')) {
    const id = pathname.split('/').pop();
    const job = jobs.get(id);
    if (!job) return sendJSON(res, 404, { ok:false, error:'job not found' });
    return sendJSON(res, 200, { ok:true, status: job.status });
  }

  // Analyze (optional horizon_deg)
  if (req.method === 'POST' && pathname === '/api/analyze') {
    let body=''; req.on('data', c => body += c);
    req.on('end', async () => {
      let payload={}; try { payload = body ? JSON.parse(body) : {}; } catch {}
      const jobId = payload.jobId || null;
      const horizon_deg = (typeof payload.horizon_deg === 'number') ? payload.horizon_deg : null;
      const job = jobId ? jobs.get(jobId) : null;
      if (!job || !job.path) return sendJSON(res, 200, mockResult({ hasVideo:false }));

      jobs.get(jobId).status = 'processing';
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
        jobs.get(jobId).status = 'done'; jobs.get(jobId).result = result;
        return sendJSON(res, 200, result);
      } catch (e) {
        jobs.get(jobId).status = 'failed';
        return sendJSON(res, 200, mockResult({ hasVideo:true, jobId }));
      }
    });
    return;
  }

  // Export PDF (unchanged from 3.1.0)
  if (req.method === 'POST' && pathname === '/api/export/pdf') {
    let body=''; req.on('data', c => body += c);
    req.on('end', async () => {
      let payload={}; try { payload = body ? JSON.parse(body) : {}; } catch {}
      try {
        const pdf = await (async function buildPdf() {
          return new Promise((resolve) => {
            const doc = new PDFDocument({ size: 'LETTER', margin: 36 });
            const chunks = []; doc.on('data', c => chunks.push(c)); doc.on('end', ()=>resolve(Buffer.concat(chunks)));
            doc.fontSize(16).text(payload?.meta?.title || 'Swingalyze Coach Report');
            doc.moveDown(0.25); doc.fontSize(10).fillColor('#666').text(`Swingalyze Coach v${VERSION}  •  ${new Date().toLocaleString()}`);
            if (payload?.meta?.notes) { doc.moveDown(0.5).fillColor('#111').fontSize(11).text(payload.meta.notes); }
            doc.moveDown(0.5);
            const r=payload.report||{}; const tempo=r.tempo||{}; const pose=r.pose||{};
            doc.fillColor('#111').fontSize(12).text('Metrics', { underline:true }).moveDown(0.25).fontSize(10);
            [['Backswing (s)',tempo.back],['Downswing (s)',tempo.down],['Ratio',tempo.ratio],['Tempo confidence',tempo.confidence],
             ['Spine vs Vertical (°)',pose?.angles?.spineToVertical_deg],['Lead-arm vs Ground (°)',pose?.angles?.leadArmToGround_deg],['Pose confidence',pose.confidence]
            ].forEach(([k,v])=>doc.text(`${k}: ${v ?? '—'}`));
            doc.addPage().fontSize(12).text('Coaching Notes',{underline:true}).moveDown(0.25).fontSize(10);
            const tips=[]; const rr=Number(tempo.ratio||0), tc=Number(tempo.confidence||0), pc=Number(pose.confidence||0);
            if (tc<0.4) tips.push('Tempo provisional — camera/light may reduce accuracy.');
            if (rr===0) tips.push('Record a swing or step frames to estimate tempo.');
            else if (rr<2.8) tips.push("Tempo fast (<3:1). Count 'one-two' up, 'one' down.");
            else if (rr>3.2) tips.push('Tempo slow (>3:1). Start the downswing sooner.');
            else tips.push('Tempo ~3:1 — money. Keep the same cadence.');
            const s=pose?.angles?.spineToVertical_deg, a=pose?.angles?.leadArmToGround_deg;
            if (pc>=0.5){ if(typeof s==='number'){ if(s<2) tips.push('Add a touch more spine tilt at impact.'); else if(s<=6) tips.push('Spine tilt looks solid.'); else tips.push('A lot of tilt — keep trail side taller.'); }
              if(typeof a==='number'){ if(a<60) tips.push('Lead arm shallow / handle high — feel hinge then rotate.'); else if(a<=100) tips.push('Lead-arm angle in a playable window.'); else tips.push('Lead arm steep / handle low — soften grip and rotate through.'); } }
            else tips.push('Pose low confidence — retake with better light / full body.');
            tips.forEach(t=>doc.text(`• ${t}`));
            doc.end();
          });
        })();

        if (payload?.s3 === true && haveS3 && process.env.S3_BUCKET) {
          const s3 = new S3Client({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION });
          const key = `reports/${new Date().toISOString().slice(0,10)}/${uid()}.pdf`;
          await s3.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: pdf, ContentType:'application/pdf' }));
          const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), { expiresIn: 7*24*3600 });
          return sendJSON(res, 200, { ok:true, uploaded:true, s3key:key, url });
        }

        res.writeHead(200,{ 'Content-Type':'application/pdf', 'Content-Disposition':'attachment; filename="swingalyze_report.pdf"', 'Content-Length': pdf.length });
        return res.end(pdf);
      } catch (e) { return sendJSON(res, 500, { ok:false, error:e.message }); }
    });
    return;
  }

  // Static
  const safe = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(process.cwd(), safe);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = { ".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".png":"image/png",".ico":"image/x-icon",".pdf":"application/pdf" }[ext] || 'text/plain; charset=utf-8';
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return serveFile(res, filePath, contentType);
  return serveFile(res, path.join(process.cwd(), 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[srv] Listening on ${PORT}`);
  console.log(`[srv] Open: http://localhost:${PORT}`);
});
