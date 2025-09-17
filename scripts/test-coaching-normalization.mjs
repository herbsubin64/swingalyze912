/**
 * Ensures coaching tips arrays normalize to readable strings (no [object Object]).
 * Mirrors toTips/normalize semantics used in client.
 */
import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync('fixtures/coaching-shapes.json','utf8'));

function toTips(arr){
  if (!Array.isArray(arr)) return [];
  return arr.map(x=>{
    if (typeof x==='string') return x.trim();
    if (x && typeof x==='object'){
      const s = x.text || x.message || x.tip || x.note || x.reason;
      if (typeof s==='string') return s.trim();
      const label = (typeof x.label==='string' && x.label.trim()) || '';
      const advice = (typeof x.advice==='string' && x.advice.trim()) || '';
      if (label || advice) return `${label}${label&&advice?': ':''}${advice}`.trim();
      try { return JSON.stringify(x); } catch { return String(x); }
    }
    return String(x);
  }).filter(Boolean);
}

const tips = toTips(raw);
if (!Array.isArray(tips) || tips.length !== raw.length) {
  console.error('❌ toTips length mismatch:', tips.length, 'expected', raw.length);
  process.exit(1);
}
if (tips.some(t => /\[object Object\]/.test(String(t)))) {
  console.error('❌ Found [object Object] in tips:', tips);
  process.exit(1);
}
console.log('✅ Coaching normalization OK:', tips);
