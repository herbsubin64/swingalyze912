# Swingalyze (Checkpoint Sept 17, 2025) — API-first Coaching + PNG Report

This change adds a **client-side Export PNG Report** button while preserving the API-first flow.
Assumptions (already present in your backend):

- `GET /api/status`
- `POST /api/analyze` (expects `FormData` with file field `video`)
  - Returns JSON including: `keyframes`, `series`, `angles`, `stance`, `tempo`, `coaching[]`

## Files
- `/public/index.html` — mobile-first UI
- `/public/app.js` — calls `/api/analyze`, renders summary, and exports a PNG report
- `/public/styles.css` — light styling

## How to use
1. Serve `/public` as static root (your current server already does this).
2. Open the app, upload a swing video (MP4/MOV). Click **Analyze**.
3. After results show, click **Export PNG Report** to download a one-page image with key metrics & coaching.

## Notes
- Report focuses on **impact frame** plus metrics (tempo, angles, stance) and `coaching[]` bullet points.
- Keyframes from API are used to select a representative frame if available; otherwise fallback is `video.currentTime`.
- No server changes required if `/api/status` and `/api/analyze` already work.
