#!/usr/bin/env bash
set -euo pipefail

APP_PORT="${APP_PORT:-8000}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

cmd="${1:-up}"

kill_port() {
  pkill -f "uvicorn" 2>/dev/null || true
  lsof -ti:"$APP_PORT" | xargs -r kill -9 || true
}

venv_py=".venv/bin/python"
venv_pip=".venv/bin/pip"

case "$cmd" in
  up)
    echo "[1] Kill leftovers on :$APP_PORT"
    kill_port

    echo "[2] Ensure venv"
    python3 -m venv .venv 2>/dev/null || true
    source .venv/bin/activate

    echo "[3] Pin stable deps (no Mediapipe yet)"
    $venv_py -m pip install --upgrade pip
    $venv_pip uninstall -y opencv-python opencv-contrib-python opencv-python-headless numpy 2>/dev/null || true
    $venv_pip install --no-cache-dir "numpy==1.26.4" "opencv-python-headless==4.8.1.78"
    $venv_pip install --no-cache-dir -r requirements.txt

    echo "[4] Sanity: cv2 from venv"
    $venv_py - <<'PY'
import cv2, sys
print("cv2:", cv2.__version__)
print("cv2 file:", cv2.__file__)
assert ".venv" in cv2.__file__, f"cv2 not from venv: {cv2.__file__}"
PY

    echo "[5] Start uvicorn (NO reload)"
    exec "$venv_py" -m uvicorn server:app --host 0.0.0.0 --port "$APP_PORT"
    ;;

  stop)
    kill_port
    echo "Stopped anything on :$APP_PORT"
    ;;

  test)
    echo "[T] Health:"; curl -s "http://127.0.0.1:$APP_PORT/health" || true; echo
    echo "[T] Index :" ; curl -sI "http://127.0.0.1:$APP_PORT/" | head -n1 || true
    echo "[T] Static:" ; curl -sI "http://127.0.0.1:$APP_PORT/static/script.js" | head -n1 || true
    ;;

  *)
    echo "Usage: ./dev.sh [up|stop|test]"; exit 1
    ;;
esac
