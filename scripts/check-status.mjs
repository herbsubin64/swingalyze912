/**
 * Optional: verify /api/status is reachable and sane.
 * Env: ANALYZE_URL
 * Skips if env not set.
 */
import http from 'node:http';
import { request as httpsRequest } from 'node:https';

const BASE = process.env.ANALYZE_URL;
if (!BASE) {
  console.log('SKIP check-status: ANALYZE_URL not set');
  process.exit(0);
}

const url = new URL(`${BASE.replace(/\/+$/,'')}/api/status`);
const useHttps = url.protocol === 'https:';
const mod = useHttps ? httpsRequest : http.request;

const req = mod({
  hostname: url.hostname,
  port: url.port || (useHttps ? 443 : 80),
  path: url.pathname + url.search,
  method: 'GET',
  headers: { 'Accept': 'application/json' }
}, res => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const status = res.statusCode || 0;
    const text = Buffer.concat(chunks).toString('utf8');
    if (status !== 200) {
      console.error(`❌ /api/status HTTP ${status}: ${text.slice(0,200)}`);
      process.exit(1);
    }
    let j;
    try { j = JSON.parse(text); } catch {
      console.error('❌ /api/status is not JSON');
      process.exit(1);
    }
    const okShape = (typeof j.ok === 'boolean') || typeof j.status === 'string' || typeof j.version === 'string';
    if (!okShape) {
      console.error('❌ /api/status missing expected fields (ok/status/version)');
      process.exit(1);
    }
    console.log('✅ /api/status OK:', JSON.stringify(j));
  });
});
req.on('error', e => { console.error('❌ /api/status error:', e.message); process.exit(1); });
req.end();
