# pose.py — lightweight MediaPipe-based pose analysis + overlay render
from __future__ import annotations
import csv
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Tuple, Optional, List

import cv2
import numpy as np
import mediapipe as mp

mp_pose = mp.solutions.pose

# ---- math helpers -----------------------------------------------------------

def angle_between(p1, p2, p3) -> Optional[float]:
    """Return angle at p2 (in degrees) for points p1-p2-p3; None if invalid."""
    if None in (p1, p2, p3):
        return None
    v1 = np.array([p1[0] - p2[0], p1[1] - p2[1]], dtype=np.float32)
    v2 = np.array([p3[0] - p2[0], p3[1] - p2[1]], dtype=np.float32)
    n1 = np.linalg.norm(v1)
    n2 = np.linalg.norm(v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return None
    cosang = np.dot(v1, v2) / (n1 * n2)
    cosang = np.clip(cosang, -1.0, 1.0)
    return float(np.degrees(np.arccos(cosang)))


def line_angle(p1, p2) -> Optional[float]:
    """Angle of line p1->p2 vs horizontal, in degrees [-180, 180]."""
    if None in (p1, p2):
        return None
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return None
    return float(np.degrees(np.arctan2(-dy, dx)))  # screen y grows downward


def to_xy(lmk, w, h) -> Tuple[float, float]:
    return (lmk.x * w, lmk.y * h)


# ---- core analysis ----------------------------------------------------------

def analyze_video(
    input_path: str,
    results_dir: str,
    make_overlay: bool = True,
    target_max_w: int = 1280,
    target_max_h: int = 720,
    overlay_fps: int = 24,
) -> Tuple[Dict, int, Optional[str], Optional[str]]:
    """
    Returns: (summary, frames_analyzed, keypoints_csv_path, overlay_mp4_path)
    """
    results = Path(results_dir)
    results.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        return (
            {
                "avg_shoulder_turn_deg": None,
                "avg_lead_arm_deg": None,
                "avg_trail_knee_deg": None,
                "notes": "Could not open video.",
            },
            0,
            None,
            None,
        )

    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(src_fps // 5))  # sample ~5 fps

    # output filenames
    clip_id = Path(input_path).stem
    csv_path = results / f"{clip_id}_keypoints.csv"
    overlay_path = results / f"{clip_id}_overlay.mp4"

    # CSV header
    header = [
        "frame_idx",
        "LShoulder.x",
        "LShoulder.y",
        "RShoulder.x",
        "RShoulder.y",
        "LWrist.x",
        "LWrist.y",
        "LElbow.x",
        "LElbow.y",
        "LHip.x",
        "LHip.y",
        "RKnee.x",
        "RKnee.y",
        "RAnkle.x",
        "RAnkle.y",
        "shoulder_line_deg",
        "lead_arm_deg",
        "trail_knee_deg",
    ]
    csv_f = csv_path.open("w", newline="")
    writer = csv.writer(csv_f)
    writer.writerow(header)

    # overlay writer (optional)
    vw = None
    if make_overlay:
        out_w, out_h = fit_box(src_w, src_h, target_max_w, target_max_h)
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        vw = cv2.VideoWriter(str(overlay_path), fourcc, float(overlay_fps), (out_w, out_h))

    # accumulators
    shoulders_acc: List[float] = []
    lead_arm_acc: List[float] = []
    trail_knee_acc: List[float] = []

    with mp_pose.Pose(
        static_image_mode=False,
        enable_segmentation=False,
        model_complexity=1,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
        smooth_landmarks=True,
    ) as pose:
        frame_idx = 0
        sample_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            if frame_idx % step != 0:
                frame_idx += 1
                continue

            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = pose.process(rgb)
            lm = res.pose_landmarks.landmark if res.pose_landmarks else None

            # Extract a small set we need (2D pixel coords)
            def P(i):
                return to_xy(lm[i], w, h) if (lm and 0 <= i < len(lm)) else None

            LShoulder = P(mp_pose.PoseLandmark.LEFT_SHOULDER.value)
            RShoulder = P(mp_pose.PoseLandmark.RIGHT_SHOULDER.value)
            LElbow = P(mp_pose.PoseLandmark.LEFT_ELBOW.value)
            LWrist = P(mp_pose.PoseLandmark.LEFT_WRIST.value)
            LHip = P(mp_pose.PoseLandmark.LEFT_HIP.value)
            RKnee = P(mp_pose.PoseLandmark.RIGHT_KNEE.value)
            RAnkle = P(mp_pose.PoseLandmark.RIGHT_ANKLE.value)

            # Metrics
            shoulder_deg = line_angle(LShoulder, RShoulder)  # line across shoulders vs horizontal
            lead_arm = angle_between(LShoulder, LElbow, LWrist)  # elbow angle (lead arm)
            trail_knee = angle_between(LHip, RKnee, RAnkle)  # knee flex angle

            if shoulder_deg is not None:
                shoulders_acc.append(shoulder_deg)
            if lead_arm is not None:
                lead_arm_acc.append(lead_arm)
            if trail_knee is not None:
                trail_knee_acc.append(trail_knee)

            # Write CSV row
            row = [
                frame_idx,
                *(LShoulder or (None, None)),
                *(RShoulder or (None, None)),
                *(LWrist or (None, None)),
                *(LElbow or (None, None)),
                *(LHip or (None, None)),
                *(RKnee or (None, None)),
                *(RAnkle or (None, None)),
                shoulder_deg,
                lead_arm,
                trail_knee,
            ]
            writer.writerow(row)

            # Overlay frame
            if vw is not None:
                disp = draw_overlay(frame, LShoulder, RShoulder, LElbow, LWrist, LHip, RKnee, RAnkle,
                                    shoulder_deg, lead_arm, trail_knee)
                disp = resize_fit(disp, out_w, out_h)
                vw.write(disp)

            frame_idx += 1
            sample_idx += 1

    cap.release()
    csv_f.close()
    if vw is not None:
        vw.release()

    summary = {
        "avg_shoulder_turn_deg": round(np.nanmean(shoulders_acc), 1) if shoulders_acc else None,
        "avg_lead_arm_deg": round(np.nanmean(lead_arm_acc), 1) if lead_arm_acc else None,
        "avg_trail_knee_deg": round(np.nanmean(trail_knee_acc), 1) if trail_knee_acc else None,
        "notes": "MVP metrics (downsampled). Next: add clean Greenside-style overlay.",
    }

    return summary, len(shoulders_acc), str(csv_path), (str(overlay_path) if make_overlay else None)


# ---- overlay helpers --------------------------------------------------------

GREEN = (80, 220, 120)
CYAN = (200, 255, 255)
YELLOW = (50, 230, 230)
WHITE = (240, 240, 240)
RED = (80, 80, 255)
GREY = (60, 60, 60)

def draw_line(img, p1, p2, color, t=2):
    if p1 and p2:
        cv2.line(img, (int(p1[0]), int(p1[1])), (int(p2[0]), int(p2[1])), color, t)

def draw_dot(img, p, color, r=4):
    if p:
        cv2.circle(img, (int(p[0]), int(p[1])), r, color, -1)

def put_text(img, text, org, color=WHITE, scale=0.6, thick=2):
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thick, cv2.LINE_AA)

def draw_overlay(frame, LShoulder, RShoulder, LElbow, LWrist, LHip, RKnee, RAnkle,
                 shoulder_deg, lead_arm, trail_knee):
    canvas = frame.copy()
    # skeleton bits we track
    draw_line(canvas, LShoulder, RShoulder, CYAN, 3)
    draw_line(canvas, LShoulder, LElbow, GREEN, 3)
    draw_line(canvas, LElbow, LWrist, GREEN, 3)
    draw_line(canvas, LHip, RKnee, YELLOW, 3)
    draw_line(canvas, RKnee, RAnkle, YELLOW, 3)

    for p in (LShoulder, RShoulder, LElbow, LWrist, LHip, RKnee, RAnkle):
        draw_dot(canvas, p, WHITE, 4)

    # HUD
    h, w = canvas.shape[:2]
    x, y = 18, 28
    box_w = 360
    cv2.rectangle(canvas, (12, 8), (12 + box_w, 8 + 90), (0, 0, 0), -1)
    cv2.rectangle(canvas, (12, 8), (12 + box_w, 8 + 90), GREY, 1)

    put_text(canvas, f"Shoulder line: {fmt(shoulder_deg)} deg", (x, y), CYAN)
    put_text(canvas, f"Lead arm:      {fmt(lead_arm)} deg", (x, y + 26), GREEN)
    put_text(canvas, f"Trail knee:    {fmt(trail_knee)} deg", (x, y + 52), YELLOW)
    return canvas

def fmt(v):
    return "—" if v is None else f"{v:.1f}"

def fit_box(w, h, max_w, max_h) -> Tuple[int, int]:
    s = min(max_w / max(1, w), max_h / max(1, h))
    return max(1, int(w * s)), max(1, int(h * s))

def resize_fit(img, out_w, out_h):
    return cv2.resize(img, (out_w, out_h), interpolation=cv2.INTER_AREA)
