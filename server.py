# server.py
from __future__ import annotations
import os
from pathlib import Path
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from pose import analyze_video  # local analysis module

HERE = Path(__file__).parent.resolve()
UPLOADS = HERE / "uploads"
RESULTS = HERE / "results"

# Ensure folders exist
for p in (UPLOADS, RESULTS):
    p.mkdir(exist_ok=True)

# No Starlette MultipartMiddleware needed; we do manual size checks.
app = FastAPI(title="Swingalyze", version="pose-v1")

# Serve static assets (index.html references /static/...)
app.mount("/static", StaticFiles(directory=str(HERE)), name="static")


@app.get("/", response_class=HTMLResponse)
def root():
    idx = HERE / "index.html"
    if not idx.exists():
        return HTMLResponse("<h2>index.html not found</h2>", status_code=500)
    return FileResponse(idx)


@app.get("/health")
def health():
    return {"ok": True, "service": "swingalyze-backend"}


async def _save_upload_streamed(upload: UploadFile, dest: Path, max_bytes: int = 500 * 1024 * 1024):
    """Stream the upload to disk and enforce a hard byte-limit (prevents 413s)."""
    total = 0
    chunk_size = 1024 * 1024
    with dest.open("wb") as f:
        while True:
            chunk = await upload.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                # stop early and remove partial file
                try:
                    f.close()
                except Exception:
                    pass
                if dest.exists():
                    dest.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="File too large")
            f.write(chunk)


@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    if not file:
        raise HTTPException(status_code=400, detail="No file")
    dest = UPLOADS / file.filename
    await _save_upload_streamed(file, dest)
    return {"ok": True, "filename": file.filename, "path": str(dest)}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    if not file:
        raise HTTPException(status_code=400, detail="No file")
    dest = UPLOADS / file.filename
    await _save_upload_streamed(file, dest)

    report = analyze_video(str(dest), sample_every_n=5)
    return JSONResponse(report)
