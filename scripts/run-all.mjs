/**
 * Local one-command runner for all Swingalyze checks (in CI order).
 * - Optional steps (live calls) are automatically skipped if envs are missing.
 * - Exits 1 on the first hard failure.
 *
 * Usage:
 *   node scripts/run-all.mjs
 *   ANALYZE_URL=http://localhost:3000 ANALYZE_VIDEO=./clip.mp4 node scripts/run-all.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const has = (p) => { try{ fs.accessSync(p); return true; }catch{ return false; } };
const envHasLive = !!(process.env.ANALYZE_URL);
const envHasVideo = !!(process.env.ANALYZE_VIDEO && has(process.env.ANALYZE_VIDEO));

const steps = [
  { name: 'Verify build tag',               cmd: ['node','scripts/verify-buildtag.mjs'] },
  { name: 'Contract check (ALL goldens)',   cmd: ['bash','-lc','set -e; for f in fixtures/*.golden.json; do echo " - $f"; node scripts/verify-analyze-shape.mjs "$f"; done'] },
  { name: 'Validate metric bounds',         cmd: ['node','scripts/validate-metrics-bounds.mjs'] },
  { name: 'Validate ranges vs bounds/tols', cmd: ['node','scripts/validate-ranges-vs-bounds.mjs'] },
  { name: 'Validate ranges profiles',       cmd: ['node','scripts/validate-ranges.mjs'] },
  { name: 'Coaching normalization test',    cmd: ['node','scripts/test-coaching-normalization.mjs'] },
  { name: 'Static smoke (UI controls)',     cmd: ['node','scripts/smoke-static.mjs'] },
  { name: 'Static smoke (UI signatures)',   cmd: ['node','scripts/smoke-ui-signatures.mjs'] },
  // Optional live steps
  { name: 'Optional /api/status live check',    cmd: ['node','scripts/check-status.mjs'], optional: true, enabled: envHasLive },
  { name: 'Optional live compare-to-golden',    cmd: ['node','scripts/compare-to-golden.mjs'], optional: true, enabled: envHasLive && envHasVideo },
  { name: 'Optional light load test (5x,1c)',   cmd: ['node','scripts/load-test.mjs','5','1'], optional: true, enabled: envHasLive && envHasVideo },
];

function runStep(s){
  if (s.optional && s.enabled === false) {
    console.log(`SKIP ${s.name} (env missing)`);
    return { skipped: true, code: 0 };
  }
  console.log(`\n▶ ${s.name}`);
  const res = spawnSync(s.cmd[0], s.cmd.slice(1), { stdio: 'inherit', shell: false });
  if (res.status !== 0) {
    console.error(`\n❌ ${s.name} failed with code ${res.status}`);
    process.exit(res.status || 1);
  }
  console.log(`✅ ${s.name} passed`);
  return { skipped: false, code: 0 };
}

(function main(){
  console.log('Swingalyze: running full local check suite…');
  for (const s of steps) runStep(s);
  console.log('\n🎉 All checks passed (locals + optional live if enabled).');
})();
