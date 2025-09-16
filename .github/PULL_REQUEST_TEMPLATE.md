## What
- Angles v1: optional ANGLES in analyzer, server passthrough, UI rendering (feature-flagged)

## Why
- Progress toward robust analyzer without breaking baseline; keeps contract stable and gates unchanged.

## How tested
- curl /api/status and /api/analyze on golf1.mp4 and upload.mp4
- UI shows Keyframes / Series / Angles
- Angles return null gracefully if ROI/lines not detected

## Notes
- ANGLES not gated yet; future PR will add fixtures/goldens + tolerances.
