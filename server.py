# server.py
from __future__ import annotations
import os, io, json, tempfile, shutil
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Local analysis
from pose import analyze_video

APP_ROOT = Path(__file__).resolve().parent
RESULTS_DIR = APP_ROOT / "results"
RESULTS_DIR.mkdir(exist_ok=True)

# Configurable upload cap (MB)
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "200"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

app = FastAPI(title="Swingalyze")

# CORS: allow the Codespaces origin and local
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Codespaces’ forwarded origins vary; keep permissive in dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve your current top-level files without breaking the baseline UI
@app.get("/styles.css")
def styles_css():
    path = APP_ROOT / "styles.css"
    if not path.exists():
        raise HTTPException(404, "styles.css not found")
    return FileResponse(path)

@app.get("/script.js")
def script_js():
    path = APP_ROOT / "script.js"
    if not path.exists():
        raise HTTPException(404, "script.js not found")
    return FileResponse(path)

# Optional: mount a /static mirror of the project root (handy during dev)
app.mount("/static", StaticFiles(directory=str(APP_ROOT)), name="static")

@app.get("/health")
def health():
    return {"ok": True, "service": "swingalyze-backend"}

@app.get("/", response_class=FileResponse)
def root():
    index = APP_ROOT / "index.html"
    if not index.exists():
        return PlainTextResponse("index.html not found", status_code=404)
    return FileResponse(index)

def _save_upload_to_temp(upload: UploadFile, limit_bytes: int) -> str:
    """Stream the upload to a temp file with explicit size guard (prevents 413s at proxy)."""
    suffix = Path(upload.filename or "clip.mp4").suffix or ".mp4"
    fd, tmp_path = tempfile.mkstemp(prefix="swing_", suffix=suffix)
    os.close(fd)
    written = 0
    with open(tmp_path, "wb") as out:
        while True:
            chunk = upload.file.read(1024 * 1024)  # 1MB
            if not chunk:
                break
            written += len(chunk)
            if written > limit_bytes:
                out.close()
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail=f"File too large (> {limit_bytes} bytes)")
            out.write(chunk)
    return tmp_path

@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "Missing filename")
    # Save to temp with size cap
    tmp_path = _save_upload_to_temp(file, MAX_UPLOAD_BYTES)

    try:
        result = analyze_video(tmp_path, max_frames=900, frame_step=2)
    finally:
        # keep workspace clean
        try:
            os.remove(tmp_path)
        except Exception:
            pass

    if not result.get("ok"):
        return JSONResponse(result, status_code=400)

    # also write a copy under results/ for debugging (keyed by original name)
    out_name = Path(file.filename).stem + ".json"
    with open(RESULTS_DIR / out_name, "w") as f:
        json.dump(result, f, indent=2)

    return result
