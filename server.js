import express from 'express';
import path from 'path';
import fs from 'fs';
import fileUpload from 'express-fileupload';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function loadConfig() {
  const p = path.join(__dirname, 'config', 'config.json');
  try { return JSON.parse(fs.readFileSync(p,'utf8')); }
  catch { return { contractVersion:'1.0.0',
    gates:{ratioMin:1.2,ratioMax:30,seriesMin:10,stepMax:0.10,magMin:-1,magMax:100},
    detector:{smoothSec:0.12,onsetSustain:0.18,preMarginSec:0.18,addressBackoffSec:0.06,topPreWin:0.60,clubMinDt:0.22,eps:0.08,stepSec:0.02,canvasW:192},
    features:{angles:false,stance:false,clubPath:false}}; }
}
const CFG = loadConfig();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(fileUpload({ limits: { fileSize: 200 * 1024 * 1024 }, useTempFiles: false }));
app.use(express.static(path.join(__dirname,'public'),{fallthrough:true}));

app.get('/api/status', (req,res)=>res.json({ ok:true, node:process.version, contract:CFG.contractVersion, proto:['__KEYFRAMES__','__SERIES__','__ANGLES__'] }));

app.post('/api/upload', async (req,res) => {
  try {
    if (!req.files || !req.files.video) return res.status(400).json({ ok:false, error:'no_file' });
    const dst = path.join(__dirname,'public','upload.mp4');
    await req.files.video.mv(dst);
    return res.json({ ok:true, saved:'upload.mp4', size:req.files.video.size });
  } catch(e) { return res.status(500).json({ ok:false, error:'upload_failed', detail:String(e) }); }
});

app.post('/api/analyze', (req,res) => {
  const video    = (req.body && req.body.video) || 'golf1.mp4';
  const clipPath = path.join(__dirname,'public',video);
  const pyPath   = path.join(__dirname,'tools','analyze_refined.py');
  if (!fs.existsSync(clipPath)) return res.status(400).json({ ok:false, error:'clip_missing', clipPath });
  if (!fs.existsSync(pyPath))   return res.status(500).json({ ok:false, error:'analyzer_missing', pyPath });

  const py = spawn('python3', [pyPath, clipPath], { cwd: __dirname });
  let out = '', err = '';
  py.stdout.on('data', d => out += d.toString());
  py.stderr.on('data', d => err += d.toString());
  py.on('close', code => {
    if (code !== 0) return res.status(500).json({ ok:false, error:'analyze_failed', code, stderr:err, stdout:out });
    const lines = out.split('\n');
    const kLine = lines.find(l => l.startsWith('__KEYFRAMES__ '));
    const sLine = lines.find(l => l.startsWith('__SERIES__ '));
    const aLine = lines.find(l => l.startsWith('__ANGLES__ '));
    if (!kLine) return res.status(200).json({ ok:true, note:'no keyframes line', raw:out });
    try {
      const keyframes = JSON.parse(kLine.replace('__KEYFRAMES__ ','').trim());
      const series    = sLine ? JSON.parse(sLine.replace('__SERIES__ ','').trim()) : null;
      const angles    = aLine ? JSON.parse(aLine.replace('__ANGLES__ ','').trim()) : null;

      // Gates (unchanged; angles are not gated)
      const G = CFG.gates;
      const seq = [keyframes.addressT, keyframes.clubParallelT, keyframes.topT, keyframes.impactT, keyframes.followT];
      const mono = seq.every((v,i)=> i===0 || v >= (seq[i-1]-1e-6));
      const b = keyframes.topT - keyframes.addressT;
      const d = keyframes.impactT - keyframes.topT;
      const ratio = (d>0) ? (b/d) : Infinity;
      const samplesOk = !!(series && series.samples && series.samples >= G.seriesMin);
      const stepOk    = !!(series && series.stepSec && series.stepSec > 0 && series.stepSec <= G.stepMax);
      const vals = (series && Array.isArray(series.motion)) ? series.motion : [];
      let vmax=-Infinity, vmin=Infinity; for (const v of vals) if (Number.isFinite(v)) { if (v>vmax) vmax=v; if (v<vmin) vmin=v; }
      const magnitudeOk = Number.isFinite(vmax) && Number.isFinite(vmin) && vmax <= G.magMax && vmin >= G.magMin;

      const ok = mono && samplesOk && stepOk && magnitudeOk && Number.isFinite(ratio) && ratio >= G.ratioMin && ratio <= G.ratioMax;
      if (!ok) return res.status(422).json({
        ok:false, error:'regression_gate_failed',
        reason: !mono?'non_monotonic' : !samplesOk?'few_samples' : !stepOk?'bad_stepSec' : !magnitudeOk?'series_out_of_range'
              : !Number.isFinite(ratio)?'ratio_nan' : (ratio<G.ratioMin||ratio>G.ratioMax)?'ratio_bounds' : 'unknown',
        ratio, samples: series?.samples ?? 0, stepSec: series?.stepSec ?? null, vmin, vmax, keyframes, series
      });

      return res.json({ ok:true, keyframes, series, angles, contract: CFG.contractVersion });
    } catch(e) {
      return res.status(200).json({ ok:true, note:'parse_failed', raw:out, err:String(e) });
    }
  });
});

app.listen(PORT,'0.0.0.0',()=>console.log(`✅ Swingalyze API on http://0.0.0.0:${PORT}`));
