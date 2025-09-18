/**
 * Ensures derived fields exist and are sane across ALL goldens.
 * - Derives tempo.ratio from backswing/downswing if missing.
 * - Verifies ratio ~ backswing/downswing when all present.
 * - Flags invalid/NaN metrics; warns on out-of-[0,1] stance fraction.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'fixtures';
const EPS = 0.25; // allowable ratio drift vs backswing/downswing

function listGoldens(dir){
  return fs.readdirSync(dir).filter(f=>f.endsWith('.golden.json')).map(f=>path.join(dir,f));
}
function load(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }

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
  const a=out.angles, s=out.stance, t=out.tempo;
  out.angles = {
    ...a,
    spine_impact_deg: a.spine_impact_deg ?? a.spineImpact ?? a.spine_impact ?? a.spineImpactDeg,
    shaft_impact_deg: a.shaft_impact_deg ?? a.shaftImpact ?? a.shaft_impact ?? a.shaftImpactDeg
  };
  out.stance = { ...s, impact_fraction: s.impact_fraction ?? s.impact ?? s.impactFrac };
  // derive tempo.ratio if possible
  if (t && (t.ratio==null || Number.isNaN(Number(t.ratio)))) {
    const bs = Number(t.backswing), ds = Number(t.downswing);
    if (Number.isFinite(bs) && Number.isFinite(ds) && ds>0) out.tempo.ratio = bs/ds;
  }
  return out;
}

function n(v){ const x=Number(v); return Number.isFinite(x)?x:NaN; }

(function main(){
  const files = listGoldens(DIR);
  if (!files.length){ console.error('❌ No goldens found'); process.exit(1); }

  const errs=[], warns=[];
  for (const f of files){
    let j;
    try{ j = normalize(load(f)); }catch(e){ errs.push(`${f}: unreadable (${e.message})`); continue; }
    const t=j.tempo||{}, ang=j.angles||{}, st=j.stance||{};
    const ratio=n(t.ratio), bs=n(t.backswing), ds=n(t.downswing);
    if (!Number.isFinite(ratio)) errs.push(`${f}: tempo.ratio missing and not derivable`);
    if (Number.isFinite(bs) && Number.isFinite(ds) && ds>0 && Number.isFinite(ratio)) {
      const want = bs/ds; const delta = Math.abs(ratio - want);
      if (delta>EPS) errs.push(`${f}: tempo.ratio=${ratio.toFixed(3)} differs from backswing/down (${want.toFixed(3)}) by ${delta.toFixed(3)} (> ${EPS})`);
    }

    const si=n(ang.spine_impact_deg), sha=n(ang.shaft_impact_deg);
    if (!Number.isFinite(si)) errs.push(`${f}: angles.spine_impact_deg missing/NaN`);
    if (!Number.isFinite(sha)) errs.push(`${f}: angles.shaft_impact_deg missing/NaN`);

    const frac=n(st.impact_fraction);
    if (!Number.isFinite(frac)) errs.push(`${f}: stance.impact_fraction missing/NaN`);
    else if (frac<0 || frac>1) warns.push(`${f}: stance.impact_fraction=${frac.toFixed(3)} outside [0,1] (will display but flagged)`);
  }

  if (warns.length) console.log('⚠️  Derived warnings:\n- ' + warns.join('\n- '));
  if (errs.length) { console.error('❌ Derived validation failed:\n- ' + errs.join('\n- ')); process.exit(1); }
  console.log('✅ All derived metrics present and coherent.');
})();
