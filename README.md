# Swingalyze Coach v2.6.0 — Full Rewrite (2025-09-19)

Adds **per-slot measured angles** and **Export JSON Report** (alongside the PNG strip).
API unchanged: `GET /api/status`, `POST /api/analyze?g=golf1`.

## Start
npm install
PORT=3001 npm start

## Workflow
1) Upload a swing.
2) Select a keyframe slot → navigate → **Set Frame**.
3) Draw lines (Ground/Spine/Shaft) for that slot.
4) Repeat for all slots.
5) Click **Analyze** (to store metrics for the report).
6) **Export PNG Report** (5-panel strip) or **Export JSON Report** for data sharing.

## JSON Report schema
{
  "build": "Swingalyze Coach v2.6.0",
  "generated_at": "ISO timestamp",
  "analyzer": { ... last /api/analyze payload ... },
  "slots": {
    "<slot>": {
      "frame_sec": Number|null,
      "thumbnail_png": "data:image/png;base64,...",
      "overlays": [{ mode, x1,y1,x2,y2, frame }, ...],
      "measured_angles": {
        "groundToHorizontal_deg": Number|null,
        "spineToVertical_deg": Number|null,
        "shaftToGround_deg": Number|null
      }
    }
  }
}
