/**
 * Minimal dev analyzer for local/testing use.
 * - POST /api/analyze   → returns a golden JSON (choose via ?g=edge-dark|edge-slowmo|edge-partial|edge-vertical|golf1)
 * - GET  /api/status    → { ok: true, ... }
 * CORS enabled so it works with the static UI on another port.
 */
import http from 'node:http';
import fs from 'node:fs';
import url from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.PORT || 3001);
const HOST = '0.0.0.0';

const GOLDEN_MAP = {
  'golf1':        'fixtures/golf1.golden.json',
  'edge-dark':    'fixtures/edge-dark.golden.json',
  'edge-slowmo':  'fixtures/edge-slowmo.golden.json',
  'edge-partial': 'fixtures/edge-partial.golden.json',
  'edge-vertical':'fixtures/edge-vertical.golden.json'
};

function send(res, status, body, headers={}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...headers
  });
  res.end(body);
}
function sendJSON(res, status, obj, headers={}) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
}

function readGolden(name) {
  const p = GOLDEN_MAP[name] || GOLDEN_MAP['golf1'];
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  if (req.method === 'OPTIONS') return send(res, 204, '');

  if (u.pathname === '/api/status' && req.method === 'GET') {
    return sendJSON(res, 200, { ok: true, status: 'ok', version: 'dev-analyzer', time: new Date().toISOString() });
  }

  if (u.pathname === '/api/analyze' && req.method === 'POST') {
    // Drain the body (we don't parse it; this is a stub).
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const golden = readGolden(String(u.query.g || 'golf1'));
        return sendJSON(res, 200, golden);
      } catch (e) {
        return sendJSON(res, 500, { error: 'Failed to load golden', message: e.message });
      }
    });
    return;
  }

  // Simple index/help
  if (u.pathname === '/' && req.method === 'GET') {
    const help = [
      'Dev Analyzer',
      'GET  /api/status',
      'POST /api/analyze?g=golf1|edge-dark|edge-slowmo|edge-partial|edge-vertical'
    ].join('\n');
    return send(res, 200, help, { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`▶ Dev analyzer listening on http://${HOST}:${PORT}`);
});
