// server.js
import express from 'express';
import path from 'path';
import fs from 'fs';
import fileUpload from 'express-fileupload';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public'), { fallthrough: true }));

app.get('/api/status', (req, res) => {
  res.json({
    ok:true,
    node:process.version,
    contract:"1.0.0",
    proto:["__KEYFRAMES__","__SERIES__","__ANGLES__","__STANCE__","__TEMPO__"]
  });
});

app.post('/api/upload', (req, res) => {
  if (!req.files || !req.files.file) return res.status(400).json({ ok:false, error:'no_file' });
  const f = req.files.file;
  fs.mkdirSync(path.join(__dirname,'uploads'), { recursive:true });
  const p = path.join(__dirname, 'uploads', 'upload.mp4');
  f.mv(p, (err) => {
    if (err) return res.status(500).json({ ok:false, error:'write_failed', detail:String(err) });
    res.json({ ok:true, savedAs:'upload.mp4' });
  });
});

app.post('/api/analyze', (req, res) => {
  const video = (req.body && req.body.video) || 'golf1.mp4';
  const clipPath = (video === 'upload.mp4')
    ? path.join(__dirname, 'uploads', 'upload.mp4')
    : path.join(__dirname, 'public',  video);

  if (!fs.existsSync(clipPath)) return res.json({ ok:false, error:'clip_missing', clipPath });

  const py = spawn('python3', [ path.join(__dirname,'tools','analyze_refined.py'), clipPath ], { cwd:__dirname });

  let out='', err='';
  py.stdout.on('data', d => out += d.toString());
  py.stderr.on('data', d => err += d.toString());
  py.on('close', (code) => {
    if (code !== 0) return res.json({ ok:false, error:'analyze_failed', code, stderr:err });

    const lines = out.split(/\r?\n/).filter(Boolean);
    const pick  = (tag) => {
      const L = lines.find(l => l.startsWith(tag+' '));
      return L ? JSON.parse(L.replace(tag+' ','').trim()) : null;
    };
    try {
      const keyframes = pick('__KEYFRAMES__');
      const series    = pick('__SERIES__');
      const angles    = pick('__ANGLES__');
      const stance    = pick('__STANCE__');
      const tempo     = pick('__TEMPO__');

      return res.json({ ok:true, keyframes, series, angles, stance, tempo, contract:"1.0.0" });
    } catch(e) {
      return res.json({ ok:false, error:'parse_failed', raw:out, stderr:err, detail:String(e) });
    }
  });
});

app.listen(PORT,'0.0.0.0',()=>console.log(`✅ Swingalyze API on http://0.0.0.0:${PORT}`));
