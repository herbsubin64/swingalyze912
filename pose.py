# pose.py
from __future__ import annotations
import cv2
import math
from dataclasses import dataclass, asdict
from typing import Dict, Any, Optional, List

try:
    import mediapipe as mp
except Exception as e:
    raise RuntimeError("mediapipe is required. Check requirements.txt / venv.") from e

mp_pose = mp.solutions.pose
L = mp_pose.PoseLandmark


def _midpoint(a, b):
    return ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)

def _angle_deg(vx, vy):
    return math.degrees(math.atan2(vy, vx))

def _angle_to_vertical(p1, p2):
    vx = p2[0] - p1[0]
    vy = p2[1] - p1[1]
    ang = _angle_deg(vx, -vy)  # flip y (image coords)
    if ang > 90:
        ang -= 180
    if ang < -90:
        ang += 180
    return ang

def _angle_to_horizontal(p1, p2):
    vx = p2[0] - p1[0]
    vy = p2[1] - p1[1]
    ang = _angle_deg(vx, -vy)
    if ang > 90:
        ang -= 180
    if ang < -90:
        ang += 180
    return ang

def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


@dataclass
class FrameMetrics:
    frame_index: int
    mid_hip: Optional[tuple] = None
    mid_shoulder: Optional[tuple] = None
    nose: Optional[tuple] = None
    shoulder_tilt_deg: Optional[float] = None
    spine_tilt_deg: Optional[float] = None

@dataclass
class VideoReport:
    ok: bool
    frames_processed: int
    sampled_every_n: int
    address: Dict[str, Any]
    stability: Dict[str, Any]
    notes: List[str]
    def to_dict(self): return asdict(self)


def analyze_video(video_path: str, sample_every_n: int = 5) -> Dict[str, Any]:
    """
    Headless metrics only (no overlays):
      - Address posture (first good frame)
      - Spine tilt change (max vs address)
      - Pelvis sway (mid-hip x)
      - Head movement (nose displacement)
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"ok": False, "error": "Could not open video"}

    frame_i = -1
    frames: List[FrameMetrics] = []
    address_frame: Optional[FrameMetrics] = None

    with mp_pose.Pose(
        static_image_mode=False,
        model_complexity=1,
        enable_segmentation=False,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as pose:

        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame_i += 1
            if frame_i % sample_every_n != 0:
                continue

            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = pose.process(rgb)
            if not res.pose_landmarks:
                continue

            lm = res.pose_landmarks.landmark
            h, w = frame.shape[:2]

            def P(idx: L):
                p = lm[idx]
                return (p.x * w, p.y * h)

            l_sh, r_sh = P(L.LEFT_SHOULDER), P(L.RIGHT_SHOULDER)
            l_hip, r_hip = P(L.LEFT_HIP), P(L.RIGHT_HIP)
            nose = P(L.NOSE)
            mid_sh = _midpoint(l_sh, r_sh)
            mid_hip = _midpoint(l_hip, r_hip)

            shoulder_tilt = _angle_to_horizontal(r_sh, l_sh)
            spine_tilt = _angle_to_vertical(mid_hip, mid_sh)

            fm = FrameMetrics(
                frame_index=frame_i,
                mid_hip=mid_hip,
                mid_shoulder=mid_sh,
                nose=nose,
                shoulder_tilt_deg=shoulder_tilt,
                spine_tilt_deg=spine_tilt,
            )

            if address_frame is None:
                address_frame = fm
            frames.append(fm)

    cap.release()

    if not frames or address_frame is None:
        return {"ok": False, "error": "No pose detected. Try better lighting/angle."}

    addr_mid_hip = address_frame.mid_hip
    addr_nose = address_frame.nose
    addr_spine = address_frame.spine_tilt_deg or 0.0

    pelvis_sway_px = 0.0
    head_move_px = 0.0
    max_spine_tilt_change = 0.0

    for fm in frames:
        if fm.mid_hip and addr_mid_hip:
            pelvis_sway_px = max(pelvis_sway_px, abs(fm.mid_hip[0] - addr_mid_hip[0]))
        if fm.nose and addr_nose:
            head_move_px = max(head_move_px, _dist(fm.nose, addr_nose))
        if fm.spine_tilt_deg is not None:
            max_spine_tilt_change = max(max_spine_tilt_change, abs(fm.spine_tilt_deg - addr_spine))

    report = VideoReport(
        ok=True,
        frames_processed=len(frames),
        sampled_every_n=sample_every_n,
        address={
            "shoulder_tilt_deg": address_frame.shoulder_tilt_deg,
            "spine_tilt_deg": address_frame.spine_tilt_deg,
        },
        stability={
            "pelvis_sway_px_max": round(pelvis_sway_px, 2),
            "head_movement_px_max": round(head_move_px, 2),
            "spine_tilt_change_deg_max": round(max_spine_tilt_change, 2),
        },
        notes=["Headless metrics only. Overlay/phase detection can be added next."],
    )
    return report.to_dict()
