// Validates public/ranges.json without deps.
// Checks: keys exist, arrays length 2, good in warn, numeric, plausibility.
import fs from 'node:fs';

const path = 'public/ranges.json';
if (!fs.existsSync(path)) {
  console.error('ERROR: public/ranges.json not found'); process.exit(2);
}
let cfg; try { cfg = JSON.parse(fs.readFileSync(path,'utf-8')); }
catch(e){ console.error('ERROR: ranges.json parse failed:', e.message); process.exit(2); }

const metricHints = {
  'tempo.ratio':        { min: 1.0, max: 6.0 },
  'tempo.backswing':    { min: 0.1, max: 3.0 },
  'tempo.downswing':    { min: 0.05, max: 1.0 },
  'angles.spine_impact_deg': { min: 0, max: 90 },
  'angles.shaft_impact_deg': { min: 0, max: 90 },
  'stance.impact_fraction':  { min: 0.0, max: 1.0 }
};

const errors = [];
const profiles = Object.keys(cfg);
if (profiles.length === 0) errors.push('No profiles in ranges.json');

for (const prof of profiles) {
  const m = cfg[prof];
  if (typeof m !== 'object' || Array.isArray(m)) { errors.push(`Profile ${prof} must be an object`); continue; }
  for (const [key, band] of Object.entries(m)) {
    if (!band || typeof band !== 'object') { errors.push(`${prof}:${key} missing band object`); continue; }
    const g = band.good, w = band.warn;
    if (!Array.isArray(g) || g.length !== 2) errors.push(`${prof}:${key} good must be [min,max]`);
    if (!Array.isArray(w) || w.length !== 2) errors.push(`${prof}:${key} warn must be [min,max]`);
    const [g0,g1] = g||[]; const [w0,w1] = w||[];
    if ([g0,g1,w0,w1].some(v=>typeof v!=='number' || Number.isNaN(v))) errors.push(`${prof}:${key} bands must be numbers`);
    if (g && g[0] > g[1]) errors.push(`${prof}:${key} good min>max`);
    if (w && w[0] > w[1]) errors.push(`${prof}:${key} warn min>max`);
    if (g && w && !(w0 <= g0 && g1 <= w1)) errors.push(`${prof}:${key} good must be within warn`);
    const hint = metricHints[key];
    if (hint) {
      if (g0 < hint.min || g1 > hint.max || w0 < hint.min || w1 > hint.max) {
        errors.push(`${prof}:${key} out of plausible range [${hint.min}, ${hint.max}]`);
      }
    }
  }
}

if (errors.length) { console.error('❌ ranges.json FAILED:\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('✅ ranges.json OK across profiles:', profiles.join(', '));
