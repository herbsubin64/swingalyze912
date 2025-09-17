// Contract test for /api/analyze output that accepts either:
//  A) normalized keys:    keyframes, series, angles, stance, tempo, coaching[]
//  B) analyzer keys:      __KEYFRAMES__, __SERIES__, __ANGLES__, __STANCE__, __TEMPO__
//
// It also tolerates legacy angle/stance field names and maps them.

import fs from 'node:fs';

const path = process.argv[2] || 'fixtures/golf1.golden.json';
if (!fs.existsSync(path)) {
  console.error(`ERROR: Fixture not found at ${path}`);
  process.exit(2);
}

let j;
try { j = JSON.parse(fs.readFileSync(path, 'utf-8')); }
catch (e) { console.error('ERROR: JSON parse failed:', e.message); process.exit(2); }

// ---- Normalization ----
function normalize(obj) {
  // 1) Top-level keys
  const kf = obj.keyframes ?? obj.__KEYFRAMES__;
  const sr = obj.series ?? obj.__SERIES__;
  const ag = obj.angles ?? obj.__ANGLES__;
  const st = obj.stance ?? obj.__STANCE__;
  const tp = obj.tempo ?? obj.__TEMPO__;
  const coach = Array.isArray(obj.coaching) ? obj.coaching
               : Array.isArray(obj.__COACHING__) ? obj.__COACHING__
               : undefined;

  const out = { keyframes: kf, series: sr, angles: ag, stance: st, tempo: tp, coaching: coach };

  // 2) Angles field mapping (common variants)
  if (out.angles && typeof out.angles === 'object') {
    const a = out.angles;
    // Map camelCase → snake_case preferred fields (impact)
    out.angles = {
      ...a,
      spine_impact_deg: a.spine_impact_deg ?? a.spineImpact ?? a.spineImpactDeg ?? a.spine_impact,
      shaft_impact_deg: a.shaft_impact_deg ?? a.shaftImpact ?? a.shaftImpactDeg ?? a.shaft_impact,
      spine_top_deg:    a.spine_top_deg ?? a.spineTop ?? a.spineTopDeg ?? a.spine_top,
      shaft_top_deg:    a.shaft_top_deg ?? a.shaftTop ?? a.shaftTopDeg ?? a.shaft_top,
    };
  }

  // 3) Stance (allow impact_fraction or impact)
  if (out.stance && typeof out.stance === 'object') {
    const s = out.stance;
    out.stance = {
      ...s,
      impact_fraction: s.impact_fraction ?? s.impact ?? s.impactFrac,
      address_fraction: s.address_fraction ?? s.address ?? s.addressFrac,
    };
  }

  // 4) Keyframes acceptance (map variants)
  if (out.keyframes && typeof out.keyframes === 'object') {
    const k = out.keyframes;
    // Allow frames array or direct labels
    if (!('frames' in k) && Array.isArray(k.__frames)) {
      out.keyframes.frames = k.__frames;
    }
  }

  // 5) Tempo passthrough
  // (backswing, downswing, ratio, quality, confidence) — values may already match

  return out;
}

const n = normalize(j);

// ---- Assertions (tolerant but strict on presence) ----
const errors = [];
function reqObject(name, val) {
  if (val == null) errors.push(`Missing key: ${name}`);
  else if (typeof val !== 'object' || Array.isArray(val)) errors.push(`${name} must be an object`);
}
function numOrNull(v, name) {
  if (v == null) return;
  if (typeof v !== 'number' || Number.isNaN(v)) errors.push(`Field ${name} must be a number or null`);
}

// Required top-level objects
reqObject('keyframes', n.keyframes);
reqObject('series', n.series);
reqObject('angles', n.angles);
reqObject('stance', n.stance);
reqObject('tempo', n.tempo);

// Coaching is optional but must be array if present
if (n.coaching !== undefined && !Array.isArray(n.coaching)) {
  errors.push('coaching must be an array if present');
}

// Key angles
numOrNull(n.angles?.spine_impact_deg, 'angles.spine_impact_deg (or mappable)');
numOrNull(n.angles?.shaft_impact_deg, 'angles.shaft_impact_deg (or mappable)');

// Tempo
numOrNull(n.tempo?.ratio, 'tempo.ratio');
numOrNull(n.tempo?.backswing, 'tempo.backswing');
numOrNull(n.tempo?.downswing, 'tempo.downswing');

// Stance
numOrNull(n.stance?.impact_fraction, 'stance.impact_fraction');

// Keyframes must expose either numeric impact OR frames[].t
const kf = n.keyframes || {};
let kfOk = false;
if (typeof kf.impact === 'number') kfOk = true;
if (Array.isArray(kf.frames)) {
  const hasT = kf.frames.some(f => typeof f?.t === 'number');
  if (hasT) kfOk = true;
}
if (!kfOk) errors.push('keyframes must include numeric "impact" or frames[].t');

if (errors.length) {
  console.error('❌ Analyze contract FAILED:\n- ' + errors.join('\n- '));
  process.exit(1);
}
console.log('✅ Analyze contract OK for', path);
