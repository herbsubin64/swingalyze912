/**
 * Static UI signatures: ensure critical client functions & handlers exist.
 * Fails if signatures are missing (prevents accidental removal).
 */
import fs from 'node:fs';

const P = 'public/app.js';
let src = '';
try { src = fs.readFileSync(P, 'utf8'); }
catch (e) { console.error(`❌ Cannot read ${P}:`, e.message); process.exit(1); }

const checks = [
  [/async\s+function\s+renderReportPNG\s*\(/, 'renderReportPNG'],
  [/function\s+drawOverlaysOnImpact\s*\(/, 'drawOverlaysOnImpact'],
  [/els\.exportPngBtn\?\.\s*addEventListener\(\s*'click'/, 'exportPngBtn click'],
  [/els\.sharePngBtn\?\.\s*addEventListener\(\s*'click'/, 'sharePngBtn click'],
  [/els\.exportCsvBtn\?\.\s*addEventListener\(\s*'click'/, 'exportCsvBtn click'],
  [/function\s+toTips\s*\(/, 'toTips'],
  [/function\s+dedupe\s*\(/, 'dedupe']
];

const missing = checks.filter(([re]) => !re.test(src)).map(([,name]) => name);
if (missing.length) {
  console.error('❌ UI signatures missing:', missing.join(', '));
  process.exit(1);
}
console.log('✅ UI signatures present:', checks.map(([,n]) => n).join(', '));
