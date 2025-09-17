// Static smoke test (no deps, no server). Fails early on common UI regressions.
// Checks:
//  - Required files exist
//  - index.html links to styles/app (cache-busting allowed)
//  - Critical DOM ids present in index.html
//  - public/app.js parses (syntax-only; not executed)
//  - Golden exists and passes contract script (re-uses your script)

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const mustExist = [
  'public/index.html',
  'public/styles.css',
  'public/app.js',
  'public/ranges.json',
  'scripts/verify-analyze-shape.mjs',
  'fixtures/golf1.golden.json'
];

const fail = (msg) => { console.error('❌ Smoke:', msg); process.exit(1); };
const ok = (msg) => console.log('✅', msg);

for (const p of mustExist) {
  if (!fs.existsSync(p)) fail(`Missing file: ${p}`);
}
ok('All required files exist');

const html = fs.readFileSync('public/index.html','utf-8');

// Must link styles.css and app.js (allow ?v= cache-busting)
const hasStyles = /href\s*=\s*["']\.\/styles\.css(\?[^"']*)?["']/i.test(html);
const hasScript = /src\s*=\s*["']\.\/app\.js(\?[^"']*)?["']/i.test(html);
if (!hasStyles) fail('index.html missing <link ... styles.css>');
if (!hasScript) fail('index.html missing <script ... app.js>');
ok('index.html links to styles.css and app.js');

// Critical DOM ids (accept either exportPngBtn or legacy exportBtn)
const ids = ['fileInput','analyzeBtn','video','results','downloadLink','statusDot'];
for (const id of ids) {
  if (!new RegExp(`id=["']${id}["']`).test(html)) fail(`index.html missing id="${id}"`);
}
const hasAnyExport = /id=["']exportPngBtn["']/.test(html) || /id=["']exportBtn["']/.test(html);
if (!hasAnyExport) fail('index.html missing export button id (exportPngBtn or exportBtn)');
ok('index.html has required DOM ids');

// JS syntax compile only (no execution)
const js = fs.readFileSync('public/app.js','utf-8');
try {
  new vm.Script(js, { filename: 'public/app.js' });
  ok('public/app.js parses (syntax OK)');
} catch (e) {
  fail(`public/app.js syntax error: ${e.message}`);
}

// Re-run contract check against golden (ensures scripts still runnable)
const cp = spawnSync(process.execPath, ['scripts/verify-analyze-shape.mjs','fixtures/golf1.golden.json'], { stdio:'pipe' });
if (cp.status !== 0) {
  console.error(cp.stdout.toString() || '');
  console.error(cp.stderr.toString() || '');
  fail('Contract check on golden failed');
}
ok('Golden passes contract script');

console.log('🎉 Static smoke test passed');
