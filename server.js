// server.js (diagnostic-safe)
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

// --- Middleware ---
app.use(express.json());
app.use(fileUpload({ useTempFiles: false, createParentPath: true }));
app.use(express.static(path.join(__dirname, 'public'), { fallthrough: true }));

// --- Helpers ---
function pythonAnalyze(fullPath) {
  return new Promise((resolve) => {
    const py = spawn('python3', [ path.join(__dirname,'tools','analyze_refined.py'), fullPath ], { cwd:__dirname });
    let out='', err='';
    py.stdout.on('data', d => out += d.toString());
    py.stderr.on('data', d => err += d.toString());
    py.on('close', (code) => resolve({ code, out, err }));
  });
}
function pickTagged(lines, tag) {
  const L = lines.find(l => l.startsWith(tag+' '));
  return L ? JSON.parse(L.replace(tag+' ','').trim()) : null;
}

// --- Status / Debug ---
app.get('/api/status', (req, res) => {
  res.json({
    ok:true,
    node:process.version,
    contract:"1.0.0",
    cwd:process.cwd(),
    dirname:__dirname,
    paths:{
      public:path.join(__dirname,'public'),
      uploads:path.join(__dirname,'uploads')
    },
    proto:["__KEYFRAMES__","__SERIES__","__ANGLES__","__STANCE__","__TEMPO__"]
  });
});

// Lists uploads to prove where files really are
app.get('/api/ls', (req, res) => {
  const up = path.join(__dirname,'uploads');
  const pub = path.join(__dirname,'public');
  const safeList = (p) => {
    try { return fs.readdirSync(p); } catch { return []; }
  };
  res.json({
    ok:true,
    uploadsDir: up,
    uploads: safeList(up),
    publicDir: pub,
    public: safeList(pub)
  });
});

// --- Upload (always saves to uploads/upload.mp4) ---
app.post('/api/upload', async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).json({ ok:false, error:'no_file' });
  }
  const f = req.files.file;
  const dir = path.join(__dirname,'uploads');
  fs.mkdirSync(dir, { recursive:true });
  const target = path.join(dir, 'upload.mp4');

  try {
    await f.mv(target);
    const stat = fs.statSync(target);
    return res.json({ ok:true, savedAs:'upload.mp4', size: stat.size, fullPath: target });
  } catch (e) {
    return res.status(500).json({ ok:false, error:'write_failed', detail:String(e), fullPath: target });
  }
});

// --- Analyze ---
app.post('/api/analyze', async (req, res) => {
  const name = (req.body && req.body.video) || 'golf1.mp4';
  const fullPath = (name === 'upload.mp4' || name === 'upload_h264.mp4')
    ? path.join(__dirname,'uploads',name)
    : path.join(__dirname,'public',name);

  if (!fs.existsSync(fullPath)) {
    return res.json({ ok:false, error:'clip_missing', clip: name, clipPath: fullPath });
  }

  const { code, out, err } = await pythonAnalyze(fullPath);
  if (code !== 0) {
    return res.json({ ok:false, error:'analyze_failed', code, stderr: err });
  }
  const lines = out.split(/\r?\n/).filter(Boolean);
  try {
    const keyframes = pickTagged(lines,'__KEYFRAMES__');
    const series    = pickTagged(lines,'__SERIES__');
    const angles    = pickTagged(lines,'__ANGLES__');
    const stance    = pickTagged(lines,'__STANCE__');
    const tempo     = pickTagged(lines,'__TEMPO__');
    return res.json({ ok:true, keyframes, series, angles, stance, tempo, contract:"1.0.0" });
  } catch (e) {
    return res.json({ ok:false, error:'parse_failed', detail:String(e), raw: out, stderr: err });
  }
});

app.listen(PORT,'0.0.0.0',()=>console.log(`✅ Swingalyze API on http://0.0.0.0:${PORT}`));
