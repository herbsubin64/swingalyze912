#!/usr/bin/env bash
# reset_server.sh — kill stragglers, ensure deps, start uvicorn cleanly

set -euo pipefail
cd "$(dirname "$0")"

echo "[1] Kill any uvicorn/python servers"
pkill -9 -f '[u]vicorn' 2>/dev/null || true
pkill -9 -f 'python -m uvicorn' 2>/dev/null || true

# also kill anything bound to :8000 (sometimes lsof shows only the child)
if PIDS="$(lsof -ti :8000 2>/dev/null || true)"; then
  if [ -n "${PIDS:-}" ]; then
    echo "[1b] Killing PIDs on :8000 -> $PIDS"
    kill -9 $PIDS 2>/dev/null || true
  fi
fi

echo "[2] Ensure venv exists and is active"
if [ ! -f .venv/bin/activate ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
export PYTHONNOUSERSITE=1

echo "[3] Python info"
python - <<'PY'
import sys, site
print("[PY] exe   :", sys.executable)
print("[PY] prefix:", sys.prefix)
print("[PY] sites :", site.getsitepackages())
PY

echo "[4] Install baseline deps from requirements.txt"
python -m pip install --upgrade pip >/dev/null
pip install --no-cache-dir -r requirements.txt >/dev/null

echo "[5] Enforce headless OpenCV + NumPy 1.x (prevents libGL + ABI issues)"
pip uninstall -y opencv-python opencv-contrib-python opencv-python-headless >/dev/null 2>&1 || true
pip uninstall -y numpy >/dev/null 2>&1 || true
pip install --no-cache-dir "numpy==1.26.4" "opencv-python-headless==4.8.1.78" >/dev/null

# If mediapipe is used, DO NOT reinstall opencv-contrib-python (it will pull GUI OpenCV).
# Mediapipe works fine with headless OpenCV when you don't import its cv modules directly.

echo "[6] Sanity check cv2 & numpy from THIS venv"
python - <<'PY'
import cv2, numpy as np, sys
print("[cv2]", cv2.__version__, "->", cv2.__file__)
print("[np ]", np.__version__)
assert ".venv" in cv2.__file__, f"cv2 outside venv: {cv2.__file__}"
assert np.__version__.startswith("1."), f"Expected NumPy 1.x, got {np.__version__}"
PY

echo "[7] Ensure runtime folders exist"
mkdir -p uploads results static

echo "[8] Start uvicorn (foreground) — logs below"
echo "    Health:  curl -s http://127.0.0.1:8000/health"
if [ -n "${CODESPACE_NAME:-}" ]; then
  echo "    Public:  https://8000-${CODESPACE_NAME}.github.dev/"
fi

# Run in the foreground so you can see errors immediately
exec .venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
