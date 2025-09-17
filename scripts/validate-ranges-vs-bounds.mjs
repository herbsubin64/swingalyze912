/**
 * Ensures public/ranges.json is consistent with fixtures/bounds.json and fixtures/tolerances.json.
 * - keys must match across files (allow extra bounds keys but not missing ranges)
 * - good/warn arrays are ordered and within bounds
 * - good ⊆ warn
 * - tolerances are non-negative and not absurd (> full bounds span)
 */
import fs from 'node:fs';

const RANGES = 'public/ranges.json';
const BOUNDS = 'fixtures/bounds.json';
const TOLS   = 'fixtures/tolerances.json';

function read(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
function okNum(n){ return typeof n==='number' && Number.isFinite(n); }

const errs = [], warns = [];

let ranges, bounds, tols;
try { ranges = read(RANGES); } catch(e){ console.error(`❌ ${RANGES} missing or unreadable: ${e.message}`); process.exit(1); }
try { bounds = read(BOUNDS); } catch(e){ console.error(`❌ ${BOUNDS} missing or unreadable: ${e.message}`); process.exit(1); }
try { tols   = read(TOLS);   } catch(e){ console.error(`❌ ${TOLS} missing or unreadable: ${e.message}`); process.exit(1); }

const rKeys = Object.keys(ranges);
const bKeys = Object.keys(bounds);
const tKeys = Object.keys(tols);

// Key set checks
for (const k of rKeys) if (!bKeys.includes(k)) errs.push(`ranges key not in bounds: ${k}`);
for (const k of tKeys) if (!rKeys.includes(k)) errs.push(`tolerances key not in ranges: ${k}`);
for (const k of bKeys) if (!rKeys.includes(k)) warns.push(`bounds has extra key not used by ranges: ${k}`);

// Range structure checks
for (const k of rKeys){
  const r = ranges[k]; const b = bounds[k];
  if (!r || !b) continue;
  const good = r.good, warn = r.warn;
  if (!Array.isArray(good) || good.length!==2) { errs.push(`${k}: good must be [min,max]`); continue; }
  if (!Array.isArray(warn) || warn.length!==2) { errs.push(`${k}: warn must be [min,max]`); continue; }
  const [g0,g1] = good.map(Number), [w0,w1] = warn.map(Number);
  if (![g0,g1,w0,w1].every(Number.isFinite)) { errs.push(`${k}: good/warn must be numeric`); continue; }
  if (g0>g1) errs.push(`${k}: good min>max`);
  if (w0>w1) errs.push(`${k}: warn min>max`);
  if (w0>g0 || g1>w1) errs.push(`${k}: good must be within warn`);

  const {min: Bmin, max: Bmax} = b;
  if (!okNum(Bmin)||!okNum(Bmax)||Bmin>Bmax) errs.push(`${k}: invalid bounds in fixtures/bounds.json`);
  if (g0<Bmin || g1>Bmax) errs.push(`${k}: good outside bounds [${Bmin},${Bmax}]`);
  if (w0<Bmin || w1>Bmax) errs.push(`${k}: warn outside bounds [${Bmin},${Bmax}]`);

  // Tolerance sanity
  if (k in tols){
    const tol = Number(tols[k]);
    if (!(tol>=0)) errs.push(`${k}: tolerance must be >= 0`);
    const span = Bmax - Bmin;
    if (tol > span) errs.push(`${k}: tolerance ${tol} > full bounds span ${span}`);
  } else {
    warns.push(`${k}: missing tolerance; live↔golden deltas won't be validated`);
  }
}

if (warns.length) console.log('⚠️  Ranges warnings:\n- ' + warns.join('\n- '));
if (errs.length) { console.error('❌ Ranges vs bounds/tolerances failed:\n- ' + errs.join('\n- ')); process.exit(1); }
console.log('✅ ranges.json consistent with bounds & tolerances.');
