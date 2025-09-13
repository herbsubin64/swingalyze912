import os, io, time, math, hashlib
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# ---- Paths
ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
UPLOADS = ROOT / "uploads"
RESULTS = ROOT / "results"
for p in (STATIC, UPLOADS, RESULTS):
    p.mkdir(parents=True, exist_ok=True)

# ---- App
app = FastAPI(title="Swingalyze", version="MVP-2")

# Serve static assets and data
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS), name="uploads")
app.mount("/results", StaticFiles(directory=RESULTS), name="results")

# Home page
@app.get("/", response_class=HTMLResponse)
def home():
    index_path = ROOT / "index.html"
    if not index_path.exists():
        return HTMLResponse("<h1>index.html missing</h1>", status_code=500)
    return FileResponse(index_path)

@app.get("/health")
def health():
    return {"ok": True, "service": "swingalyze-backend"}

# -------------------------------------------------------------------
# Upload endpoint (kept small + safe to avoid 413 at Codespaces proxy)
# -------------------------------------------------------------------
ALLOWED_EXTS = {".mp4", ".mov", ".webm", ".m4v"}
MAX_UPLOAD_MB = 50
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(data)//(1024*1024)}MB). Max {MAX_UPLOAD_MB}MB."
        )

    clip_id = hashlib.md5(f"{time.time()}_{file.filename}".encode()).hexdigest()[:12]
    out_name = f"{clip_id}{ext}"
    out_path = UPLOADS / out_name
    with open(out_path, "wb") as f:
        f.write(data)

    return {"ok": True, "clip_id": clip_id, "filename": out_name, "url": f"/uploads/{out_name}"}

# -------------------------------------------------------------------
# Analyze endpoint (by filename, not re-uploading the blob)
# -------------------------------------------------------------------
import numpy as np
try:
    import cv2  # headless build required
except Exception:
    cv2 = None

try:
    import mediapipe as mp
    MP_OK = True
except Exception:
    MP_OK = False

def _safe_open_video(path: Path):
    if (path.exists() and path.is_file() and cv2 is not None):
        cap = cv2.VideoCapture(str(path))
        if cap.isOpened():
            return cap
    return None

def _downscale(frame, target_w=640):
    h, w = frame.shape[:2]
    if w <= target_w:
        return frame
    scale = target_w / float(w)
    nh = int(h * scale)
    return cv2.resize(frame, (target_w, nh), interpolation=cv2.INTER_AREA)

def _render_overlay(src_path: Path, dst_path: Path, step: int, max_frames: int):
    """
    Create a light overlay MP4. If MediaPipe is available, draw shoulders/hips/arms/knees.
    Otherwise, draw a small frame counter watermark. Keep fast & small.
    """
    cap = _safe_open_video(src_path)
    if cap is None:
        return None

    # Output writer: mp4v @ original fps if available; we downscale frames to width ~640
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    ok, first = cap.read()
    if not ok:
        cap.release()
        return None
    first = _downscale(first, 640)
    h, w = first.shape[:2]
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    vw = cv2.VideoWriter(str(dst_path), fourcc, fps, (w, h))

    # Prepare pose if possible
    if MP_OK:
        mp_pose = mp.solutions.pose
        pose = mp_pose.Pose(static_image_mode=False,
                            model_complexity=0,
                            enable_segmentation=False,
                            min_detection_confidence=0.5,
                            min_tracking_confidence=0.5)
    else:
        pose = None

    fidx = 0
    frames_done = 0

    def draw_landmarks(img, lms):
        # Draw a few lines: shoulders, hips, lead arm (L-elbow->L-wrist), trail knee (R-knee->R-ankle)
        H, W = img.shape[:2]
        def P(i):
            lm = lms[i]
            return int(lm.x * W), int(lm.y * H)
        keep = [11,12,23,24,13,15,26,28]
        # points
        for i in keep:
            x,y = P(i)
            cv2.circle(img, (x,y), 3, (80,255,120), -1)
        # lines
        cv2.line(img, P(11), P(12), (0,255,0), 2)   # shoulders
        cv2.line(img, P(23), P(24), (0,170,255), 2) # hips
        cv2.line(img, P(13), P(15), (255,220,0), 2) # lead arm (L)
        cv2.line(img, P(26), P(28), (255,120,120), 2) # trail knee (R)

    # Write first frame
    if pose:
        rgb = cv2.cvtColor(first, cv2.COLOR_BGR2RGB)
        res = pose.process(rgb)
        if res.pose_landmarks:
            draw_landmarks(first, res.pose_landmarks.landmark)
    else:
        cv2.putText(first, f"Frame {fidx}", (20, h-20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200,200,200), 2)
    vw.write(first)
    frames_done += 1

    ok, frame = cap.read()
    while ok and frames_done < max_frames:
        if fidx % step == 0:
            frame = _downscale(frame, 640)
            if pose:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                res = pose.process(rgb)
                if res.pose_landmarks:
                    draw_landmarks(frame, res.pose_landmarks.landmark)
            else:
                cv2.putText(frame, f"Frame {fidx}", (20, frame.shape[0]-20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200,200,200), 2)
            vw.write(frame)
            frames_done += 1
        fidx += 1
        ok, frame = cap.read()

    cap.release()
    if pose:
        pose.close()
    vw.release()
    return dst_path.name

