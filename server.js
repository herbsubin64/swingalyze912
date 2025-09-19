/**
 * Swingalyze Coach v2.6.0 (2025-09-19)
 * API-compatible with v2.3/2.4/2.5 (UI-only upgrades).
 * Endpoints:
 *   GET  /api/status
 *   POST /api/analyze?g=golf1
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3001;
const SERVICE = 'swingalyze-api';

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

function makeMockAnalyze(variant='golf1') {
  return {
    ok: true,
    received: { frames: 0, hasVideo: false },
    keyframes: ["address","club-parallel","top","impact","follow-through"],
    tempo: { back: 0.84, down: 0.28, ratio: 3.0, confidence: 0.9 },
    angles: { spineTop_deg: 33.0, spineImpact_deg: 34.2, shaftTop_deg: 44.0, shaftImpact_deg: 41.0 },
    stance: { address_frac: 0.48, impact_frac: 0.50 },
    overlays: [],
    ts: Date.now(),
    variant
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

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method === 'GET' && pathname === '/api/status') {
    return sendJSON(res, 200, { ok: true, ts: Date.now(), service: SERVICE });
  }
  if (req.method === 'POST' && pathname === '/api/analyze') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const variant = (parsed.query && parsed.query.g) ? String(parsed.query.g) : 'golf1';
      return sendJSON(res, 200, makeMockAnalyze(variant));
    });
    return;
  }

  const safe = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(process.cwd(), safe);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'text/plain; charset=utf-8';
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return serveFile(res, filePath, contentType);
  }
  return serveFile(res, path.join(process.cwd(), 'index.html'));
});

server.listen(PORT, () => {
  console.log(`[srv] Listening on ${PORT}`);
  console.log(`[srv] Open: http://localhost:${PORT}`);
});
