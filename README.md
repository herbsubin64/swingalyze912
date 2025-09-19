# Swingalyze Coach v2.5.0 — Full Rewrite (2025-09-19)

Adds **keyframe slots** (Address/Club-parallel/Top/Impact/Follow-through), **per-slot overlays**, **Set Frame** capture, and a cleaner **5-keyframe PNG report**. API is unchanged.

## Start
npm install
PORT=3001 npm start

## Workflow
1) Upload a swing.
2) Click a keyframe slot → navigate the video → **Set Frame** to capture a thumbnail.
3) Draw lines for that slot (Ground/Spine/Shaft).
4) Repeat for the other slots.
5) Click **Analyze** to see coaching tips (tempo + current slot angles).
6) **Export PNG Report** → 5 panels (one per slot) with overlays + banner.

## Notes
- If no thumbnail is set for a slot, the report uses the current frame for that panel.
- Keep the API stable when swapping in your real analyzer.
