#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> Using repo at: $ROOT"

# Kill anything stale (harmless if none)
pkill -f "uvicorn" || true
pkill -f "http.server" || true

echo "==> Ensuring venv..."
python3 -m venv .venv >/dev/null 2>&1 || true
source .venv/bin/activate

echo "==> Upgrading pip..."
python -m pip install --upgrade pip >/dev/null

echo "==> Installing requirements..."
python -m pip install -r requirements.txt

# Enforce headless OpenCV (prevents libGL errors)
python -m pip uninstall -y opencv-python opencv-contrib-python >/dev/null 2>&1 || true
python -m pip install --no-cache-dir opencv-python-headless==4.8.1.78

# Create runtime dirs
mkdir -p uploads results static

# Ensure static assets exist (copied from repo files, not generated)
# (No-op if you’re keeping index.html, styles.css, script.js at repo root)
# We serve /static/* automatically below.

echo "==> Starting FastAPI on :8000"
echo "Local health:  curl -s http://127.0.0.1:8000/health"
if [ -n "${CODESPACE_NAME:-}" ]; then
  echo "Public URL   : https://8000-${CODESPACE_NAME}.github.dev/"
fi

exec python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
