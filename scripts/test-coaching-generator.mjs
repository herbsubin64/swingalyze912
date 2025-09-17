// Asserts coaching generator logic produces tips for known out-of-range inputs.
function assess(v, good, warn){ if (v==null) return 'na'; const inGood = v>=good[0]&&v<=good[1]; const inWarn = v>=warn[0]&&v<=warn[1]; return inGood?'ok':(inWarn?'warn':'bad'); }
function genTips(a, rs){
  const tips=[]; const t=a.tempo||{}, ang=a.angles||{}, st=a.stance||{};
  push(t.ratio,'tempo.ratio','Tempo','Aim ~3:1');
  push(t.backswing,'tempo.backswing','Backswing time','Smooth back');
  push(t.downswing,'tempo.downswing','Downswing time','Brisk down');
  push(ang.spine_impact_deg,'angles.spine_impact_deg','Spine tilt @ impact','Maintain forward tilt');
  push(ang.shaft_impact_deg,'angles.shaft_impact_deg','Shaft angle @ impact','Hands ahead');
  push(st.impact_fraction,'stance.impact_fraction','Stance width','Match to club');
  function push(val,key,label,cue){ if(val==null||!rs[key])return; const s=assess(Number(val),rs[key].good,rs[key].warn); if(s==='bad') tips.push(`${label} out of range: ${val}. ${cue}`); if(s==='warn') tips.push(`${label} borderline: ${val}. ${cue}`); }
  return Array.from(new Set(tips));
}
// Minimal ranges and a purposely "bad" analysis:
const rs = {
  'tempo.ratio': {good:[2.8,3.4], warn:[2.6,3.6]},
  'tempo.backswing': {good:[0.6,1.2], warn:[0.5,1.4]},
  'tempo.downswing': {good:[0.18,0.35], warn:[0.15,0.4]},
  'angles.spine_impact_deg': {good:[20,45], warn:[15,50]},
  'angles.shaft_impact_deg': {good:[45,70], warn:[40,75]},
  'stance.impact_fraction': {good:[0.38,0.55], warn:[0.32,0.62]},
};
const analysis = {
  tempo:{ratio:2.0, backswing:1.6, downswing:0.12}, // bad/borderline
  angles:{spine_impact_deg:10, shaft_impact_deg:80}, // bad
  stance:{impact_fraction:0.25} // bad
};
const tips = genTips(analysis, rs);
if (!Array.isArray(tips)) { console.error('❌ coaching generator did not return array'); process.exit(1); }
if (tips.length < 3) { console.error('❌ coaching generator returned too few tips:', tips); process.exit(1); }
if (tips.some(t=>typeof t!=='string')) { console.error('❌ coaching generator contains non-string entries'); process.exit(1); }
console.log('✅ coaching generator OK, tips:', tips.length);
