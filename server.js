/**
 * Swingalyze Coach v2.7.0 (2025-09-19)
 * Analyzer Bridge: upload -> jobId -> analyze(jobId). Flat files, no deps.
 * Endpoints:
 *  GET  /api/status
 *  POST /api/upload           (body = raw video bytes; header video/* or application/octet-stream) -> { ok, jobId, path }
 *  POST /api/analyze          (body = { jobId? }) -> analyzerAdapter() mock response
 *  GET  /api/job/:id/status   -> { ok, status }
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 3001;
const SERVICE = 'swingalyze-api';
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const jobs = new Map(); // id -> { status: 'queued'|'processing'|'done'|'failed', path, created, result? }

function sendJSON(res, code, obj) {
  res.writeHead(code, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(obj));
}
function serveFile(res, filePath, contentType='text/html') {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); }
    else { res.writeHead(200, {'Content-Type': contentType}); res.end(data); }
  });
}
function uid() { return crypto.randomBytes(8).toString('hex'); }

// Deterministic mock analyzer — swap this later for real AI without changing UI.
async function analyzerAdapter({ jobId, videoPath }) {
  // Simulate some work using job map
  await new Promise(r => setTimeout(r, 250));
  return {
    ok: true,
    received: { jobId: jobId || null, hasVideo: !!videoPath },
    keyframes: ["address","club-parallel","top","impact","follow-through"],
    tempo: { back: 0.84, down: 0.28, ratio: 3.0, confidence: 0.9 },
    angles: { spineTop_deg: 33.0, spineImpact_deg: 34.2, shaftTop_deg: 44.0, shaftImpact_deg: 41.0 },
    stance: { address_frac: 0.48, impact_frac: 0.50 },
    overlays: [],
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
};

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Status
  if (req.method === 'GET' && pathname === '/api/status') {
    return sendJSON(res, 200, { ok: true, ts: Date.now(), service: SERVICE });
  }

  // Upload: raw body streamed to disk
  if (req.method === 'POST' && pathname === '/api/upload') {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (!ct.startsWith('video/') && ct !== 'application/octet-stream') {
      return sendJSON(res, 400, { ok:false, error:'Send raw video bytes; Content-Type video/* or application/octet-stream' });
    }
    const id = uid();
    const filePath = path.join(UPLOAD_DIR, `${id}.mp4`);
    const ws = fs.createWriteStream(filePath);
    req.pipe(ws);
    ws.on('finish', () => {
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

  // Analyze: accepts { jobId? }
  if (req.method === 'POST' && pathname === '/api/analyze') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      let payload = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { payload = {}; }
      const jobId = payload.jobId || null;
      const job = jobId ? jobs.get(jobId) : null;

      if (job && job.status === 'processing') {
        return sendJSON(res, 200, { ok:false, error:'job busy' });
      }

      if (job) job.status = 'processing';
      try {
        const result = await analyzerAdapter({ jobId, videoPath: job?.path });
        if (job) { job.status = 'done'; job.result = result; }
        return sendJSON(res, 200, result);
      } catch (e) {
        if (job) job.status = 'failed';
        return sendJSON(res, 500, { ok:false, error: e.message });
      }
    });
    return;
  }

  // Static files
  const safe = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(process.cwd(), safe);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'text/plain; charset=utf-8';
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return serveFile(res, filePath, contentType);
  }
  return serveFile(res, path.join(process.cwd(), 'index.html'));
});

// Bind 0.0.0.0 for Codespaces
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[srv] Listening on ${PORT}`);
  console.log(`[srv] Open: http://localhost:${PORT}`);
});
