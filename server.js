import express from 'express';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { fallthrough: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { fallthrough: true }));

const CFG = {
  contractVersion: '1.0.0',
  analyzer: path.join(__dirname, 'tools', 'analyze_refined.py'),
  profilesPath: path.join(__dirname, 'config', 'coach_profiles.json'),
};

function loadProfiles() {
  try {
    const j = JSON.parse(fs.readFileSync(CFG.profilesPath, 'utf8'));
    return j;
  } catch {
    return {
      Driver: {
        spineTop:{target:20,band:8}, spineImpact:{target:25,band:10},
        shaftTop:{target:50,band:12}, shaftImpact:{target:25,band:8},
        tempo:{ backswing:[2.8,5.0], ratio:[2.0,4.0] }
      }
    };
  }
}

function grade(val, target, band) {
  if (val==null || !Number.isFinite(val)) return {state:'unknown', delta:null};
  const d = Math.abs(val - target);
  if (d <= band) return {state:'ok', delta:d};
  if (d <= band*1.5) return {state:'warn', delta:d};
  return {state:'bad', delta:d};
}

function makeCoaching(payload, club='Driver', profiles=loadProfiles()) {
  const p = profiles[club] || profiles['Driver'];
  const out = [];
  const A = payload.angles || {};
  const T = payload.tempo  || {};
  const add = (level, title, text)=> out.push({level, title, text});

  // Angles
  const gSTop = grade(A.spineTiltTop,    p.spineTop.target,    p.spineTop.band);
  const gSImp = grade(A.spineTiltImpact, p.spineImpact.target, p.spineImpact.band);
  const gShTop= grade(A.shaftTop,        p.shaftTop.target,    p.shaftTop.band);
  const gShImp= grade(A.shaftImpact,     p.shaftImpact.target, p.shaftImpact.band);

  const advice = (name, v, t) => {
    if (v==null || !Number.isFinite(v)) return `${name}: not confident yet`;
    const dir = v - t.target;
    if (name.startsWith('Spine')) {
      if (dir>0) return `${name} ${v.toFixed(1)}° (target ${t.target}°±${t.band}). Upper body tilting too much. Feel chest more over the ball.`;
      return `${name} ${v.toFixed(1)}° (target ${t.target}°±${t.band}). Too upright. Add a bit more side bend.`;
    } else { // Shaft
      if (dir>0) return `${name} ${v.toFixed(1)}° (target ${t.target}°±${t.band}). Too steep. Feel more around/under (flatter).`;
      return `${name} ${v.toFixed(1)}° (target ${t.target}°±${t.band}). Too flat. Feel arms up; more vertical set.`;
    }
  };

  const pushAngle = (g, name, val, t) => {
    if (g.state==='ok') add('ok', name, `${name} ${val?.toFixed?.(1) ?? '–'}° on target.`);
    if (g.state==='warn') add('warn', name, advice(name, val, t));
    if (g.state==='bad') add('bad', name, advice(name, val, t));
  };

  pushAngle(gSTop, 'Spine @Top', A.spineTiltTop, p.spineTop);
  pushAngle(gSImp, 'Spine @Impact', A.spineTiltImpact, p.spineImpact);
  pushAngle(gShTop,'Shaft @Top', A.shaftTop, p.shaftTop);
  pushAngle(gShImp,'Shaft @Impact', A.shaftImpact, p.shaftImpact);

  // Tempo
  if (T) {
    const r = T.ratio, bs = T.backswing;
    if (Number.isFinite(r)) {
      const [rMin,rMax] = p.tempo.ratio;
      const level = (r>=rMin && r<=rMax) ? 'ok' : (Math.min(Math.abs(r-rMin),Math.abs(r-rMax))<=0.6 ? 'warn' : 'bad');
      add(level, 'Tempo ratio', `Ratio ${r.toFixed(2)} (target ${rMin}–${rMax}). Aim for smoother 3:1 feel.`);
    } else {
      add('unknown','Tempo ratio','Not confident yet.');
    }
    if (Number.isFinite(bs)) {
      const [bMin,bMax] = p.tempo.backswing;
      const level = (bs>=bMin && bs<=bMax) ? 'ok' : (Math.min(Math.abs(bs-bMin),Math.abs(bs-bMax))<=0.5 ? 'warn' : 'bad');
      add(level, 'Backswing time', `Backswing ${bs.toFixed(2)}s (target ${bMin}–${bMax}s).`);
    } else {
      add('unknown','Backswing time','Not confident yet.');
    }
  }

  // Pick top 3 non-ok first, then ok to fill
  const nonOk = out.filter(x=>x.level!=='ok');
  const ok    = out.filter(x=>x.level==='ok');
  const chosen = [...nonOk.slice(0,3)];
  while (chosen.length<3 && ok.length) chosen.push(ok.shift());
  return chosen;
}

app.get('/api/status', (req, res) => {
  res.json({ ok:true, node:process.version, contract: CFG.contractVersion, proto:['__KEYFRAMES__','__SERIES__','__ANGLES__','__STANCE__','__TEMPO__'] });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const video = (req.body && req.body.video) || 'golf1.mp4';
    const club  = (req.body && req.body.club)  || 'Driver';
    const clipPath = video==='upload.mp4'
      ? path.join(__dirname, 'uploads', 'upload.mp4')
      : path.join(__dirname, 'public', 'golf1.mp4');

    if (!fs.existsSync(clipPath)) {
      return res.json({ ok:false, error:'clip_missing', clipPath });
    }

    const py = spawn('python3', [CFG.analyzer, clipPath], { cwd: __dirname });
    let out = '', err = '';
    py.stdout.on('data', d => { out += d.toString(); });
    py.stderr.on('data', d => { err += d.toString(); });

    py.on('close', code => {
      if (code !== 0) return res.json({ ok:false, error:'analyze_failed', code, stderr:err });

      const lines = out.split(/\r?\n/).filter(Boolean);
      const kLine = lines.find(l => l.startsWith('__KEYFRAMES__ '));
      const sLine = lines.find(l => l.startsWith('__SERIES__ '));
      const aLine = lines.find(l => l.startsWith('__ANGLES__ '));
      const tLine = lines.find(l => l.startsWith('__TEMPO__ '));
      const stLine= lines.find(l => l.startsWith('__STANCE__ '));

      if (!kLine || !sLine) return res.json({ ok:false, error:'contract_mismatch', raw:out });

      const keyframes = JSON.parse(kLine.replace('__KEYFRAMES__ ','').trim());
      const series    = JSON.parse(sLine.replace('__SERIES__ ','').trim());
      const angles    = aLine ? JSON.parse(aLine.replace('__ANGLES__ ','').trim()) : null;
      const tempo     = tLine ? JSON.parse(tLine.replace('__TEMPO__ ','').trim())  : null;
      const stance    = stLine? JSON.parse(stLine.replace('__STANCE__ ','').trim()) : null;

      const payload = { keyframes, series, angles, tempo, stance, contract: CFG.contractVersion };
      const coaching = makeCoaching(payload, club, loadProfiles());
      return res.json({ ok:true, ...payload, coaching });
    });
  } catch (e) {
    return res.json({ ok:false, error:'server_exception', detail:String(e) });
  }
});

app.listen(PORT,'0.0.0.0',()=>console.log(`✅ Swingalyze API on http://0.0.0.0:${PORT}`));
