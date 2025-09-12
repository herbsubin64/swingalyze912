# pose.py
# Minimal, robust MediaPipe-based pose analysis that extracts a few
# swing landmarks and angles without altering the frontend.

from __future__ import annotations
import math
import cv2
import mediapipe as mp

mp_pose = mp.solutions.pose

# Landmarks we care about (MediaPipe indices)
# https://developers.google.com/mediapipe/solutions/vision/pose_landmarker#pose_landmarks
L = mp_pose.PoseLandmark

WANTED = [
    L.NOSE,
    L.LEFT_SHOULDER, L.RIGHT_SHOULDER,
    L.LEFT_ELBOW, L.RIGHT_ELBOW,
    L.LEFT_WRIST, L.RIGHT_WRIST,
    L.LEFT_HIP, L.RIGHT_HIP,
    L.LEFT_KNEE, L.RIGHT_KNEE,
    L.LEFT_ANKLE, L.RIGHT_ANKLE,
]

def _angle(a, b, c) -> float:
    """Angle at point b given points a,b,c in 2D (degrees)."""
    try:
        ab = (a[0]-b[0], a[1]-b[1])
        cb = (c[0]-b[0], c[1]-b[1])
        dot = ab[0]*cb[0] + ab[1]*cb[1]
        nab = math.hypot(*ab)
        ncb = math.hypot(*cb)
        if nab == 0 or ncb == 0:
            return float('nan')
        cosang = max(-1.0, min(1.0, dot/(nab*ncb)))
        return math.degrees(math.acos(cosang))
    except Exception:
        return float('nan')

def _pt(landmarks, idx):
    lm = landmarks[idx]
    return (lm.x, lm.y)

def analyze_video(path: str, max_frames: int = 900, frame_step: int = 2) -> dict:
    """
    Extracts coarse swing phases + a few joint angles across the clip.
    Returns a compact JSON-ready dict.
    - max_frames: upper bound to avoid runaway processing on long videos
    - frame_step: sample every Nth frame for speed
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return {"ok": False, "error": "Could not open video."}

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    length = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    # Results
    samples = []   # per-sample small record
    events  = {}   # detected swing moments (address, top, impact approx.)

    # MediaPipe Pose (static_image_mode=False for video)
    with mp_pose.Pose(model_complexity=1, enable_segmentation=False, smooth_landmarks=True) as pose:
        frame_idx = 0
        sampled   = 0
        address_frame = None
        top_frame     = None
        impact_frame  = None

        max_to_process = min(length, max_frames) if length > 0 else max_frames

        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame_idx += 1
            if frame_idx % frame_step != 0:
                continue
            if sampled >= max_to_process:
                break

            # Convert BGR to RGB
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = pose.process(rgb)
            if not res.pose_landmarks:
                continue

            lm = res.pose_landmarks.landmark
            pts = { name.name: _pt(lm, name) for name in WANTED }

            # Simple angles (left/right elbow, shoulder tilt, hip tilt)
            left_elbow  = _angle(pts["LEFT_SHOULDER"], pts["LEFT_ELBOW"], pts["LEFT_WRIST"])
            right_elbow = _angle(pts["RIGHT_SHOULDER"], pts["RIGHT_ELBOW"], pts["RIGHT_WRIST"])

            # Shoulder tilt = angle between line (L shoulder -> R shoulder) and horizontal
            ls = pts["LEFT_SHOULDER"]; rs = pts["RIGHT_SHOULDER"]
            shoulder_tilt = math.degrees(math.atan2((ls[1]-rs[1]), (ls[0]-rs[0])))

            # Hip tilt
            lh = pts["LEFT_HIP"]; rh = pts["RIGHT_HIP"]
            hip_tilt = math.degrees(math.atan2((lh[1]-rh[1]), (lh[0]-rh[0])))

            # Crude club proxy using wrists: "backswing height" ~ min y of wrists (normalized)
            lw = pts["LEFT_WRIST"]; rw = pts["RIGHT_WRIST"]
            hands_height = min(lw[1], rw[1])  # lower value = higher on screen

            samples.append({
                "f": frame_idx,
                "t": frame_idx / fps,
                "angles": {
                    "left_elbow": round(left_elbow, 1) if left_elbow==left_elbow else None,
                    "right_elbow": round(right_elbow, 1) if right_elbow==right_elbow else None,
                    "shoulder_tilt": round(shoulder_tilt, 1),
                    "hip_tilt": round(hip_tilt, 1),
                },
                "hands_h": round(hands_height, 4),
            })
            sampled += 1

        cap.release()

    if not samples:
        return {"ok": False, "error": "No pose detected in sampled frames."}

    # Very simple event picks:
    # - Address: earliest frame with small shoulder/hip motion (first pose)
    # - Top of backswing: frame with MIN hands_h (highest hands)
    # - Impact: frame where shoulder_tilt crosses back toward address tilt (rough heuristic)
    address_frame = samples[0]["f"]

    min_hands = min(samples, key=lambda s: s["hands_h"])
    top_frame = min_hands["f"]

    # crude impact: pick the sample closest in time to top where shoulder_tilt changes sign vs top delta
    top_idx = next(i for i, s in enumerate(samples) if s["f"] == top_frame)
    impact_candidate = None
    base_tilt = samples[0]["angles"]["shoulder_tilt"]
    for s in samples[top_idx:]:
        if base_tilt is None or s["angles"]["shoulder_tilt"] is None:
            continue
        # when shoulder tilt comes back within ~5 degrees of address
        if abs(s["angles"]["shoulder_tilt"] - base_tilt) < 5:
            impact_candidate = s
            break
    impact_frame = (impact_candidate["f"] if impact_candidate else samples[-1]["f"])

    events = {
        "address": {"frame": address_frame, "time": round(address_frame/ fps, 3)},
        "top":     {"frame": top_frame,     "time": round(top_frame    / fps, 3)},
        "impact":  {"frame": impact_frame,  "time": round(impact_frame / fps, 3)},
    }

    return {
        "ok": True,
        "video": {
            "fps": fps, "frames": length, "width": width, "height": height,
            "sampled": len(samples), "step": frame_step
        },
        "events": events,
        "samples": samples[:300],  # keep payload modest; adjust as needed
    }
