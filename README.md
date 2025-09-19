# Swingalyze Coach v2.7.0 — Analyzer Bridge (2025-09-19)

Adds upload→jobId→analyze flow:
- POST /api/upload  (raw video bytes; Content-Type video/*) -> { jobId }
- POST /api/analyze (body { jobId }) -> mock metrics (swap adapter later)
- GET  /api/job/:id/status

UI auto-uploads when you pick a file and sends jobId to /api/analyze.
Server binds to 0.0.0.0 for Codespaces.

Start:
  npm install
  npx kill-port 3001 || true
  PORT=3001 npm start
