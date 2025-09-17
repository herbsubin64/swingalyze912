/**
 * Validates that every *.golden.json has metrics inside plausible bounds.
 * Fails if out of bounds; warns on missing/non-numeric.
 */
import fs from 'node:fs';
import path from 'node:path';

const GLOB_DIR = 'fixtures';
const BOUNDS_P = 'fixtures/bounds.json';

function listGoldens(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.golden.json'))
    .map(f => path.join(dir, f));
}
function loadJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }

function normalize(obj){
  const out = {
    keyframes: obj.keyframes ?? obj.__KEYFRAMES__ ?? {},
    series:    obj.series    ?? obj.__SERIES__    ?? {},
    angles:    obj.angles    ?? obj.__ANGLES__    ?? {},
    stance:    obj.stance    ?? obj.__STANCE__    ?? {},
    tempo:     obj.tempo     ?? obj.__TEMPO__     ?? {},
    coaching:  Array.isArray(obj.coaching) ? obj.coaching :
               Array.isArray(obj.__COACHING__) ? obj.__COACHING__ : []
  };
  const a=out.angles, s=out.stance;
  out.angles = {
    ...a,
    spine_impact_deg: a.spine_impact_deg ?? a.spineImpact ?? a.spine_impact ?? a.spineImpactDeg,
    shaft_impact_deg: a.shaft_impact_deg ?? a.shaftImpact ?? a.shaft_impact ?? a.shaftImpactDeg
  };
  out.stance = { ...s, impact_fraction: s.impact_fraction ?? s.impact ?? s.impactFrac };
  return out;
}
function get(obj, dotted){
  return dotted.split('.').reduce((acc,k)=> (acc==null ? undefined : acc[k]), obj);
}

(function main(){
  const bounds = loadJson(BOUNDS_P);
  const goldens = listGoldens(GLOB_DIR);
  if (goldens.length === 0) {
    console.error('❌ No golden files found.');
    process.exit(1);
  }

  let fails = [];
  let warns = [];

  for (const file of goldens) {
    let raw;
    try { raw = loadJson(file); } catch (e) {
      fails.push(`${file}: unreadable JSON (${e.message})`);
      continue;
    }
    const j = normalize(raw);
    for (const key of Object.keys(bounds)) {
      const v = Number(get(j, key));
      if (!Number.isFinite(v)) { warns.push(`${file}: ${key} missing or not numeric`); continue; }
      const { min, max } = bounds[key];
      if (v < min || v > max) {
        fails.push(`${file}: ${key}=${v.toFixed(3)} out of bounds [${min}, ${max}]`);
      }
    }
  }

  if (warns.length) console.log('⚠️  Warnings:\n- ' + warns.join('\n- '));
  if (fails.length) {
    console.error('❌ Bounds validation failed:\n- ' + fails.join('\n- '));
    process.exit(1);
  }
  console.log('✅ All golden metrics within plausible bounds.');
})();
