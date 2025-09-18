/**
 * Verifies essential static assets exist and key hooks are present.
 * Keeps CI deterministic even when the server isn't running.
 */
import fs from 'node:fs';

const mustExist = [
  'public/index.html',
  'public/styles.css',
  'public/app.js',
  'public/ranges.json'
];

let failed = false;
for (const p of mustExist) {
  try { fs.accessSync(p); }
  catch (e) { console.error(`❌ Missing asset: ${p}`); failed = true; }
}

try {
  const html = fs.readFileSync('public/index.html','utf8');
  const reqIds = ['buildTag','statusDot','apiBaseInput','fileInput','analyzeBtn','results'];
  for (const id of reqIds) {
    if (!new RegExp(`id=["']${id}["']`).test(html)) {
      console.error(`❌ index.html missing #${id}`);
      failed = true;
    }
  }
  if (!/app\.js\?v=/.test(html)) {
    console.error('❌ index.html missing cache-busted app.js include (?v=...)');
    failed = true;
  }
} catch (e) {
  console.error('❌ Unable to read public/index.html:', e.message);
  failed = true;
}

try {
  const js = fs.readFileSync('public/app.js','utf8');
  const signatures = [
    /function\s+normalize\s*\(/,
    /async\s+function\s+renderReportPNG\s*\(/,
    /function\s+drawOverlaysOnImpact\s*\(/,
    /function\s+assess\s*\(/,
    /function\s+generateCoaching\s*\(/,
    /function\s+toTips\s*\(/,
    /function\s+dedupe\s*\(/,
    /function\s+apiUrl\s*\(/
  ];
  for (const re of signatures) {
    if (!re.test(js)) {
      console.error(`❌ public/app.js missing signature: ${re}`);
      failed = true;
    }
  }
} catch (e) {
  console.error('❌ Unable to read public/app.js:', e.message);
  failed = true;
}

if (failed) process.exit(1);
console.log('✅ Static assets present and wired.');
