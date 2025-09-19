#!/usr/bin/env bash
set -u
echo "── Swingalyze Smoke Test ─────────────────────────"
echo "Dir: $(pwd)"
git rev-parse --show-toplevel >/dev/null 2>&1 && echo "Repo: $(basename "$(git rev-parse --show-toplevel)")" || echo "Not a git repo"
echo "Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '—')"
echo "Remotes:" && (git remote -v 2>/dev/null || echo "—")
echo "Node: $(node -v 2>/dev/null || echo 'missing')"
echo "NPM : $(npm -v 2>/dev/null || echo 'missing')"
echo "──────────────────────────────────────────────────"
echo "[0] Freeing ports 3000/3001 (ignore errors if none)…"
npx kill-port 3000 3001 >/dev/null 2>&1 || true
rm -f .smoke.pid .smoke.log
echo "[1] Installing deps…"
npm install --silent || npm ci --silent || true
echo "[2] Launching server on PORT=3001…"
( PORT=3001 node server.js > .smoke.log 2>&1 & echo $! > .smoke.pid )
sleep 2
if ! ps -p "$(cat .smoke.pid 2>/dev/null || echo 0)" >/dev/null 2>&1; then
  echo "   ⚠ Server process did not stay up. Recent log tail:"
  tail -n 40 .smoke.log || true
  echo "   Try: npm start (if defined) or check .smoke.log for EADDRINUSE/stack traces."
  exit 1
fi
echo "[3] GET /api/status"
STATUS="$(curl -sS http://localhost:3001/api/status || true)"
echo "→ $STATUS"
echo "$STATUS" | grep -qi "ok" && echo "   ✅ Status endpoint looks OK" || echo "   ⚠ Unexpected status response"
echo "[4] POST /api/analyze?g=golf1"
ANALYZE="$(curl -sS -X POST "http://localhost:3001/api/analyze?g=golf1" -H "Content-Type: application/json" -d '{}' || true)"
echo "$ANALYZE" | grep -o '"__KEYFRAMES__":[^,}]*' | head -n1 || echo "(__KEYFRAMES__ not found)"
echo "$ANALYZE" | grep -o '"__TEMPO__":[^}]*' | head -n1 || echo "(__TEMPO__ not found)"
echo "$ANALYZE" | grep -o '"__ANGLES__":[^}]*' | head -n1 || echo "(__ANGLES__ not found)"
if echo "$ANALYZE" | grep -q "__KEYFRAMES__"; then
  echo "   ✅ Analyzer returned expected keys"
else
  echo "   ⚠ Analyzer missing expected keys — check .smoke.log"
fi
echo "[6] Tail last 30 lines of server log:"
tail -n 30 .smoke.log || true
echo "[7] Clean shutdown (optional)"
kill "$(cat .smoke.pid 2>/dev/null || echo 0)" >/dev/null 2>&1 || true
rm -f .smoke.pid
echo "── Smoke test complete ───────────────────────────"
