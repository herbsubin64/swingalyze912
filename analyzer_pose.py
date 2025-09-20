#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Swingalyze Analyzer v3.2.0 (full rewrite)
- MediaPipe-based pose extraction
- Horizon correction for both angles (camera tilt)
- Tempo estimation from lead wrist motion
- Clean JSON output the server/UI expect

CLI:
  python3 analyzer_pose.py <video_path> [--horizon=FLOAT] [--fps=30] [--max-frames=3000]

Output JSON:
{
  "tempo": {"back": float, "down": float, "ratio": float, "confidence": float},
  "pose": {"angles": {"spineToVertical_deg": float, "leadArmToGround_deg": float}, "confidence": float}
}
"""

import os, sys, json, math, argparse
import numpy as np

def _clamp(x, lo, hi): return max(lo, min(hi, x))

# ---- safe imports with friendly errors ----
try:
    import cv2
except Exception as e:
    print(json.dumps({
        "tempo":{"back":0.0,"down":0.0,"ratio":0.0,"confidence":0.0},
        "pose":{"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.0},
        "error": f"OpenCV import failed: {e}. Try: sudo apt-get install -y libgl1 libglib2.0-0 && pip install opencv-python-headless"
    }), flush=True); sys.exit(0)

try:
    import mediapipe as mp
except Exception as e:
    print(json.dumps({
        "tempo":{"back":0.0,"down":0.0,"ratio":0.0,"confidence":0.0},
        "pose":{"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.0},
        "error": f"Mediapipe import failed: {e}. Try: pip install 'mediapipe>=0.10.11,<0.11'"
    }), flush=True); sys.exit(0)

# ---- helpers ----
def angle_deg_between(v1, v2):
    a = np.array(v1, float); b = np.array(v2, float)
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0: return None
    c = float(np.dot(a,b)/(na*nb)); c = _clamp(c,-1.0,1.0)
    return math.degrees(math.acos(c))

def moving_average(x, k):
    if k <= 1: return np.asarray(x, float)
    x = np.asarray(x, float); k = int(k); 
    if k % 2 == 0: k += 1
    pad = k//2; xx = np.pad(x, (pad,pad), mode='edge')
    ker = np.ones(k)/k
    return np.convolve(xx, ker, mode='valid')

def estimate_tempo_from_wrist(ts, y_series):
    y = np.asarray(y_series, float); t = np.asarray(ts, float)
    if len(y) < 15 or len(t)!=len(y): return (0.0,0.0,0.0,0.0)
    ys = moving_average(y, k=max(3, len(y)//50))
    vy = np.gradient(ys, t)
    i_top = int(np.argmin(ys))
    i_imp = i_top
    if i_top < len(vy)-1: i_imp = int(np.argmax(vy[i_top+1:])) + i_top + 1
    t_back = max(0.0, float(t[i_top]-t[0]))
    t_down = max(0.0, float(t[i_imp]-t[i_top]))
    ratio = (t_back/t_down) if t_down>1e-3 else 0.0
    peak = float(np.max(vy)) if vy.size else 0.0
    spread = float(np.std(vy))
    conf = 0.0
    if peak>0 and spread>0: conf = _clamp((peak/(spread*6.0)), 0.0, 1.0)
    if 0.4<=t_back<=6.5 and 0.15<=t_down<=3.5: conf = _clamp(conf+0.15,0.0,1.0)
    return (round(t_back,3), round(t_down,3), round(ratio,3), round(conf,2))

def compute_pose_angles(landmarks, img_w, img_h, horizon_deg=None, right_handed=True):
    mp_pose = mp.solutions.pose.PoseLandmark
    ls = landmarks[mp_pose.LEFT_SHOULDER.value]
    rs = landmarks[mp_pose.RIGHT_SHOULDER.value]
    lh = landmarks[mp_pose.LEFT_HIP.value]
    rh = landmarks[mp_pose.RIGHT_HIP.value]
    lead_sh = landmarks[mp_pose.LEFT_SHOULDER.value] if right_handed else landmarks[mp_pose.RIGHT_SHOULDER.value]
    lead_wr = landmarks[mp_pose.LEFT_WRIST.value]    if right_handed else landmarks[mp_pose.RIGHT_WRIST.value]
    need = [ls,rs,lh,rh,lead_sh,lead_wr]
    if any(l is None for l in need): return (None,None,0.0)

    vis = [getattr(l,"visibility",0.0) for l in need]
    vis_conf = float(np.mean([v for v in vis if v is not None])) if vis else 0.0

    def px(lm): return np.array([lm.x*img_w, lm.y*img_h], float)
    LS,RS,LH,RH,LSH,LWR = map(px, need)

    mid_sh = (LS+RS)/2.0; mid_hp = (LH+RH)/2.0
    spine_vec = mid_sh - mid_hp
    vertical = np.array([0.0,-1.0], float)
    spine_raw = angle_deg_between(spine_vec, vertical)

    arm_vec = LWR - LSH
    horizontal = np.array([1.0,0.0], float)
    arm_raw = angle_deg_between(arm_vec, horizontal)
    if spine_raw is None or arm_raw is None:
        return (None,None,_clamp(vis_conf,0.0,0.95))

    if horizon_deg is not None:
        H = float(horizon_deg)
        spine = abs(spine_raw - H)
        arm   = abs(arm_raw - H)
    else:
        spine = float(spine_raw); arm = float(arm_raw)

    spine = _clamp(spine,0.0,90.0); arm = _clamp(arm,0.0,180.0)

    spine_len = float(np.linalg.norm(spine_vec))
    arm_len   = float(np.linalg.norm(arm_vec))
    diag = float(np.linalg.norm([img_w,img_h]))
    lconf = 0.0
    if diag>0: lconf = _clamp(0.5*((spine_len/diag)+(arm_len/diag))*4.0,0.0,1.0)
    pose_conf = _clamp(0.6*vis_conf + 0.4*lconf, 0.0, 1.0)
    return (round(spine,1), round(arm,1), round(pose_conf,2))

def analyze_video(path, horizon=None, fps_hint=30, max_frames=3000):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return {"tempo":{"back":0.0,"down":0.0,"ratio":0.0,"confidence":0.0},
                "pose":{"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.0}}
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps<=0 or fps>240: fps = float(fps_hint)
    dt = 1.0/max(fps,1e-6)

    mp_pose = mp.solutions.pose
    pose = mp_pose.Pose(static_image_mode=False, model_complexity=1,
                        enable_segmentation=False, min_detection_confidence=0.5,
                        min_tracking_confidence=0.5, smooth_landmarks=True)

    ts, wrist_y, spine_list, arm_list, conf_list = [], [], [], [], []
    frame_idx = 0
    try:
        while frame_idx < max_frames:
            ok, frame = cap.read()
            if not ok: break
            frame_idx += 1
            h,w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = pose.process(rgb)
            if res.pose_landmarks:
                lms = res.pose_landmarks.landmark
                s,a,pconf = compute_pose_angles(lms, w,h, horizon_deg=horizon, right_handed=True)
                spine_list.append(s); arm_list.append(a); conf_list.append(pconf)
                lw = lms[mp_pose.PoseLandmark.LEFT_WRIST.value]
                wy = lw.y*h if lw is not None else np.nan
                wrist_y.append(wy); ts.append(frame_idx*dt)
            else:
                wrist_y.append(np.nan); ts.append(frame_idx*dt)
                spine_list.append(None); arm_list.append(None); conf_list.append(0.0)
    finally:
        cap.release(); pose.close()

    ts = np.asarray(ts,float); wy = np.asarray(wrist_y,float)
    if np.all(np.isnan(wy)):
        t_back=t_down=ratio=t_conf=0.0
    else:
        nans = np.isnan(wy)
        if np.any(nans):
            good = ~nans
            wy[nans] = np.interp(np.flatnonzero(nans), np.flatnonzero(good), wy[good])
        t_back,t_down,ratio,t_conf = estimate_tempo_from_wrist(ts, wy)

    s_valid = np.array([v for v in spine_list if isinstance(v,(int,float))], float)
    a_valid = np.array([v for v in arm_list if isinstance(v,(int,float))], float)
    c_valid = np.array([v for v in conf_list if isinstance(v,(int,float))], float)

    if s_valid.size==0 or a_valid.size==0:
        pose_angles = {"spineToVertical_deg":None,"leadArmToGround_deg":None}
        pose_conf = 0.0
    else:
        spine_med = float(np.median(s_valid))
        arm_med   = float(np.median(a_valid))
        pose_conf = float(np.median(c_valid)) if c_valid.size else 0.0
        pose_angles = {"spineToVertical_deg":round(spine_med,1),
                       "leadArmToGround_deg":round(arm_med,1)}
        pose_conf = round(_clamp(pose_conf,0.0,1.0),2)

    return {"tempo":{"back":t_back,"down":t_down,"ratio":ratio,"confidence":t_conf},
            "pose":{"angles":pose_angles,"confidence":pose_conf}}

def main():
    ap = argparse.ArgumentParser(description="Swingalyze analyzer (pose + tempo)")
    ap.add_argument("video", help="Path to input video (mp4/mov/etc.)")
    ap.add_argument("--horizon", type=float, default=None, help="Camera tilt in degrees; subtract from angles")
    ap.add_argument("--fps", type=float, default=30.0, help="Fallback FPS if not discoverable")
    ap.add_argument("--max-frames", type=int, default=3000, help="Max frames to process")
    args = ap.parse_args()

    if not os.path.isfile(args.video):
        print(json.dumps({
            "tempo":{"back":0.0,"down":0.0,"ratio":0.0,"confidence":0.0},
            "pose":{"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.0},
            "error": f"File not found: {args.video}"
        }), flush=True); sys.exit(0)

    try:
        out = analyze_video(args.video, horizon=args.horizon, fps_hint=args.fps, max_frames=args.max_frames)
    except Exception as e:
        out = {"tempo":{"back":0.0,"down":0.0,"ratio":0.0,"confidence":0.0},
               "pose":{"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.0},
               "error": f"analyze_video exception: {e.__class__.__name__}: {e}"}
    print(json.dumps(out), flush=True)

if __name__ == "__main__":
    main()