@app.post("/analyze")
async def analyze(filename: str = Form(...),
                  max_frames: int = Form(120),
                  render_overlay: int = Form(0)):
    """
    Analyze an already-uploaded file by name.
    FormData:
      - filename: uploaded file name (e.g., 123abc.mp4)
      - max_frames: cap frames processed (default 120)
      - render_overlay: 1 to generate a small overlay mp4 in /results
    """
    if cv2 is None:
        return JSONResponse(
            {"ok": True, "frames_analyzed": 0,
             "summary": {"avg_shoulder_turn_deg": None,
                         "avg_lead_arm_deg": None,
                         "avg_trail_knee_deg": None,
                         "notes": "OpenCV not available; ensure venv and headless build are installed."},
             "keypoints_csv": None,
             "rendered_overlay": None},
            status_code=200,
        )

    src = UPLOADS / filename
    cap = _safe_open_video(src)
    if cap is None:
        raise HTTPException(status_code=400, detail="Cannot open uploaded video")

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    step = max(1, total // max(1, min(max_frames, total or 1)))
    step = max(step, 1)

    # Prepare pose if available
    if MP_OK:
      mp_pose = mp.solutions.pose
      pose = mp_pose.Pose(static_image_mode=False,
                          model_complexity=0,
                          enable_segmentation=False,
                          min_detection_confidence=0.5,
                          min_tracking_confidence=0.5)
    else:
      pose = None

    clip_id = Path(filename).stem
    csv_path = RESULTS / f"{clip_id}_keypoints.csv"
    csv_buf = io.StringIO()
    csv_buf.write("frame,landmark,x,y,z,visibility\n")

    shoulder_turns, lead_arm_angles, trail_knee_angles = [], [], []

    frames_kept = 0
    fidx = 0
    ok, frame = cap.read()
    while ok:
        if fidx % step == 0:
            frames_kept += 1
            if pose:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                res = pose.process(rgb)
                if res.pose_landmarks:
                    lms = res.pose_landmarks.landmark
                    keep_ids = [11,12,23,24,13,15,26,28]
                    for lid in keep_ids:
                        lm = lms[lid]
                        csv_buf.write(f"{fidx},{lid},{lm.x:.6f},{lm.y:.6f},{lm.z:.6f},{lm.visibility:.3f}\n")

                    L_SH, R_SH = lms[11], lms[12]
                    dx = (R_SH.x - L_SH.x); dy = (R_SH.y - L_SH.y)
                    shoulder_turns.append(math.degrees(math.atan2(dy, dx)))

                    L_EL, L_WR = lms[13], lms[15]
                    arm_dx = (L_WR.x - L_EL.x); arm_dy = (L_WR.y - L_EL.y)
                    lead_arm_angles.append(math.degrees(math.atan2(arm_dy, arm_dx)))

                    R_KN, R_ANK = lms[26], lms[28]
                    knee_dx = (R_ANK.x - R_KN.x); knee_dy = (R_ANK.y - R_KN.y)
                    trail_knee_angles.append(math.degrees(math.atan2(knee_dy, knee_dx)))
            else:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                shoulder_turns.append(float(gray.mean()))

        ok, frame = cap.read()
        fidx += 1
        if frames_kept >= max_frames:
            break

    cap.release()
    if pose:
        pose.close()

    with open(csv_path, "w") as cf:
        cf.write(csv_buf.getvalue())

    def safe_avg(arr):
        return round(float(sum(arr)/len(arr)), 2) if arr else None

    summary = {
        "avg_shoulder_turn_deg": safe_avg(shoulder_turns),
        "avg_lead_arm_deg": safe_avg(lead_arm_angles),
        "avg_trail_knee_deg": safe_avg(trail_knee_angles),
        "notes": "MVP metrics (downsampled). Next: refine turn detection windows."
    }

    overlay_name = None
    if int(render_overlay) == 1:
        overlay_name = f"{clip_id}_overlay.mp4"
        dst = RESULTS / overlay_name
        # render using same step & frame cap as analysis
        produced = _render_overlay(src, dst, step=step, max_frames=max_frames)
        overlay_name = produced if produced else None

    return {
        "ok": True,
        "clip_id": clip_id,
        "upload": filename,
        "summary": summary,
        "frames_analyzed": frames_kept,
        "keypoints_csv": f"{clip_id}_keypoints.csv",
        "rendered_overlay": overlay_name
    }
