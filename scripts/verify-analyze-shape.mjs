// Minimal contract test for /api/analyze response shape.
// Usage: node scripts/verify-analyze-shape.mjs [pathToJson]
// Defaults to fixtures/golf1.golden.json if not provided.

import fs from 'node:fs';

const path = process.argv[2] || 'fixtures/golf1.golden.json';

if (!fs.existsSync(path)) {
  console.error(`ERROR: Fixture not found at ${path}.
Provide a path to an analyze JSON output, e.g.:
  node scripts/verify-analyze-shape.mjs fixtures/golf1.golden.json
`);
  process.exit(2);
}

const raw = fs.readFileSync(path, 'utf-8');
let j;
try { j = JSON.parse(raw); } catch (e) {
  console.error('ERROR: JSON parse failed:', e.message);
  process.exit(2);
}

// ---- Contract expectations (stable keys) ----
const errors = [];

function req(obj, key, type) {
  const v = obj?.[key];
  if (v == null) { errors.push(`Missing key: ${key}`); return; }
  if (type && typeof v !== type) { errors.push(`Key ${key} should be ${type}, got ${typeof v}`); }
}

function numOrNull(v, name) {
  if (v == null) return;
  if (typeof v !== 'number' || Number.isNaN(v)) errors.push(`Field ${name} must be a number or null`);
}

// Top-level keys required
['keyframes','series','angles','stance','tempo'].forEach(k => req(j, k, 'object'));

// Coaching optional but must be array if present
if ('coaching' in j && !Array.isArray(j.coaching)) {
  errors.push('coaching must be an array if present');
}

// Angles: allow either spine_impact_deg/shaft_impact_deg or legacy camelCase
const a = j.angles || {};
numOrNull(a.spine_impact_deg ?? a.spineImpact, 'angles.spine_impact_deg|spineImpact');
numOrNull(a.shaft_impact_deg ?? a.shaftImpact, 'angles.shaft_impact_deg|shaftImpact');

// Tempo: ratio, backswing, downswing numbers
const t = j.tempo || {};
numOrNull(t.ratio, 'tempo.ratio');
numOrNull(t.backswing, 'tempo.backswing');
numOrNull(t.downswing, 'tempo.downswing');

// Stance: impact fraction (number)
const s = j.stance || {};
numOrNull(s.impact ?? s.impact_fraction, 'stance.impact|impact_fraction');

// Keyframes: allow either {impact: seconds} or {frames:[{label,t}]}
const kf = j.keyframes || {};
let kfOk = false;
if (typeof kf.impact === 'number') kfOk = true;
if (Array.isArray(kf.frames)) {
  const hasT = kf.frames.some(f => typeof f?.t === 'number');
  if (hasT) kfOk = true;
}
if (!kfOk) errors.push('keyframes must include numeric "impact" or frames[].t');

// Series is flexible; just require object
if (typeof j.series !== 'object') errors.push('series must be an object');

// Coaching strings (if present)
if (Array.isArray(j.coaching)) {
  for (const [i, tip] of j.coaching.entries()) {
    if (typeof tip !== 'string') errors.push(`coaching[${i}] must be string`);
  }
}

if (errors.length) {
  console.error('❌ Analyze contract FAILED:\n- ' + errors.join('\n- '));
  process.exit(1);
} else {
  console.log('✅ Analyze contract OK for', path);
}
