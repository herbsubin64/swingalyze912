#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "[1] Kill leftovers and free port 8000"
pkill -9 -f "uvicorn" 2>/dev/null || true
fuser -k 8000/tcp 2>/dev/null || true

echo "[2] Ensure venv"
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip

echo "[3] Install locked deps"
# NOTE: pin Starlette exactly to avoid shell '<' parsing issues.
pip install --no-cache-dir \
  fastapi==0.116.1 \
  uvicorn==0.35.0 \
  pillow==11.3.0 \
  python-multipart==0.0.20 \
  mediapipe==0.10.21 \
  opencv-python-headless==4.8.1.78 \
  numpy==1.26.4 \
  requests==2.32.3 \
  starlette==0.47.3

echo "[4] Verify cv2 in venv"
python - <<'PY'
import sys, cv2, numpy
print("PY:", sys.executable)
print("cv2:", cv2.__version__, "->", cv2.__file__)
print("np :", numpy.__version__)
assert "/workspaces/swingalyze912/.venv/" in cv2.__file__, "cv2 not from venv!"
assert numpy.__version__.startswith("1."), "NumPy must be 1.x"
PY

echo "[5] Start uvicorn (venv python, foreground)"
exec .venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
